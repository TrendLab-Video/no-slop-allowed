// Shared helper for every Recliner page: run files, header, workflow diagram, polling.
// Plain ES module, no dependencies, nothing remote.

export const params = new URLSearchParams(location.search);
export const runId = params.get('run');

export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const $ = (sel, root = document) => root.querySelector(sel);

// URL of a file in the run folder (paths inside run files are relative to it).
export const fileUrl = (p, id = runId) => (p && /^https?:\/\//.test(p) ? p : p ?`/runs/${encodeURIComponent(id)}/${String(p).split('/').map(encodeURIComponent).join('/')}` : '');

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
// Reference proof metrics, skipping nulls (research often only finds views).
export function metrics(m = {}, keys = ['views', 'likes', 'comments', 'shares'], bold = true) {
  return keys.filter((k) => m?.[k] != null && m[k] !== '').map((k) => `<span>${bold ? `<b>${fmtNum(m[k])}</b>` : fmtNum(m[k])} ${k}</span>`).join('');
}
export const arClass =(ar) => `ar-${String(ar || '9:16').replace(':', '-')}`;

export function scoreBar(score, max = 100, pass) {
  const pct = Math.max(0, Math.min(100, (Number(score) / max) * 100)) || 0;
  const cls = pass === true ? 'ok' : pass === false ? 'bad' : '';
  return `<div class="bar ${cls}"><i style="width:${pct}%"></i></div>`;
}

export function video(src, { ar = '9:16', poster = '', controls = true, autoplay = false, badge = '', badge2 = '' } = {}) {
  if (!src) return `<div class="media ${arClass(ar)}"><div class="empty" style="height:100%;display:grid;place-items:center;border:0;color:var(--muted)">No video yet</div></div>`;
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
    <a class="brand" href="/${q}" title="Recliner">
      <span class="wm">36 Labs</span><span class="x">×</span>
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.2" fill="none" stroke="currentColor" stroke-width="2.4"/></svg><span class="wm" style="margin-left:-4px">fal</span>
      <span class="prod">No Slop Allowed</span><span class="prod2">· Recliner</span>
    </a>
    <nav class="nav">
      <a href="/" class="${active === 'runs' ? 'on' : ''}">Runs</a>
      <a href="/${q}" class="${active === 'brief' ? 'on' : ''} ${off}">Brief</a>
      <a href="/steps.html${q}" class="${active === 'steps' ? 'on' : ''} ${off}">Steps</a>
      <a href="/result.html${q}" class="${active === 'result' ? 'on' : ''} ${off}">Result</a>
    </nav>
    <div class="top-right"><span class="bal" id="bal" title="fal account balance and the minimum a run should start with"></span><span class="rid">${runId ? esc(runId) : 'local'}</span></div>
  </div>`;
  document.body.prepend(el);
  balance();
  setInterval(balance, 60000);
}

// fal balance and floor in the header, from /api/preflight (cached server side). Never shows the key.
export async function balance() {
  const el = document.getElementById('bal');
  if (!el) return;
  try {
    const r = await api('/api/preflight');
    const usd = (n) => `$${Number(n).toFixed(2)}`;
    // Floor comes from lib/fal.mjs (RECLINER_MIN_BALANCE) via the preflight result; 0 means off.
    const floor = r.floor == null ? '' : `<span>· floor ${r.floor ? usd(r.floor) : 'off'}</span>`;
    if (r.balance != null) {
      el.className = `bal ${r.low || r.status === 'rejected' ? 'low' : 'okb'}`;
      el.innerHTML = `<i></i>fal ${usd(r.balance)} ${floor}`;
    } else {
      el.className = `bal ${['missing', 'rejected', 'low'].includes(r.status) ? 'low' : ''}`;
      el.innerHTML = `<i></i>fal ${esc({ missing: 'no key', rejected: 'rejected', present: 'key set', accepted: 'ok', low: 'low' }[r.status] || r.status)} ${floor}`;
    }
    el.title = r.reason || '';
  } catch { el.textContent = ''; }
}

// Live workflow diagram: 9 stages, horizontal. Call render(state) on every poll.
export function flow(container) {
  container.innerHTML = `<div class="flow-wrap">
    <div class="flow-head"><span class="ttl">Workflow</span><span class="pulse idle"></span><span class="status"></span><span class="right"><span class="total"></span><span class="polled"></span></span></div>
    <div class="flow"></div>
    <div class="flow-note" hidden><span class="tag"></span><span class="txt"></span></div>
  </div>`;
  const $f = (s) => container.querySelector(s);
  let last = null;
  const draw = () => {
    const state = last;
    if (!state) { $f('.flow').innerHTML = '<div class="small" style="grid-column:1/-1;color:var(--muted)">Waiting for state.json…</div>'; return; }
    const live = state.status === 'running' || state.status === 'awaiting_brief';
    $f('.pulse').className = `pulse ${state.status === 'running' ? '' : 'idle'}`;
    $f('.status').innerHTML = statusTag(state.status);
    const end = live ? null : state.updatedAt;
    $f('.total').textContent = `Elapsed ${fmtMs(elapsed(state.createdAt, end))}`;
    $f('.flow').innerHTML = state.stages.map((s, i) => {
      const t = s.startedAt ? fmtMs(elapsed(s.startedAt, s.finishedAt || (live ? null : state.updatedAt))) : '';
      const icon = { done: '✓', failed: '✕', retrying: '↻', skipped: '–' }[s.status] || '';
      const note = s.note || (s.status === 'running' ? 'Working…' : s.status === 'retrying' ? 'Retrying…' : s.status === 'pending' ? 'Waiting' : '');
      return `<div class="st ${esc(s.status)}" title="${esc(`${s.label}: ${s.status}${s.note ? ` · ${s.note}` : ''}`)}">
        <div class="top-row"><span>${String(i + 1).padStart(2, '0')}</span><span class="t">${esc(t)}</span><span class="ic">${icon}</span></div>
        <div class="nm">${esc(s.label)}</div><div class="note">${esc(note)}</div></div>`;
    }).join('');
    const cur = state.stages.find((s) => s.id === state.currentStage);
    const note = $f('.flow-note');
    if (cur && (cur.status === 'running' || cur.status === 'retrying' || cur.status === 'failed')) {
      note.hidden = false;
      note.querySelector('.tag').className = `tag ${{ running: 'run', retrying: 'retry', failed: 'bad' }[cur.status]}`;
      note.querySelector('.tag').textContent = `${cur.label} · ${cur.status}`;
      note.querySelector('.txt').textContent = cur.note || (cur.id === 'brief' ? 'Waiting for the brief to be submitted.' : 'Working…');
    } else if (state.status === 'done') {
      note.hidden = false;
      note.querySelector('.tag').className = 'tag ok';
      note.querySelector('.tag').textContent = 'Complete';
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

// Keyframe validations: clips/<sceneId>/<attempt>.keyframe.validation.json beside attempt.keyframe.
// Found files are cached; missing ones are retried on the next poll. Sets attempt.keyframeValidation.
const kfCache = {};
export const kfValidationPath = (kf) => String(kf).replace(/\.(jpe?g|png|webp)$/i, '') + '.validation.json';
// attempt.keyframe is either a path or an object { file, url, prompt, model, validation, reference }.
// Normalises it to a path (or fal URL) in attempt.keyframe, keeps the object in attempt.keyframeInfo, and
// takes the validation from the object when embedded, else from the .validation.json beside the file.
const normVal = (v) => (v ? { score: v.score ?? v.validation?.score, passed: v.passed ?? v.validation?.passed, reason: v.reason ?? v.validation?.reason, steering: v.steering ?? v.validation?.steering } : null);

// ---------- Validator verdicts: always labelled, never mistaken for the plan ----------
const BD_LABELS = { hook: 'Hook', briefFit: 'Brief fit', craft: 'Craft', originality: 'Originality', slop: 'No slop' };
const asList = (x) => (Array.isArray(x) ? x : x ? [x] : []).map((i) => (typeof i === 'string' ? i : i?.text || i?.repair || i?.description || JSON.stringify(i)));

// "VALIDATOR VERDICT 43 · BELOW PASS SCORE 60" (label can be changed, e.g. KEYFRAME VALIDATOR).
export function verdictHead(v, passScore, label = 'Validator verdict') {
  if (!v || v.score == null) return `<div class="verdict"><span class="vlabel">${esc(label)}</span><span class="tag">not validated yet</span></div>`;
  return `<div class="verdict"><span class="vlabel">${esc(label)}</span><span class="vscore ${v.passed === false ? 'fail' : ''}">${esc(v.score)}</span>
    <span class="tag ${v.passed === false ? 'bad' : v.passed ? 'ok' : ''}">${v.passed === false ? `below pass score${passScore != null ? ` ${esc(passScore)}` : ''}` : v.passed ? 'passed' : 'scored'}</span></div>`;
}

// Banner when the selected (best) result did not pass.
export function belowPassBanner(result, config) {
  const sel = result?.results?.find((r) => r.id === result.selectedId);
  const v = sel?.validation;
  if (!v || v.passed !== false) return '';
  const used = Math.max(0, (result.results?.length || 1) - 1);
  const allowed = config?.finalRetries;
  return `<div class="failbanner"><b>Best available result: did not pass validation</b>
    <span>score ${esc(v.score)}${config?.passScore != null ? `, pass ${esc(config.passScore)}` : ''}. Retries used ${used}${allowed != null ? ` of ${esc(allowed)}` : ''}.</span></div>`;
}

// INTENDED (the plan) beside WHAT THE VALIDATOR SAW (reason, breakdown, biggestProblem, repairs).
export function intendedVsSaw(plan, v, passScore) {
  const scenes = plan?.scenes || [];
  const problems = asList(v?.biggestProblem);
  const repairs = asList(v?.repairs);
  const bd = v?.breakdown || {};
  return `<div class="compare">
    <div class="cmp intended"><div class="vlabel">Intended · the plan</div>
      ${plan ? `<h3>${esc(plan.title || '')}</h3>${plan.creativeGuidance ? `<p>${esc(plan.creativeGuidance)}</p>` : plan.description ? `<p>${esc(plan.description)}</p>` : ''}
      <ol class="scenes">${scenes.map((s) => `<li><span>${esc(s.description || '')}${s.onScreenText ? ` <span class="muted mono small">“${esc(s.onScreenText)}”</span>` : ''}</span><span class="d">${esc(s.durationSeconds ?? '')}s</span></li>`).join('')}</ol>`
        : '<p class="muted">No plan.</p>'}
    </div>
    <div class="cmp saw"><div class="vlabel">What the validator saw</div>
      ${verdictHead(v, passScore)}
      ${v?.reason ? `<blockquote>${esc(v.reason)}</blockquote>` : ''}
      ${Object.keys(bd).length ? `<div class="breakdown">${Object.entries(bd).map(([k, n]) => `<div class="score"><span>${esc(BD_LABELS[k] || k)}</span>${scoreBar(n, 100, passScore != null ? Number(n) >= passScore : undefined)}<span>${esc(n)}</span></div>`).join('')}</div>` : ''}
      ${problems.length ? `<div class="vsub">Biggest problem</div><ul>${problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
      ${repairs.length ? `<div class="vsub">Repairs</div><ul>${repairs.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
    </div>
  </div>`;
}

// Music for a composition: result.audio { present, bed, lufs, truePeak, audible } + plan.audio.musicPrompt.
export function musicBlock(r, plan) {
  const a = r?.audio; const prompt = plan?.audio?.musicPrompt;
  if (!a && !prompt) return '';
  const stats = a ? [a.present === false ? 'no audio' : 'music', a.lufs != null ? `${a.lufs} LUFS` : '', a.truePeak != null ? `peak ${a.truePeak} dBTP` : '', a.audible === false ? 'inaudible' : ''].filter(Boolean).join(' · ') : '';
  return `<div class="musicblk"><div class="mh"><span class="tag ${a?.present === false || a?.audible === false ? 'bad' : 'info'}">♪ ${esc(stats || 'music planned')}</span></div>
    ${prompt ? `<p class="small muted">${esc(prompt)}</p>` : ''}
    ${a?.bed ? `<audio controls preload="none" src="${esc(fileUrl(a.bed))}"></audio>` : ''}</div>`;
}
export async function withKeyframeValidations(clips) {
  const atts = (clips?.scenes || []).flatMap((sc) => sc.attempts || []).filter((a) => a.keyframe);
  await Promise.all(atts.map(async (a) => {
    if (typeof a.keyframe === 'object') {
      a.keyframeInfo = a.keyframe;
      a.keyframe = a.keyframe.file || a.keyframe.url || null;
      if (a.keyframeInfo.validation) { a.keyframeValidation = normVal(a.keyframeInfo.validation); return; }
    }
    if (!a.keyframe || /^https?:/.test(a.keyframe)) return;
    const p = kfValidationPath(a.keyframe);
    if (!kfCache[p]) { const v = await getJson(p); if (v) kfCache[p] = v; }
    if (kfCache[p]) a.keyframeValidation = normVal(kfCache[p]);
  }));
  return clips;
}

// plan.endCard: { text, seconds } or { headline, subline, durationSeconds } or a string.
export function endCardOf(plan) {
  const e = plan?.endCard;
  if (!e) return null;
  if (typeof e === 'string') return { headline: e, subline: '', seconds: null };
  const headline = e.headline || e.text || '';
  if (!headline && !e.subline) return null;
  return { headline, subline: e.subline || '', seconds: e.durationSeconds ?? e.seconds ?? null };
}

// plan.productImages: real product photos used as generation references. Paths or objects.
export function productImagesOf(plan) {
  return (plan?.productImages || []).map((x) => (typeof x === 'string' ? { src: x } : { src: x.file || x.path || x.image || x.url, label: x.title || x.label || x.name || '' })).filter((x) => x.src);
}
export const kfBadge = (v) => (v && v.score != null ? `<span class="tag ${v.passed === false ? 'bad' : 'ok'}" title="${esc(v.reason || '')}">key ${esc(v.score)}</span>` : '');

// ---------- Media stage: the best visual available so far, upgraded in place ----------
// Modes, in order of preference: final/composed video > scene clips (storyboard that clips replace)
// > goals being scored > reference mosaic > brief keywords. References are always badged REFERENCE
// with a dashed, desaturated frame; our own output is badged GENERATED.

const arCls = (ar) => ({ '16:9': 'r16-9', '1:1': 'r1-1' })[ar] || 'r9-16';

// Keyed patch: keep children whose html is unchanged (videos keep playing), replace the rest.
export function patch(container, items) {
  const existing = new Map([...container.children].map((el) => [el.dataset.key, el]));
  let prev = null;
  for (const { key, html } of items) {
    let el = existing.get(key);
    if (!el || el.dataset.h !== html) {
      const tpl = document.createElement('template');
      tpl.innerHTML = html.trim();
      const fresh = tpl.content.firstElementChild;
      fresh.dataset.key = key;
      fresh.dataset.h = html;
      if (el) el.replaceWith(fresh);
      el = fresh;
    }
    existing.delete(key);
    const want = prev ? prev.nextElementSibling : container.firstElementChild;
    if (want !== el) container.insertBefore(el, want);
    prev = el;
  }
  for (const el of existing.values()) el.remove();
}

const KW_STOP = new Set('about after again against their there these those which while would could should being through product brand video known along every other where into from with that this your make made more most also than them they will just over what when only even very much such into across bringing together without straight people within using every based'.split(' '));
function keywords(b) {
  const text = `${b.objective || ''} ${b.raw || ''} ${b.notes || ''}`.toLowerCase();
  const counts = {};
  for (const w of text.match(/[a-z][a-z-]{4,}/g) || []) if (!KW_STOP.has(w)) counts[w] = (counts[w] || 0) + 1;
  return Object.entries(counts).sort((a, z) => z[1] - a[1]).slice(0, 10).map(([w]) => w);
}


function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function researchEvents(traces) {
  const out = [];
  for (const s of traces?.steps || []) {
    if (s.stage !== 'references') continue;
    if (s.name === 'search') {
      const n = s.outputs?.urls?.length ?? s.outputs?.results?.length ?? null;
      out.push({
        key: `search-${out.length}`,
        kind: 'query',
        title: s.inputs?.query || 'reference search',
        meta: `${s.model || 'search'}${n != null ? ` · ${n} candidates` : ''}`,
        state: s.outputs?.error ? 'failed' : n != null ? 'done' : 'running',
      });
    } else if (s.name === 'fetch-ref') {
      const frames = s.outputs?.frames?.length || 0;
      const files = s.outputs?.files?.length || 0;
      const views = s.outputs?.metrics?.views;
      out.push({
        key: `fetch-${s.inputs?.referenceId || out.length}`,
        kind: s.inputs?.kind === 'brand' ? 'brand truth' : 'extract',
        title: s.inputs?.referenceId || hostOf(s.inputs?.url) || 'reference fetch',
        meta: `${hostOf(s.inputs?.url) || 'source'}${s.outputs?.mode ? ` · ${s.outputs.mode}` : ''}${frames ? ` · ${frames} frames` : files ? ` · ${files} images` : ''}${views ? ` · ${fmtNum(views)} views` : ''}`,
        state: s.outputs?.ok ? 'done' : 'failed',
      });
    }
  }
  return out.slice(-6);
}

// All images for a reference: screenshots plus frame strips (references/<id>/frame-N.jpg), any of png/jpg/webp/svg.
export const refImages = (r) => [...new Set([...(r?.screenshots || []), ...(r?.frames || [])].filter(Boolean))];
export const isBrand = (r) => r?.kind === 'brand';
export const refBadge = (r) => (isBrand(r) ? '<span class="tag brandb">Brand</span>' : '<span class="tag refb">Reference</span>');

function refTile(r, i) {
  const m = r.metrics || {};
  const proof = metrics(m, ['views', 'likes'], false) || (isBrand(r) ? '' : '<span>metrics unavailable</span>');
  const imgs = refImages(r);
  const head = `<div class="tl">${refBadge(r)}${r.platform ? `<span class="tag">${esc(r.platform)}</span>` : ''}</div>`;
  if (imgs.length) return `<div class="mt ref ${isBrand(r) ? 'isbrand' : ''}" style="animation-delay:${i * 60}ms"><img src="${esc(fileUrl(imgs[0]))}" alt="" loading="lazy">${head}
    <div class="cap"><b>${esc(r.title || '')}</b><span class="proof">${proof}</span>
      ${imgs.length > 1 ? `<div class="fstrip">${imgs.slice(1, 6).map((f) => `<img src="${esc(fileUrl(f))}" alt="" loading="lazy">`).join('')}${imgs.length > 6 ? `<span>+${imgs.length - 6}</span>` : ''}</div>` : ''}</div></div>`;
  const s = r.structure || {};
  return `<div class="mt ref card-ref ${isBrand(r) ? 'isbrand' : ''}" style="animation-delay:${i * 60}ms">${head}
    <div class="refbody"><div class="rt">${esc(r.title || 'Untitled reference')}</div>
      <div class="proof big">${proof}${m.shares ? `<span>${fmtNum(m.shares)} shares</span>` : ''}</div>
      ${s.hook ? `<div class="rk"><b>Hook</b>${esc(s.hook)}</div>` : ''}${s.pacing ? `<div class="rk"><b>Pacing</b>${esc(s.pacing)}</div>` : ''}
      ${s.durationSeconds ? `<div class="rk"><b>Length</b>${esc(s.durationSeconds)}s</div>` : ''}</div></div>`;
}

function sceneTile(scene, i, clipScene, ar, total) {
  const atts = clipScene?.attempts || [];
  const gen = atts.filter((a) => a.status === 'generated' && a.file);
  const shown = gen.find((a) => a.attempt === clipScene?.acceptedAttempt) || gen[gen.length - 1];
  const latest = atts[atts.length - 1];
  const retrying = shown && latest && latest !== shown && latest.status === 'generating';
  const label = `Scene ${String(i + 1).padStart(2, '0')}${scene?.durationSeconds ? ` · ${scene.durationSeconds}s` : ''}`;
  let inner, cls = '', badges = '';
  if (shown) {
    const v = shown.validation;
    const acc = clipScene.acceptedAttempt === shown.attempt;
    cls = acc ? 'acc' : v && !v.passed ? 'rej' : '';
    badges = `<div class="tl"><span class="tag genb">Generated</span>${v ? `<span class="tag ${acc ? 'ok' : v.passed ? 'ok' : 'bad'}">${esc(v.score)} · ${acc ? 'accepted' : v.passed ? 'passed' : 'rejected'}</span>` : '<span class="tag">validating</span>'}${retrying ? '<span class="tag retry">↻ retrying</span>' : atts.length > 1 ? `<span class="tag">try ${esc(shown.attempt)}</span>` : ''}</div>`;
    inner = `<video src="${esc(fileUrl(shown.file))}" autoplay muted loop playsinline preload="auto"></video>`;
  } else if (atts.some((a) => a.keyframe)) {
    const k = [...atts].reverse().find((a) => a.keyframe);
    const failed = latest?.status === 'failed';
    const kfRejected = k.keyframeValidation?.passed === false;
    const state = failed ? ['bad', 'clip failed'] : kfRejected && k === latest ? ['retry', 'keyframe rejected'] : kfRejected ? ['retry', '↻ new keyframe'] : ['run', 'animating'];
    cls = 'kf';
    inner = `<img src="${esc(fileUrl(k.keyframe))}" alt="">`;
    badges = `<div class="tl"><span class="tag kfb">Keyframe</span>${kfBadge(k.keyframeValidation)}<span class="tag ${state[0]}">${state[1]}</span></div>`;
  } else {
    const failed = latest?.status === 'failed';
    const state = !clipScene ? 'Planned' : failed ? 'Failed' : 'Generating';
    inner = `<div class="ph ${!clipScene ? 'dim' : failed ? 'fail' : ''}" style="animation-delay:-${i * 0.7}s"></div>
      <div class="sb-text">${scene?.onScreenText ? `<div class="ost-big">${esc(scene.onScreenText)}</div>` : ''}
        <div class="prompt">${esc((scene?.prompt || scene?.description || '').slice(0, 140))}${(scene?.prompt || '').length > 140 ? '…' : ''}</div></div>`;
    badges = `<div class="tl"><span class="tag ${state === 'Generating' ? 'run' : state === 'Failed' ? 'bad' : ''}">${state}</span></div>${failed && latest.error ? `<div class="tr"><span class="tag bad" title="${esc(latest.error)}">error</span></div>` : ''}`;
  }
  return `<div class="tile ${arCls(ar)} ${cls}" style="--n:${total}">${inner}${badges}
    <div class="cap"><b>${esc(label)}</b>${esc(scene?.description || '')}</div></div>`;
}

export function mediaStage(container) {
  container.innerHTML = `<section class="stage"><div class="stage-info"></div><div class="stage-media"></div></section>`;
  const info = container.querySelector('.stage-info');
  const media = container.querySelector('.stage-media');
  let mode = null;
  const setMode = (m, shell) => { if (mode !== m) { mode = m; media.dataset.mode = m; media.innerHTML = shell; } };

  return {
    render(d) {
      const b = d['brief.json'] || {}, state = d.state || {}, refs = d['references.json'], goals = d['goals.json'], scores = d['scores.json'], plan = d['plan.json'], clips = d['clips.json'], result = d['result.json'];
      const ar = plan?.aspectRatio || b.aspectRatio || '9:16';
      const cur = state.stages?.find((s) => s.id === state.currentStage);
      const q = `?run=${encodeURIComponent(runId)}`;
      const links = `<div class="links"><a class="btn ghost" href="/steps.html${q}">Steps <span class="arrow">→</span></a><a class="btn" href="/result.html${q}">Result <span class="arrow">→</span></a></div>`;
      const pill = (t) => `<span class="pillb">${state.status === 'running' ? '<span class="pulse"></span>' : ''}${esc(t)}</span>`;
      const curNote = cur && cur.status !== 'done' ? `<div class="sub">${esc(cur.label)} · ${esc(cur.status)}${cur.note ? ` — ${esc(cur.note)}` : ''}</div>` : '';
      const results = result?.results || [];

      if (results.length) {
        const sel = results.find((r) => r.id === result.selectedId) || [...results].sort((a, z) => (z.validation?.score ?? -1) - (a.validation?.score ?? -1))[0];
        const final = state.status === 'done' || !!result.selectedId && ['done'].includes(state.stages?.find((s) => s.id === 'final_validation')?.status);
        const v = sel.validation || {};
        info.innerHTML = `${pill(final ? 'Final video' : 'Composed video')}<h1>${esc(b.promote || 'Untitled')}</h1>
          ${v.score != null ? `${verdictHead(v, d['config.json']?.passScore)}<div class="bignum ${v.passed === false ? 'fail' : ''}">${esc(v.score)}<small>/100</small></div>
            ${v.passed === false && final ? `<div class="sub warnline">Best available result: did not pass. Retries used ${Math.max(0, results.length - 1)}${d['config.json']?.finalRetries != null ? ` of ${esc(d['config.json'].finalRetries)}` : ''}.</div>` : ''}
            ${v.reason ? `<p class="vquote"><span class="vlabel">Validator saw</span>${esc(v.reason.length > 220 ? v.reason.slice(0, 220) + '…' : v.reason)}</p>` : ''}` : '<div class="sub">Validating…</div>'}
          <div class="sub">${results.length} composition${results.length === 1 ? '' : 's'} · ${esc(sel.compositor || '')} · ${esc(sel.durationSeconds ?? '')}s</div>${curNote}${links}`;
        setMode('final', '<div class="tiles"></div>');
        patch(media.firstElementChild, [{ key: sel.id, html: `<div class="tile hero-tile ${arCls(ar)}" style="--n:1"><video src="${esc(fileUrl(sel.file))}" ${sel.thumbnail ? `poster="${esc(fileUrl(sel.thumbnail))}"` : ''} autoplay muted loop playsinline controls preload="auto"></video>
          <div class="tl"><span class="tag genb">Generated</span>${final ? '<span class="tag ok">selected</span>' : ''}</div></div>` }]);
        return;
      }

      if (plan || clips) {
        const scenes = plan?.scenes || (clips?.scenes || []).map((s) => ({ id: s.sceneId }));
        const byId = Object.fromEntries((clips?.scenes || []).map((s) => [s.sceneId, s]));
        const ready = (clips?.scenes || []).filter((s) => s.attempts.some((a) => a.status === 'generated')).length;
        const end = endCardOf(plan);
        const prods = productImagesOf(plan);
        const total = Math.round((scenes.reduce((n, s) => n + (Number(s.durationSeconds) || 0), 0) + (Number(end?.seconds) || 0)) * 10) / 10;
        const music = plan?.audio?.musicPrompt;
        info.innerHTML = `${pill(clips ? `Clips · ${ready}/${scenes.length} ready` : 'Storyboard')}<h1>${esc(plan?.title || b.promote || '')}</h1>
          <p>${esc(plan?.description || '')}</p>
          <div class="sub">${scenes.length} scenes · ${total}s · ${esc(ar)}${plan?.confidence != null ? ` · ${Math.round(plan.confidence * 100)}% brief fit` : ''}</div>
          ${music ? `<div class="sub music" title="${esc(music)}">♪ ${esc(music.slice(0, 90))}${music.length > 90 ? '…' : ''}</div>` : ''}${curNote}${links}`;
        setMode('board', '<div class="board"><div class="boardrow"><div class="prodcol"></div><div class="tiles"></div></div><div class="timeline"></div></div>');
        // Product references (real photos used to steer generation) beside the keyframes, for comparison.
        const pc = media.querySelector('.prodcol');
        pc.hidden = !prods.length;
        patch(pc, prods.slice(0, 3).map((p, i) => ({ key: p.src, html: `<div class="prodtile"><img src="${esc(fileUrl(p.src))}" alt=""><span class="tag prodb">Product reference</span>${p.label ? `<span class="pl">${esc(p.label)}</span>` : ''}</div>` })));
        const n = scenes.length + (end ? 1 : 0);
        const tiles = scenes.map((s, i) => ({ key: s.id, html: sceneTile(s, i, byId[s.id], ar, n) }));
        if (end) tiles.push({ key: '__end', html: `<div class="tile endcard ${arCls(ar)}" style="--n:${n}"><div class="ec"><div><div class="ec-t">${esc(end.headline)}</div>${end.subline ? `<div class="ec-s">${esc(end.subline)}</div>` : ''}</div></div>
          <div class="tl"><span class="tag">End card</span></div><div class="cap"><b>End card${end.seconds ? ` · ${esc(end.seconds)}s` : ''}</b>Added at composition</div></div>` });
        patch(media.querySelector('.tiles'), tiles);
        const segs = scenes.map((s, i) => {
          const cs = byId[s.id]; const done = cs?.attempts?.some((a) => a.status === 'generated'); const kf = cs?.attempts?.some((a) => a.keyframe);
          return { key: s.id, html: `<div class="seg-t ${done ? 'done' : kf ? 'kf' : cs ? 'gen' : ''}" style="flex-grow:${Number(s.durationSeconds) || 1}"><span>${String(i + 1).padStart(2, '0')}</span><span>${esc(s.durationSeconds ?? '')}s</span></div>` };
        });
        if (end) segs.push({ key: '__end', html: `<div class="seg-t end" style="flex-grow:${Number(end.seconds) || 1.5}"><span>end</span><span>${esc(end.seconds ?? '')}${end.seconds ? 's' : ''}</span></div>` });
        patch(media.querySelector('.timeline'), segs);
        return;
      }

      if (goals?.goals?.length) {
        const conf = (id) => scores?.scores?.find((s) => s.goalId === id);
        const scored = scores?.scores?.length || 0;
        info.innerHTML = `${pill(scores?.selectedGoalId ? 'Goal selected' : scored ? `Scoring · ${scored}/${goals.goals.length}` : 'Goals written')}<h1>${esc(b.promote || '')}</h1>
          <p>${scores?.selectedGoalId ? `Winner: ${esc(goals.goals.find((g) => g.id === scores.selectedGoalId)?.title || '')}` : `${goals.goals.length} distinct creative directions, scored against the brief${scores?.scorer ? ` by ${esc(scores.scorer)}` : ''}.`}</p>${curNote}${links}`;
        setMode('goals', `<div class="goalgrid"></div>`);
        const g = media.firstElementChild;
        g.style.setProperty('--cols', goals.goals.length > 4 ? 3 : Math.min(goals.goals.length, 2));
        patch(g, goals.goals.map((goal, i) => {
          const s = conf(goal.id); const win = scores?.selectedGoalId === goal.id; const lose = scores?.selectedGoalId && !win;
          return { key: goal.id, html: `<div class="gcard ${win ? 'win' : ''} ${lose ? 'lose' : ''}" style="animation-delay:${i * 80}ms">
            <div class="gtop"><span class="mono">${esc(goal.id)}</span><span class="mono">${esc(goal.durationSeconds ?? '')}s · ${esc(goal.scenes?.length ?? 0)} scenes</span>${win ? '<span class="tag ok">winner</span>' : ''}</div>
            <div class="gt">${esc(goal.title)}</div><div class="gd">${esc(goal.description || '')}</div>
            <div class="gconf"><div class="bar"><i style="--w:${s ? Math.round(s.confidence * 100) : 0}%"></i></div><span class="mono">${s ? `${Math.round(s.confidence * 100)}%` : 'scoring…'}</span></div></div>` };
        }));
        return;
      }

      if (refs?.references?.length) {
        // One big tile per reference (brand last), its extra frames as a strip inside the tile.
        const items = [...refs.references].sort((a, z) => isBrand(a) - isBrand(z)).slice(0, 8);
        const nBrand = refs.references.filter(isBrand).length;
        info.innerHTML = `${pill(`References · ${refs.references.length - nBrand}${nBrand ? ` + brand` : ''}`)}<h1>${esc(b.promote || '')}</h1>
          <p>Proven, current examples for ${esc(b.platform || 'the platform')}. These are other people's videos, used only to learn what works${nBrand ? '; the brand card is the client’s own look' : ''}.</p>
          ${refs.takeaways?.length ? `<div class="sub">${refs.takeaways.slice(0, 3).map((t) => `· ${esc(t)}`).join('<br>')}</div>` : ''}${curNote}${links}`;
        setMode('refs', '<div class="mosaic"></div>');
        const m = media.firstElementChild;
        const n = items.length;
        m.style.setProperty('--cols', n <= 4 ? n : n <= 6 ? 3 : 4);
        m.style.setProperty('--rows', n <= 4 ? 1 : 2);
        patch(m, items.map((r, i) => ({ key: r.id, html: refTile(r, i) })));
        return;
      }

      if (cur?.id === 'references') {
        const events = researchEvents(d['traces.json']);
        const fetches = events.filter((e) => e.kind !== 'query');
        const frames = (d['traces.json']?.steps || []).reduce((n, s) => n + (s.stage === 'references' ? (s.outputs?.frames?.length || 0) : 0), 0);
        const candidates = (d['traces.json']?.steps || []).reduce((n, s) => n + (s.stage === 'references' && s.name === 'search' ? (s.outputs?.urls?.length || 0) : 0), 0);
        info.innerHTML = `${pill('References · evidence scan')}<h1>${esc(b.promote || '')}</h1>
          <p>Searching proven, current examples for ${esc(b.platform || 'the platform')}, then extracting frames, metrics and brand truth before any creative goal is written.</p>
          <div class="sub">${events.length ? `${events.length} research events` : 'research agents preparing'}${candidates ? ` · ${candidates} candidates` : ''}${frames ? ` · ${frames} frames extracted` : ''}${fetches.length ? ` · ${fetches.length} fetches` : ''}</div>${curNote}${links}`;
        setMode('research', `<div class="researchviz">
          <video class="researchloop" src="/assets/reference-radar.mp4" autoplay muted loop playsinline preload="auto"></video>
          <div class="researchshade"></div>
          <div class="research-contract"><div class="rcap">Input contract</div>
            ${[['Platform', b.platform], ['Format', b.videoType], ['Domain', b.domain], ['Frame', ar]].filter(([, v]) => v).map(([k, v]) => `<div class="rline"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}
          </div>
          <div class="research-ops"><div class="rcap">Research operations</div><div class="rops"></div></div>
        </div>`);
        const fallbackOps = [
          { key: 'prepare', kind: 'query', title: 'forming platform-native searches', meta: 'waiting for research events', state: 'running' },
          { key: 'extract', kind: 'extract', title: 'candidate posts and frame capture', meta: 'yt-dlp / page images when available', state: 'pending' },
          { key: 'brand', kind: 'brand truth', title: 'product image verification', meta: 'hero images become generation ground truth', state: 'pending' },
        ];
        const ops = events.length ? events : fallbackOps;
        patch(media.querySelector('.rops'), ops.map((e, i) => ({ key: e.key, html: `<div class="rop ${esc(e.state)}" style="animation-delay:${i * 90}ms"><span class="ropk">${esc(e.kind)}</span><div><b>${esc(e.title)}</b><span>${esc(e.meta)}</span></div><i></i></div>` })));
        return;
      }

      // Brief: keywords, platform and the chosen frame, while research starts.
      const kws = keywords(b);
      info.innerHTML = `${pill(cur ? `${cur.label} · ${cur.status}` : 'Brief')}<h1>${esc(b.promote || 'Untitled brief')}</h1><p>${esc((b.objective || '').slice(0, 220))}</p>${curNote}${links}`;
      setMode('brief', '<div class="briefviz"><div class="tiles"></div><div class="kw"></div></div>');
      patch(media.querySelector('.tiles'), [{ key: 'frame', html: `<div class="tile frame ${arCls(ar)}" style="--n:1"><div class="ph"></div>
        <div class="sb-text"><div class="ost-big">${esc(b.promote || '')}</div><div class="prompt">${esc(b.platform || '')} · ${esc(ar)}${b.videoType ? ` · ${esc(b.videoType)}` : ''}</div></div>
        <div class="tl"><span class="tag">frame ${esc(ar)}</span></div></div>` }]);
      patch(media.querySelector('.kw'), [b.platform, b.videoType, b.domain, ...kws].filter(Boolean).map((k, i) => ({ key: k, html: `<span class="kwp" style="animation-delay:${i * 90}ms">${esc(k)}</span>` })));
    },
  };
}
