import { checkAccount } from '../../lib/fal.mjs';
import { appendTraceLocked } from '../../lib/lock.mjs';

export const describe = 'preflight [runId] [--probe]: check FAL_KEY is set and accepted (free balance check; --probe submits a tiny job). Exits 1 with the reason';

export default async function ([runId], flags) {
  const r = await checkAccount({ probe: !!flags.probe });
  if (runId) {
    appendTraceLocked(runId, {
      name: 'preflight', stage: 'brief',
      tool_calls: [{ tool: `fal:${r.method || 'none'}`, arguments: {}, result: { ok: r.ok, status: r.status, balance: r.balance, reason: r.reason } }],
      outputs: { ok: r.ok, reason: r.reason }, duration_ms: r.duration_ms,
    });
  }
  if (!r.ok) throw new Error(r.reason);
  return { ok: true, balance: r.balance, method: r.method, duration_ms: r.duration_ms };
}
