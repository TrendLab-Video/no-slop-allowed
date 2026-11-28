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

// Balanced wrap: the fewest lines that fit, with breaks chosen so lines are as even as possible
// ("Order your first / bag today", never "Order your first bag / today").
export function wrap(text, maxChars, maxLines = 3) {
  const words = String(text).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const join = (ws) => ws.join(' ');
  if (join(words).length <= maxChars) return [join(words)];
  let best = null;
  const consider = (lines) => {
    const longest = Math.max(...lines.map((l) => l.length));
    const score = (longest > maxChars ? 1000 + longest : longest) * 10 + lines.length;
    if (!best || score < best.score) best = { lines, score };
  };
  for (let i = 1; i < words.length; i++) {
    consider([join(words.slice(0, i)), join(words.slice(i))]);
    if (maxLines >= 3) for (let j = i + 1; j < words.length; j++) consider([join(words.slice(0, i)), join(words.slice(i, j)), join(words.slice(j))]);
  }
  // Prefer two lines when they fit.
  const two = [];
  for (let i = 1; i < words.length; i++) two.push([join(words.slice(0, i)), join(words.slice(i))]);
  const fitTwo = two.filter((l) => Math.max(l[0].length, l[1].length) <= maxChars).sort((a, b) => Math.max(a[0].length, a[1].length) - Math.max(b[0].length, b[1].length))[0];
  return fitTwo || best.lines;
}

// Heavy display font shared by both compositors (rsvg by family name, Blender by file).
export const FONT_FILES = ['/System/Library/Fonts/Supplemental/Arial Black.ttf', '/System/Library/Fonts/Supplemental/Arial Bold.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'];
const FONT_FAMILY = "'Arial Black', 'Helvetica Neue', Helvetica, Arial, sans-serif";

// Caption layout: centred in the lower third, never over the bottom 15% (platform UI) and within 84% of the
// width; at most 3 balanced lines.
export function textLayout(text, width, height) {
  const vertical = height > width;
  // Arial Black averages ~0.6 x font size per character (measured on renders); lines may use 88% of the width.
  const fontSize = Math.round(vertical ? width * 0.088 : height * 0.085);
  const maxChars = Math.max(8, Math.floor((width * 0.88) / (fontSize * 0.6)));
  const lines = wrap(text, maxChars).slice(0, 3);
  const lineH = Math.round(fontSize * 1.15);
  const blockH = lines.length * lineH;
  const centerY = Math.round(Math.min(height * 0.72, height * 0.85 - blockH / 2 - fontSize * 0.4));
  return { lines, fontSize, lineH, centerY, blockH, firstBaseline: centerY - ((lines.length - 1) * lineH) / 2 + fontSize * 0.36 };
}

