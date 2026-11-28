// Minimal fal client over the queue REST API (https://queue.fal.run). No dependencies.
// Every call resolves to a trace-friendly record:
//   { endpoint, arguments, requestId, status, result, url, duration_ms, error }
import fs from 'node:fs';
import path from 'node:path';
import { loadEnv } from './env.mjs';

const QUEUE = 'https://queue.fal.run';

// Default models per effort level (1..5). lib/effort.mjs presets may reference these. Text-to-video ids;
// imageToVideoModel() derives the image-to-video variant used with keyframes.
// Measured 2026-11-28, one 5s image-to-video clip each from the same keyframe (wall time incl. queue):
//   vidu q3 turbo 40s ~$0.035 (540p) | seedance v1 pro fast 33s ~$0.05 (480p) / ~$0.11 (720p) | ltx-2.3 fast 20s $0.36 (6s, 1080p)
//   seedance 2.0 fast (previous default) 157-261s ~$0.77 per clip at 480p.
export const VIDEO_MODELS = {
  1: 'fal-ai/vidu/q3/text-to-video/turbo',
  2: 'fal-ai/vidu/q3/text-to-video/turbo',
  3: 'fal-ai/bytedance/seedance/v1/pro/fast/text-to-video',
  4: 'fal-ai/ltx-2.3/text-to-video/fast',
  5: 'fal-ai/kling-video/v3/pro/text-to-video',
};
export const IMAGE_MODEL = 'fal-ai/flux/schnell';
export const MUSIC_MODEL = 'elevenlabs/music/v2.5';
export const MUSIC_FALLBACK_MODEL = 'fal-ai/stable-audio-25/text-to-audio';
export const TTS_MODEL = 'fal-ai/elevenlabs/tts/turbo-v2.5';

