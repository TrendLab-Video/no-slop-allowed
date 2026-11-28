import { setStage } from '../../lib/store.mjs';
export const describe = 'stage <runId> <stageId> <pending|running|retrying|done|failed|skipped> [note]: update the live workflow state';
export default async function ([runId, stageId, status, ...note]) {
  const state = setStage(runId, stageId, status, note.join(' '));
  return { runId, status: state.status, currentStage: state.currentStage };
}
