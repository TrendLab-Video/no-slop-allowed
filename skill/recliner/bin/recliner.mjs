#!/usr/bin/env node
// Recliner CLI. Each command is one file in bin/commands/<name>.mjs exporting
//   export const describe = 'one line';
//   export default async function (args, flags) { ... }
// Add a command by adding a file; this dispatcher never needs editing.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'commands');
const [name, ...rest] = process.argv.slice(2);

function parse(argv) {
  const args = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      flags[k] = v ?? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true);
    } else args.push(a);
  }
  return { args, flags };
}

const file = name && path.join(dir, `${name}.mjs`);
if (!name || !fs.existsSync(file)) {
  console.log('Usage: recliner <command> [args] [--flags]\n');
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.mjs')).sort()) {
    const mod = await import(path.join(dir, f));
    console.log(`  ${f.replace('.mjs', '').padEnd(18)} ${mod.describe || ''}`);
  }
  process.exit(name ? 1 : 0);
}
const { args, flags } = parse(rest);
try {
  const out = await (await import(file)).default(args, flags);
  if (out !== undefined) console.log(typeof out === 'string' ? out : JSON.stringify(out, null, 2));
} catch (err) {
  console.error(`recliner ${name}: ${err.message}`);
  process.exit(1);
}
