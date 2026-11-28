import { acceptClips } from '../../lib/scoring.mjs';
export const describe = 'accept-clips <runId>: merge clip validation files into clips.json and set acceptedAttempt per scene (best score)';
export default async function ([runId]) {
  if (!runId) throw new Error('Usage: accept-clips <runId>');
  return acceptClips(runId);
}
