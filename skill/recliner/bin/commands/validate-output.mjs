import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, runPath, repoRoot } from '../../lib/store.mjs';
import { updateJson, appendTraceLocked } from '../../lib/lock.mjs';
import { sh } from '../../lib/compositors/ffmpeg.mjs';

export const describe = 'validate-output <runId> [--attempt n] [--strict]: run deterministic ffmpeg/audio validation for a composed final.mp4';

// The Python `validation` package sits at the repo root in the repository and inside the skill folder in the
// packaged skill (scripts/package-skill.sh copies it there). Run from whichever holds it.
function validationRoot() {
  const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  for (const dir of [repoRoot(), skillRoot]) if (fs.existsSync(path.join(dir, 'validation', 'run.py'))) return dir;
  throw new Error('the validation package was not found (looked in the workspace root and the skill folder)');
}

export default async function ([runId], flags) {
  if (!runId) throw new Error('usage: validate-output <runId> [--attempt n] [--strict]');
  const started = Date.now();
  const result = readJson(runId, 'result.json');
  if (!result?.results?.length) throw new Error(`No compositions in ${runId}/result.json`);
  const entry = flags.attempt
    ? result.results.find((r) => r.attempt === Number(flags.attempt))
    : [...result.results].sort((a, b) => b.attempt - a.attempt)[0];
  if (!entry) throw new Error(`No composition attempt ${flags.attempt} in ${runId}`);

  const video = runPath(runId, entry.file);
  if (!fs.existsSync(video)) throw new Error(`Missing composed video ${entry.file}`);
  const compositionDir = path.dirname(video);
  const relDir = path.dirname(entry.file);
  const reportFile = path.join(compositionDir, 'validation_report.json');
  const repairFile = path.join(compositionDir, 'repair_plan.json');
  const contactFile = path.join(compositionDir, 'contact-sheet.png');
  const brief = readJson(runId, 'brief.json', {}) || {};
  const plan = readJson(runId, 'plan.json', {}) || {};
  const briefRef = path.resolve(repoRoot(), brief.file || `runs/${runId}/brief.json`);

  const args = [
    '-m', 'validation.run', compositionDir,
    '--video', video,
    '--write', reportFile,
    '--repair-write', repairFile,
    '--contact-sheet', contactFile,
    '--video-only',
    '--source-brief', briefRef,
  ];
  if (typeof plan.durationSeconds === 'number' && plan.durationSeconds > 0) {
    const tolerance = Math.max(1, plan.durationSeconds * 0.1);
    args.push('--duration-min', String(Math.max(1, plan.durationSeconds - tolerance)));
    args.push('--duration-max', String(plan.durationSeconds + tolerance));
  }
  let cliOut = '';
  let error = null;
  try {
    const run = await sh('python3', args, { cwd: validationRoot(), timeoutMs: 150000 });
    cliOut = run.out;
  } catch (err) {
    error = err;
  }

  if (error || !fs.existsSync(reportFile)) {
    appendTraceLocked(runId, {
      name: `validate-output:${entry.id}`, stage: 'final_validation', model: null,
      inputs: { file: entry.file, mode: 'video-only', targetDurationSeconds: plan.durationSeconds ?? null },
      tool_calls: [{ tool: 'validation.run', arguments: { command: `python3 ${args.join(' ')}` }, result: { ok: false } }],
      outputs: { error: error?.message || 'validation_report.json was not written' },
      duration_ms: Date.now() - started,
    });
    throw error || new Error('validation_report.json was not written');
  }

  const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
  const counts = {
    blockers: report.findings.filter((f) => f.severity === 'blocker').length,
    major: report.findings.filter((f) => f.severity === 'major').length,
    minor: report.findings.filter((f) => f.severity === 'minor').length,
  };
  const technicalValidation = {
    status: report.status,
    report: `${relDir}/validation_report.json`,
    repairPlan: `${relDir}/repair_plan.json`,
    contactSheet: fs.existsSync(contactFile) ? `${relDir}/contact-sheet.png` : null,
    blockerCount: counts.blockers,
    majorCount: counts.major,
    minorCount: counts.minor,
    wallTimeMs: report.cost?.wall_time_ms ?? null,
    mode: 'video-only',
  };

  updateJson(runId, 'result.json', { results: [], selectedId: null }, (doc) => {
    const target = doc.results.find((r) => r.id === entry.id);
    if (target) target.technicalValidation = technicalValidation;
  });
  appendTraceLocked(runId, {
    name: `validate-output:${entry.id}`, stage: 'final_validation', model: null,
    inputs: { file: entry.file, mode: 'video-only', sourceBrief: briefRef, targetDurationSeconds: plan.durationSeconds ?? null },
    tool_calls: [{ tool: 'validation.run', arguments: { command: `python3 ${args.join(' ')}` }, result: { ok: true, status: report.status } }],
    outputs: {
      status: report.status,
      validationReport: technicalValidation.report,
      repairPlan: technicalValidation.repairPlan,
      contactSheet: technicalValidation.contactSheet,
      counts,
      warnings: report.warnings || [],
    },
    duration_ms: Date.now() - started,
  });

  const out = { runId, id: entry.id, attempt: entry.attempt, ...technicalValidation };
  if (flags.strict && report.status !== 'pass') throw new Error(`technical validation ${report.status}: ${technicalValidation.report}`);
  try { out.cli = JSON.parse(cliOut); } catch {}
  return out;
}
