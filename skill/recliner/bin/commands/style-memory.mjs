import { recordRun, recent, memoryFile, compact } from '../../lib/style-memory.mjs';
export const describe = 'style-memory <runId> | --recent [n] [--full]: append the run\'s styleTags (from plan.json) to runs/style-memory.json, or print recent entries compactly';
export default async function ([runId], flags) {
  if (flags.recent) {
    const entries = recent(Number(flags.recent) || 8);
    return flags.full ? { file: memoryFile(), entries } : { file: memoryFile(), avoid: entries.map(compact) };
  }
  if (!runId) throw new Error('Usage: style-memory <runId> | style-memory --recent [n] [--full]');
  return recordRun(runId);
}