export function falKey() {
  loadEnv();
  const key = process.env.FAL_KEY || process.env.FAL_API_KEY;
  if (!key) throw new Error('FAL_KEY is not set. Add FAL_KEY=... to .env in the main checkout (or enter it on the Brief page).');
  return key;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isTransient = (status) => status === 408 || status === 429 || status >= 500;

async function request(url, { method = 'GET', body, timeoutMs = 30000 } = {}) {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Key ${falKey()}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  if (!res.ok) {
    const detail = json?.detail ? (typeof json.detail === 'string' ? json.detail : JSON.stringify(json.detail)) : text.slice(0, 300);
    const err = new Error(`fal ${method} ${url.replace(QUEUE, '')} -> ${res.status}: ${detail}`);
    err.status = res.status;
    err.transient = isTransient(res.status);
    throw err;
  }
  return json;
}

// Retries once on network errors, timeouts and 408/429/5xx.
async function withRetry(fn) {
  try {
    return await fn();
  } catch (err) {
    const transient = err.transient || err.name === 'TimeoutError' || err.name === 'AbortError' || err.cause?.code || /fetch failed/i.test(err.message);
    if (!transient) throw err;
    await sleep(2000);
    return fn();
  }
}

// ---- Spend guard ------------------------------------------------------------------------------
// Every paid submit checks the account balance first and refuses at or below RECLINER_MIN_BALANCE
// (USD, default 100, 0 disables). The balance is cached for 20s and shared between parallel calls.
const BALANCE_URL = 'https://rest.alpha.fal.ai/billing/user_balance';
let balanceCache = null; // { value, at } or { promise, at }

export function minBalance() {
  loadEnv();
  const v = parseFloat(process.env.RECLINER_MIN_BALANCE ?? '100');
  return Number.isFinite(v) && v > 0 ? v : 0;
}

// Returns { balance: number|null, status, error }. Never throws.
export async function getBalance({ maxAgeMs = 20000, force = false } = {}) {
  const now = Date.now();
  if (!force && balanceCache && (balanceCache.promise || now - balanceCache.at < maxAgeMs)) return balanceCache.promise || balanceCache.value;
  const promise = (async () => {
    try {
      const res = await fetch(BALANCE_URL, { headers: { Authorization: `Key ${falKey()}` }, signal: AbortSignal.timeout(10000) });
      const text = (await res.text()).trim();
      const n = parseFloat(text);
      return res.ok && Number.isFinite(n) ? { balance: n, status: res.status, error: null } : { balance: null, status: res.status, error: text.slice(0, 200) };
    } catch (err) { return { balance: null, status: null, error: err.message }; }
  })();
  balanceCache = { promise, at: now };
  const value = await promise;
  balanceCache = { value, at: Date.now() };
  return value;
}

const usd = (n) => `$${Number(n).toFixed(2)}`;
export const floorMessage = (balance, floor) => `fal balance ${usd(balance)} is at or below the floor ${usd(floor)}`;

// Throws (err.floor = true) at or below the floor. If the balance cannot be read the call is allowed.
export async function spendGuard() {
  const floor = minBalance();
  if (!floor) return { floor: 0, balance: null };
  const b = await getBalance();
  if (b.status === 401) { const e = new Error('fal rejected FAL_KEY (401): the key is wrong or revoked'); e.status = 401; throw e; }
  if (b.balance === null) return { floor, balance: null, warning: `balance unavailable (${b.status || b.error}); call allowed` };
  if (b.balance <= floor) { const e = new Error(floorMessage(b.balance, floor)); e.floor = true; e.balance = b.balance; throw e; }
  return { floor, balance: b.balance };
}

export const isFloorError = (err) => !!err?.floor || /is at or below the floor/.test(err?.message || err || '');
// Errors after which no further fal call can succeed: stop everything at once.
export const isStopError = (err) => isAuthError(err) || isFloorError(err);

// 401/403 from fal: bad key, locked account or exhausted balance. Retrying or trying other scenes cannot help.
export const isAuthError = (err) => err?.status === 401 || err?.status === 403 || / -> 40[13]:/.test(err?.message || err || '');

// Cheapest authenticated check: the balance endpoint is free. If it is unavailable for this key, submit the
// smallest possible job (1-step 256px SDXL, a fraction of a cent) and cancel it. Never throws.
export async function checkAccount({ probe = false } = {}) {
  const started = Date.now();
  const floor = minBalance();
  const out = { ok: false, reason: null, balance: null, floor, headroom: null, method: 'billing/user_balance', status: null, duration_ms: null };
  const done = (extra) => ({ ...out, ...extra, duration_ms: Date.now() - started });
  try { falKey(); } catch (e) { return done({ reason: e.message, method: null }); }
  const b = await getBalance({ force: true });
  out.status = b.status;
  if (b.status === 401) return done({ reason: 'fal rejected FAL_KEY (401): the key is wrong or revoked' });
  if (b.balance !== null) {
    out.balance = b.balance;
    out.headroom = Math.round((b.balance - floor) * 100) / 100;
    if (b.balance <= 0) return done({ reason: `fal balance is ${usd(b.balance)}: top up at fal.ai/dashboard/billing` });
    if (floor && b.balance <= floor) return done({ reason: floorMessage(b.balance, floor) });
    if (!probe) return done({ ok: true });
  }
  // Balance unavailable for this key (or --probe): a real queue submit, which is where fal reports locked accounts.
  out.method = 'queue submit fal-ai/fast-sdxl';
  try {
    const sub = await request(`${QUEUE}/fal-ai/fast-sdxl`, { method: 'POST', body: { prompt: 'preflight', num_inference_steps: 1, image_size: { width: 256, height: 256 } }, timeoutMs: 15000 });
    if (sub.cancel_url) fetch(sub.cancel_url, { method: 'PUT', headers: { Authorization: `Key ${falKey()}` } }).catch(() => {});
    return done({ ok: true, status: 200 });
  } catch (err) {
    return done({ status: err.status || null, reason: isAuthError(err) ? err.message.replace(/^fal POST \S+ -> /, 'fal ') : `fal unreachable: ${err.message}` });
  }
}

export async function submit(endpoint, args) {
  await spendGuard();
  return withRetry(() => request(`${QUEUE}/${endpoint}`, { method: 'POST', body: args }));
}

// Polls until COMPLETED. onStatus(status, info) is called on every change.
export async function poll(submitted, { timeoutMs = 10 * 60 * 1000, intervalMs = 2000, onStatus } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const s = await withRetry(() => request(submitted.status_url));
    if (s.status !== last) { last = s.status; onStatus?.(s.status, s); }
    if (s.status === 'COMPLETED') {
      if (s.error) throw new Error(`fal request failed: ${s.error}`);
      return s;
    }
    await sleep(intervalMs);
  }
  // Cancel so an abandoned request stops costing money (fal only cancels jobs still in the queue).
  if (submitted.cancel_url) await fetch(submitted.cancel_url, { method: 'PUT', headers: { Authorization: `Key ${falKey()}` }, signal: AbortSignal.timeout(5000) }).catch(() => {});
  const err = new Error(`fal request ${submitted.request_id} timed out after ${Math.round(timeoutMs / 1000)}s`);
  err.timeout = true;
  throw err;
}

