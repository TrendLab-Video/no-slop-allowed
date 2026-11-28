import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRun, newRunId, runDir, readJson, writeJson, repoRoot } from '../../lib/store.mjs';
import { parseBriefMarkdown, submitBrief } from '../../lib/effort.mjs';

export const describe = 'new-run [--slug s] [--prefill file.json] [--brief brief.md] [--effort n] [--sample] [--port 4600]: create a run, print { runId, url }';

const here = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = path.join(here, '../../examples/sample-run');

export default async function (args, flags) {
  const port = flags.port || process.env.RECLINER_PORT || 4600;
  const briefText = flags.brief ? fs.readFileSync(flags.brief, 'utf8') : null;
  const parsed = briefText ? parseBriefMarkdown(briefText) : null;
  const slug = flags.slug || (flags.brief ? path.basename(flags.brief).replace(/\.\w+$/, '') : flags.sample ? 'sample' : 'run');
  const runId = newRunId(slug);
  const url = `http://127.0.0.1:${port}/?run=${runId}`;

  if (flags.sample) {
    fs.cpSync(SAMPLE, runDir(runId), { recursive: true });
    for (const name of ['state.json', 'brief.json']) {
      const doc = readJson(runId, name);
      if (doc) writeJson(runId, name, { ...doc, runId });
    }
    return { runId, url, sample: true };
  }

  const prefill = flags.prefill ? JSON.parse(fs.readFileSync(flags.prefill, 'utf8')) : {};
  createRun(runId, { ...prefill, ...(parsed || {}) });
  if (parsed) {
    const effort = Number(flags.effort || prefill.effort || 1);
    // `file`: the brief path relative to the repo root (export uses it for outputs/<brief-slug>/).
    const file = path.relative(repoRoot(), path.resolve(flags.brief)).split(path.sep).join('/');
    submitBrief(runId, { brief: { ...prefill, ...parsed, file }, config: { ...prefill, effort } }, 'file');
    return { runId, url, headless: true };
  }
  return { runId, url };
}
