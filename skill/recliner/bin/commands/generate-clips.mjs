import fs from 'node:fs';
import { readJson, runPath } from '../../lib/store.mjs';
import { updateJson, appendTraceLocked } from '../../lib/lock.mjs';
import {
  run as falRun, download, toolCall, videoArgs, imageArgs, imageToVideoModel, imageToVideoArgs, dataUri,
  checkAccount, getBalance, minBalance, VIDEO_MODELS, IMAGE_MODEL, REFERENCE_IMAGE_MODEL,
} from '../../lib/fal.mjs';
import { probeDuration, kenBurns, dimensions } from '../../lib/compositors/ffmpeg.mjs';
import { generateAssets } from '../../lib/audio.mjs';

export const describe = 'generate-clips <runId> [--keyframes-only] [--scene id] [--steering "..."] [--no-keyframes]: keyframe stills, then image-to-video per scene in parallel; updates clips.json';

// Bounded parallel map.
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}

const clean = (t) => String(t || '').trim().replace(/[\s.,;:]+$/, '');
// The briefed brand's real mark on the product is wanted; invented or garbled text is not.
const VIDEO_SUFFIX = 'Single continuous take, no cuts. No captions, no garbled or fake text, no watermarks.';
const STILL_SUFFIX = 'No captions, no garbled or fake text, no watermarks.';
const withSteering = (p, steering) => (steering ? `${p} Important correction from review: ${clean(steering)}.` : p);

// Text-to-video prompt (config.keyframes false, or the fallback when the still or image-to-video fails).
export function scenePrompt(plan, scene, steering) {
  let p = clean(scene.prompt || scene.description);
  if (plan.style && !p.toLowerCase().includes(String(plan.style).toLowerCase().slice(0, 20))) p += `. Style: ${clean(plan.style)}`;
  return withSteering(`${p}. ${VIDEO_SUFFIX}`, steering);
}

// Still keyframe prompt: the scene's first frame, composed and lit like a finished shot.
export function keyframePrompt(plan, scene, steering, { withReference = false } = {}) {
  let p = clean(scene.keyframePrompt || scene.prompt || scene.description);
  if (plan.style) p += `. Style: ${clean(plan.style)}`;
  p += `. Single cinematic still frame, sharp focus on the subject, professional composition, photoreal. ${STILL_SUFFIX}`;
  if (withReference) p = `Keep the same product, people, wardrobe, colour palette and lighting as the reference image, in a new shot: ${p}`;
  return withSteering(p, steering);
}

// Image-to-video prompt: the motion from the still (scene.prompt per the contract).
export function motionPrompt(plan, scene, steering) {
  const p = clean(scene.prompt || scene.description);
  return withSteering(`${p}. Keep the subject, framing and look of the start frame; smooth, natural motion. ${VIDEO_SUFFIX}`, steering);
}

const hasFile = (runId, rel) => !!rel && fs.existsSync(runPath(runId, rel));
const stillOk = (runId, a) => a.keyframe?.file && a.keyframe.status !== 'failed' && hasFile(runId, a.keyframe.file);

// The still a video call animates: the scene's acceptedKeyframe if set, otherwise the newest still-only
// attempt (status "pending") whose still was not rejected by its validator.
export function reusableKeyframe(runId, sceneClips) {
  if (!sceneClips) return null;
  const stills = sceneClips.attempts.filter((a) => stillOk(runId, a));
  if (sceneClips.acceptedKeyframe != null) {
    const a = stills.find((x) => x.attempt === sceneClips.acceptedKeyframe);
    if (a) return a;
  }
  const rejected = (a) => {
    const v = a.keyframe.validation || readJson(runId, `clips/${sceneClips.sceneId}/${a.attempt}.keyframe.validation.json`);
    return v && v.passed === false;
  };
  return stills.filter((a) => a.status === 'pending' && !rejected(a)).sort((x, y) => y.attempt - x.attempt)[0] || null;
}

