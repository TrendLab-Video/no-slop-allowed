import { readJson, runPath } from '../../lib/store.mjs';
import { updateJson, appendTraceLocked } from '../../lib/lock.mjs';
import { run as falRun, download, toolCall, videoArgs, checkAccount, isAuthError, VIDEO_MODELS } from '../../lib/fal.mjs';
import { probeDuration } from '../../lib/compositors/ffmpeg.mjs';
import { generateAssets } from '../../lib/audio.mjs';

export const describe = 'generate-clips <runId> [--scene id --steering "..."]: fal video per scene in parallel (or one retry attempt); updates clips.json';

// Bounded parallel map.
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}

export function scenePrompt(plan, scene, steering) {
  const clean = (t) => String(t || '').trim().replace(/[\s.,;:]+$/, '');
  let p = clean(scene.prompt || scene.description);
  if (plan.style && !p.toLowerCase().includes(String(plan.style).toLowerCase().slice(0, 20))) p += `. Style: ${clean(plan.style)}`;
  p += '. No on-screen text, no captions, no logos, no watermarks.';
  if (steering) p += ` Important correction from review: ${clean(steering)}.`;
  return p;
}

export default async function ([runId], flags) {
  if (!runId) throw new Error('usage: generate-clips <runId> [--scene id --steering "..."]');
  const plan = readJson(runId, 'plan.json');
  if (!plan) throw new Error(`No plan.json in run ${runId}`);
  const config = readJson(runId, 'config.json', {});
  // Fail fast on a missing key, bad key or empty balance before reserving any attempts.
  const account = await checkAccount();
  if (!account.ok) throw new Error(account.reason);

  const model = config.videoModel || VIDEO_MODELS[config.effort || 3];
  const aspectRatio = config.aspectRatio || plan.aspectRatio || readJson(runId, 'brief.json', {})?.aspectRatio || '16:9';
  const parallelism = config.parallelism || 4;
  const scenes = [...plan.scenes].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const targets = flags.scene ? scenes.filter((s) => s.id === flags.scene) : scenes;
  if (!targets.length) throw new Error(`Scene ${flags.scene} not in plan.json`);
  const steering = typeof flags.steering === 'string' ? flags.steering : null;

  // Several generate-clips processes may run at once (parallel per-scene retries), and accept-clips merges
  // validation into the same file, so every write re-reads clips.json under a lock and only patches its own attempt.
  const clips = () => readJson(runId, 'clips.json', { scenes: [] });
  const order = (id) => scenes.findIndex((q) => q.id === id);
  const update = (sceneId, attemptNo, patch) => updateJson(runId, 'clips.json', { scenes: [] }, (doc) => {
    let s = doc.scenes.find((x) => x.sceneId === sceneId);
    if (!s) { s = { sceneId, acceptedAttempt: null, attempts: [] }; doc.scenes.push(s); }
    let a = s.attempts.find((x) => x.attempt === attemptNo);
    if (!a) { a = { attempt: attemptNo }; s.attempts.push(a); }
    Object.assign(a, patch);
    doc.scenes.sort((x, y) => order(x.sceneId) - order(y.sceneId));
  });
  // Reserves the next attempt number for a scene atomically (read and claim under one lock).
  const reserve = (sceneId, patch) => {
    let attemptNo;
    updateJson(runId, 'clips.json', { scenes: [] }, (doc) => {
      let s = doc.scenes.find((x) => x.sceneId === sceneId);
      if (!s) { s = { sceneId, acceptedAttempt: null, attempts: [] }; doc.scenes.push(s); }
      attemptNo = s.attempts.length ? Math.max(...s.attempts.map((a) => a.attempt)) + 1 : 1;
      s.attempts.push({ attempt: attemptNo, file: `clips/${sceneId}/${attemptNo}.mp4`, ...patch });
      doc.scenes.sort((x, y) => order(x.sceneId) - order(y.sceneId));
    });
    return attemptNo;
  };
  // Reserve attempt numbers up front so parallel scenes never collide.
  const jobs = targets.map((scene) => {
    const prompt = scenePrompt(plan, scene, steering);
    const seconds = scene.durationSeconds || config.clipSeconds || 5;
    const resolution = config.resolution || (config.effort <= 1 ? '480p' : '720p');
    const attempt = reserve(scene.id, { model, prompt, steering, requestId: null, status: 'generating', error: null, durationSeconds: null, validation: null });
    return { scene, attempt, prompt, seconds, resolution, file: `clips/${scene.id}/${attempt}.mp4` };
  });

  // Start the music bed (and voiceover) alongside the clips so compose finds them cached.
  const audioJob = flags.scene || config.audio === false ? null : generateAssets(runId, plan, config).catch((e) => ({ notes: [e.message] }));

  // A 401/403 (bad key, locked or exhausted account) stops every job that has not started yet.
  let authError = null;
  const results = await mapLimit(jobs, parallelism, async (job) => {
    if (authError) {
      update(job.scene.id, job.attempt, { status: 'failed', error: `skipped: ${authError}` });
      return { sceneId: job.scene.id, attempt: job.attempt, model, status: 'failed', file: null, error: `skipped: ${authError}` };
    }
    const call = (m) => falRun(m, videoArgs(m, { prompt: job.prompt, aspectRatio, seconds: job.seconds, resolution: job.resolution }), {
      timeoutMs: (config.clipTimeoutMinutes || 8) * 60000,
      onSubmit: (r) => update(job.scene.id, job.attempt, { requestId: r.requestId, model: m }),
    });
    const calls = [await call(model)];
    if (calls[0].status === 'failed' && isAuthError(calls[0].error)) authError = authError || calls[0].error;
    // An unknown or retired endpoint (404) falls back to the known-good default for this effort level.
    const fallback = VIDEO_MODELS[config.effort || 3];
    if (calls[0].status === 'failed' && / -> 404:/.test(calls[0].error || '') && fallback !== model) calls.push(await call(fallback));
    const rec = calls[calls.length - 1];
    const usedModel = rec.endpoint;
    let durationSeconds = null;
    if (rec.status === 'ok' && rec.url) {
      try {
        await download(rec.url, runPath(runId, job.file));
        durationSeconds = await probeDuration(runPath(runId, job.file));
      } catch (err) { rec.status = 'failed'; rec.error = `download: ${err.message}`; }
    } else if (rec.status === 'ok') { rec.status = 'failed'; rec.error = 'fal result had no video url'; }
    const ok = rec.status === 'ok';
    update(job.scene.id, job.attempt, { status: ok ? 'generated' : 'failed', error: rec.error, requestId: rec.requestId, model: usedModel, durationSeconds });
    appendTraceLocked(runId, {
      name: `generate-clip:${job.scene.id}#${job.attempt}`,
      stage: 'clips',
      model: usedModel,
      inputs: { sceneId: job.scene.id, attempt: job.attempt, steering, aspectRatio, seconds: job.seconds, resolution: job.resolution },
      prompt: job.prompt,
      tool_calls: calls.map(toolCall),
      outputs: { file: ok ? job.file : null, status: ok ? 'generated' : 'failed', error: rec.error, durationSeconds },
      duration_ms: calls.reduce((a, c) => a + c.duration_ms, 0),
    });
    return { sceneId: job.scene.id, attempt: job.attempt, model: usedModel, status: ok ? 'generated' : 'failed', file: ok ? job.file : null, error: rec.error, seconds: Math.round(rec.duration_ms / 1000) };
  });

  const audio = audioJob ? await audioJob : null;
  const failed = results.filter((r) => r.status === 'failed');
  if (authError) throw new Error(`fal refused the request, stopped: ${authError}`);
  if (failed.length === results.length) throw new Error(`All ${failed.length} clip(s) failed: ${failed.map((f) => f.error).join(' | ')}`);
  return { runId, model, results, audio: audio && { music: !!audio.music, voiceover: !!audio.voiceover, notes: audio.notes } };
}

