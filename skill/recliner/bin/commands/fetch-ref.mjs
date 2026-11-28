// fetch-ref: download one representative image for a reference and record it in its `screenshots`.
// Never throws for "nothing found": it returns { ok: false, reason } so the stage keeps going.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { runPath, readJson } from '../../lib/store.mjs';
import { updateJson, appendTraceLocked } from '../../lib/lock.mjs';
import { extractFrames, probeDuration } from '../../lib/compositors/ffmpeg.mjs';

const VIDEO_POST = /(tiktok\.com\/@[^/]+\/video\/|vm\.tiktok\.com\/|youtube\.com\/(watch\?|shorts\/)|youtu\.be\/|instagram\.com\/(reel|reels|p)\/|(x|twitter)\.com\/[^/]+\/status\/)/i;
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
    '--socket-timeout', '10', '--merge-output-format', 'mp4', '-o', target, url,
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
    return { frames, durationSeconds, cuts, secondsPerShot: durationSeconds ? +(durationSeconds / (cuts + 1)).toFixed(2) : null };
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
  // 1. Video posts: real frames and measured pacing (yt-dlp + ffmpeg). Any failure falls through to one image.
  const video = flags.kind === 'brand' || flags['no-video'] ? null : await captureVideo(url, dir, tried);
  let saved = null;
  if (!video) {
    for (const img of await candidates(url, tried)) {
      try {
        saved = { ...(await download(img, dir, 1)), source: img };
        break;
      } catch (err) {
        tried.push({ url: img, error: err.name === 'TimeoutError' ? 'timeout' : err.message });
      }
    }
  }
  const file = targetFile(runId, refId, typeof flags.file === 'string' ? flags.file : null);
  const rels = video ? video.frames.map((f) => `references/${refId}/${path.basename(f)}`) : saved ? [`references/${refId}/${path.basename(saved.file)}`] : [];
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
    if (video) {
      ref.structure = { ...(ref.structure || {}), durationSeconds: video.durationSeconds, measuredCuts: video.cuts, measuredSecondsPerShot: video.secondsPerShot, measured: true };
      ref.video = `references/${refId}/video.mp4`;
    }
    return doc;
  });
  const out = video
    ? { ok: true, referenceId: refId, mode: 'video', frames: rels, durationSeconds: video.durationSeconds, cuts: video.cuts, secondsPerShot: video.secondsPerShot, recordedIn: file }
    : saved
      ? { ok: true, referenceId: refId, mode: 'image', file: rel, source: saved.source, bytes: saved.bytes, recordedIn: file }
      : { ok: false, referenceId: refId, reason: 'no image found', recordedIn: file, tried: tried.slice(-6) };
  appendTraceLocked(runId, { name: 'fetch-ref', stage: 'references', inputs: { referenceId: refId, url, kind: flags.kind || 'reference' }, tool_calls: tried.map((t) => ({ tool: t.tool || 'fetch', arguments: { url: t.url }, result: t.error || t.status || t.result })), outputs: out, duration_ms: Date.now() - t0 });
  return out;
}
