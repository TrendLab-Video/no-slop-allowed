import { recordRun, recent, memoryFile } from '../../lib/style-memory.mjs';
export const describe = 'style-memory <runId> | --recent [n]: append the run\'s chosen style (from plan.json) to runs/style-memory.json, or print recent entries';
export default async function ([runId], flags) {
  if (flags.recent) return { file: memoryFile(), entries: recent(Number(flags.recent) || 8) };
  if (!runId) throw new Error('Usage: style-memory <runId> | style-memory --recent [n]');
  return recordRun(runId);
}
