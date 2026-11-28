// fetch-ref: download one representative image for a reference and record it in its `screenshots`.
// Never throws for "nothing found": it returns { ok: false, reason } so the stage keeps going.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { runPath, readJson } from '../../lib/store.mjs';
import { updateJson, appendTraceLocked } from '../../lib/lock.mjs';
import { extractFrames, probeDuration } from '../../lib/compositors/ffmpeg.mjs';
import { searchProvider, pageImages, imageSearch, VIDEO_POST, tiktokPostFromImage } from '../../lib/search.mjs';

// "<brand> <product> product photo", product cut to its first clause, brand not repeated.
function brandImageQuery(brand, product) {
  const p = String(product).split(/[(,.;:]/)[0].trim().split(/\s+/).slice(0, 6).join(' ');
  const b = String(brand).trim();
  const both = p.toLowerCase().startsWith(b.toLowerCase()) ? p : `${b} ${p}`;
  return `${both.trim()} product photo front`.replace(/\s+/g, ' ');
}

const onPath = (bin) => spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], { stdio: 'ignore' }).status === 0;

// Run a command with a hard timeout; resolves { code, out, err } and never rejects.
function run(cmd, args, timeoutMs) {
  return new Promise((resolve) => {
    let out = '';
    let err = '';
    let child;
    try { child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { return resolve({ code: -1, out, err: e.message }); }
    const timer = setTimeout(() => { child.kill('SIGKILL'); err += ' timeout'; }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err = (err + d).slice(-20000); });
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, out, err: e.message }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out, err }); });
  });
}

// Video post → references/<id>/video.mp4, 6 frames (frame-N.jpg), duration and a scene-detected cut count.
async function captureVideo(url, dir, tried) {
  if (!VIDEO_POST.test(url) || !onPath('yt-dlp') || !onPath('ffmpeg')) return null;
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, 'video.mp4');
  const dl = await run('yt-dlp', [
    '--no-playlist', '--no-warnings', '--quiet', '--no-progress',
    // Frames only need picture: a video-only h264 stream at <=480p is small and avoids merge failures.
    '-f', 'bv*[height<=480][vcodec^=avc1]/b[height<=480][ext=mp4]/bv*[height<=480]/b[height<=480]/w',
    '--max-filesize', '20M', '--match-filter', 'duration <= 600',
    '--socket-timeout', '10', '--merge-output-format', 'mp4', '--write-info-json', '-o', target, url,
  ], 20000);
  tried.push({ tool: 'yt-dlp', url, result: dl.code === 0 ? 'ok' : `exit ${dl.code}: ${dl.err.trim().split('\n').pop()?.slice(0, 160)}` });
  if (dl.code !== 0 || !fs.existsSync(target) || fs.statSync(target).size < 10000) {
    fs.rmSync(target, { force: true });
    return null;
  }
  try {
    // Keep at most the first 60 s (stream copy, fast).
    if (((await probeDuration(target)) || 0) > 60) {
      const cut = path.join(dir, 'video.60s.mp4');
      const tr = await run('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', target, '-t', '60', '-c', 'copy', cut], 15000);
      if (tr.code === 0 && fs.existsSync(cut)) fs.renameSync(cut, target);
    }
    const durationSeconds = await probeDuration(target);
    const tmp = path.join(dir, '.frames');
    const files = await extractFrames(target, tmp, 6);
    const frames = files.map((f, i) => {
      const dest = path.join(dir, `frame-${i + 1}.jpg`);
      fs.renameSync(f, dest);
      return dest;
    });
    fs.rmSync(tmp, { recursive: true, force: true });
    const sc = await run('ffmpeg', ['-hide_banner', '-i', target, '-vf', "select='gt(scene,0.3)',showinfo", '-an', '-f', 'null', '-'], 20000);
    const cuts = (sc.err.match(/pts_time:/g) || []).length;
    // Platform metrics from yt-dlp's info JSON (real numbers at capture time), kept small.
    let info = null;
    const infoFile = path.join(dir, 'video.info.json');
    try {
      const j = JSON.parse(fs.readFileSync(infoFile, 'utf8'));
      const n = (v) => (Number.isFinite(v) ? v : null);
      info = { title: j.title || null, uploader: j.uploader || j.channel || null, uploadDate: j.upload_date ? `${j.upload_date.slice(0, 4)}-${j.upload_date.slice(4, 6)}-${j.upload_date.slice(6, 8)}` : null, webpageUrl: j.webpage_url || null, originalDurationSeconds: n(j.duration), metrics: { views: n(j.view_count), likes: n(j.like_count), comments: n(j.comment_count), shares: n(j.repost_count) } };
    } catch {}
    fs.rmSync(infoFile, { force: true });
    return { frames, durationSeconds, cuts, secondsPerShot: durationSeconds ? +(durationSeconds / (cuts + 1)).toFixed(2) : null, info };
  } catch (err) {
    tried.push({ tool: 'ffmpeg', url: target, result: err.message.slice(0, 160) });
    return null;
  }
}

