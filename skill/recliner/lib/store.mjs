// Shared run store. Every stage, page and trace reads and writes runs/<runId>/ through this file.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

export const STAGES = [
  ['brief', 'Brief'],
  ['references', 'References'],
  ['goals', 'Goals'],
  ['scoring', 'Scoring'],
  ['clips', 'Clips'],
  ['clip_validation', 'Clip validation'],
  ['composition', 'Composition'],
  ['final_validation', 'Final validation'],
  ['output', 'Output'],
];

// Repo root of the current checkout (worktree-aware). RECLINER_ROOT overrides.
export function repoRoot() {
  if (process.env.RECLINER_ROOT) return process.env.RECLINER_ROOT;
  try {
    return execSync('git rev-parse --show-toplevel', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return process.cwd();
  }
}

export const runsDir = () => process.env.RECLINER_RUNS || path.join(repoRoot(), 'runs');
export const runDir = (runId) => path.join(runsDir(), runId);
export const runPath = (runId, ...parts) => path.join(runDir(runId), ...parts);

export function readJson(runId, name, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(runPath(runId, name), 'utf8'));
  } catch {
    return fallback;
  }
}

// Atomic write so pages polling the file never see half a document.
export function writeJson(runId, name, data) {
  const file = runPath(runId, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
  return file;
}

export function newRunId(slug = 'run') {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  const clean = String(slug).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'run';
  return `${stamp}-${clean}`;
}

export function createRun(runId, prefill = {}) {
  fs.mkdirSync(runDir(runId), { recursive: true });
  const now = new Date().toISOString();
  writeJson(runId, 'state.json', {
    runId,
    status: 'awaiting_brief',
    currentStage: 'brief',
    stages: STAGES.map(([id, label]) => ({ id, label, status: id === 'brief' ? 'running' : 'pending', startedAt: id === 'brief' ? now : null, finishedAt: null, note: '' })),
    createdAt: now,
    updatedAt: now,
  });
  writeJson(runId, 'prefill.json', prefill);
  writeJson(runId, 'traces.json', { brief: null, output_video: null, started_at: now, finished_at: null, steps: [] });
  return runId;
}

// status: pending | running | retrying | done | failed | skipped
export function setStage(runId, stageId, status, note = '') {
  const state = readJson(runId, 'state.json');
  if (!state) throw new Error(`No run ${runId}`);
  const stage = state.stages.find((s) => s.id === stageId);
  if (!stage) throw new Error(`Unknown stage ${stageId}`);
  const now = new Date().toISOString();
  stage.status = status;
  stage.note = note;
  if (status === 'running' && !stage.startedAt) stage.startedAt = now;
  if (['done', 'failed', 'skipped'].includes(status)) stage.finishedAt = now;
  if (['running', 'retrying'].includes(status)) state.currentStage = stageId;
  if (status === 'failed') state.status = 'failed';
  else if (stageId === 'output' && status === 'done') state.status = 'done';
  else if (['running', 'retrying'].includes(status) && stageId !== 'brief') state.status = 'running'; // also resumes a failed run
  else if (state.status !== 'failed' && !(stageId === 'brief' && status === 'running')) state.status = 'running';
  state.updatedAt = now;
  writeJson(runId, 'state.json', state);
  return state;
}

// Append one step to traces.json. Shape follows traces.example.json; extra fields are welcome.
export function appendTrace(runId, step) {
  const traces = readJson(runId, 'traces.json', { steps: [] });
  traces.steps.push({
    id: `step-${traces.steps.length + 1}`,
    name: step.name || 'step',
    stage: step.stage || null,
    model: step.model ?? null,
    requestId: step.requestId ?? null,
    inputs: step.inputs || {},
    prompt: step.prompt ?? null,
    tool_calls: step.tool_calls || [],
    outputs: step.outputs || {},
    duration_ms: step.duration_ms ?? null,
    at: new Date().toISOString(),
    ...(step.extra || {}),
  });
  writeJson(runId, 'traces.json', traces);
  return traces;
}
