import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeJson, runPath, repoRoot } from '../../lib/store.mjs';

export const describe = 'export <runId> [--slug s]: copy the selected video and traces.json to outputs/<brief-slug>/';

const slugify = (s) => String(s).toLowerCase().replace(/\.md$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

// Brief slug: the brief file name when the run came from a file, else the run's slug part.
export function briefSlug(runId, brief) {
  const src = brief?.file || brief?.briefFile || brief?.path;
  if (src) return slugify(path.basename(src));
  if (brief?.promote) return slugify(brief.promote);
  return slugify(runId.replace(/^\d{8}-\d{6}-/, ''));
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

  // Fill the top-level trace fields in the run's own traces.json too, so both copies agree.
  const traces = readJson(runId, 'traces.json', { steps: [] });
  const briefRef = brief.file || brief.briefFile || brief.path || (brief.raw ? `brief.json (${runId})` : null);
  traces.brief = traces.brief || (briefRef ? briefRef : { promote: brief.promote, objective: brief.objective, platform: brief.platform, raw: brief.raw });
  traces.output_video = `${outRel}/final.mp4`;
  traces.finished_at = new Date().toISOString();
  traces.run_id = runId;
  traces.selected_result = { id: selected.id, file: selected.file, compositor: selected.compositor, validation: selected.validation ?? null };
  writeJson(runId, 'traces.json', traces);
  fs.writeFileSync(path.join(outDir, 'traces.json'), JSON.stringify(traces, null, 2));
  return { runId, selectedId: selected.id, video: `${outRel}/final.mp4`, traces: `${outRel}/traces.json` };
}
