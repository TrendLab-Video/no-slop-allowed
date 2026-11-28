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
const clip = (s, n = 400) => (s ? String(s).replace(/\s+/g, ' ').trim().slice(0, n) : '');

// recency: day | week | month | year (Tavily time_range; Parallel source_policy.after_date)
export async function search(query, { max = 8, recency = 'year', provider } = {}) {
  const p = searchProvider(provider);
  if (!p) throw new Error(NO_KEY);
  if (p === 'tavily') {
    const r = await tavily('/search', {
      query, max_results: Math.min(20, max), search_depth: 'basic', topic: 'general', time_range: recency,
      include_images: true, include_image_descriptions: true, include_published_date: true,
    });
    return {
      provider: p, query,
      results: (r.results || []).map((x) => ({ title: x.title || '', url: x.url, snippet: clip(x.content), publishedAt: x.published_date || null, image: imgUrl(x.images?.[0]) })),
      images: (r.images || []).map((i) => ({ url: imgUrl(i), description: i?.description || '' })).filter((i) => i.url),
    };
  }
  const days = { day: 1, week: 7, month: 31, year: 365 }[recency] || 365;
  const after = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  const r = await parallel('/v1/search', { objective: query, search_queries: [query], mode: 'fast', advanced_settings: { max_results: max, source_policy: { after_date: after } } });
  return {
    provider: p, query,
    results: (r.results || []).map((x) => ({ title: x.title || '', url: x.url, snippet: clip((x.excerpts || []).join(' ')), publishedAt: x.publish_date || null, image: null })),
    images: [],
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
