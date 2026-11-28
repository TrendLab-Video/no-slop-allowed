// Effort presets: the Brief page slider (1 quick .. 5 max) resolves to one of these.
// Every field matches config.json in docs/CONTRACTS.md; the user may override any of them.
// Video models come from VIDEO_MODELS in lib/fal.mjs so presets and production code agree.
import { VIDEO_MODELS } from './fal.mjs';
export const VIDEO_MODEL_OPTIONS = [...new Set(Object.values(VIDEO_MODELS))];
export const PRESETS = {
  1: { effort: 1, label: 'Quick', scenes: 2, clipSeconds: 5, parallelism: 2, videoModel: VIDEO_MODELS[1], imageModel: 'fal-ai/flux/schnell', resolution: '480p', referencesCount: 2, goalsCount: 3, clipRetries: 1, finalRetries: 0, passScore: 50, timeBudgetMinutes: 6, scorer: 'haiku', compositor: 'blender', audio: true, keyframes: true },
  2: { effort: 2, label: 'Light', scenes: 3, clipSeconds: 5, parallelism: 3, videoModel: VIDEO_MODELS[2], imageModel: 'fal-ai/flux/schnell', resolution: '720p', referencesCount: 3, goalsCount: 5, clipRetries: 1, finalRetries: 0, passScore: 60, timeBudgetMinutes: 12, scorer: 'haiku', compositor: 'blender', audio: true, keyframes: true },
  3: { effort: 3, label: 'Standard', scenes: 4, clipSeconds: 5, parallelism: 4, videoModel: VIDEO_MODELS[3], imageModel: 'fal-ai/flux/dev', resolution: '720p', referencesCount: 5, goalsCount: 5, clipRetries: 1, finalRetries: 1, passScore: 70, timeBudgetMinutes: 15, scorer: 'jev', compositor: 'blender', audio: true, keyframes: true },
  4: { effort: 4, label: 'High', scenes: 5, clipSeconds: 5, parallelism: 5, videoModel: VIDEO_MODELS[4], imageModel: 'fal-ai/flux-pro/v1.1', resolution: '1080p', referencesCount: 6, goalsCount: 5, clipRetries: 2, finalRetries: 1, passScore: 75, timeBudgetMinutes: 20, scorer: 'jev', compositor: 'blender', audio: true, keyframes: true },
  5: { effort: 5, label: 'Max', scenes: 6, clipSeconds: 8, parallelism: 6, videoModel: VIDEO_MODELS[5], imageModel: 'fal-ai/flux-pro/v1.1-ultra', resolution: '1080p', referencesCount: 8, goalsCount: 5, clipRetries: 3, finalRetries: 2, passScore: 80, timeBudgetMinutes: 30, scorer: 'jev', compositor: 'blender', audio: true, keyframes: true },
};

export const CONFIG_FIELDS = ['effort', 'scenes', 'clipSeconds', 'parallelism', 'videoModel', 'imageModel', 'resolution', 'referencesCount', 'goalsCount', 'clipRetries', 'finalRetries', 'passScore', 'timeBudgetMinutes', 'scorer', 'compositor', 'audio', 'keyframes'];

const NUMERIC = new Set(['effort', 'scenes', 'clipSeconds', 'parallelism', 'referencesCount', 'goalsCount', 'clipRetries', 'finalRetries', 'passScore', 'timeBudgetMinutes']);

// Preset for `effort`, with any overrides applied and coerced to the contract types.
export function resolveConfig(effort = 1, overrides = {}) {
  const e = Math.min(5, Math.max(1, Math.round(Number(overrides.effort ?? effort) || 1)));
  const out = { ...PRESETS[e] };
  delete out.label;
  for (const k of CONFIG_FIELDS) {
    if (overrides[k] === undefined || overrides[k] === '' || overrides[k] === null) continue;
    let v = overrides[k];
    if (NUMERIC.has(k)) v = Number(v);
    else if (k === 'audio' || k === 'keyframes') v = v === true || v === 'true';
    if (NUMERIC.has(k) && !Number.isFinite(v)) continue;
    out[k] = v;
  }
  out.effort = e;
  if (!['jev', 'haiku'].includes(out.scorer)) out.scorer = 'haiku';
  if (!['blender', 'ffmpeg'].includes(out.compositor)) out.compositor = 'blender';
  return out;
}