// Full-frame transparent PNG with the caption, rendered with rsvg-convert (ffmpeg here has no drawtext).
// A soft dark scrim across the caption band plus a doubled shadow keeps heavy white text legible on any
// footage (Blender draws a rounded plate instead).
export async function textCard(text, width, height, file) {
  if (!text || !which('rsvg-convert')) return null;
  const L = textLayout(text, width, height);
  const fs_ = L.fontSize;
  const tspans = L.lines.map((l, i) => `<tspan x="${width / 2}" y="${Math.round(L.firstBaseline + i * L.lineH)}">${esc(l)}</tspan>`).join('');
  const scrimH = Math.round(L.blockH + fs_ * 2.4);
  const scrimY = Math.round(L.centerY - scrimH / 2);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <defs>
    <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="0.3" stop-color="#000" stop-opacity="0.42"/>
      <stop offset="0.7" stop-color="#000" stop-opacity="0.42"/><stop offset="1" stop-color="#000" stop-opacity="0"/>
    </linearGradient>
    <filter id="shadow" x="-30%" y="-60%" width="160%" height="220%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="${Math.round(fs_ * 0.09)}" result="sb"/>
      <feOffset in="sb" dy="${Math.round(fs_ * 0.04)}" result="shadow"/>
      <feComponentTransfer in="shadow" result="shadowA"><feFuncA type="linear" slope="0.9"/></feComponentTransfer>
      <feMerge><feMergeNode in="shadowA"/><feMergeNode in="shadowA"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <rect x="0" y="${scrimY}" width="${width}" height="${scrimH}" fill="url(#scrim)"/>
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
    // Caption window from compose: starts once the scene is fully visible, clears before it starts leaving.
    const tin = seg.textIn ?? 0.3;
    const tout = Math.max(tin + 0.6, seg.textOut ?? len - 0.5);
    filter = `${base}[v];[1:v]format=rgba,fade=in:st=${tin.toFixed(2)}:d=0.3:alpha=1,fade=out:st=${(tout - 0.25).toFixed(2)}:d=0.25:alpha=1[t];[v][t]overlay=0:0:format=auto,format=yuv420p[o]`;
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

  // Audio only when there is a bed: no silent track pretending to be audio.
  let audioArgs = ['-an'];
  if (bed) {
    args.push('-i', bed);
    filter += `;[${norm.length}:a]atrim=0:${total.toFixed(3)},apad=whole_dur=${total.toFixed(3)},aresample=48000[a]`;
    audioArgs = ['-map', '[a]', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2'];
  }

  const final = [...args, '-filter_complex', filter, '-map', '[v]', ...audioArgs,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-profile:v', 'high', '-level', '4.1', '-pix_fmt', 'yuv420p', '-r', String(fps),
    '-movflags', '+faststart', '-t', total.toFixed(3), outFile];
  await ff(final);
  return { file: outFile, durationSeconds: await probeDuration(outFile), notes, commands: ['ffmpeg ' + final.join(' ')] };
}

// Ensure a delivered file is web-safe H.264/AAC with faststart (used after Blender renders).
export async function finalize(input, outFile, { bed = null, fps = 30, copyVideo = false } = {}) {
  const total = await probeDuration(input);
  const args = ['-i', input];
  const video = copyVideo ? ['-c:v', 'copy'] : ['-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-r', String(fps)];
  if (bed) {
    args.push('-i', bed, '-map', '0:v:0', '-map', '1:a:0', '-filter:a', `atrim=0:${total},apad=whole_dur=${total}`,
      '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2');
  } else args.push('-map', '0:v:0', '-an');
  args.push(...video, '-movflags', '+faststart', '-t', String(total), outFile);
  await ff(args);
  return outFile;
}

// Integrated loudness (LUFS) and true peak of a file's audio, or null when it has no audio stream.
export async function loudness(file) {
  if (!(await hasAudio(file))) return null;
  const { err } = await sh('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-']);
  const summary = err.slice(err.lastIndexOf('Summary:'));
  const I = parseFloat((summary.match(/I:\s+(-?[\d.]+|-inf)\s+LUFS/) || [])[1]);
  const peak = parseFloat((summary.match(/Peak:\s+(-?[\d.]+|-inf)\s+dBFS/) || [])[1]);
  return { lufs: Number.isFinite(I) ? I : -Infinity, truePeak: Number.isFinite(peak) ? peak : null };
}

// End card: brand-tinted background, large headline, small subline, as a short clip that the compositors
// cross-fade into like any scene. Accepts { headline, subline, durationSeconds } or { text, seconds }.
export function endCardSpec(card) {
  if (!card) return null;
  let headline = card.headline || '';
  let subline = card.subline || '';
  if (!headline && card.text) {
    const m = String(card.text).split(/\s+[—–|-]\s+|:\s+|\.\s+/);
    headline = m[0];
    subline = m.slice(1).join(' ');
  }
  headline = String(headline).trim().replace(/[.]+$/, '');
  if (!headline) return null;
  const seconds = Number(card.durationSeconds ?? card.seconds) || 1.5;
  return { headline, subline: String(subline).trim(), seconds: Math.min(4, Math.max(1, seconds)), color: card.color || card.background || null };
}

