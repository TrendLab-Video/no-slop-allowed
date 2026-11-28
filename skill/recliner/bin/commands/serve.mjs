import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runsDir, runDir, readJson, createRun, newRunId } from '../../lib/store.mjs';
import { PRESETS, VIDEO_MODEL_OPTIONS, submitBrief, writeKeys } from '../../lib/effort.mjs';
import { loadEnv } from '../../lib/env.mjs';

export const describe = 'serve [--port 4600]: serve the Brief, Steps and Result pages and the API on 127.0.0.1';

const WEB = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../web');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8' };
const RUN_ID = /^[A-Za-z0-9._-]+$/;

function send(res, code, body, headers = {}) {
  const json = typeof body !== 'string' && !Buffer.isBuffer(body);
  res.writeHead(code, { 'Content-Type': json ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(json ? JSON.stringify(body) : body);
}

// Static file with Range support (Safari will not play video without 206 responses).
function sendFile(req, res, file) {
  let stat;
  try { stat = fs.statSync(file); } catch { return send(res, 404, 'Not found'); }
  if (!stat.isFile()) return send(res, 404, 'Not found');
  const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const base = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', 'Last-Modified': stat.mtime.toUTCString() };
  const range = req.headers.range && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range.trim());
  if (req.headers.range && !range) { res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); return res.end(); }
  if (range) {
    let start = range[1] === '' ? stat.size - Number(range[2]) : Number(range[1]);
    let end = range[1] === '' || range[2] === '' ? stat.size - 1 : Math.min(Number(range[2]), stat.size - 1);
    if (start < 0) start = 0;
    if (start > end || start >= stat.size) { res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); return res.end(); }
    res.writeHead(206, { ...base, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...base, 'Content-Length': stat.size });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

// Resolve a path under root, refusing anything that escapes it.
function safeJoin(root, rel) {
  const p = path.resolve(root, '.' + path.sep + decodeURIComponent(rel));
  return p === root || p.startsWith(root + path.sep) ? p : null;
}

function readBody(req, limit = 1e6) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > limit) { reject(Object.assign(new Error('Body too large'), { code: 413 })); req.destroy(); } });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(Object.assign(new Error('Invalid JSON'), { code: 400 })); } });
    req.on('error', reject);
  });
}

function listRuns() {
  let ids = [];
  try { ids = fs.readdirSync(runsDir()).filter((d) => fs.existsSync(path.join(runsDir(), d, 'state.json'))); } catch {}
  return ids.sort().reverse().map((id) => ({ runId: id, state: readJson(id, 'state.json'), brief: readJson(id, 'brief.json') }));
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  const p = url.pathname;
  try {
    if (p === '/api/runs' && req.method === 'GET') return send(res, 200, { runs: listRuns() });
    if (p === '/api/runs' && req.method === 'POST') {
      const body = await readBody(req);
      const runId = newRunId(body.slug || 'run');
      createRun(runId, body.prefill || {});
      return send(res, 201, { runId });
    }
    if (p === '/api/effort' && req.method === 'GET') return send(res, 200, { presets: PRESETS, videoModels: VIDEO_MODEL_OPTIONS });
    if (p === '/api/keys' && req.method === 'GET') {
      // Presence only; key values are never sent to the page.
      loadEnv();
      return send(res, 200, { fal: !!process.env.FAL_KEY, jev: !!process.env.JEV_API_KEY });
    }
    let m = p.match(/^\/api\/runs\/([^/]+)\/brief$/);
    if (m && req.method === 'POST') {
      if (!RUN_ID.test(m[1])) return send(res, 400, { error: 'Bad run id' });
      const body = await readBody(req);
      const out = submitBrief(m[1], body, 'page');
      const saved = writeKeys(body.keys);
      return send(res, 200, { ...out, keysSaved: saved });
    }
    m = p.match(/^\/runs\/([^/]+)\/(.+)$/);
    if (m && (req.method === 'GET' || req.method === 'HEAD')) {
      if (!RUN_ID.test(m[1])) return send(res, 400, 'Bad run id');
      const file = safeJoin(runDir(m[1]), m[2]);
      return file ? sendFile(req, res, file) : send(res, 403, 'Forbidden');
    }
    if (req.method === 'GET' || req.method === 'HEAD') {
      const file = safeJoin(WEB, p === '/' ? 'index.html' : p.slice(1));
      return file ? sendFile(req, res, file) : send(res, 403, 'Forbidden');
    }
    return send(res, 405, { error: 'Method not allowed' });
  } catch (err) {
    return send(res, err.code && Number.isInteger(err.code) ? err.code : 500, { error: err.message });
  }
}

export default async function (args, flags) {
  const port = Number(flags.port || process.env.RECLINER_PORT || 4600);
  const host = '127.0.0.1'; // local only, by design
  const server = http.createServer(handle);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  console.log(`Recliner serving on http://${host}:${port}  (runs: ${runsDir()})`);
  await new Promise(() => {}); // run until killed
}
