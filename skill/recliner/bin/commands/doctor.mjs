// Checks what this machine needs before a run. Exits 1 only when something required is missing.
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { loadEnv, envFiles } from '../../lib/env.mjs';

export const describe = 'doctor: check prerequisites (Node, ffmpeg, keys; optional Blender, yt-dlp, rsvg-convert, search and Jev keys)';

const which = (bin) => {
  try {
    return execSync(`command -v ${bin}`, { stdio: ['ignore', 'pipe', 'ignore'], shell: '/bin/sh' }).toString().trim() || null;
  } catch {
    return null;
  }
};
const MAC_BLENDER = '/Applications/Blender.app/Contents/MacOS/Blender';

export default async function () {
  loadEnv();
  const node = Number(process.versions.node.split('.')[0]);
  const blender = process.env.BLENDER_BIN || which('blender') || (fs.existsSync(MAC_BLENDER) ? MAC_BLENDER : null);
  const checks = [
    { name: 'Node 22+', required: true, ok: node >= 22, detail: `found ${process.versions.node}` },
    { name: 'ffmpeg', required: true, ok: !!which('ffmpeg'), detail: which('ffmpeg') || 'not on PATH' },
    { name: 'ffprobe', required: true, ok: !!which('ffprobe'), detail: which('ffprobe') || 'not on PATH' },
    { name: 'FAL_KEY', required: true, ok: !!(process.env.FAL_KEY || process.env.FAL_API_KEY), detail: `looked in ${envFiles().join(', ')} (or enter it on the Brief page)` },
    { name: 'Blender (recommended compositor)', required: false, ok: !!blender, detail: blender || 'not found: ffmpeg will compose' },
    { name: 'rsvg-convert (captions on the ffmpeg path)', required: false, ok: !!which('rsvg-convert'), detail: which('rsvg-convert') || 'not on PATH' },
    { name: 'yt-dlp (reference video frames)', required: false, ok: !!which('yt-dlp'), detail: which('yt-dlp') || 'not on PATH: one image per reference' },
    { name: 'Search key (TAVILY_API_KEY or PARALLEL_API_KEY)', required: false, ok: !!(process.env.TAVILY_API_KEY || process.env.PARALLEL_API_KEY), detail: 'optional: built-in web search otherwise' },
    { name: 'JEV_API_KEY (scoring)', required: false, ok: !!process.env.JEV_API_KEY, detail: 'optional: Haiku sub-agent otherwise' },
  ];
  for (const c of checks) console.log(`${c.ok ? 'ok     ' : c.required ? 'MISSING' : 'absent '} ${c.name}${c.ok && c.required ? '' : `  (${c.detail})`}`);
  const missing = checks.filter((c) => c.required && !c.ok);
  if (missing.length) throw new Error(`missing required: ${missing.map((c) => c.name).join(', ')}`);
  return 'Ready. Run `recliner preflight` to check the fal account itself.';
}
