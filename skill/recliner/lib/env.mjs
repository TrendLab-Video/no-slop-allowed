// Loads keys from .env. Looks in the current checkout first, then the main checkout
// (so git worktrees share one .env). Never copies keys into a run folder.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { repoRoot } from './store.mjs';

export function envFiles() {
  const files = [path.join(repoRoot(), '.env')];
  try {
    const common = execSync('git rev-parse --path-format=absolute --git-common-dir', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    files.push(path.join(path.dirname(common), '.env'));
  } catch {}
  return [...new Set(files)];
}

export function loadEnv() {
  for (const file of envFiles()) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && m[2] && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  return process.env;
}

export function requireKey(name) {
  loadEnv();
  if (!process.env[name]) throw new Error(`${name} is not set. Add it to .env (${envFiles().join(' or ')}).`);
  return process.env[name];
}