export default async function ([runId], flags) {
  if (!runId) throw new Error('usage: generate-clips <runId> [--keyframes-only] [--scene id] [--steering "..."] [--no-keyframes]');
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
  const referenceModel = config.referenceImageModel === false ? null : config.referenceImageModel || REFERENCE_IMAGE_MODEL;
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
  // validation into the same file, so every write re-reads clips.json under a lock and patches only its own attempt.
  const order = (id) => scenes.findIndex((q) => q.id === id);
  const edit = (fn) => updateJson(runId, 'clips.json', { scenes: [] }, (doc) => {
    fn(doc);
    doc.scenes.sort((x, y) => order(x.sceneId) - order(y.sceneId));
  });
  const sceneOf = (doc, sceneId) => {
    let s = doc.scenes.find((x) => x.sceneId === sceneId);
    if (!s) { s = { sceneId, acceptedKeyframe: null, acceptedAttempt: null, attempts: [] }; doc.scenes.push(s); }
    return s;
  };
  const update = (sceneId, attemptNo, patch, keyframePatch = null) => edit((doc) => {
    const s = sceneOf(doc, sceneId);
    let a = s.attempts.find((x) => x.attempt === attemptNo);
    if (!a) { a = { attempt: attemptNo }; s.attempts.push(a); }
    Object.assign(a, patch);
    if (keyframePatch) a.keyframe = { ...(a.keyframe || {}), ...keyframePatch };
  });
  const nextAttempt = (s) => (s.attempts.length ? Math.max(...s.attempts.map((a) => a.attempt)) + 1 : 1);

  // Plan every job under one lock: animate an existing still (same attempt if it has no video yet), or reserve
  // a new attempt number. A steering retry makes a fresh still unless acceptedKeyframe pins one.
  const jobs = [];
  let referenceStill = null; // the first scene's still, the reference for the others' keyframes
  edit((doc) => {
    const first = doc.scenes.find((x) => x.sceneId === scenes[0].id);
    const firstStill = first && reusableKeyframe(runId, first);
    if (firstStill) referenceStill = { file: firstStill.keyframe.file, url: firstStill.keyframe.url || null };
    for (const scene of targets) {
      const s = sceneOf(doc, scene.id);
      const reuse = useKeyframes && !keyframesOnly && (!steering || s.acceptedKeyframe != null) ? reusableKeyframe(runId, s) : null;
      const job = { scene, seconds: scene.durationSeconds || config.clipSeconds || 5, resolution: config.resolution || (config.effort <= 1 ? '480p' : '720p'), reused: !!reuse };
      job.attempt = reuse && reuse.status === 'pending' ? reuse.attempt : nextAttempt(s);
      if (job.attempt !== reuse?.attempt) s.attempts.push({ attempt: job.attempt });
      if (reuse) job.keyframe = { ...reuse.keyframe };
      job.file = `clips/${scene.id}/${job.attempt}.mp4`;
      const a = s.attempts.find((x) => x.attempt === job.attempt);
      Object.assign(a, {
        file: job.file, model, prompt: null, steering: steering ?? a.steering ?? null, requestId: null,
        // "pending": a still-only attempt whose video has not been made yet.
        status: keyframesOnly ? 'pending' : 'generating',
        error: null, durationSeconds: null, validation: a.validation ?? null,
        mode: useKeyframes ? 'image-to-video' : 'text-to-video',
      });
      if (reuse) a.keyframe = { ...reuse.keyframe, reusedFrom: reuse.attempt !== job.attempt ? reuse.attempt : undefined };
      else if (useKeyframes) a.keyframe = { file: null, prompt: null, model: imageModel, requestId: null, status: 'generating', error: null, validation: null };
      jobs.push(job);
    }
  });

  // Start the music bed (and voiceover) alongside the clips so compose finds them cached.
  const audioJob = flags.scene || keyframesOnly || config.audio === false ? null : generateAssets(runId, plan, config).catch((e) => ({ notes: [e.message] }));

  // A 401/403 (bad key, locked or exhausted account) or the spend floor stops every job that has not started yet.
  let stopError = null;
  const fail = (job, error, notes = []) => {
    update(job.scene.id, job.attempt, { status: 'failed', error, notes });
    return { sceneId: job.scene.id, attempt: job.attempt, status: 'failed', file: null, error };
  };

  // Scene 1's new still is the reference for the others, so they wait for it (cheap: a few seconds).
  let resolveFirst;
  const firstStillReady = new Promise((r) => (resolveFirst = r));
  const firstJob = jobs.find((j) => j.scene.id === scenes[0].id && useKeyframes && !j.keyframe);
  if (!firstJob) resolveFirst(referenceStill);

  async function makeKeyframe(job, traceBase) {
    const sid = job.scene.id;
    const isFirst = job === firstJob;
    const ref = isFirst || !referenceModel ? null : await firstStillReady;
    const refUrl = ref ? ref.url || (hasFile(runId, ref.file) ? dataUri(runPath(runId, ref.file)) : null) : null;
    const m = refUrl ? referenceModel : imageModel;
    const prompt = keyframePrompt(plan, job.scene, steering, { withReference: !!refUrl });
    update(sid, job.attempt, {}, { status: 'generating', model: m, prompt, reference: ref?.file || null });
    let rec = await falRun(m, imageArgs(m, { prompt, aspectRatio }, refUrl ? [refUrl] : null), { timeoutMs: 3 * 60000 });
    const calls = [rec];
    // A failed reference edit falls back to a plain still from the base model.
    if (rec.status !== 'ok' && refUrl && !rec.stop) {
      const plain = keyframePrompt(plan, job.scene, steering);
      rec = await falRun(imageModel, imageArgs(imageModel, { prompt: plain, aspectRatio }), { timeoutMs: 3 * 60000 });
      rec.prompt = plain;
      calls.push(rec);
    }
    if (rec.stop) stopError = stopError || rec.error;
    const rel = `clips/${sid}/${job.attempt}.keyframe.png`;
    let still = null;
    if (rec.status === 'ok' && rec.url) {
      try {
        await download(rec.url, runPath(runId, rel));
        still = { file: rel, url: rec.url, prompt: rec.prompt || prompt, model: rec.endpoint, requestId: rec.requestId, reference: rec.endpoint === referenceModel ? ref?.file || null : null };
      } catch (err) { rec.error = `download: ${err.message}`; }
    }
    update(sid, job.attempt, {}, still ? { ...still, status: 'generated', error: null } : { status: 'failed', error: rec.error || 'no image url' });
    appendTraceLocked(runId, {
      ...traceBase, name: `keyframe:${sid}#${job.attempt}`, model: rec.endpoint, prompt: rec.prompt || prompt,
      tool_calls: calls.map(toolCall), outputs: { file: still?.file || null, reference: still?.reference || null, error: still ? null : rec.error, cost: rec.cost },
      duration_ms: calls.reduce((a, c) => a + c.duration_ms, 0),
    });
    if (isFirst) resolveFirst(still ? { file: still.file, url: still.url } : referenceStill);
    return still;
  }

  // Jobs run in scene order, so scene 1's still starts first; the others then wait on it.
  const results = await mapLimit(jobs, parallelism, async (job) => {
    const sid = job.scene.id;
    const traceBase = { stage: 'clips', inputs: { sceneId: sid, attempt: job.attempt, steering, aspectRatio, seconds: job.seconds, resolution: job.resolution, keyframesOnly } };
    const notes = [];
    if (stopError) {
      if (job === firstJob) resolveFirst(referenceStill);
      appendTraceLocked(runId, { ...traceBase, name: `generate-clip:${sid}#${job.attempt}`, model, outputs: { status: 'failed', error: stopError, skipped: true } });
      return fail(job, stopError);
    }

    // 1. Keyframe still (unless animating an existing one).
    if (useKeyframes && !job.keyframe) {
      try { job.keyframe = await makeKeyframe(job, traceBase); } finally { if (job === firstJob) resolveFirst(referenceStill); }
      if (stopError) return fail(job, stopError);
      if (!job.keyframe) notes.push('keyframe failed');
    }
    if (keyframesOnly) {
      if (!job.keyframe) return fail(job, 'keyframe failed', notes);
      return { sceneId: sid, attempt: job.attempt, status: 'pending', keyframe: job.keyframe.file };
    }

    // 2. Video: image-to-video from the still, else text-to-video.
    const calls = [];
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
    let rec = await videoCall(i2v || model, !!i2v);
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
    // Last resort so a run always completes on time: a Ken Burns move over the still, rendered locally.
    if (rec.status !== 'ok' && !rec.stop && job.keyframe && hasFile(runId, job.keyframe.file)) {
      try {
        const { width, height } = dimensions(aspectRatio, 1280);
        await kenBurns(runPath(runId, job.keyframe.file), runPath(runId, job.file), { seconds: job.seconds + 0.5, width, height, variant: order(sid) });
        durationSeconds = await probeDuration(runPath(runId, job.file));
        notes.push(`fal video failed (${rec.error}); used a Ken Burns move over the keyframe`);
        rec = { ...rec, status: 'ok', error: null, endpoint: 'local:ffmpeg-ken-burns' };
        mode = 'ken-burns';
      } catch (err) { notes.push(`Ken Burns fallback failed: ${err.message}`); }
    }
    const ok = rec.status === 'ok';
    update(sid, job.attempt, { status: ok ? 'generated' : 'failed', error: rec.error, requestId: rec.requestId, model: rec.endpoint, prompt: rec.prompt, mode, durationSeconds, notes });
    appendTraceLocked(runId, {
      ...traceBase, name: `generate-clip:${sid}#${job.attempt}`, model: rec.endpoint, prompt: rec.prompt,
      tool_calls: calls.map(toolCall), // the keyframe call has its own trace step
      outputs: { file: ok ? job.file : null, status: ok ? 'generated' : 'failed', mode, keyframe: job.keyframe?.file || null, keyframeReused: job.reused, error: rec.error, durationSeconds, cost: rec.cost, notes },
      duration_ms: calls.reduce((a, c) => a + c.duration_ms, 0),
    });
    return { sceneId: sid, attempt: job.attempt, model: rec.endpoint, mode, status: ok ? 'generated' : 'failed', file: ok ? job.file : null, keyframe: job.keyframe?.file || null, error: rec.error, seconds: Math.round(calls.reduce((a, c) => a + c.duration_ms, 0) / 1000) };
  });

  const audio = audioJob ? await audioJob : null;
  const failed = results.filter((r) => r.status === 'failed');
  // Balance delta is the only cost signal fal gives this key (the queue API reports none per call), and it lags.
  const after = await getBalance({ force: true });
  const balanceAfter = after.balance;
  const produced = results.length - failed.length;
  const spent = balanceBefore !== null && balanceAfter !== null ? Math.round((balanceBefore - balanceAfter) * 10000) / 10000 : null;
  const summary = {
    model, imageModel: useKeyframes ? imageModel : null, referenceModel: useKeyframes ? referenceModel : null, keyframesOnly,
    scenes: results.length, produced, failed: failed.length, stopped: stopError, clipTimeoutSeconds,
    balanceBefore, balanceAfter, floor: minBalance(), spent, seconds: Math.round((Date.now() - started) / 1000),
    note: 'spent is the account balance delta: it lags by a few seconds and includes any concurrent fal use on the account',
  };
  appendTraceLocked(runId, { name: keyframesOnly ? 'generate-keyframes:summary' : 'generate-clips:summary', stage: 'clips', model, inputs: { scene: flags.scene || null, steering, parallelism, keyframes: useKeyframes }, outputs: summary, duration_ms: Date.now() - started });
  if (stopError) throw new Error(`fal generation stopped: ${stopError}`);
  if (failed.length === results.length) throw new Error(`All ${failed.length} scene(s) failed: ${failed.map((f) => f.error).join(' | ')}`);
  return { runId, model, keyframes: useKeyframes, results, balanceBefore, balanceAfter, spent, audio: audio && { music: !!audio.music, voiceover: !!audio.voiceover, notes: audio.notes } };
}
