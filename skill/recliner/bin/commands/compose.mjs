import fs from 'node:fs';
import { readJson, runPath } from '../../lib/store.mjs';
import { updateJson, appendTraceLocked } from '../../lib/lock.mjs';
import * as ffmpeg from '../../lib/compositors/ffmpeg.mjs';
import * as blender from '../../lib/compositors/blender.mjs';
import { generateAssets, mixBed } from '../../lib/audio.mjs';

export const describe = 'compose <runId> [--compositor blender|ffmpeg]: accepted clips + text + audio -> compositions/<n>/final.mp4; adds a result.json entry';

const TRANSITION = 0.4;

// Accepted attempt, else highest validation score (merged by accept-clips, or read from the validators'
// clips/<sceneId>/<attempt>.validation.json if not merged yet), else the latest generated attempt.
export function pickAttempt(sceneClips, runId) {
  if (!sceneClips) return null;
  const ok = sceneClips.attempts.filter((a) => a.status === 'generated' && a.file);
  const accepted = ok.find((a) => a.attempt === sceneClips.acceptedAttempt);
  if (accepted) return accepted;
  const score = (a) => {
    if (typeof a.validation?.score === 'number') return a.validation.score;
    const v = runId && readJson(runId, `clips/${sceneClips.sceneId}/${a.attempt}.validation.json`);
    return typeof v?.score === 'number' ? v.score : null;
  };
  const scored = ok.map((a) => [a, score(a)]).filter(([, sc]) => sc !== null).sort((x, y) => y[1] - x[1]);
  return scored[0]?.[0] || ok[ok.length - 1] || null;
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
    const a = pickAttempt(clips.scenes.find((s) => s.sceneId === scene.id), runId);
    if (!a || !fs.existsSync(runPath(runId, a.file))) { notes.push(`scene ${scene.id}: no usable clip, skipped`); continue; }
    const want = (scene.durationSeconds || config.clipSeconds || 5) + (i < scenes.length - 1 ? TRANSITION : 0);
    const have = a.durationSeconds || (await ffmpeg.probeDuration(runPath(runId, a.file)));
    segments.push({ file: runPath(runId, a.file), seconds: Math.round((have ? Math.min(want, have) : want) * 100) / 100, available: have, text: scene.onScreenText || '' });
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

  // End card (plan.endCard, either contract shape): a designed card the last scene cross-fades into.
  const card = ffmpeg.endCardSpec(plan.endCard);
  if (card) {
    try {
      const file = await ffmpeg.endCardClip({ ...card, seconds: card.seconds + TRANSITION }, { width, height, fps, file: runPath(runId, dir, 'work', 'endcard.mp4') });
      if (file) {
        // The last scene now overlaps the card, so it gains the transition (as far as its clip allows).
        const last = segments[segments.length - 1];
        last.seconds = Math.round(Math.min(last.seconds + TRANSITION, last.available || last.seconds + TRANSITION) * 100) / 100;
        segments.push({ file, seconds: card.seconds + TRANSITION, text: '', endCard: true });
      } else notes.push('end card skipped: rsvg-convert not found');
    } catch (err) { notes.push(`end card failed: ${err.message}`); }
  } else notes.push('no end card in plan');

  // Caption windows, in seconds into each segment: start once the scene is fully visible (after the incoming
  // cross-fade), clear before the outgoing cross-fade or the final fade to black.
  segments.forEach((s, i) => {
    const fadeIn = i > 0 ? TRANSITION : 0.25;
    const fadeOut = i < segments.length - 1 ? TRANSITION : 0.5;
    s.textIn = Math.round((fadeIn + 0.15) * 100) / 100;
    s.textOut = Math.round(Math.max(s.textIn + 0.8, s.seconds - fadeOut - 0.1) * 100) / 100;
  });
  const total = segments.reduce((a, s) => a + s.seconds, 0) - TRANSITION * (segments.length - 1);

  // Audio bed: cached fal assets, mixed to the exact length and loudness-normalised. Without a bed the video
  // has no audio stream at all (never a silent track that claims to be audio).
  let bed = null;
  const audioStarted = Date.now();
  if (config.audio === false) notes.push('no audio: disabled in config');
  else {
    try {
      const assets = await generateAssets(runId, plan, config);
      notes.push(...assets.notes);
      bed = await mixBed({ music: assets.music, voiceover: assets.voiceover, total, outFile: runPath(runId, dir, 'bed.wav') });
      if (!bed) notes.push('no audio: music generation failed');
    } catch (err) { notes.push(`no audio: ${err.message}`); }
  }
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

  // Verify the music is actually audible in the delivered file (integrated loudness of the final mix).
  const loud = await ffmpeg.loudness(out.file);
  const audio = loud
    ? { present: true, bed: `${dir}/bed.wav`, lufs: loud.lufs, truePeak: loud.truePeak, audible: loud.lufs > -30 }
    : { present: false, note: notes.find((x) => x.startsWith('no audio')) || 'no audio' };
  if (loud && !audio.audible) notes.push(`audio present but too quiet (${loud.lufs} LUFS)`);

  const entry = {
    id: `comp-${n}`, attempt: n, file: `${dir}/final.mp4`, thumbnail: `${dir}/thumb.jpg`, compositor,
    durationSeconds: out.durationSeconds, width, height, clips: used, endCard: card ? { headline: card.headline, subline: card.subline, seconds: card.seconds } : null,
    audio, notes, validation: null,
  };
  // Append only our entry under the lock, so validation that rank merged into other entries is kept.
  updateJson(runId, 'result.json', { results: [], selectedId: null }, (doc) => { doc.results.push(entry); });
  appendTraceLocked(runId, {
    name: `compose:${entry.id}`, stage: 'composition', model: null,
    inputs: { clips: used, aspectRatio: aspect, width, height, fps, transition: TRANSITION, onScreenText: segments.map((s) => s.text) },
    tool_calls: (out.commands || []).map((c) => ({ tool: compositor, arguments: { command: c.length > 4000 ? c.slice(0, 4000) + '…' : c }, result: { file: entry.file } })),
    outputs: { file: entry.file, thumbnail: entry.thumbnail, durationSeconds: entry.durationSeconds, compositor, endCard: entry.endCard, audio, notes, audio_ms: audioMs },
    duration_ms: Date.now() - started,
  });
  return entry;
}