export const describe = 'fetch-ref <runId> <referenceId> <url> [--kind brand] [--title t] [--file references.<angle>.json] [--no-video]: video posts (with yt-dlp): 6 frames + measured duration and cuts; otherwise one image (og:image, YouTube thumbnail, oEmbed); adds them to screenshots';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
const TIMEOUT = 8000;
const get = (url, accept = '*/*') => fetch(url, { headers: { 'User-Agent': UA, Accept: accept, 'Accept-Language': 'en' }, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT) });

function youtubeId(u) {
  const m = u.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/);
  return m ? m[1] : null;
}

const decode = (s) => s.replace(/&amp;/g, '&').replace(/&#x2F;/g, '/').replace(/&#47;/g, '/').replace(/&quot;/g, '"');

function metaImages(html, base) {
  const out = [];
  const tags = html.match(/<(meta|link)\b[^>]*>/gi) || [];
  for (const t of tags) {
    const key = (t.match(/\b(?:property|name|rel|itemprop)\s*=\s*["']([^"']+)["']/i) || [])[1]?.toLowerCase();
    const val = (t.match(/\b(?:content|href)\s*=\s*["']([^"']+)["']/i) || [])[1];
    if (!key || !val) continue;
    if (['og:image', 'og:image:secure_url', 'og:image:url', 'twitter:image', 'twitter:image:src', 'image_src', 'image'].includes(key)) {
      try { out.push(new URL(decode(val), base).href); } catch {}
    }
  }
  return out;
}

async function oembedThumb(url) {
  const endpoints = [];
  if (/tiktok\.com\//.test(url)) endpoints.push(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`);
  if (/vimeo\.com\//.test(url)) endpoints.push(`https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`);
  if (/instagram\.com\//.test(url)) endpoints.push(`https://api.instagram.com/oembed?url=${encodeURIComponent(url)}`);
  if (/youtube\.com|youtu\.be/.test(url)) endpoints.push(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`);
  const out = [];
  for (const e of endpoints) {
    try {
      const r = await get(e, 'application/json');
      if (r.ok) { const j = await r.json(); if (j.thumbnail_url) out.push(j.thumbnail_url); }
    } catch {}
  }
  return out;
}

// Product-looking <img> sources on a page (src, data-src, largest srcset entry), skipping icons, logos and sprites.
function pageImgTags(html, base) {
  const out = [];
  for (const t of html.match(/<img\b[^>]*>/gi) || []) {
    const srcset = (t.match(/\b(?:srcset|data-srcset)\s*=\s*["']([^"']+)["']/i) || [])[1];
    const biggest = srcset ? srcset.split(',').map((s) => s.trim().split(/\s+/)).sort((a, b) => (parseInt(b[1]) || 0) - (parseInt(a[1]) || 0))[0]?.[0] : null;
    const src = biggest || (t.match(/\b(?:data-src|src)\s*=\s*["']([^"']+)["']/i) || [])[1];
    if (!src || /^data:|\.svg(\?|$)|logo|icon|sprite|favicon|avatar|badge|pixel|1x1/i.test(src)) continue;
    const w = parseInt((t.match(/\bwidth\s*=\s*["']?(\d+)/i) || [])[1] || '0', 10);
    if (w && w < 300) continue;
    try { out.push(new URL(decode(src), base).href); } catch {}
  }
  return out.slice(0, 8);
}

async function candidates(url, tried, { pageImgs = false } = {}) {
  const list = [];
  const yt = youtubeId(url);
  if (yt) list.push(`https://i.ytimg.com/vi/${yt}/maxresdefault.jpg`, `https://i.ytimg.com/vi/${yt}/hqdefault.jpg`);
  list.push(...(await oembedThumb(url)));
  if (/\.(jpe?g|png|webp)(\?|$)/i.test(url)) list.push(url);
  try {
    const r = await get(url, 'text/html,application/xhtml+xml');
    tried.push({ url, status: r.status });
    if (r.ok && /html/i.test(r.headers.get('content-type') || '')) {
      const html = (await r.text()).slice(0, 800000);
      list.push(...metaImages(html, r.url));
      if (pageImgs) list.push(...pageImgTags(html, r.url));
    }
  } catch (err) {
    tried.push({ url, error: err.name === 'TimeoutError' ? 'timeout' : err.message });
  }
  return [...new Set(list)];
}

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' };

async function download(img, dir, n, minBytes = 2000) {
  const r = await get(img, 'image/avif,image/webp,image/*,*/*');
  const type = (r.headers.get('content-type') || '').split(';')[0].trim();
  if (!r.ok || !type.startsWith('image/') || type === 'image/svg+xml') throw new Error(`${r.status} ${type || 'no type'}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length < minBytes) throw new Error(`too small (${buf.length} B, likely an icon or placeholder)`);
  fs.mkdirSync(dir, { recursive: true });
  const file = `${dir}/${n}.${EXT[type] || 'jpg'}`;
  fs.writeFileSync(file, buf);
  return { file, bytes: buf.length, type };
}

// The references file holding this id (angle files first written by sub-agents), else --file or references.json.
function targetFile(runId, refId, flagFile) {
  if (flagFile) return flagFile;
  const files = fs.existsSync(runPath(runId)) ? fs.readdirSync(runPath(runId)).filter((f) => /^references(\.[\w-]+)?\.json$/.test(f)) : [];
  return files.find((f) => (readJson(runId, f, {}).references || []).some((r) => r.id === refId)) || 'references.json';
}

export default async function ([runId, refId, rawUrl], flags) {
  // A TikTok image URL from search stands for its video post.
  const url = tiktokPostFromImage(rawUrl) || rawUrl;
  if (!runId || !refId || !url) throw new Error('Usage: fetch-ref <runId> <referenceId> <url> [--kind brand] [--title t] [--file f]');
  if (!readJson(runId, 'state.json')) throw new Error(`No run ${runId}`);
  const t0 = Date.now();
  const tried = [];
  const dir = runPath(runId, 'references', refId);
  // 1. Video posts: real frames and measured pacing (yt-dlp + ffmpeg). Any failure falls through to one image.
  const isBrand = flags.kind === 'brand';
  const video = isBrand || flags['no-video'] ? null : await captureVideo(url, dir, tried);
  // 2. Page images. A reference keeps one; the brand keeps up to 2 (og:image can be the back of the product,
  //    so large <img> product shots on the page are candidates too). Brand images must be real photos (>= 15 KB).
  const savedList = [];
  if (!video) {
    let n = 1;
    for (const img of await candidates(url, tried, { pageImgs: isBrand })) {
      try {
        const d = await download(img, dir, n, isBrand ? 15000 : 2000);
        savedList.push({ ...d, source: img });
        n++;
        if (savedList.length >= (isBrand ? 2 : 1)) break;
      } catch (err) {
        tried.push({ url: img, error: err.name === 'TimeoutError' ? 'timeout' : err.message });
      }
    }
  }
  const saved = savedList[0] || null;
  const file = targetFile(runId, refId, typeof flags.file === 'string' ? flags.file : null);
  // 3. Search-provider fallback (key-gated, Tavily only: Parallel returns no images). For references with no
  //    image yet: images on that page (extract), else an image search on title + platform. For the brand:
  //    always add an image search for "<brand> <product> product photo" so goals see the real product.
  const sources = {};
  const extra = [];
  if (!video && (!saved || isBrand) && searchProvider() === 'tavily') {
    const existing = (readJson(runId, file, {}).references || []).find((r) => r.id === refId) || {};
    const brief = readJson(runId, 'brief.json', {});
    const q = typeof flags['image-query'] === 'string' ? flags['image-query']
      : isBrand ? brandImageQuery(brief.promote || flags.title || '', readJson(runId, 'goals.json', {})?.intent?.product || '')
        : `${existing.title || flags.title || refId} ${existing.platform || ''}`.trim();
    let found = [];
    try {
      if (!isBrand) found = (await pageImages(url)).map((u) => ({ url: u, via: 'tavily-extract' }));
      tried.push({ tool: 'tavily-extract', url, result: `${found.length} images` });
    } catch (err) { tried.push({ tool: 'tavily-extract', url, result: err.message.slice(0, 160) }); }
    if (!found.length) {
      try {
        found = (await imageSearch(q, 4)).map((i) => ({ url: i.url, via: 'tavily-image-search', description: i.description }));
        tried.push({ tool: 'tavily-image-search', url: q, result: `${found.length} images` });
      } catch (err) { tried.push({ tool: 'tavily-image-search', url: q, result: err.message.slice(0, 160) }); }
    }
    let n = savedList.length + 1;
    for (const img of found) {
      if (extra.length >= 2) break;
      try {
        // tiktok.com/api/img answers 403 to direct fetches: use that video's oEmbed thumbnail instead.
        const post = tiktokPostFromImage(img.url);
        if (post) img.url = (await oembedThumb(post))[0] || img.url;
        const d = await download(img.url, dir, n, isBrand ? 15000 : 2000);
        const r = `references/${refId}/${path.basename(d.file)}`;
        extra.push(r);
        sources[r] = { url: img.url, via: img.via, description: img.description || null, query: img.via === 'tavily-image-search' ? q : null };
        n++;
      } catch (err) { tried.push({ url: img.url, error: err.message }); }
    }
  }
  for (const s of savedList) sources[`references/${refId}/${path.basename(s.file)}`] = { url: s.source, via: 'page' };
  const rels = video ? video.frames.map((f) => `references/${refId}/${path.basename(f)}`) : [...savedList.map((s) => `references/${refId}/${path.basename(s.file)}`), ...extra];
  const rel = rels[0] || null;
  updateJson(runId, file, { references: [] }, (doc) => {
    doc.references ||= [];
    let ref = doc.references.find((r) => r.id === refId);
    if (!ref) {
      ref = { id: refId, kind: flags.kind || 'reference', title: flags.title || (flags.kind === 'brand' ? 'Brand page' : refId), url, platform: flags.kind === 'brand' ? 'web' : null, metrics: { views: null, likes: null, comments: null, shares: null }, why: flags.kind === 'brand' ? 'The brand\'s own page image: what the product, logo and palette actually look like.' : '', structure: null, screenshots: [] };
      doc.references.push(ref);
    }
    if (flags.kind) ref.kind = flags.kind;
    ref.screenshots ||= [];
    for (const r of rels) if (!ref.screenshots.includes(r)) ref.screenshots.push(r);
    if (Object.keys(sources).length) ref.screenshotSources = { ...(ref.screenshotSources || {}), ...sources };
    if (video) {
      ref.structure = { ...(ref.structure || {}), durationSeconds: video.durationSeconds, measuredCuts: video.cuts, measuredSecondsPerShot: video.secondsPerShot, measured: true };
      ref.video = `references/${refId}/video.mp4`;
      if (video.info) {
        // Measured metrics fill gaps only; numbers the agent sourced are kept.
        ref.metrics = { ...(ref.metrics || {}) };
        for (const [k, v] of Object.entries(video.info.metrics)) if (v != null && ref.metrics[k] == null) ref.metrics[k] = v;
        ref.metricsSource = ref.metricsSource || `yt-dlp at capture time (${new Date().toISOString().slice(0, 10)})`;
        ref.postInfo = video.info;
        if (!ref.title || ref.title === refId) ref.title = video.info.title || ref.title;
      }
    }
    return doc;
  });
  const out = video
    ? { ok: true, referenceId: refId, mode: 'video', frames: rels, durationSeconds: video.durationSeconds, cuts: video.cuts, secondsPerShot: video.secondsPerShot, metrics: video.info?.metrics ?? null, uploader: video.info?.uploader ?? null, recordedIn: file }
    : rels.length
      ? { ok: true, referenceId: refId, mode: saved ? 'image' : 'search', files: rels, sources, recordedIn: file }
      : { ok: false, referenceId: refId, reason: 'no image found', recordedIn: file, tried: tried.slice(-6) };
  appendTraceLocked(runId, { name: 'fetch-ref', stage: 'references', inputs: { referenceId: refId, url, kind: flags.kind || 'reference' }, tool_calls: tried.map((t) => ({ tool: t.tool || 'fetch', arguments: { url: t.url }, result: t.error || t.status || t.result })), outputs: out, duration_ms: Date.now() - t0 });
  return out;
}
