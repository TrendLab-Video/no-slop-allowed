import { readJson, writeJson, appendTrace, runPath } from '../../lib/store.mjs';
import { run as falRun, download, toolCall, videoArgs, falKey, VIDEO_MODELS } from '../../lib/fal.mjs';
import { probeDuration } from '../../lib/compositors/ffmpeg.mjs';

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
  let p = scene.prompt || scene.description;
  if (plan.style && !p.toLowerCase().includes(String(plan.style).toLowerCase().slice(0, 20))) p += `. Style: ${plan.style}`;
  p += '. No on-screen text, no captions, no logos, no watermarks.';
  if (steering) p += ` Important correction from review: ${steering}`;
  return p;
}

export default async function ([runId], flags) {
  if (!runId) throw new Error('usage: generate-clips <runId> [--scene id --steering "..."]');
  const plan = readJson(runId, 'plan.json');
  if (!plan) throw new Error(`No plan.json in run ${runId}`);
  const config = readJson(runId, 'config.json', {});
  falKey(); // fail fast with a clear message

  const model = config.videoModel || VIDEO_MODELS[config.effort || 3];
  const aspectRatio = config.aspectRatio || plan.aspectRatio || readJson(runId, 'brief.json', {})?.aspectRatio || '16:9';
  const parallelism = config.parallelism || 4;
  const scenes = [...plan.scenes].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const targets = flags.scene ? scenes.filter((s) => s.id === flags.scene) : scenes;
  if (!targets.length) throw new Error(`Scene ${flags.scene} not in plan.json`);
  const steering = typeof flags.steering === 'string' ? flags.steering : null;

  // clips.json is read-modify-written synchronously, so parallel tasks in this process never clobber each other.
  const clips = () => readJson(runId, 'clips.json', { scenes: [] });
  const update = (sceneId, attemptNo, patch) => {
    const doc = clips();
    let s = doc.scenes.find((x) => x.sceneId === sceneId);
    if (!s) { s = { sceneId, acceptedAttempt: null, attempts: [] }; doc.scenes.push(s); }
    let a = s.attempts.find((x) => x.attempt === attemptNo);
    if (!a) { a = { attempt: attemptNo }; s.attempts.push(a); }
    Object.assign(a, patch);
    doc.scenes.sort((x, y) => scenes.findIndex((q) => q.id === x.sceneId) - scenes.findIndex((q) => q.id === y.sceneId));
    writeJson(runId, 'clips.json', doc);
  };
  const nextAttempt = (sceneId) => {
    const s = clips().scenes.find((x) => x.sceneId === sceneId);
    return s?.attempts?.length ? Math.max(...s.attempts.map((a) => a.attempt)) + 1 : 1;
  };

  // Reserve attempt numbers up front so parallel scenes never collide.
  const jobs = targets.map((scene) => {
    const attempt = nextAttempt(scene.id);
    const prompt = scenePrompt(plan, scene, steering);
    const seconds = scene.durationSeconds || config.clipSeconds || 5;
    const args = videoArgs(model, { prompt, aspectRatio, seconds, resolution: config.resolution || (config.effort <= 1 ? '480p' : '720p') });
    const file = `clips/${scene.id}/${attempt}.mp4`;
    update(scene.id, attempt, { file, model, prompt, steering, requestId: null, status: 'generating', error: null, durationSeconds: null, validation: null });
    return { scene, attempt, prompt, args, file };
  });

  const results = await mapLimit(jobs, parallelism, async (job) => {
    const rec = await falRun(model, job.args, {
      timeoutMs: (config.clipTimeoutMinutes || 8) * 60000,
      onSubmit: (r) => update(job.scene.id, job.attempt, { requestId: r.requestId }),
    });
    let durationSeconds = null;
    if (rec.status === 'ok' && rec.url) {
      try {
        await download(rec.url, runPath(runId, job.file));
        durationSeconds = await probeDuration(runPath(runId, job.file));
      } catch (err) { rec.status = 'failed'; rec.error = `download: ${err.message}`; }
    } else if (rec.status === 'ok') { rec.status = 'failed'; rec.error = 'fal result had no video url'; }
    const ok = rec.status === 'ok';
    update(job.scene.id, job.attempt, { status: ok ? 'generated' : 'failed', error: rec.error, requestId: rec.requestId, durationSeconds });
    appendTrace(runId, {
      name: `generate-clip:${job.scene.id}#${job.attempt}`,
      stage: 'clips',
      model,
      inputs: { sceneId: job.scene.id, attempt: job.attempt, steering, aspectRatio },
      prompt: job.prompt,
      tool_calls: [toolCall(rec)],
      outputs: { file: ok ? job.file : null, status: ok ? 'generated' : 'failed', error: rec.error, durationSeconds },
      duration_ms: rec.duration_ms,
    });
    return { sceneId: job.scene.id, attempt: job.attempt, status: ok ? 'generated' : 'failed', file: ok ? job.file : null, error: rec.error, seconds: Math.round(rec.duration_ms / 1000) };
  });

  const failed = results.filter((r) => r.status === 'failed');
  if (failed.length === results.length) throw new Error(`All ${failed.length} clip(s) failed: ${failed.map((f) => f.error).join(' | ')}`);
  return { runId, model, results };
}

