import { rankResults } from '../../lib/scoring.mjs';
export const describe = 'rank <runId>: merge final validation files into result.json and set selectedId (best score)';
export default async function ([runId]) {
  if (!runId) throw new Error('Usage: rank <runId>');
  return rankResults(runId);
}
