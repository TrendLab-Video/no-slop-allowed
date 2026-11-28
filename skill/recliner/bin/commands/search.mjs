import { search, searchProvider, NO_KEY, VIDEO_DOMAINS } from '../../lib/search.mjs';
import { readJson } from '../../lib/store.mjs';
import { appendTraceLocked } from '../../lib/lock.mjs';

export const describe = 'search <runId> "<query>" [--max 8] [--recency day|week|month|year] [--days n] [--domains a.com,b.com | --domains video] [--provider tavily|parallel]: web search via Tavily or Parallel (key-gated); prints { provider, query, results, images }';

export default async function ([runId, ...words], flags) {
  const query = words.join(' ').trim();
  if (!runId || !query) throw new Error('Usage: search <runId> "<query>" [--max 8]');
  if (!readJson(runId, 'state.json')) throw new Error(`No run ${runId}`);
  if (!searchProvider(flags.provider)) throw new Error(NO_KEY);
  const t0 = Date.now();
  const domains = flags.domains === 'video' ? VIDEO_DOMAINS : typeof flags.domains === 'string' ? flags.domains : undefined;
  const opts = { max: Number(flags.max) || 8, recency: flags.recency || 'year', days: Number(flags.days) || undefined, domains, provider: flags.provider };
  try {
    const out = await search(query, opts);
    appendTraceLocked(runId, { name: 'search', stage: 'references', model: out.provider, inputs: { query, ...opts }, tool_calls: [{ tool: out.provider, arguments: { query }, result: { results: out.results.length, images: out.images.length } }], outputs: { urls: out.results.map((r) => r.url) }, duration_ms: Date.now() - t0 });
    return out;
  } catch (err) {
    appendTraceLocked(runId, { name: 'search', stage: 'references', model: searchProvider(flags.provider), inputs: { query, ...opts }, outputs: { error: err.message }, duration_ms: Date.now() - t0, extra: { fallback: 'use the agent\'s built-in web search' } });
    throw new Error(`${err.message} (fall back to the agent's built-in web search)`);
  }
}