// ---- Brief submission (shared by the server and `new-run --brief`) ----
import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeJson, setStage, appendTrace, runPath } from './store.mjs';
import { envFiles } from './env.mjs';

const BRIEF_FIELDS = ['promote', 'objective', 'url', 'platform', 'videoType', 'domain', 'aspectRatio', 'notes', 'raw'];

// Turns a starter-brief markdown file (# Title, URL: ..., paragraphs) into brief fields.
export function parseBriefMarkdown(text) {
  const lines = text.split('\n');
  const title = (lines.find((l) => /^#\s+/.test(l)) || '').replace(/^#\s+/, '').trim();
  const url = (text.match(/^\s*URL:\s*(\S+)/im) || [])[1] || '';
  const body = lines.filter((l) => !/^#\s+/.test(l) && !/^\s*URL:/i.test(l)).join('\n').trim();
  return { promote: title, url, objective: body, raw: text };
}

export function submitBrief(runId, { brief = {}, config = {} } = {}, source = 'page') {
  if (!fs.existsSync(runPath(runId, 'state.json'))) throw Object.assign(new Error(`No run ${runId}`), { code: 404 });
  if (fs.existsSync(runPath(runId, 'brief.json'))) throw Object.assign(new Error('A brief was already submitted for this run'), { code: 409 });
  const clean = { runId, source, file: source === 'file' && typeof brief.file === 'string' ? brief.file : null };
  for (const k of BRIEF_FIELDS) clean[k] = typeof brief[k] === 'string' ? brief[k].trim() : '';
  if (!['9:16', '16:9', '1:1'].includes(clean.aspectRatio)) clean.aspectRatio = '9:16';
  if (!clean.platform) clean.platform = 'TikTok';
  if (!clean.promote && !clean.objective && !clean.raw) throw Object.assign(new Error('The brief needs at least what to promote or an objective'), { code: 400 });
  clean.submittedAt = new Date().toISOString();
  const cfg = resolveConfig(config.effort ?? 1, config);
  // config first, brief last: brief.json existing is the signal wait-brief watches for.
  writeJson(runId, 'config.json', cfg);
  writeJson(runId, 'brief.json', clean);
  const traces = readJson(runId, 'traces.json', { steps: [] });
  traces.brief = clean.raw || [clean.promote, clean.objective].filter(Boolean).join('\n\n');
  writeJson(runId, 'traces.json', traces);
  appendTrace(runId, { name: 'brief', stage: 'brief', inputs: { source }, outputs: { brief: clean, config: cfg } });
  setStage(runId, 'brief', 'done', `${source === 'file' ? 'Brief file' : 'Brief page'} · effort ${cfg.effort}`);
  return { brief: clean, config: cfg };
}

// Writes keys to the shared .env (main checkout's when it exists). Never returns them.
export function writeKeys(keys = {}) {
  const map = { fal: 'FAL_KEY', FAL_KEY: 'FAL_KEY', jev: 'JEV_API_KEY', JEV_API_KEY: 'JEV_API_KEY' };
  const updates = {};
  for (const [k, v] of Object.entries(keys || {})) if (map[k] && typeof v === 'string' && v.trim()) updates[map[k]] = v.trim().replace(/[\r\n]/g, '');
  if (!Object.keys(updates).length) return [];
  const files = envFiles();
  const file = files.find((f) => fs.existsSync(f)) || files[files.length - 1];
  let text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  for (const [name, value] of Object.entries(updates)) {
    const re = new RegExp(`^\\s*${name}\\s*=.*$`, 'm');
    text = re.test(text) ? text.replace(re, `${name}=${value}`) : `${text}${text && !text.endsWith('\n') ? '\n' : ''}${name}=${value}\n`;
    process.env[name] = value;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, { mode: 0o600 });
  return Object.keys(updates);
}
