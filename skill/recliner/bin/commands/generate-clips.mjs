import fs from 'node:fs';
import { readJson, runPath } from '../../lib/store.mjs';
import { updateJson, appendTraceLocked } from '../../lib/lock.mjs';
import {
  run as falRun, download, toolCall, videoArgs, imageArgs, imageToVideoModel, imageToVideoArgs, dataUri,
  checkAccount, getBalance, minBalance, VIDEO_MODELS, IMAGE_MODEL,
} from '../../lib/fal.mjs';
import { probeDuration, kenBurns, dimensions } from '../../lib/compositors/ffmpeg.mjs';
import { generateAssets } from '../../lib/audio.mjs';

export const describe = 'generate-clips <runId> [--scene id] [--steering "..."] [--keyframes-only] [--no-keyframes]: keyframe still then image-to-video per scene, in parallel; updates clips.json';

// Bounded parallel map.
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}

const clean = (t) => String(t || '').trim().replace(/[\s.,;:]+$/, '');

// Text-to-video prompt (also the motion prompt when there is no keyframe).
export function scenePrompt(plan, scene, steering) {
  let p = clean(scene.prompt || scene.description);
  if (plan.style && !p.toLowerCase().includes(String(plan.style).toLowerCase().slice(0, 20))) p += `. Style: ${clean(plan.style)}`;
  p += `. ${VIDEO_SUFFIX}`;
  if (steering) p += ` Important correction from review: ${clean(steering)}.`;
  return p;
}

// The briefed brand's real mark on the product is wanted; invented or garbled text is not.
const VIDEO_SUFFIX = 'Single continuous take, no cuts. No captions, no garbled or fake text, no watermarks.';
const STILL_SUFFIX = 'No captions, no garbled or fake text, no watermarks.';

// Still keyframe prompt: the scene's first frame, composed and lit like a finished shot.
export function keyframePrompt(plan, scene, steering) {
  let p = clean(scene.keyframePrompt || scene.imagePrompt || scene.prompt || scene.description);
  if (plan.style) p += `. Style: ${clean(plan.style)}`;
  p += `. Single cinematic still frame, sharp focus on the subject, professional composition, photoreal. ${STILL_SUFFIX}`;
  if (steering) p += ` Important correction from review: ${clean(steering)}.`;
  return p;
}

// Image-to-video prompt: describes the motion from the keyframe.
export function motionPrompt(plan, scene, steering) {
  let p = clean(scene.motionPrompt || scene.motion || scene.prompt || scene.description);
  p += `. Keep the subject, framing and look of the start frame; smooth, natural motion. ${VIDEO_SUFFIX}`;
  if (steering) p += ` Important correction from review: ${clean(steering)}.`;
  return p;
}

const hasFile = (runId, rel) => !!rel && fs.existsSync(runPath(runId, rel));

// A keyframe-only attempt this call can turn into video: the scene's acceptedKeyframe if set, otherwise the
// newest attempt still in status "keyframe" whose still was not rejected (merged keyframeValidation or the
// validator's clips/<sceneId>/<attempt>.keyframe.validation.json).
export function reusableKeyframe(runId, sceneClips) {
  if (!sceneClips) return null;
  const rejected = (a) => {
    const v = a.keyframeValidation || readJson(runId, `clips/${sceneClips.sceneId}/${a.attempt}.keyframe.validation.json`);
    return v && v.passed === false;
  };
  const withStill = sceneClips.attempts.filter((a) => hasFile(runId, a.keyframe));
  if (sceneClips.acceptedKeyframe != null) {
    const a = withStill.find((x) => x.attempt === sceneClips.acceptedKeyframe);
    if (a) return a;
  }
  return withStill.filter((a) => a.status === 'keyframe' && !rejected(a)).sort((x, y) => y.attempt - x.attempt)[0] || null;
}

