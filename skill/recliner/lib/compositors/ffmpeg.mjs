// ffmpeg compositor and shared ffmpeg helpers (probe, frames, text cards, final mux).
// Compositor interface (shared with blender.mjs):
//   compose({ segments: [{ file, seconds, text }], width, height, fps, transition, bed, outFile, workDir })
//     -> { file, durationSeconds, notes: [string], commands: [string] }
// `bed` is an already mixed and loudness-normalised audio file (or null for silence).
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';

export function which(bin) {
  try { return execFileSync('/usr/bin/which', [bin], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || null; } catch { return null; }
}

export function sh(bin, args, { timeoutMs = 10 * 60000 } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    const t = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
    p.on('error', (e) => { clearTimeout(t); reject(e); });
    p.on('close', (code) => {
      clearTimeout(t);
      if (code === 0) resolve({ out, err });
      else reject(new Error(`${path.basename(bin)} exited ${code}: ${err.split('\n').filter(Boolean).slice(-6).join(' | ')}`));
    });
  });
}

const ff = (args, opts) => sh('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], opts);

export async function probeDuration(file) {
  const { out } = await sh('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file]);
  const d = parseFloat(out);
  return Number.isFinite(d) ? Math.round(d * 100) / 100 : null;
}

export async function hasAudio(file) {
  const { out } = await sh('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', file]);
  return out.trim().length > 0;
}

export function dimensions(aspectRatio = '16:9', long = 1920) {
  const short = Math.round((long * 9) / 16 / 2) * 2;
  if (aspectRatio === '9:16') return { width: short, height: long };
  if (aspectRatio === '1:1') return { width: short, height: short };
  return { width: long, height: short };
}

// Evenly spaced frames (avoiding the very first and last frame). Returns file paths.
export async function extractFrames(video, outDir, count = 6) {
  fs.mkdirSync(outDir, { recursive: true });
  const dur = (await probeDuration(video)) || 1;
  const files = [];
  for (let i = 0; i < count; i++) {
    const t = (dur * (i + 0.5)) / count;
    const f = path.join(outDir, `frame_${String(i + 1).padStart(2, '0')}.jpg`);
    await ff(['-ss', t.toFixed(3), '-i', video, '-frames:v', '1', '-q:v', '3', '-vf', "scale='min(1280,iw)':-2", f]);
    files.push(f);
  }
  return files;
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function wrap(text, maxChars) {
  const words = String(text).trim().split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    if (line && (line + ' ' + w).length > maxChars) { lines.push(line); line = w; } else line = line ? `${line} ${w}` : w;
  }
  if (line) lines.push(line);
  return lines;
}

// Heavy display font shared by both compositors (rsvg by family name, Blender by file).
export const FONT_FILES = ['/System/Library/Fonts/Supplemental/Arial Black.ttf', '/System/Library/Fonts/Supplemental/Arial Bold.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'];
const FONT_FAMILY = "'Arial Black', 'Helvetica Neue', Helvetica, Arial, sans-serif";

// Text layout inside platform safe areas: vertical video keeps clear of the bottom ~22% (captions, UI)
// and the top ~12%; text sits in the lower-middle band, at most 3 lines within 84% of the width.
export function textLayout(text, width, height) {
  const vertical = height > width;
  const fontSize = Math.round(vertical ? width * 0.088 : height * 0.078);
  const maxChars = Math.max(8, Math.floor((width * 0.84) / (fontSize * 0.6)));
  const lines = wrap(text, maxChars).slice(0, 3);
  const lineH = Math.round(fontSize * 1.15);
  const centerY = Math.round(height * (vertical ? 0.63 : 0.76));
  return { lines, fontSize, lineH, centerY, firstBaseline: centerY - ((lines.length - 1) * lineH) / 2 + fontSize * 0.36 };
}

// Full-frame transparent PNG with the on-screen text, rendered with rsvg-convert (ffmpeg here has no drawtext).
// A heavy font with a doubled soft shadow keeps white text legible on any footage (Blender adds a plate).
export async function textCard(text, width, height, file) {
  if (!text || !which('rsvg-convert')) return null;
  const L = textLayout(text, width, height);
  const fs_ = L.fontSize;
  const tspans = L.lines.map((l, i) => `<tspan x="${width / 2}" y="${Math.round(L.firstBaseline + i * L.lineH)}">${esc(l)}</tspan>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <defs>
    <filter id="shadow" x="-30%" y="-60%" width="160%" height="220%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="${Math.round(fs_ * 0.09)}" result="sb"/>
      <feOffset in="sb" dy="${Math.round(fs_ * 0.04)}" result="shadow"/>
      <feComponentTransfer in="shadow" result="shadowA"><feFuncA type="linear" slope="0.9"/></feComponentTransfer>
      <feMerge><feMergeNode in="shadowA"/><feMergeNode in="shadowA"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <text font-family="${FONT_FAMILY}" font-weight="900" font-size="${fs_}" fill="#ffffff" text-anchor="middle" filter="url(#shadow)">${tspans}</text>
</svg>`;
  const svgFile = file.replace(/\.png$/, '.svg');
  fs.writeFileSync(svgFile, svg);
  await sh('rsvg-convert', ['-w', String(width), '-h', String(height), '-o', file, svgFile]);
  return file;
}

// Normalise one clip: cover-scale and crop to WxH, constant fps, exact length, text card faded in.
async function normalise(seg, i, { width, height, fps, workDir }) {
  const out = path.join(workDir, `seg_${i}.mp4`);
  const card = seg.text ? await textCard(seg.text, width, height, path.join(workDir, `text_${i}.png`)) : null;
  const len = seg.seconds;
  // Hold the last frame if the clip is shorter than the slot.
  const base = `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,fps=${fps},tpad=stop_mode=clone:stop_duration=${len},trim=0:${len},setpts=PTS-STARTPTS,format=yuv420p`;
  const args = ['-i', seg.file];
  let filter;
  if (card) {
    args.push('-loop', '1', '-t', String(len), '-i', card);
    const fadeOut = Math.max(0.5, len - 0.45);
    filter = `${base}[v];[1:v]format=rgba,fade=in:st=0.25:d=0.4:alpha=1,fade=out:st=${fadeOut.toFixed(2)}:d=0.3:alpha=1[t];[v][t]overlay=0:0:format=auto,format=yuv420p[o]`;
  } else filter = `${base}[o]`;
  await ff([...args, '-filter_complex', filter, '-map', '[o]', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', '-r', String(fps), out]);
  return { out, card };
}

export async function compose({ segments, width, height, fps = 30, transition = 0.4, bed = null, outFile, workDir }) {
  fs.mkdirSync(workDir, { recursive: true });
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const notes = [];
  if (!which('rsvg-convert') && segments.some((s) => s.text)) notes.push('rsvg-convert not found: on-screen text skipped');
  const norm = [];
  for (let i = 0; i < segments.length; i++) norm.push(await normalise(segments[i], i, { width, height, fps, workDir }));

  // Join with xfade cross-dissolves; each transition overlaps adjacent segments by `transition` seconds.
  const T = segments.length > 1 ? transition : 0;
  const args = [];
  norm.forEach((n) => args.push('-i', n.out));
  let filter = '';
  let last = '[0:v]';
  let offset = 0;
  for (let i = 1; i < norm.length; i++) {
    offset += segments[i - 1].seconds - T;
    const label = `[x${i}]`;
    filter += `${last}[${i}:v]xfade=transition=fade:duration=${T}:offset=${offset.toFixed(3)}${label};`;
    last = label;
  }
  const total = segments.reduce((a, s) => a + s.seconds, 0) - T * (segments.length - 1);
  const fadeOutStart = Math.max(0, total - 0.5);
  filter += `${last}fade=in:st=0:d=0.25,fade=out:st=${fadeOutStart.toFixed(3)}:d=0.5,format=yuv420p[v]`;

  const audioIdx = norm.length;
  if (bed) args.push('-i', bed);
  else args.push('-f', 'lavfi', '-t', String(total), '-i', 'anullsrc=r=48000:cl=stereo');
  filter += `;[${audioIdx}:a]atrim=0:${total.toFixed(3)},apad=whole_dur=${total.toFixed(3)},aresample=48000[a]`;

  const final = [...args, '-filter_complex', filter, '-map', '[v]', '-map', '[a]',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-profile:v', 'high', '-level', '4.1', '-pix_fmt', 'yuv420p', '-r', String(fps),
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-movflags', '+faststart', '-t', total.toFixed(3), outFile];
  await ff(final);
  return { file: outFile, durationSeconds: await probeDuration(outFile), notes, commands: ['ffmpeg ' + final.join(' ')] };
}

// Ensure a delivered file is web-safe H.264/AAC with faststart (used after Blender renders).
export async function finalize(input, outFile, { bed = null, fps = 30, copyVideo = false } = {}) {
  const total = await probeDuration(input);
  const args = ['-i', input];
  if (bed) args.push('-i', bed); else args.push('-f', 'lavfi', '-t', String(total), '-i', 'anullsrc=r=48000:cl=stereo');
  const video = copyVideo ? ['-c:v', 'copy'] : ['-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-r', String(fps)];
  args.push('-map', '0:v:0', '-map', '1:a:0', '-filter:a', `atrim=0:${total},apad=whole_dur=${total}`, ...video,
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-movflags', '+faststart', '-t', String(total), outFile);
  await ff(args);
  return outFile;
}

export async function thumbnail(video, file, at = null) {
  const dur = (await probeDuration(video)) || 1;
  const t = at ?? Math.min(1.2, dur / 3);
  await ff(['-ss', t.toFixed(3), '-i', video, '-frames:v', '1', '-q:v', '2', file]);
  return file;
}

export { ff };
