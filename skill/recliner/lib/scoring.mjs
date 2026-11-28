// Goal scoring (Jev or a sub-agent's scores.json), clip acceptance and result ranking.
// All deterministic except the Jev call. Writes only through store.mjs.
import fs from 'node:fs';
import { readJson, writeJson, runPath } from './store.mjs';
import { loadEnv } from './env.mjs';
import { updateJson, appendTraceLocked } from './lock.mjs';

export const QUESTION = 'Does this goal match the intended brief?';
export const JEV_URL = process.env.JEV_URL || 'https://api.typesafe.ai/v1/systemone'; // override for tests
export const JEV_MODEL = 'jev-latest';

// Time budget measured from brief.submittedAt (falls back to run creation).
export function budget(runId) {
  const brief = readJson(runId, 'brief.json', {});
  const state = readJson(runId, 'state.json', {});
  const config = readJson(runId, 'config.json', {});
  const start = Date.parse(brief.submittedAt || state.createdAt || '') || Date.now();
  const total = Number(config.timeBudgetMinutes) || 15;
  const elapsed = (Date.now() - start) / 60000;
  const remaining = total - elapsed;
  const reserve = Math.max(4, total * 0.3);
  return {
    budgetMinutes: total,
    elapsedMinutes: +elapsed.toFixed(1),
    remainingMinutes: +remaining.toFixed(1),
    stopRetrying: remaining < reserve,
  };
}

function jevKey() {
  loadEnv();
  return process.env.JEV_API_KEY || process.env.TYPESAFE_API_KEY || '';
}

// What Jev sees for one goal: the brief and the goal without noise.
function jevState(brief, goal, intent) {
  return {
    brief: { promote: brief.promote, objective: brief.objective, url: brief.url, platform: brief.platform, videoType: brief.videoType, domain: brief.domain, notes: brief.notes, raw: brief.raw },
    intent: intent || null,
    goal: {
      title: goal.title,
      description: goal.description,
      creativeGuidance: goal.creativeGuidance,
      style: goal.style,
      durationSeconds: goal.durationSeconds,
      scenes: (goal.scenes || []).map((s) => ({ description: s.description, onScreenText: s.onScreenText })),
    },
  };
}

