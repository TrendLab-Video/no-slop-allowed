// Optional search providers for the references stage, behind one small interface.
//   searchProvider()            -> 'tavily' | 'parallel' | null (key-gated: TAVILY_API_KEY, then PARALLEL_API_KEY)
//   search(query, opts)         -> { provider, query, results: [{ title, url, snippet, publishedAt, image }], images: [{ url, description }] }
//   pageImages(url)             -> [imageUrl]  (Tavily Extract; Parallel has no image output)
//   imageSearch(query, n)       -> [{ url, description }]  (Tavily Search images; Parallel: [])
// Docs used: https://docs.tavily.com/documentation/api-reference/endpoint/search.md, .../extract.md,
// https://docs.parallel.ai/api-reference/search/web. Base URLs can be overridden for tests.
import { loadEnv } from './env.mjs';

const TIMEOUT = 15000;
const tavilyBase = () => process.env.TAVILY_BASE_URL || 'https://api.tavily.com';
const parallelBase = () => process.env.PARALLEL_BASE_URL || 'https://api.parallel.ai';

export function searchProvider(prefer) {
  loadEnv();
  const has = { tavily: !!process.env.TAVILY_API_KEY, parallel: !!process.env.PARALLEL_API_KEY };
  if (prefer && has[prefer]) return prefer;
  return has.tavily ? 'tavily' : has.parallel ? 'parallel' : null;
}

export const NO_KEY = 'No search key configured: set TAVILY_API_KEY or PARALLEL_API_KEY in .env, or use the agent\'s built-in web search.';

async function post(url, headers, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

const tavily = (path, body) => post(`${tavilyBase()}${path}`, { Authorization: `Bearer ${process.env.TAVILY_API_KEY}` }, body);
const parallel = (path, body) => post(`${parallelBase()}${path}`, { 'x-api-key': process.env.PARALLEL_API_KEY }, body);
const imgUrl = (i) => (typeof i === 'string' ? i : i?.url) || null;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };
export function decodeEntities(s) {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+|#39);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}
const clean = (s, n = 400) => (s ? decodeEntities(String(s)).replace(/\s+/g, ' ').trim().slice(0, n) : '');
// Providers return RFC 1123 ("Fri, 19 Jun 2026 12:19:37 GMT") or YYYY-MM-DD: normalise to YYYY-MM-DD.
const isoDate = (s) => { if (!s) return null; const t = Date.parse(s); return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : String(s); };
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const domainList = (d) => (Array.isArray(d) ? d : String(d || '').split(',')).map((x) => x.trim()).filter(Boolean);

// Video platforms for post-level references (feed fetch-ref / yt-dlp frames).
export const VIDEO_DOMAINS = ['tiktok.com', 'youtube.com', 'instagram.com'];
export const VIDEO_POST = /(tiktok\.com\/@[^/]+\/video\/|vm\.tiktok\.com\/|youtube\.com\/(watch\?|shorts\/)|youtu\.be\/|instagram\.com\/(reel|reels|p)\/|(x|twitter)\.com\/[^/]+\/status\/)/i;
export const isVideoPost = (u) => VIDEO_POST.test(String(u || ''));
// Tavily returns TikTok images as tiktok.com/api/img/?itemId=<videoId> (403 to plain fetches). The id is the
// video's: rebuild a post URL that yt-dlp and TikTok oEmbed accept (the @handle segment is not checked).
export function tiktokPostFromImage(u) {
  const m = String(u || '').match(/tiktok\.com\/api\/img\/?\?(?:.*&)?itemId=(\d+)/);
  return m ? `https://www.tiktok.com/@_/video/${m[1]}` : null;
}

// recency: day | week | month | year; days: n (overrides recency); domains: restrict to these sites.
export async function search(query, { max = 8, recency = 'year', days, domains, provider } = {}) {
  const p = searchProvider(provider);
  if (!p) throw new Error(NO_KEY);
  const include = domainList(domains);
  if (p === 'tavily') {
    const body = {
      query, max_results: Math.min(20, max), search_depth: 'basic', topic: 'general',
      include_images: true, include_image_descriptions: true, include_published_date: true,
    };
    if (days) body.start_date = daysAgo(Number(days));
    else body.time_range = recency;
    if (include.length) body.include_domains = include;
    const r = await tavily('/search', body);
    const results = (r.results || []).map((x) => ({ title: clean(x.title, 200), url: x.url, snippet: clean(x.content), publishedAt: isoDate(x.published_date), image: imgUrl(x.images?.[0]), isVideoPost: isVideoPost(x.url) }));
    const images = (r.images || []).map((i) => ({ url: imgUrl(i), description: clean(i?.description || '', 300), postUrl: tiktokPostFromImage(imgUrl(i)) })).filter((i) => i.url);
    // Post-level video URLs ready for fetch-ref: direct results first, then posts recovered from TikTok images.
    const posts = [...new Set([...results.filter((x) => x.isVideoPost).map((x) => x.url), ...images.map((i) => i.postUrl).filter(Boolean)])];
    return { provider: p, query, domains: include, results, images, posts };
  }
  const n = Number(days) || { day: 1, week: 7, month: 31, year: 365 }[recency] || 365;
  const source_policy = { after_date: daysAgo(n), ...(include.length ? { include_domains: include } : {}) };
  const r = await parallel('/v1/search', { objective: query, search_queries: [query], mode: 'fast', advanced_settings: { max_results: max, source_policy } });
  return {
    provider: p, query, domains: include,
    results: (r.results || []).map((x) => ({ title: clean(x.title, 200), url: x.url, snippet: clean((x.excerpts || []).join(' ')), publishedAt: isoDate(x.publish_date), image: null, isVideoPost: isVideoPost(x.url) })),
    images: [],
    posts: (r.results || []).map((x) => x.url).filter(isVideoPost),
  };
}

// Images found on one page (Tavily Extract). Parallel Extract returns no images.
export async function pageImages(url, provider) {
  const p = searchProvider(provider);
  if (p !== 'tavily') return [];
  const r = await tavily('/extract', { urls: [url], include_images: true, extract_depth: 'basic' });
  return [...new Set((r.results || []).flatMap((x) => (x.images || []).map(imgUrl)).filter(Boolean))];
}

export async function imageSearch(query, n = 4, provider) {
  const p = searchProvider(provider);
  if (p !== 'tavily') return [];
  const r = await search(query, { max: 5, recency: 'year', provider: p });
  return [...r.images, ...r.results.filter((x) => x.image).map((x) => ({ url: x.image, description: x.title }))].slice(0, n);
}
