import fs from 'node:fs';
import { appendTrace } from '../../lib/store.mjs';
export const describe = 'trace <runId> <step.json | ->: append one step to traces.json';
export default async function ([runId, file]) {
  const step = JSON.parse(fs.readFileSync(!file || file === '-' ? 0 : file, 'utf8'));
  return { steps: appendTrace(runId, step).steps.length };
}