export default async function ([runId], flags) {
  if (!runId) throw new Error('usage: generate-clips <runId> [--scene id] [--steering "..."] [--keyframes-only] [--no-keyframes]');
  const plan = readJson(runId, 'plan.json');
  if (!plan) throw new Error(`No plan.json in run ${runId}`);
  const config = readJson(runId, 'config.json', {});
  const started = Date.now();
  const account = await checkAccount();
  if (!account.ok) {
    appendTraceLocked(runId, { name: 'generate-clips:refused', stage: 'clips', inputs: { scene: flags.scene || null }, outputs: { ok: false, reason: account.reason, balance: account.balance, floor: account.floor } });
    throw new Error(account.reason);
  }
  const balanceBefore = account.balance;

  const model = config.videoModel || VIDEO_MODELS[config.effort || 3];
  const imageModel = config.imageModel || IMAGE_MODEL;
  const keyframesOnly = !!flags['keyframes-only'];
  const useKeyframes = keyframesOnly || (config.keyframes !== false && !flags['no-keyframes']);
  const aspectRatio = config.aspectRatio || plan.aspectRatio || readJson(runId, 'brief.json', {})?.aspectRatio || '16:9';
  const parallelism = config.parallelism || 4;
  // Per-clip fal budget; past it the request is cancelled and the scene falls back to a Ken Burns still.
  const clipTimeoutSeconds = Number(config.clipTimeoutSeconds) || 240;
  const scenes = [...plan.scenes].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const targets = flags.scene ? scenes.filter((s) => s.id === flags.scene) : scenes;
  if (!targets.length) throw new Error(`Scene ${flags.scene} not in plan.json`);
  const steering = typeof flags.steering === 'string' ? flags.steering : null;

  // Several generate-clips processes may run at once (parallel per-scene retries), and accept-clips merges
  // validation into the same file, so every write re-reads clips.json under a lock and only patches its own attempt.
  const order = (id) => scenes.findIndex((q) => q.id === id);
  const edit = (fn) => updateJson(runId, 'clips.json', { scenes: [] }, (doc) => {
    fn(doc);
    doc.scenes.sort((x, y) => order(x.sceneId) - order(y.sceneId));
  });
  const sceneOf = (doc, sceneId) => {
    let s = doc.scenes.find((x) => x.sceneId === sceneId);
    if (!s) { s = { sceneId, acceptedAttempt: null, attempts: [] }; doc.scenes.push(s); }
    return s;
  };
  const update = (sceneId, attemptNo, patch) => edit((doc) => {
    const s = sceneOf(doc, sceneId);
    let a = s.attempts.find((x) => x.attempt === attemptNo);
    if (!a) { a = { attempt: attemptNo }; s.attempts.push(a); }
    Object.assign(a, patch);
  });

  // Plan each job under one lock: reuse an accepted keyframe-only attempt, or reserve a new attempt number.
  const jobs = [];
  edit((doc) => {
    for (const scene of targets) {
      const s = sceneOf(doc, scene.id);
      const seconds = scene.durationSeconds || config.clipSeconds || 5;
      const resolution = config.resolution || (config.effort <= 1 ? '480p' : '720p');
      // A steering retry makes a fresh still unless the orchestrator pinned one with acceptedKeyframe.
      const reuse = useKeyframes && !keyframesOnly && (!steering || s.acceptedKeyframe != null) ? reusableKeyframe(runId, s) : null;
      const job = { scene, seconds, resolution, reuse: !!reuse };
      if (reuse) {
        job.attempt = reuse.attempt;
        job.keyframe = { file: reuse.keyframe, url: reuse.keyframeUrl || null, prompt: reuse.keyframePrompt, model: reuse.keyframeModel };
        // Reusing another attempt's still for a steering retry: copy it onto a new attempt.
        if (reuse.status !== 'keyframe') {
          job.attempt = s.attempts.length ? Math.max(...s.attempts.map((a) => a.attempt)) + 1 : 1;
          s.attempts.push({ attempt: job.attempt, file: `clips/${scene.id}/${job.attempt}.mp4` });
        }
      } else {
        job.attempt = s.attempts.length ? Math.max(...s.attempts.map((a) => a.attempt)) + 1 : 1;
        s.attempts.push({ attempt: job.attempt, file: `clips/${scene.id}/${job.attempt}.mp4` });
      }
      job.file = `clips/${scene.id}/${job.attempt}.mp4`;
      const a = s.attempts.find((x) => x.attempt === job.attempt);
      Object.assign(a, {
        file: job.file, model, steering: steering ?? a.steering ?? null, requestId: null, error: null, durationSeconds: null, validation: a.validation ?? null,
        status: 'generating', // keyframes-only attempts become "keyframe" once the still exists
        mode: useKeyframes ? 'image-to-video' : 'text-to-video',
        ...(job.keyframe ? { keyframe: job.keyframe.file, keyframeUrl: job.keyframe.url, keyframePrompt: job.keyframe.prompt, keyframeModel: job.keyframe.model } : {}),
      });
      jobs.push(job);
    }
  });

  // Start the music bed (and voiceover) alongside the clips so compose finds them cached.
  const audioJob = flags.scene || keyframesOnly || config.audio === false ? null : generateAssets(runId, plan, config).catch((e) => ({ notes: [e.message] }));

  // A 401/403 (bad key, locked or exhausted account) or the spend floor stops every job that has not started yet.
  let stopError = null;
  const fail = (job, error, extra = {}) => {
    update(job.scene.id, job.attempt, { status: 'failed', error, ...extra });
    return { sceneId: job.scene.id, attempt: job.attempt, status: 'failed', file: null, error };
  };

  const results = await mapLimit(jobs, parallelism, async (job) => {
    const sid = job.scene.id;
    const traceBase = { stage: 'clips', inputs: { sceneId: sid, attempt: job.attempt, steering, aspectRatio, seconds: job.seconds, resolution: job.resolution, keyframesOnly } };
    if (stopError) {
      appendTraceLocked(runId, { ...traceBase, name: `generate-clip:${sid}#${job.attempt}`, model, outputs: { status: 'failed', error: stopError, skipped: true } });
      return fail(job, stopError);
    }
    const calls = [];
    const notes = [];

    // 1. Keyframe still (unless reusing one).
    if (useKeyframes && !job.keyframe) {
      const prompt = keyframePrompt(plan, job.scene, steering);
      const rec = await falRun(imageModel, imageArgs(imageModel, { prompt, aspectRatio }), { timeoutMs: 3 * 60000 });
      const rel = `clips/${sid}/${job.attempt}.keyframe.jpg`;
      if (rec.stop) stopError = stopError || rec.error;
      if (rec.status === 'ok' && rec.url) {
        try {
          await download(rec.url, runPath(runId, rel));
          job.keyframe = { file: rel, url: rec.url, prompt, model: imageModel };
          update(sid, job.attempt, { keyframe: rel, keyframeUrl: rec.url, keyframePrompt: prompt, keyframeModel: imageModel, keyframeRequestId: rec.requestId });
        } catch (err) { notes.push(`keyframe download failed: ${err.message}`); }
      } else notes.push(`keyframe failed: ${rec.error || 'no image url'}`);
      appendTraceLocked(runId, { ...traceBase, name: `keyframe:${sid}#${job.attempt}`, model: imageModel, prompt, tool_calls: [toolCall(rec)], outputs: { file: job.keyframe?.file || null, error: rec.error, cost: rec.cost }, duration_ms: rec.duration_ms });
      if (stopError) return fail(job, stopError);
    }

    if (keyframesOnly) {
      if (!job.keyframe) return fail(job, notes.join('; ') || 'keyframe failed');
      update(sid, job.attempt, { status: 'keyframe' });
      return { sceneId: sid, attempt: job.attempt, status: 'keyframe', keyframe: job.keyframe.file };
    }

    // 2. Video: image-to-video from the keyframe, else text-to-video.
    const i2v = job.keyframe ? imageToVideoModel(model) : null;
    if (job.keyframe && !i2v) notes.push(`no image-to-video variant for ${model}; used text-to-video`);
    const videoCall = async (m, imageMode) => {
      const prompt = imageMode ? motionPrompt(plan, job.scene, steering) : scenePrompt(plan, job.scene, steering);
      const opts = { prompt, aspectRatio, seconds: job.seconds, resolution: job.resolution };
      const imageUrl = imageMode ? job.keyframe.url || dataUri(runPath(runId, job.keyframe.file)) : null;
      const args = imageMode ? imageToVideoArgs(m, opts, imageUrl) : videoArgs(m, opts);
      const rec = await falRun(m, args, {
        timeoutMs: clipTimeoutSeconds * 1000,
        onSubmit: (r) => update(sid, job.attempt, { requestId: r.requestId, model: m, prompt, mode: imageMode ? 'image-to-video' : 'text-to-video' }),
      });
      if (imageUrl?.startsWith('data:')) {
        const key = 'start_image_url' in args ? 'start_image_url' : 'image_url';
        rec.arguments = { ...rec.arguments, [key]: `(data uri of ${job.keyframe.file})` };
      }
      rec.prompt = prompt;
      rec.imageMode = imageMode;
      calls.push(rec);
      if (rec.stop) stopError = stopError || rec.error;
      return rec;
    };
    let rec = await videoCall(i2v || model, !!(i2v && job.keyframe));
    // Fallbacks, never after a stop error or a timeout (another fal call would blow the time budget):
    // unknown endpoint (404) -> effort default; image-to-video failure -> text-to-video.
    const fallback = VIDEO_MODELS[config.effort || 3];
    if (rec.status === 'failed' && !rec.stop && !rec.timeout && / -> 404:/.test(rec.error || '') && fallback && fallback !== model) {
      notes.push(`${rec.endpoint} not found; used ${fallback}`);
      const fi2v = job.keyframe ? imageToVideoModel(fallback) : null;
      rec = await videoCall(fi2v || fallback, !!fi2v);
    }
    if (rec.status === 'failed' && !rec.stop && !rec.timeout && rec.imageMode) { notes.push(`image-to-video failed (${rec.error}); fell back to text-to-video`); rec = await videoCall(model, false); }
    let durationSeconds = null;
    if (rec.status === 'ok' && rec.url) {
      try {
        await download(rec.url, runPath(runId, job.file));
        durationSeconds = await probeDuration(runPath(runId, job.file));
      } catch (err) { rec.status = 'failed'; rec.error = `download: ${err.message}`; }
    } else if (rec.status === 'ok') { rec.status = 'failed'; rec.error = 'fal result had no video url'; }
    let mode = rec.imageMode ? 'image-to-video' : 'text-to-video';
    // Last resort so a run always completes on time: a Ken Burns move over the keyframe, rendered locally.
    if (rec.status !== 'ok' && !rec.stop && job.keyframe && hasFile(runId, job.keyframe.file)) {
      try {
        const { width, height } = dimensions(aspectRatio, 1280);
        await kenBurns(runPath(runId, job.keyframe.file), runPath(runId, job.file), { seconds: job.seconds + 0.5, width, height, variant: order(sid) });
        durationSeconds = await probeDuration(runPath(runId, job.file));
        notes.push(`fal video failed (${rec.error}); used a Ken Burns move over the keyframe`);
        rec = { ...rec, status: 'ok', error: null, endpoint: 'local:ffmpeg-ken-burns', fallbackFrom: rec.endpoint };
        mode = 'ken-burns';
      } catch (err) { notes.push(`Ken Burns fallback failed: ${err.message}`); }
    }
    const ok = rec.status === 'ok';
    update(sid, job.attempt, { status: ok ? 'generated' : 'failed', error: rec.error, requestId: rec.requestId, model: rec.endpoint, prompt: rec.prompt, mode, durationSeconds, notes });
    appendTraceLocked(runId, {
      ...traceBase,
      name: `generate-clip:${sid}#${job.attempt}`,
      model: rec.endpoint,
      prompt: rec.prompt,
      tool_calls: calls.map(toolCall), // the keyframe call has its own trace step
      outputs: { file: ok ? job.file : null, status: ok ? 'generated' : 'failed', mode, keyframe: job.keyframe?.file || null, keyframeReused: job.reuse, error: rec.error, durationSeconds, cost: rec.cost, notes },
      duration_ms: calls.reduce((a, c) => a + c.duration_ms, 0),
    });
    return { sceneId: sid, attempt: job.attempt, model: rec.endpoint, mode, status: ok ? 'generated' : 'failed', file: ok ? job.file : null, keyframe: job.keyframe?.file || null, error: rec.error, seconds: Math.round(rec.duration_ms / 1000) };
  });

  const audio = audioJob ? await audioJob : null;
  const failed = results.filter((r) => r.status === 'failed');
  // Balance delta is the only cost signal fal gives this key (the queue API reports none per call).
  const after = await getBalance({ force: true });
  const balanceAfter = after.balance;
  const produced = results.length - failed.length;
  const spent = balanceBefore !== null && balanceAfter !== null ? Math.round((balanceBefore - balanceAfter) * 10000) / 10000 : null;
  const summary = {
    model, imageModel: useKeyframes ? imageModel : null, keyframesOnly, scenes: results.length, produced, failed: failed.length, stopped: stopError,
    balanceBefore, balanceAfter, floor: minBalance(), spent, costPerScene: spent !== null && produced ? Math.round((spent / produced) * 10000) / 10000 : null,
    seconds: Math.round((Date.now() - started) / 1000),
    note: 'spent is the account balance delta: it includes the music bed when it ran in this call and any concurrent fal use on the account',
  };
  appendTraceLocked(runId, { name: keyframesOnly ? 'generate-keyframes:summary' : 'generate-clips:summary', stage: 'clips', model, inputs: { scene: flags.scene || null, steering, parallelism, keyframes: useKeyframes }, outputs: summary, duration_ms: Date.now() - started });
  if (stopError) throw new Error(`fal generation stopped: ${stopError}`);
  if (failed.length === results.length) throw new Error(`All ${failed.length} scene(s) failed: ${failed.map((f) => f.error).join(' | ')}`);
  return { runId, model, keyframes: useKeyframes, results, balanceBefore, balanceAfter, spent, audio: audio && { music: !!audio.music, voiceover: !!audio.voiceover, notes: audio.notes } };
}