// One Jev call per goal. Choice question so confidence and probabilities are explicit.
export async function jevScoreGoal(brief, goal, intent, key = jevKey()) {
  const t0 = Date.now();
  const body = {
    model: JEV_MODEL,
    state: jevState(brief, goal, intent),
    questions: {
      match: {
        type: 'choice',
        instructions: `${QUESTION} Judge whether the goal sells this specific product toward the brief's objective on its platform, rather than being generic.`,
        criteria: {
          yes: 'The goal clearly promotes this product toward the brief objective on the brief platform',
          no: 'The goal is generic, off-objective, off-platform or about something else',
        },
      },
    },
  };
  const res = await fetch(JEV_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Jev ${res.status}: ${text.slice(0, 300)}`);
  const data = JSON.parse(text);
  const a = data.answers?.match || {};
  const pYes = a.probabilities?.yes ?? (a.choice === 'yes' ? a.confidence : a.choice === 'no' ? 1 - (a.confidence ?? 1) : null);
  if (typeof pYes !== 'number') throw new Error(`Jev returned no usable answer: ${text.slice(0, 300)}`);
  return {
    goalId: goal.id,
    confidence: +Math.max(0, Math.min(1, pYes)).toFixed(3),
    reason: `Jev ${data.model || JEV_MODEL}: choice=${a.choice}, p(yes)=${pYes.toFixed(3)}, confidence=${a.confidence ?? 'n/a'}`,
    raw: { model: data.model, answer: a, usage: data.usage, ms: Date.now() - t0 },
  };
}

function checkGoals(goals) {
  const list = goals?.goals;
  if (!Array.isArray(list) || !list.length) throw new Error('goals.json has no goals. Run steps/goals.md first.');
  for (const g of list) {
    if (!g.id) throw new Error('A goal in goals.json has no id.');
    if (!Array.isArray(g.scenes) || !g.scenes.length) throw new Error(`Goal ${g.id} has no scenes.`);
    for (const s of g.scenes) if (!s.id || !s.prompt) throw new Error(`Goal ${g.id} has a scene without id or prompt.`);
  }
  return list;
}

// score <runId>: Jev when configured and keyed, else finalise a scores.json the sub-agent wrote.
export async function scoreRun(runId, { scorer } = {}) {
  const brief = readJson(runId, 'brief.json');
  if (!brief) throw new Error(`No brief.json in run ${runId}.`);
  const config = readJson(runId, 'config.json', {});
  const goalsDoc = readJson(runId, 'goals.json');
  const goals = checkGoals(goalsDoc);
  const t0 = Date.now();
  const want = scorer || config.scorer || 'jev';
  const key = jevKey();
  let scores = readJson(runId, 'scores.json');
  let jevError = null;

  if (want === 'jev' && key) {
    try {
      const results = await Promise.all(goals.map((g) => jevScoreGoal(brief, g, goalsDoc.intent, key)));
      scores = { scorer: 'jev', question: QUESTION, model: JEV_MODEL, scores: results.map(({ raw, ...r }) => r), raw: results.map((r) => ({ goalId: r.goalId, ...r.raw })) };
    } catch (err) {
      jevError = err.message;
    }
  } else if (want === 'jev') {
    jevError = 'JEV_API_KEY is not set';
  }

  if (!scores) {
    throw new Error(`${jevError ? `Jev unavailable (${jevError}). ` : ''}No scores.json yet: run the Haiku sub-agent with steps/scoring.md to write it, then run score again.`);
  }

  // Validate and select deterministically.
  const ids = new Set(goals.map((g) => g.id));
  const valid = (scores.scores || []).filter((s) => ids.has(s.goalId) && typeof s.confidence === 'number');
  if (!valid.length) throw new Error('scores.json has no scores for goals in goals.json.');
  for (const s of valid) s.confidence = Math.max(0, Math.min(1, s.confidence));
  // Goals the scorer skipped get 0 so they show up but never win.
  for (const g of goals) if (!valid.find((s) => s.goalId === g.id)) valid.push({ goalId: g.id, confidence: 0, reason: 'not scored' });
  const order = goals.map((g) => g.id);
  const best = [...valid].sort((a, b) => b.confidence - a.confidence || order.indexOf(a.goalId) - order.indexOf(b.goalId))[0];

  scores = { ...scores, question: QUESTION, scores: valid, selectedGoalId: best.goalId };
  if (jevError) scores.jevError = jevError;
  writeJson(runId, 'scores.json', scores);

  const goal = goals.find((g) => g.id === best.goalId);
  writeJson(runId, 'plan.json', { ...goal, goalId: goal.id, confidence: best.confidence, intent: goalsDoc.intent ?? null });
  appendTraceLocked(runId, {
    name: 'score-goals',
    stage: 'scoring',
    model: scores.scorer === 'jev' ? (scores.model || JEV_MODEL) : scores.scorer,
    inputs: { question: QUESTION, goals: goals.map((g) => g.id), requestedScorer: want },
    prompt: scores.scorer === 'jev' ? QUESTION : 'steps/scoring.md',
    tool_calls: scores.scorer === 'jev' ? goals.map((g) => ({ tool: 'jev', arguments: { url: JEV_URL, goalId: g.id }, result: (scores.raw || []).find((x) => x.goalId === g.id)?.answer ?? null })) : [],
    outputs: { scores: valid, selectedGoalId: best.goalId, confidence: best.confidence, files: ['scores.json', 'plan.json'] },
    duration_ms: Date.now() - t0,
    extra: { decision: `selected ${best.goalId}`, rationale: best.reason || 'highest confidence', fallback: jevError ? `Jev unavailable: ${jevError}` : null },
  });
  return { scorer: scores.scorer, selectedGoalId: best.goalId, confidence: best.confidence, scores: valid.map((s) => [s.goalId, s.confidence]), jevError, ...budget(runId) };
}

function readFile(rel, runId) {
  try {
    return JSON.parse(fs.readFileSync(runPath(runId, rel), 'utf8'));
  } catch {
    return null;
  }
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// Pick the best of a list: highest score; ties go to the later attempt (it carries steering).
function best(items, scoreOf) {
  let top = null;
  for (const it of items) {
    const s = scoreOf(it) ?? -1;
    if (!top || s >= top.s) top = { it, s };
  }
  return top?.it ?? null;
}

// accept-clips <runId>: merge clips/<sceneId>/<attempt>.validation.json, set acceptedAttempt per scene.
export function acceptClips(runId) {
  if (!readJson(runId, 'clips.json')?.scenes) throw new Error(`No clips.json in run ${runId}. Run generate-clips first.`);
  const summary = [];
  updateJson(runId, 'clips.json', { scenes: [] }, (clips) => mergeClips(runId, clips, summary));
  appendTraceLocked(runId, { name: 'accept-clips', stage: 'clip_validation', outputs: { scenes: summary }, extra: { decision: 'best-scoring attempt per scene' } });
  return { scenes: summary, allPassed: summary.every((s) => s.passed), ...budget(runId) };
}

function mergeClips(runId, clips, summary) {
  const passScore = num(readJson(runId, 'config.json', {}).passScore) ?? 70;
  for (const scene of clips.scenes) {
    for (const a of scene.attempts || []) {
      const v = readFile(`clips/${scene.sceneId}/${a.attempt}.validation.json`, runId);
      if (v && num(v.score) !== null) {
        a.validation = { score: v.score, passed: typeof v.passed === 'boolean' ? v.passed : v.score >= passScore, reason: v.reason || '', steering: v.steering || '' };
      }
    }
    const usable = (scene.attempts || []).filter((a) => a.status === 'generated' || (a.status !== 'failed' && a.status !== 'generating' && a.file && fs.existsSync(runPath(runId, a.file))));
    const pick = best(usable, (a) => num(a.validation?.score));
    scene.acceptedAttempt = pick ? pick.attempt : null;
    summary.push({ sceneId: scene.sceneId, acceptedAttempt: scene.acceptedAttempt, score: pick?.validation?.score ?? null, passed: pick?.validation?.passed ?? false, attempts: (scene.attempts || []).length });
  }
  return clips;
}

// rank <runId>: merge compositions/<attempt>/validation.json, set selectedId.
export function rankResults(runId) {
  if (!readJson(runId, 'result.json')?.results?.length) throw new Error(`No results in result.json for run ${runId}. Run compose first.`);
  let pick;
  const result = updateJson(runId, 'result.json', { results: [] }, (doc) => { pick = mergeResults(runId, doc); return doc; });
  const out = { selectedId: pick.id, score: pick.validation?.score ?? null, passed: pick.validation?.passed ?? false, ranking: result.results.map((r) => [r.id, r.validation?.score ?? null]) };
  appendTraceLocked(runId, { name: 'rank', stage: 'final_validation', outputs: out, extra: { decision: `selected ${pick.id}`, rationale: 'highest final validation score' } });
  return { ...out, ...budget(runId) };
}

function mergeResults(runId, result) {
  const passScore = num(readJson(runId, 'config.json', {}).passScore) ?? 70;
  for (const r of result.results) {
    const v = readFile(`compositions/${r.attempt}/validation.json`, runId);
    if (v && num(v.score) !== null) {
      r.validation = { score: v.score, passed: typeof v.passed === 'boolean' ? v.passed : v.score >= passScore, reason: v.reason || '', breakdown: v.breakdown || {} };
    }
  }
  const usable = result.results.filter((r) => !r.file || fs.existsSync(runPath(runId, r.file)));
  const pick = best(usable.length ? usable : result.results, (r) => num(r.validation?.score));
  result.selectedId = pick.id;
  return pick;
}
