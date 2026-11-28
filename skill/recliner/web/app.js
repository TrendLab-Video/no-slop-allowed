// Shared helper for every Recliner page: run files, header, workflow diagram, polling.
// Plain ES module, no dependencies, nothing remote.

export const params = new URLSearchParams(location.search);
export const runId = params.get('run');

export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const $ = (sel, root = document) => root.querySelector(sel);

// URL of a file in the run folder (paths inside run files are relative to it).
export const fileUrl = (p, id = runId) => (p ? `/runs/${encodeURIComponent(id)}/${String(p).split('/').map(encodeURIComponent).join('/')}` : '');

// Fetch one JSON run file; null when it does not exist yet.
export async function getJson(name, id = runId) {
  try {
    const res = await fetch(fileUrl(name, id), { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// Fetch several run files at once: { 'state.json': {...}|null, ... }
export async function getRun(names, id = runId) {
  const vals = await Promise.all(names.map((n) => getJson(n, id)));
  return Object.fromEntries(names.map((n, i) => [n, vals[i]]));
}

export async function api(path, body) {
  const res = await fetch(path, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// Calls fn every `ms`, never overlapping. fn may return false to stop.
export function poll(fn, ms = 1000) {
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    let again = true;
    try { again = (await fn()) !== false; } catch (e) { console.warn(e); }
    if (again && !stopped) setTimeout(tick, ms);
  };
  tick();
  return () => { stopped = true; };
}

// Re-render only when the data actually changed (keeps videos playing between polls).
export function changed(key, data) {
  const s = JSON.stringify(data);
  changed.cache ??= {};
  if (changed.cache[key] === s) return false;
  changed.cache[key] = s;
  return true;
}

export function fmtMs(ms) {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}
export const elapsed = (from, to) => (from ? (to ? Date.parse(to) : Date.now()) - Date.parse(from) : null);
export const fmtNum = (n) => (n == null || n === '' ? '–' : Number(n) >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : Number(n) >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n));
export const arClass = (ar) => `ar-${String(ar || '9:16').replace(':', '-')}`;

export function scoreBar(score, max = 100, pass) {
  const pct = Math.max(0, Math.min(100, (Number(score) / max) * 100)) || 0;
  const cls = pass === true ? 'ok' : pass === false ? 'bad' : '';
  return `<div class="bar ${cls}"><i style="width:${pct}%"></i></div>`;
}

export function video(src, { ar = '9:16', poster = '', controls = true, autoplay = false, badge = '', badge2 = '' } = {}) {
  if (!src) return `<div class="media ${arClass(ar)}"><div class="empty" style="height:100%;display:grid;place-items:center;border:0;color:#93a097">No video yet</div></div>`;
  return `<div class="media ${arClass(ar)}">
    <video src="${esc(src)}#t=0.1" ${poster ? `poster="${esc(poster)}"` : ''} preload="metadata" playsinline ${controls ? 'controls' : ''} ${autoplay ? 'autoplay muted loop' : ''}></video>
    ${badge ? `<span class="badge">${badge}</span>` : ''}${badge2 ? `<span class="badge2">${badge2}</span>` : ''}
  </div>`;
}

const STATUS_TAG = { pending: '', running: 'run', retrying: 'retry', done: 'ok', failed: 'bad', skipped: '', awaiting_brief: 'info' };
export const statusTag = (s) => `<span class="tag ${STATUS_TAG[s] ?? ''}">${esc(String(s || 'unknown').replace('_', ' '))}</span>`;

// Header: "36 Labs x fal", product name, page nav (run-scoped).
export function header(active) {
  const q = runId ? `?run=${encodeURIComponent(runId)}` : '';
  const off = runId ? '' : 'off';
  const el = document.createElement('header');
  el.className = 'top';
  el.innerHTML = `<div class="top-in">
    <a class="brand" href="/${q}">
      <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><rect width="22" height="22" rx="2" fill="#0a0a0a"/><path d="M5 15.5 L11 5.5 L17 15.5" stroke="#adff00" stroke-width="2" fill="none"/><circle cx="11" cy="15.5" r="1.6" fill="#adff00"/></svg>
      <span>36 Labs</span><span class="x">x</span><span>fal</span><span class="prod">Recliner</span>
    </a>
    <nav class="nav">
      <a href="/" class="${active === 'runs' ? 'on' : ''}">Runs</a>
      <a href="/${q}" class="${active === 'brief' ? 'on' : ''} ${off}">Brief · Live</a>
      <a href="/steps.html${q}" class="${active === 'steps' ? 'on' : ''} ${off}">Steps</a>
      <a href="/result.html${q}" class="${active === 'result' ? 'on' : ''} ${off}">Result</a>
    </nav>
  </div>`;
  document.body.prepend(el);
}

// Live workflow diagram: 9 stages, horizontal. Call render(state) on every poll.
export function flow(container) {
  container.innerHTML = `<div class="flow-wrap">
    <div class="flow-head"><span class="pulse idle"></span><span class="rid"></span><span class="status"></span><span class="right"><span class="total"></span><span class="polled"></span></span></div>
    <div class="flow"></div>
    <div class="flow-note" hidden><span class="eyebrow"></span><span class="txt"></span></div>
  </div>`;
  const $f = (s) => container.querySelector(s);
  let last = null;
  const draw = () => {
    const state = last;
    if (!state) { $f('.flow').innerHTML = '<div class="small" style="grid-column:1/-1;color:#93a097">Waiting for state.json…</div>'; return; }
    const live = state.status === 'running' || state.status === 'awaiting_brief';
    $f('.pulse').className = `pulse ${state.status === 'running' ? '' : 'idle'}`;
    $f('.rid').textContent = state.runId;
    $f('.status').innerHTML = statusTag(state.status);
    const end = live ? null : state.updatedAt;
    $f('.total').textContent = `elapsed ${fmtMs(elapsed(state.createdAt, end))}`;
    $f('.flow').innerHTML = state.stages.map((s, i) => {
      const t = s.startedAt ? fmtMs(elapsed(s.startedAt, s.finishedAt || (live ? null : state.updatedAt))) : '';
      const meta = s.status === 'pending' ? '' : s.status === 'done' ? t : `${s.status}${t ? ` · ${t}` : ''}`;
      const icon = s.status === 'done' ? '✓' : s.status === 'failed' ? '!' : String(i).padStart(2, '0');
      return `<div class="st ${esc(s.status)}" title="${esc(`${s.label}: ${s.status}${s.note ? ` · ${s.note}` : ''}`)}">
        <div class="node">${icon}</div><div class="nm">${esc(s.label)}</div><div class="meta">${esc(meta)}</div><div class="note">${esc(s.note || '')}</div></div>`;
    }).join('');
    const cur = state.stages.find((s) => s.id === state.currentStage);
    const note = $f('.flow-note');
    if (cur && (cur.status === 'running' || cur.status === 'retrying' || cur.status === 'failed')) {
      note.hidden = false;
      note.querySelector('.eyebrow').textContent = `${cur.label} · ${cur.status}`;
      note.querySelector('.txt').textContent = cur.note || (cur.id === 'brief' ? 'Waiting for the brief to be submitted.' : 'Working…');
    } else if (state.status === 'done') {
      note.hidden = false;
      note.querySelector('.eyebrow').textContent = 'Complete';
      note.querySelector('.txt').textContent = 'The run finished. See the Result page.';
    } else note.hidden = true;
  };
  setInterval(() => { if (last && last.status === 'running') draw(); }, 1000); // tick elapsed timers
  return {
    render(state) { last = state; draw(); $f('.polled').textContent = `polled ${new Date().toLocaleTimeString()}`; },
  };
}

export function needRun() {
  if (runId) return false;
  const m = document.querySelector('main');
  m.innerHTML = `<div class="empty">No run selected. <a href="/">Pick a run</a> or start one with <code>recliner new-run</code>.</div>`;
  return true;
}
