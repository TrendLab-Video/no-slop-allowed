import { checkAccount } from '../../lib/fal.mjs';
import { appendTraceLocked } from '../../lib/lock.mjs';

export const describe = 'preflight [runId] [--probe]: check FAL_KEY is set and accepted (free balance check; --probe submits a tiny job). Exits 1 with the reason';

export default async function ([runId], flags) {
  const r = await checkAccount({ probe: !!flags.probe });
  if (runId) {
    appendTraceLocked(runId, {
      name: 'preflight', stage: 'brief',
      tool_calls: [{ tool: `fal:${r.method || 'none'}`, arguments: {}, result: { ok: r.ok, status: r.status, balance: r.balance, reason: r.reason } }],
      outputs: { ok: r.ok, reason: r.reason, balance: r.balance, floor: r.floor, headroom: r.headroom }, duration_ms: r.duration_ms,
    });
  }
  const money = (n) => (n === null || n === undefined ? 'unknown' : `$${n.toFixed(2)}`);
  const line = `balance ${money(r.balance)}, floor ${r.floor ? money(r.floor) : 'off'} (RECLINER_MIN_BALANCE), headroom ${money(r.headroom)}`;
  if (!r.ok) throw new Error(`${r.reason} [${line}]`);
  return { ok: true, balance: r.balance, floor: r.floor, headroom: r.headroom, summary: line, method: r.method, duration_ms: r.duration_ms };
}