export async function result(submitted) {
  return withRetry(() => request(submitted.response_url, { timeoutMs: 60000 }));
}

// First media url in a fal result (video, audio, image or images[0]).
export function mediaUrl(res) {
  if (!res) return null;
  for (const k of ['video', 'audio', 'audio_file', 'image']) if (res[k]?.url) return res[k].url;
  if (Array.isArray(res.images) && res.images[0]?.url) return res.images[0].url;
  return null;
}

export async function download(url, file, { timeoutMs = 120000 } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const get = async () => {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) { const e = new Error(`download ${res.status} ${url}`); e.transient = isTransient(res.status); throw e; }
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  };
  await withRetry(get);
  return file;
}

// Submit, poll, fetch result. Never throws: returns the trace record with status ok|failed.
// `stop` is true for errors after which no other fal call can succeed (401/403, balance floor).
export async function run(endpoint, args, opts = {}) {
  const started = Date.now();
  const rec = { endpoint, arguments: args, requestId: null, status: 'submitted', result: null, url: null, cost: null, metrics: null, duration_ms: null, error: null, stop: false };
  try {
    const sub = await submit(endpoint, args);
    rec.requestId = sub.request_id;
    opts.onSubmit?.(rec);
    const st = await poll(sub, opts);
    rec.metrics = st?.metrics || null;
    rec.result = await result(sub);
    rec.url = mediaUrl(rec.result);
    // The queue API does not report cost today; keep it if a response ever carries it.
    rec.cost = rec.result?.cost ?? rec.result?.billing?.cost ?? st?.cost ?? st?.metrics?.cost ?? null;
    rec.status = 'ok';
  } catch (err) {
    rec.status = 'failed';
    rec.error = err.message;
    rec.stop = isStopError(err);
    rec.timeout = !!err.timeout;
  }
  rec.duration_ms = Date.now() - started;
  return rec;
}

// Tool-call shape for traces.json.
export const toolCall = (rec) => ({
  tool: `fal:${rec.endpoint}`,
  arguments: rec.arguments,
  result: { requestId: rec.requestId, status: rec.status, url: rec.url, cost: rec.cost, metrics: rec.metrics, error: rec.error, duration_ms: rec.duration_ms },
});

