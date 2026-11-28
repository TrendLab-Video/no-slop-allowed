// Style memory shared across runs (runs/style-memory.json), so goals steer away from recent looks.
import fs from 'node:fs';
import path from 'node:path';
import { runsDir, readJson } from './store.mjs';
import { withLock } from './lock.mjs';

export const memoryFile = () => path.join(runsDir(), 'style-memory.json');
const MAX = 50;

export function readMemory() {
  try {
    return JSON.parse(fs.readFileSync(memoryFile(), 'utf8'));
  } catch {
    return { entries: [] };
  }
}

const slugOf = (runId, brief) => {
  const src = brief?.file || brief?.promote || runId.replace(/^\d{8}-\d{6}-/, '');
  return String(path.basename(String(src))).toLowerCase().replace(/\.md$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
};

// Append (or replace) this run's entry from plan.json. Deterministic: no model involved.
export function recordRun(runId) {
  const plan = readJson(runId, 'plan.json');
  if (!plan) throw new Error(`No plan.json in run ${runId}. Run score first.`);
  const brief = readJson(runId, 'brief.json', {});
  const t = plan.styleTags || {};
  const entry = {
    runId,
    briefSlug: slugOf(runId, brief),
    goalId: plan.goalId,
    title: plan.title,
    modality: t.modality || null,
    style: plan.style || null,
    hookType: t.hookType || null,
    openingAction: t.openingAction || null,
    palette: t.palette || null,
    pacing: t.pacing || null,
    cameraLanguage: t.cameraLanguage || null,
    musicGenre: t.musicGenre || null,
    referenceIds: plan.referenceIds || [],
    referenceUrls: (readJson(runId, 'references.json', {}).references || []).filter((r) => (plan.referenceIds || []).includes(r.id)).map((r) => r.url),
    at: new Date().toISOString(),
  };
  const file = memoryFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return withLock(file, () => {
    const mem = readMemory();
    mem.entries = [...mem.entries.filter((e) => e.runId !== runId), entry].slice(-MAX);
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(mem, null, 2));
    fs.renameSync(tmp, file);
    return { entry, total: mem.entries.length };
  });
}

export const recent = (n = 8) => readMemory().entries.slice(-n);

// One short line per entry, oldest first: the fields goals must not repeat.
export const compact = (e) => {
  const pal = Array.isArray(e.palette) ? e.palette.join('/') : e.palette || '-';
  return `${e.briefSlug || e.runId} | modality=${e.modality || '-'} | hook=${e.hookType || '-'} | opening=${e.openingAction || '-'} | palette=${pal} | pacing=${e.pacing || '-'} | camera=${e.cameraLanguage || '-'} | music=${e.musicGenre || '-'}`;
};
