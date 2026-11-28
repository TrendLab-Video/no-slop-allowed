import { scoreRun } from '../../lib/scoring.mjs';
export const describe = 'score <runId> [--scorer jev|haiku]: score goals (Jev if keyed, else finalise the sub-agent scores.json), write scores.json and plan.json';
export default async function ([runId], flags) {
  if (!runId) throw new Error('Usage: score <runId> [--scorer jev|haiku]');
  return scoreRun(runId, { scorer: flags.scorer });
}
