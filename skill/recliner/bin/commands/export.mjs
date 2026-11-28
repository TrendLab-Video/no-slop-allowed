import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeJson, runPath, repoRoot, setStage } from '../../lib/store.mjs';
import { updateJson, appendTraceLocked } from '../../lib/lock.mjs';

export const describe = 'export <runId> [--slug s]: copy the selected video and traces.json to outputs/<brief-slug>/';

const slugify = (s) => String(s).toLowerCase().replace(/\.md$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

// Brief slug: the brief file's name (briefs/02-nike.md -> 02-nike), else the run slug (runId minus the timestamp).
export function briefSlug(runId, brief) {
  if (brief?.file) return slugify(path.basename(brief.file).replace(/\.\w+$/, ''));
  return slugify(runId.replace(/^\d{8}-\d{6}-/, ''));
}


function buildCreativeRationale(runId, brief, selected) {
  const plan = readJson(runId, 'plan.json', {}) || {};
  const scores = readJson(runId, 'scores.json', {}) || {};
  const referencesDoc = readJson(runId, 'references.json', { references: [] }) || { references: [] };
  const referenceIds = new Set(plan.referenceIds || []);
  const referencesUsed = (referencesDoc.references || [])
    .filter((r) => referenceIds.has(r.id) || r.kind === 'brand')
    .map((r) => ({ id: r.id, kind: r.kind || 'reference', title: r.title || null, url: r.url || null, why: r.why || null }));
  const selectedScore = (scores.scores || []).find((s) => s.goalId === plan.goalId) || null;
  const alternatives = (scores.scores || [])
    .filter((s) => s.goalId && s.goalId !== plan.goalId)
    .map((s) => ({ goalId: s.goalId, confidence: s.confidence }))
    .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
    .slice(0, 4);

  return {
    artifact_type: 'creative_rationale',
    version: '0.1.0',
    created_at: new Date().toISOString(),
    runId,
    brief: {
      file: brief.file || null,
      promote: brief.promote || null,
      objective: brief.objective || null,
      platform: brief.platform || null,
      aspectRatio: brief.aspectRatio || plan.aspectRatio || null,
    },
    creativeThesis: plan.creativeThesis || plan.title || null,
    intent: plan.intent || null,
    realWorldGrounding: plan.realWorldGrounding || [],
    selectedGoal: {
      id: plan.goalId || null,
      title: plan.title || null,
      description: plan.description || null,
      confidence: plan.confidence ?? null,
      style: plan.style || null,
      styleTags: plan.styleTags || null,
    },
    endCard: selected.endCard || plan.endCard || null,
    decisionEvidence: {
      scorer: scores.scorer || null,
      selectedReason: selectedScore?.reason || null,
      alternatives,
      referencesUsed,
      compositor: selected.compositor || null,
    },
    validationEvidence: {
      creative: selected.validation ? {
        score: selected.validation.score ?? null,
        passed: selected.validation.passed ?? null,
        reason: selected.validation.reason || null,
        biggestProblem: selected.validation.biggestProblem || null,
        slopHits: selected.validation.slopHits || [],
      } : null,
      technical: selected.technicalValidation || null,
    },
  };
}

export default async function ([runId], flags) {
  if (!runId) throw new Error('usage: export <runId> [--slug s]');
  const result = readJson(runId, 'result.json');
  if (!result?.results?.length) throw new Error(`No compositions in ${runId}/result.json`);
  const selected = result.results.find((r) => r.id === result.selectedId)
    || [...result.results].sort((a, b) => (b.validation?.score ?? -1) - (a.validation?.score ?? -1) || b.attempt - a.attempt)[0];
  const brief = readJson(runId, 'brief.json', {}) || {};
  const slug = typeof flags.slug === 'string' ? slugify(flags.slug) : briefSlug(runId, brief);
  const outRel = path.join('outputs', slug);
  const outDir = path.join(repoRoot(), outRel);
  fs.mkdirSync(outDir, { recursive: true });

  fs.copyFileSync(runPath(runId, selected.file), path.join(outDir, 'final.mp4'));
  if (selected.thumbnail && fs.existsSync(runPath(runId, selected.thumbnail))) fs.copyFileSync(runPath(runId, selected.thumbnail), path.join(outDir, 'thumbnail.jpg'));
  if (selected.technicalValidation) {
    for (const [key, file] of [['validation_report.json', selected.technicalValidation.report], ['repair_plan.json', selected.technicalValidation.repairPlan], ['contact-sheet.png', selected.technicalValidation.contactSheet]]) {
      if (file && fs.existsSync(runPath(runId, file))) fs.copyFileSync(runPath(runId, file), path.join(outDir, key));
    }
  }

  const rationale = buildCreativeRationale(runId, brief, selected);
  writeJson(runId, 'creative_rationale.json', rationale);
  fs.copyFileSync(runPath(runId, 'creative_rationale.json'), path.join(outDir, 'creative_rationale.json'));

  appendTraceLocked(runId, {
    name: 'export', stage: 'output',
    inputs: { selectedId: selected.id, file: selected.file, score: selected.validation?.score ?? null },
    tool_calls: [{ tool: 'copy', arguments: { from: selected.file, to: `${outRel}/final.mp4` }, result: { ok: true } }],
    outputs: { video: `${outRel}/final.mp4`, traces: `${outRel}/traces.json`, creativeRationale: `${outRel}/creative_rationale.json` },
  });
  // Mark the run finished before the copy, so the exported traces.json is complete: the output stage is done
  // and the last step records it (a later `recliner stage <runId> output done` is then a no-op).
  const finishedAt = new Date().toISOString();
  try { setStage(runId, 'output', 'done', `exported to ${outRel}`); } catch {}
  const startedAt = readJson(runId, 'traces.json', {})?.started_at;
  appendTraceLocked(runId, {
    name: 'run:finished', stage: 'output',
    outputs: { status: 'done', output_video: `${outRel}/final.mp4`, finished_at: finishedAt, run_seconds: startedAt ? Math.round((Date.parse(finishedAt) - Date.parse(startedAt)) / 1000) : null },
  });
  // Fill the top-level trace fields in the run's own traces.json too, so both copies agree.
  // traces.brief is a path: the brief file when there is one, else the run's brief.json.
  const briefRef = brief.file || `runs/${runId}/brief.json`;
  const traces = updateJson(runId, 'traces.json', { steps: [] }, (t) => {
    t.brief = briefRef;
    t.output_video = `${outRel}/final.mp4`;
    t.finished_at = finishedAt;
    t.run_id = runId;
    t.selected_result = { id: selected.id, file: selected.file, compositor: selected.compositor, validation: selected.validation ?? null, technicalValidation: selected.technicalValidation ?? null };
  });
  fs.writeFileSync(path.join(outDir, 'traces.json'), JSON.stringify(traces, null, 2));
  return { runId, selectedId: selected.id, video: `${outRel}/final.mp4`, traces: `${outRel}/traces.json`, creativeRationale: `${outRel}/creative_rationale.json` };
}
