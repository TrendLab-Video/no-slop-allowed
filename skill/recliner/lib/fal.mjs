// Minimal fal client over the queue REST API (https://queue.fal.run). No dependencies.
// Every call resolves to a trace-friendly record:
//   { endpoint, arguments, requestId, status, result, url, duration_ms, error }
import fs from 'node:fs';
import path from 'node:path';
import { loadEnv } from './env.mjs';

const QUEUE = 'https://queue.fal.run';

// Default models per effort level (1..5). lib/effort.mjs presets may reference these.
export const VIDEO_MODELS = {
  1: 'bytedance/seedance-2.0/fast/text-to-video', // 480p, fast and cheap
  2: 'bytedance/seedance-2.0/fast/text-to-video', // 720p
  3: 'bytedance/seedance-2.0/fast/text-to-video', // 720p
  4: 'fal-ai/kling-video/v3/pro/text-to-video',
  5: 'fal-ai/kling-video/v3/pro/text-to-video',
};
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

export async function submit(endpoint, args) {
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
export async function run(endpoint, args, opts = {}) {
  const started = Date.now();
  const rec = { endpoint, arguments: args, requestId: null, status: 'submitted', result: null, url: null, duration_ms: null, error: null };
  try {
    const sub = await submit(endpoint, args);
    rec.requestId = sub.request_id;
    opts.onSubmit?.(rec);
    await poll(sub, opts);
    rec.result = await result(sub);
    rec.url = mediaUrl(rec.result);
    rec.status = 'ok';
  } catch (err) {
    rec.status = 'failed';
    rec.error = err.message;
  }
  rec.duration_ms = Date.now() - started;
  return rec;
}

// Tool-call shape for traces.json.
export const toolCall = (rec) => ({
  tool: `fal:${rec.endpoint}`,
  arguments: rec.arguments,
  result: { requestId: rec.requestId, status: rec.status, url: rec.url, error: rec.error, duration_ms: rec.duration_ms },
});

// Map our generic request onto each video model's argument names and allowed values.
export function videoArgs(model, { prompt, aspectRatio = '16:9', seconds = 5, resolution, negativePrompt }) {
  const pick = (allowed, want) => allowed.reduce((a, b) => (Math.abs(b - want) < Math.abs(a - want) ? b : a));
  const neg = negativePrompt || 'blur, distortion, warped text, extra fingers, low quality, watermark';
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
  if (model.includes('ltx')) {
    return { prompt, aspect_ratio: aspectRatio === '9:16' ? '9:16' : '16:9', duration: pick([6, 8, 10], seconds), generate_audio: false };
  }
  return { prompt, aspect_ratio: aspectRatio, duration: seconds };
}