// Map our generic request onto each video model's argument names and allowed values.
export function videoArgs(model, { prompt, aspectRatio = '16:9', seconds = 5, resolution, negativePrompt }) {
  const pick = (allowed, want) => allowed.reduce((a, b) => (Math.abs(b - want) < Math.abs(a - want) ? b : a));
  const neg = negativePrompt || 'blur, distortion, warped text, extra fingers, low quality, watermark';
  if (model.includes('seedance/v1')) {
    const res = ['480p', '720p', '1080p'].includes(resolution) ? resolution : '720p';
    return { prompt, aspect_ratio: aspectRatio, duration: String(pick([3, 4, 5, 6, 7, 8, 9, 10], seconds)), resolution: res };
  }
  if (model.includes('vidu')) {
    return { prompt, duration: Math.round(Math.min(8, Math.max(2, seconds))), resolution: resolution === '480p' ? '540p' : '720p', audio: false, ...(model.includes('text-to-video') ? { aspect_ratio: aspectRatio } : {}) };
  }
  if (model.includes('seedance')) {
    const res = ['480p', '720p'].includes(resolution) ? resolution : '720p';
    return { prompt, aspect_ratio: aspectRatio, duration: String(pick([4, 5, 6, 7, 8, 9, 10, 11, 12], seconds)), resolution: res, generate_audio: false };
  }
  if (model.includes('kling-video/v3') || model.startsWith('kling/v4')) {
    const d = pick([3, 4, 5, 6, 7, 8, 9, 10], seconds);
    return { prompt, aspect_ratio: aspectRatio, duration: model.startsWith('kling/v4') ? d : String(d), generate_audio: false, negative_prompt: neg };
  }
  if (model.includes('kling-video')) return { prompt, aspect_ratio: aspectRatio, duration: seconds > 7 ? '10' : '5', negative_prompt: neg };
  if (model.includes('veo3')) {
    return { prompt, aspect_ratio: aspectRatio === '1:1' ? '16:9' : aspectRatio, duration: `${pick([4, 6, 8], seconds)}s`, generate_audio: false, resolution: resolution === '1080p' ? '1080p' : '720p', negative_prompt: neg };
  }
  if (model.includes('ltx-video') || model.includes('ltxv')) {
    return { prompt, aspect_ratio: aspectRatio, resolution: resolution === '480p' ? '480p' : '720p', num_frames: Math.min(121, Math.round(seconds * 24) + 1), frame_rate: 24, negative_prompt: neg };
  }
  if (model.includes('ltx')) {
    return { prompt, aspect_ratio: aspectRatio === '9:16' ? '9:16' : '16:9', duration: pick([6, 8, 10], seconds), generate_audio: false };
  }
  return { prompt, aspect_ratio: aspectRatio, duration: seconds };
}

// ---- Keyframe-first generation -------------------------------------------------------------------
// Image-to-video endpoint for a text-to-video model: ".../text-to-video" -> ".../image-to-video";
// veo endpoints without a suffix get "/image-to-video".
export function imageToVideoModel(model) {
  if (/\/image-to-video$/.test(model)) return model;
  if (model.includes('text-to-video')) return model.replace('text-to-video', 'image-to-video');
  if (model.includes('veo3') || model.includes('ltx-video')) return `${model}/image-to-video`;
  return null;
}

// Image-to-video arguments: the text-to-video mapping plus the keyframe under the model's image key.
export function imageToVideoArgs(model, opts, imageUrl) {
  const args = videoArgs(model, opts);
  if (model.includes('kling-video') || model.startsWith('kling/')) {
    delete args.aspect_ratio; // Kling takes the frame from the start image
    return { ...args, start_image_url: imageUrl };
  }
  return { ...args, image_url: imageUrl };
}

// Still keyframe arguments. FLUX schnell/dev/pro take image_size; ultra and most others take aspect_ratio.
export function imageArgs(model, { prompt, aspectRatio = '16:9' }) {
  if (model.includes('flux') && !model.includes('ultra')) {
    const size = { '9:16': 'portrait_16_9', '16:9': 'landscape_16_9', '1:1': 'square_hd' }[aspectRatio] || 'landscape_16_9';
    return { prompt, image_size: size, num_images: 1, output_format: 'jpeg', enable_safety_checker: true };
  }
  return { prompt, aspect_ratio: aspectRatio, num_images: 1, output_format: 'jpeg' };
}

// A local image as a data URI, for when a keyframe's fal CDN url is missing.
export const dataUri = (file) => `data:image/jpeg;base64,${fs.readFileSync(file).toString('base64')}`;
