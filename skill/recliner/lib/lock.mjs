// Cross-process lock for read-modify-write of shared run files (clips.json, result.json, traces.json).
// Several `recliner` processes run at once (parallel per-scene retries), so every write that reads the
// file first must hold the lock. mkdir is atomic on every platform; a lock older than 30s is stale.
import fs from 'node:fs';
import { runPath, readJson, writeJson, appendTrace } from './store.mjs';

const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

export function withLock(file, fn, { timeoutMs = 20000, staleMs = 30000 } = {}) {
  const lock = `${file}.lock`;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try { fs.mkdirSync(lock); break; } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      try { if (Date.now() - fs.statSync(lock).mtimeMs > staleMs) { fs.rmSync(lock, { recursive: true, force: true }); continue; } } catch {}
      if (Date.now() > deadline) throw new Error(`Timed out waiting for lock ${lock}`);
      sleepSync(15 + Math.random() * 25);
    }
  }
  try { return fn(); } finally { fs.rmSync(lock, { recursive: true, force: true }); }
}

// Re-read, modify and write one run JSON file under its lock. mutate(doc) edits in place or returns a new doc.
export function updateJson(runId, name, fallback, mutate) {
  return withLock(runPath(runId, name), () => {
    const doc = readJson(runId, name, structuredClone(fallback));
    const next = mutate(doc) ?? doc;
    writeJson(runId, name, next);
    return next;
  });
}

export const appendTraceLocked = (runId, step) => withLock(runPath(runId, 'traces.json'), () => appendTrace(runId, step));