export async function endCardClip(spec, { width, height, fps = 30, file }) {
  if (!which('rsvg-convert')) return null;
  const vertical = height > width;
  const hSize = Math.round(vertical ? width * 0.115 : height * 0.11);
  const sSize = Math.round(hSize * 0.42);
  const hLines = wrap(spec.headline, Math.max(6, Math.floor((width * 0.84) / (hSize * 0.62))), 3);
  const sLines = spec.subline ? wrap(spec.subline, Math.max(10, Math.floor((width * 0.8) / (sSize * 0.55))), 2) : [];
  const hLH = Math.round(hSize * 1.08), sLH = Math.round(sSize * 1.3);
  const gap = sLines.length ? Math.round(hSize * 0.55) : 0;
  const blockH = hLines.length * hLH + gap + sLines.length * sLH;
  let y = Math.round(height / 2 - blockH / 2 + hSize * 0.8);
  const bg = /^#[0-9a-f]{3,8}$/i.test(spec.color || '') ? spec.color : '#101114';
  const head = hLines.map((l, i) => `<tspan x="${width / 2}" y="${y + i * hLH}">${esc(l)}</tspan>`).join('');
  y += (hLines.length - 1) * hLH + gap + (sLines.length ? sLH * 0.75 : 0);
  const sub = sLines.map((l, i) => `<tspan x="${width / 2}" y="${Math.round(y + i * sLH)}">${esc(l)}</tspan>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <defs><radialGradient id="g" cx="0.5" cy="0.45" r="0.75"><stop offset="0" stop-color="#ffffff" stop-opacity="0.10"/><stop offset="1" stop-color="#000000" stop-opacity="0.35"/></radialGradient></defs>
  <rect width="100%" height="100%" fill="${bg}"/><rect width="100%" height="100%" fill="url(#g)"/>
  <text font-family="${FONT_FAMILY}" font-weight="900" font-size="${hSize}" fill="#ffffff" text-anchor="middle" letter-spacing="${(-hSize * 0.01).toFixed(1)}">${head}</text>
  ${sub ? `<text font-family="'Helvetica Neue', Helvetica, Arial, sans-serif" font-weight="500" font-size="${sSize}" fill="#ffffff" fill-opacity="0.82" text-anchor="middle">${sub}</text>` : ''}
</svg>`;
  const png = file.replace(/\.mp4$/, '.png');
  fs.writeFileSync(file.replace(/\.mp4$/, '.svg'), svg);
  await sh('rsvg-convert', ['-w', String(width), '-h', String(height), '-o', png, file.replace(/\.mp4$/, '.svg')]);
  // A slow 3% push-in so the card is not a dead frame; the cross-fade into it is the fade-in.
  const n = Math.round(spec.seconds * fps);
  await ff(['-loop', '1', '-i', png, '-vf', `scale=${width * 2}:${height * 2},zoompan=z='1+0.03*on/${n}':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':d=${n}:s=${width}x${height}:fps=${fps},format=yuv420p`,
    '-frames:v', String(n), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-r', String(fps), file]);
  return file;
}

// Ken Burns move over a still (the fallback when fal video times out): a slow push-in or pull-out with a
// slight drift, rendered at 2x then downsampled so the motion does not jitter. `variant` picks the move.
export async function kenBurns(image, outFile, { seconds = 5, width = 720, height = 1280, fps = 30, variant = 0 } = {}) {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const n = Math.round(seconds * fps);
  const W2 = width * 2, H2 = height * 2;
  const zoomIn = variant % 2 === 0;
  const z = zoomIn ? `1+0.14*on/${n}` : `1.14-0.14*on/${n}`;
  const dx = [0.5, 0.42, 0.58][variant % 3];
  const zoompan = `zoompan=z='${z}':x='(iw-iw/zoom)*${dx}':y='(ih-ih/zoom)/2':d=${n}:s=${width}x${height}:fps=${fps}`;
  await ff(['-loop', '1', '-i', image, '-vf', `scale=${W2}:${H2}:force_original_aspect_ratio=increase,crop=${W2}:${H2},${zoompan},format=yuv420p`,
    '-frames:v', String(n), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', '-r', String(fps), outFile]);
  return outFile;
}

export async function thumbnail(video, file, at = null) {
  const dur = (await probeDuration(video)) || 1;
  const t = at ?? Math.min(1.2, dur / 3);
  await ff(['-ss', t.toFixed(3), '-i', video, '-frames:v', '1', '-q:v', '2', file]);
  return file;
}

export { ff };
