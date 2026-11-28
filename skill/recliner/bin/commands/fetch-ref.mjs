// fetch-ref: download one representative image for a reference and record it in its `screenshots`.
// Never throws for "nothing found": it returns { ok: false, reason } so the stage keeps going.
import fs from 'node:fs';
import { runPath, readJson } from '../../lib/store.mjs';
import { updateJson, appendTraceLocked } from '../../lib/lock.mjs';

export const describe = 'fetch-ref <runId> <referenceId> <url> [--kind brand] [--title t] [--file references.<angle>.json]: save a representative image (og:image, YouTube thumbnail, oEmbed) into references/<id>/ and add it to screenshots';

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

async function candidates(url, tried) {
  const list = [];
  const yt = youtubeId(url);
  if (yt) list.push(`https://i.ytimg.com/vi/${yt}/maxresdefault.jpg`, `https://i.ytimg.com/vi/${yt}/hqdefault.jpg`);
  list.push(...(await oembedThumb(url)));
  if (/\.(jpe?g|png|webp)(\?|$)/i.test(url)) list.push(url);
  try {
    const r = await get(url, 'text/html,application/xhtml+xml');
    tried.push({ url, status: r.status });
    if (r.ok && /html/i.test(r.headers.get('content-type') || '')) list.push(...metaImages((await r.text()).slice(0, 400000), r.url));
  } catch (err) {
    tried.push({ url, error: err.name === 'TimeoutError' ? 'timeout' : err.message });
  }
  return [...new Set(list)];
}

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' };

async function download(img, dir, n) {
  const r = await get(img, 'image/avif,image/webp,image/*,*/*');
  const type = (r.headers.get('content-type') || '').split(';')[0].trim();
  if (!r.ok || !type.startsWith('image/')) throw new Error(`${r.status} ${type || 'no type'}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length < 2000) throw new Error(`too small (${buf.length} B, likely a placeholder)`);
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

export default async function ([runId, refId, url], flags) {
  if (!runId || !refId || !url) throw new Error('Usage: fetch-ref <runId> <referenceId> <url> [--kind brand] [--title t] [--file f]');
  if (!readJson(runId, 'state.json')) throw new Error(`No run ${runId}`);
  const t0 = Date.now();
  const tried = [];
  const dir = runPath(runId, 'references', refId);
  let saved = null;
  for (const img of await candidates(url, tried)) {
    try {
      saved = { ...(await download(img, dir, 1)), source: img };
      break;
    } catch (err) {
      tried.push({ url: img, error: err.name === 'TimeoutError' ? 'timeout' : err.message });
    }
  }
  const file = targetFile(runId, refId, typeof flags.file === 'string' ? flags.file : null);
  const rel = saved ? `references/${refId}/${saved.file.split('/').pop()}` : null;
  updateJson(runId, file, { references: [] }, (doc) => {
    doc.references ||= [];
    let ref = doc.references.find((r) => r.id === refId);
    if (!ref) {
      ref = { id: refId, kind: flags.kind || 'reference', title: flags.title || (flags.kind === 'brand' ? 'Brand page' : refId), url, platform: flags.kind === 'brand' ? 'web' : null, metrics: { views: null, likes: null, comments: null, shares: null }, why: flags.kind === 'brand' ? 'The brand\'s own page image: what the product, logo and palette actually look like.' : '', structure: null, screenshots: [] };
      doc.references.push(ref);
    }
    if (flags.kind) ref.kind = flags.kind;
    ref.screenshots ||= [];
    if (rel && !ref.screenshots.includes(rel)) ref.screenshots.push(rel);
    return doc;
  });
  const out = saved
    ? { ok: true, referenceId: refId, file: rel, source: saved.source, bytes: saved.bytes, recordedIn: file }
    : { ok: false, referenceId: refId, reason: 'no image found', recordedIn: file, tried: tried.slice(-6) };
  appendTraceLocked(runId, { name: 'fetch-ref', stage: 'references', inputs: { referenceId: refId, url, kind: flags.kind || 'reference' }, tool_calls: tried.map((t) => ({ tool: 'fetch', arguments: { url: t.url }, result: t.error || t.status })), outputs: out, duration_ms: Date.now() - t0 });
  return out;
}
