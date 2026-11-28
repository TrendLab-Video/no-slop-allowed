import fs from 'node:fs';
import { runPath, readJson } from '../../lib/store.mjs';

export const describe = 'wait-brief <runId> [--timeout seconds]: block until brief.json exists, then print it with config.json';

export default async function ([runId], flags) {
  if (!runId) throw new Error('Usage: wait-brief <runId>');
  if (!fs.existsSync(runPath(runId, 'state.json'))) throw new Error(`No run ${runId}`);
  const deadline = flags.timeout ? Date.now() + Number(flags.timeout) * 1000 : Infinity;
  while (!fs.existsSync(runPath(runId, 'brief.json'))) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for the brief of ${runId}`);
    await new Promise((r) => setTimeout(r, 500));
  }
  await new Promise((r) => setTimeout(r, 100)); // let the state update land
  return { brief: readJson(runId, 'brief.json'), config: readJson(runId, 'config.json') };
}
