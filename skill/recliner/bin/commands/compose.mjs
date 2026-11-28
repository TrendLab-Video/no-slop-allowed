import fs from 'node:fs';
import { readJson, writeJson, appendTrace, runPath } from '../../lib/store.mjs';
import * as ffmpeg from '../../lib/compositors/ffmpeg.mjs';
import * as blender from '../../lib/compositors/blender.mjs';
import { generateAssets, mixBed } from '../../lib/audio.mjs';

export const describe = 'compose <runId> [--compositor blender|ffmpeg]: accepted clips + text + audio -> compositions/<n>/final.mp4; adds a result.json entry';

const TRANSITION = 0.4;

// Accepted attempt, else highest validation score, else the latest generated attempt.
export function pickAttempt(sceneClips) {
  if (!sceneClips) return null;
  const ok = sceneClips.attempts.filter((a) => a.status === 'generated' && a.file);
  const accepted = ok.find((a) => a.attempt === sceneClips.acceptedAttempt);
  if (accepted) return accepted;
  const scored = ok.filter((a) => typeof a.validation?.score === 'number').sort((a, b) => b.validation.score - a.validation.score);
  return scored[0] || ok[ok.length - 1] || null;
}

export default async function ([runId], flags) {
  if (!runId) throw new Error('usage: compose <runId>');
  const started = Date.now();
  const plan = readJson(runId, 'plan.json');
  if (!plan) throw new Error(`No plan.json in run ${runId}`);
  const config = readJson(runId, 'config.json', {});
  const brief = readJson(runId, 'brief.json', {}) || {};
  const clips = readJson(runId, 'clips.json', { scenes: [] });
  const notes = [];

  const scenes = [...plan.scenes].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const segments = [];
  const used = [];
  for (const [i, scene] of scenes.entries()) {
    const a = pickAttempt(clips.scenes.find((s) => s.sceneId === scene.id));
    if (!a || !fs.existsSync(runPath(runId, a.file))) { notes.push(`scene ${scene.id}: no usable clip, skipped`); continue; }
    const want = (scene.durationSeconds || config.clipSeconds || 5) + (i < scenes.length - 1 ? TRANSITION : 0);
    const have = a.durationSeconds || (await ffmpeg.probeDuration(runPath(runId, a.file)));
    segments.push({ file: runPath(runId, a.file), seconds: Math.round((have ? Math.min(want, have) : want) * 100) / 100, text: scene.onScreenText || '' });
    used.push({ sceneId: scene.id, attempt: a.attempt, file: a.file });
  }
  if (!segments.length) throw new Error('No generated clips to compose');

  const result = readJson(runId, 'result.json', { results: [], selectedId: null });
  const n = result.results.reduce((m, r) => Math.max(m, r.attempt || 0), 0) + 1;
  const dir = `compositions/${n}`;
  const workDir = runPath(runId, dir, 'work');
  fs.mkdirSync(workDir, { recursive: true });
  const aspect = config.aspectRatio || plan.aspectRatio || brief.aspectRatio || '16:9';
  const { width, height } = ffmpeg.dimensions(aspect, config.outputLongEdge || 1920);
  const fps = 30;
  const total = segments.reduce((a, s) => a + s.seconds, 0) - TRANSITION * (segments.length - 1);

  // Audio bed: cached fal assets, mixed to the exact length and loudness-normalised.
  let bed = null;
  const audioStarted = Date.now();
  try {
    const assets = await generateAssets(runId, plan, config);
    notes.push(...assets.notes);
    bed = await mixBed({ music: assets.music, voiceover: assets.voiceover, total, outFile: runPath(runId, dir, 'bed.wav') });
    if (!bed && config.audio !== false) notes.push('no audio bed: silent track used');
  } catch (err) { notes.push(`audio failed, silent track used: ${err.message}`); }
  const audioMs = Date.now() - audioStarted;

  const job = { segments, width, height, fps, transition: TRANSITION, bed, outFile: runPath(runId, dir, 'final.mp4'), workDir, plan };
  let compositor = flags.compositor || config.compositor || (blender.findBlender() ? 'blender' : 'ffmpeg');
  let out;
  if (compositor === 'blender') {
    try {
      if (!blender.findBlender()) throw new Error('Blender not found');
      out = await blender.compose(job);
    } catch (err) {
      notes.push(`blender failed, fell back to ffmpeg: ${err.message}`);
      compositor = 'ffmpeg';
    }
  }
  if (!out) { compositor = 'ffmpeg'; out = await ffmpeg.compose(job); }
  notes.push(...(out.notes || []));
  await ffmpeg.thumbnail(out.file, runPath(runId, dir, 'thumb.jpg'));
  fs.rmSync(workDir, { recursive: true, force: true });

  const entry = {
    id: `comp-${n}`, attempt: n, file: `${dir}/final.mp4`, thumbnail: `${dir}/thumb.jpg`, compositor,
    durationSeconds: out.durationSeconds, width, height, clips: used, audio: bed ? `${dir}/bed.wav` : null, notes, validation: null,
  };
  const fresh = readJson(runId, 'result.json', { results: [], selectedId: null });
  fresh.results.push(entry);
  writeJson(runId, 'result.json', fresh);
  appendTrace(runId, {
    name: `compose:${entry.id}`, stage: 'composition', model: null,
    inputs: { clips: used, aspectRatio: aspect, width, height, fps, transition: TRANSITION, onScreenText: segments.map((s) => s.text) },
    tool_calls: (out.commands || []).map((c) => ({ tool: compositor, arguments: { command: c.length > 4000 ? c.slice(0, 4000) + '…' : c }, result: { file: entry.file } })),
    outputs: { file: entry.file, thumbnail: entry.thumbnail, durationSeconds: entry.durationSeconds, compositor, notes, audio_ms: audioMs },
    duration_ms: Date.now() - started,
  });
  return entry;
}
