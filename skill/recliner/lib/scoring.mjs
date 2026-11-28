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
  const reserve = total * 0.25; // stop retries when less than 25% of the budget remains
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
      creativeThesis: goal.creativeThesis || null,
      description: goal.description,
      realWorldGrounding: goal.realWorldGrounding || [],
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
        instructions: `${QUESTION} Judge whether the goal sells this specific product toward the brief's objective on its platform through a specific creative thesis and real-world grounding, rather than being generic atmosphere.`,
        criteria: {
          yes: 'The goal clearly promotes this product toward the brief objective on the brief platform with specific verifiable grounding',
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

// Ground-truth product photos (run-relative): the brand reference's selected `productImages`, else its
// screenshots, keeping only files that exist. Keyframe generation uses them as image references.
export function productImages(runId) {
  const brand = (readJson(runId, 'references.json', {}).references || []).find((r) => r.kind === 'brand');
  if (!brand) return [];
  const pick = Array.isArray(brand.productImages) && brand.productImages.length ? brand.productImages : brand.screenshots || [];
  return pick.filter((p) => typeof p === 'string' && fs.existsSync(runPath(runId, p))).slice(0, 3);
}

// plan.json always carries endCard { headline, subline, durationSeconds } (older shape { text, seconds } is converted).
// Controlled vocabulary for styleTags (goals.md lists the same values).
export const MODALITIES = ['product-macro', 'kinetic-type', 'ugc-creator', 'talking-head', 'athlete-talent', 'ui-demo', 'stop-motion', 'mockumentary', 'pov', 'documentary', 'lifestyle-montage', 'animation', 'other'];
export const HOOK_TYPES = ['physical-action', 'sound-first', 'reveal', 'question', 'bold-claim', 'pattern-interrupt', 'pov-entry', 'before-after', 'text-first', 'other'];
const MODALITY_WORDS = [
  ['ugc-creator', /\bugc\b|creator|selfie|phone-shot/], ['talking-head', /talking[- ]head|to camera|testimonial/],
  ['kinetic-type', /kinetic|typograph/], ['stop-motion', /stop[- ]motion/], ['mockumentary', /mockumentary/],
  ['ui-demo', /\bui\b|app demo|screen record|interface/], ['pov', /\bpov\b|first[- ]person/],
  ['documentary', /documentary|vérité|verite/], ['animation', /animat|cartoon|claymation/],
  ['athlete-talent', /athlete|talent|runner|player|dancer/], ['product-macro', /macro|product[- ]truth|close-up|detail/],
  ['lifestyle-montage', /montage|lifestyle/],
];
const HOOK_WORDS = [
  ['pov-entry', /\bpov\b/], ['question', /\?|question/], ['before-after', /\bbefore\b.*\bafter\b/],
  ['physical-action', /hits|slams|pops|kicks|drops|pours|presses|strikes|lands|pushes|grabs|throws|taps/],
  ['sound-first', /sound|bang|snap/], ['reveal', /reveal|unveil|lifts|pulls back/], ['text-first', /text|caption|title card/], ['bold-claim', /claim/],
];
const COLOURS = /\b(black|white|grey|gray|silver|gold|red|orange|amber|yellow|volt|lime|green|teal|cyan|blue|navy|indigo|purple|violet|pink|magenta|brown|beige|cream|tan|sodium|neon|pastel|chrome)\b/g;
const pick = (table, text, fallback) => (table.find(([, re]) => re.test(text)) || [fallback])[0];
const clause = (s, n = 8) => String(s || '').split(/[,.;:]/)[0].trim().split(/\s+/).slice(0, n).join(' ') || null;
const asList = (p) => (Array.isArray(p) ? p : String(p || '').split(/\s*[\/,&+]\s*|\s+and\s+/)).map((x) => String(x).trim()).filter(Boolean);

// Copy a goal's styleTags into the plan; fill anything missing from style/description/scenes so style memory is never thin.
export function normaliseStyleTags(goal = {}) {
  const t = goal.styleTags || {};
  const text = [goal.title, goal.description, goal.style, goal.creativeGuidance].join(' ').toLowerCase();
  const s1 = goal.scenes?.[0] || {};
  const s1Text = `${s1.prompt || ''} ${s1.description || ''}`.toLowerCase();
  const camera = (goal.scenes || []).map((sc) => clause(sc.keyframePrompt, 4)).filter(Boolean).join(' → ');
  const palette = asList(t.palette).length ? asList(t.palette) : [...new Set(String(goal.style || '').toLowerCase().match(COLOURS) || [])];
  const derived = [];
  const take = (key, value, fallback) => {
    if (value != null && value !== '' && !(Array.isArray(value) && !value.length)) return value;
    derived.push(key);
    return fallback;
  };
  const out = {
    modality: take('modality', t.modality, pick(MODALITY_WORDS, text, 'other')),
    hookType: take('hookType', t.hookType, pick(HOOK_WORDS, s1Text, 'other')),
    openingAction: take('openingAction', t.openingAction, clause(s1.prompt || s1.description, 12)),
    palette: take('palette', palette.length ? palette.slice(0, 3) : null, []),
    pacing: take('pacing', t.pacing, goal.scenes?.length ? `${goal.scenes.length} shots of ${goal.scenes[0].durationSeconds ?? '?'}s` : null),
    cameraLanguage: take('cameraLanguage', t.cameraLanguage, camera || null),
    musicGenre: take('musicGenre', t.musicGenre, clause(goal.audio?.musicPrompt, 4)),
  };
  if (derived.length) out.derived = derived;
  return out;
}

function splitEndCardText(text) {
  const value = String(text || '').trim();
  const lines = value.split(/\n+/).map((x) => x.trim()).filter(Boolean);
  if (lines.length > 1) return [lines[0], lines.slice(1).join(' ')];
  const explicit = value.match(/^(.*?)(?:\s+[—–|]\s+|\s+-\s+|:\s+)(.+)$/);
  if (explicit) return [explicit[1], explicit[2]];
  const idx = value.lastIndexOf('. ');
  if (idx > 0) return [value.slice(0, idx + 1), value.slice(idx + 2)];
  return [value, ''];
}

export function normaliseEndCard(card, brief = {}, intent = null) {
  const c = card || {};
  const [legacyHeadline, legacySubline] = c.text ? splitEndCardText(c.text) : ['', ''];
  const headline = String(c.headline || legacyHeadline || brief.promote || String(intent?.product || '').split(/[(,.;]/)[0].trim().split(/\s+/).slice(0, 5).join(' ')).trim().replace(/[.]+$/, '');
  const subline = c.subline ?? legacySubline;
  const out = { headline, subline, durationSeconds: Number(c.durationSeconds ?? c.seconds) || 2 };
  // Optional art direction for the compositor. Goals may leave these out; composition then infers them from
  // styleTags and uses the final frame as the card background.
  for (const key of ['visualMode', 'palette', 'typography', 'materialCue', 'accent', 'color', 'textColor']) {
    if (c[key] !== undefined) out[key] = c[key];
  }
  return out;
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
  writeJson(runId, 'plan.json', {
    ...goal,
    creativeThesis: goal.creativeThesis || goal.title,
    realWorldGrounding: Array.isArray(goal.realWorldGrounding) ? goal.realWorldGrounding : [],
    goalId: goal.id,
    confidence: best.confidence,
    intent: goalsDoc.intent ?? null,
    endCard: normaliseEndCard(goal.endCard, brief, goalsDoc.intent),
    styleTags: normaliseStyleTags(goal),
    scenes: goal.scenes.map((sc) => ({ ...sc, keyframePrompt: sc.keyframePrompt || sc.prompt })),
    productImages: productImages(runId),
  });
  appendTraceLocked(runId, {
    name: 'score-goals',
    stage: 'scoring',
    model: scores.scorer === 'jev' ? (scores.model || JEV_MODEL) : scores.scorer,
    inputs: { question: QUESTION, goals: goals.map((g) => g.id), requestedScorer: want },
    prompt: scores.scorer === 'jev' ? QUESTION : 'steps/scoring.md',
    tool_calls: scores.scorer === 'jev' ? goals.map((g) => ({ tool: 'jev', arguments: { url: JEV_URL, goalId: g.id }, result: (scores.raw || []).find((x) => x.goalId === g.id)?.answer ?? null })) : [],
    outputs: { scores: valid, selectedGoalId: best.goalId, confidence: best.confidence, creativeThesis: goal.creativeThesis || goal.title, realWorldGrounding: goal.realWorldGrounding || [], files: ['scores.json', 'plan.json'] },
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
  // allKeyframesPassed is null when no scene has a keyframe (keyframes off or not generated yet).
  return { scenes: summary, allPassed: summary.every((s) => s.passed),
    allKeyframesPassed: summary.some((s) => s.keyframePassed !== null) ? summary.every((s) => s.keyframePassed === true) : null, ...budget(runId) };
}

function mergeClips(runId, clips, summary) {
  const passScore = num(readJson(runId, 'config.json', {}).passScore) ?? 70;
  // keyframe may be a plain path string (sample/older runs) or an object (generate-clips).
  const kfFile = (a) => (typeof a.keyframe === 'string' ? a.keyframe : a.keyframe?.file) || null;
  const kfObj = (a) => (typeof a.keyframe === 'string' ? (a.keyframe = { file: a.keyframe }) : a.keyframe);
  for (const scene of clips.scenes) {
    for (const a of scene.attempts || []) {
      const v = readFile(`clips/${scene.sceneId}/${a.attempt}.validation.json`, runId);
      if (v && num(v.score) !== null) {
        a.validation = { score: v.score, passed: typeof v.passed === 'boolean' ? v.passed : v.score >= passScore, reason: v.reason || '', steering: v.steering || '' };
      }
      const kv = kfFile(a) && readFile(`clips/${scene.sceneId}/${a.attempt}.keyframe.validation.json`, runId);
      if (kv && num(kv.score) !== null) {
        kfObj(a).validation = { score: kv.score, passed: typeof kv.passed === 'boolean' ? kv.passed : kv.score >= passScore, reason: kv.reason || '', steering: kv.steering || '' };
      }
    }
    // Best still per scene (keyframe-first flow); generate-clips animates scene.acceptedKeyframe.
    const stills = (scene.attempts || []).filter((a) => kfFile(a) && kfObj(a).status !== 'failed' && fs.existsSync(runPath(runId, kfFile(a))));
    if (stills.length) scene.acceptedKeyframe = best(stills, (a) => num(kfObj(a).validation?.score)).attempt;
    const usable = (scene.attempts || []).filter((a) => a.status === 'generated' || (a.status !== 'failed' && a.status !== 'generating' && a.file && fs.existsSync(runPath(runId, a.file))));
    const pick = best(usable, (a) => num(a.validation?.score));
    scene.acceptedAttempt = pick ? pick.attempt : null;
    const kf = stills.find((a) => a.attempt === scene.acceptedKeyframe);
    summary.push({ sceneId: scene.sceneId, acceptedKeyframe: scene.acceptedKeyframe ?? null, keyframeScore: kf ? (kf.keyframe?.validation?.score ?? null) : null, keyframePassed: kf ? (kf.keyframe?.validation?.passed ?? false) : null, acceptedAttempt: scene.acceptedAttempt, score: pick?.validation?.score ?? null, passed: pick?.validation?.passed ?? false, attempts: (scene.attempts || []).length });
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
      r.validation = {
        score: v.score,
        passed: typeof v.passed === 'boolean' ? v.passed : v.score >= passScore,
        reason: v.reason || '',
        breakdown: v.breakdown || {},
        slopHits: v.slopHits || [],
        biggestProblem: v.biggestProblem || null,
      };
    }
  }
  const usable = result.results.filter((r) => !r.file || fs.existsSync(runPath(runId, r.file)));
  const pick = best(usable.length ? usable : result.results, (r) => num(r.validation?.score));
  result.selectedId = pick.id;
  return pick;
}
