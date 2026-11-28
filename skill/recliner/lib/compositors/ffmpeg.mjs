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

export function sh(bin, args, { timeoutMs = 10 * 60000, cwd = undefined, env = undefined } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], cwd, env: env ? { ...process.env, ...env } : process.env });
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    const t = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
    p.on('error', (e) => { clearTimeout(t); reject(e); });
    p.on('close', (code) => {
      clearTimeout(t);
      if (code === 0) resolve({ out, err });
      else reject(new Error(`${path.basename(bin)} exited ${code}: ${(`${err}\n${out}`).split('\n').filter(Boolean).slice(-20).join(' | ')}`));
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


// Palette words are creative-direction data, not exact brand tokens. Map them to restrained screen colours so
// fallbacks still belong to the film rather than to a universal grey template.
const PALETTE_HEX = [
  [/\bblack\b|charcoal|noir/, '#101114'], [/\bwhite\b/, '#F7F5EF'], [/\bivory\b|\bcream\b|\bbone\b/, '#F1E8D7'],
  [/paper|ecru/, '#EFE4D2'], [/caramel|tan|camel/, '#B9824E'], [/brass|gold/, '#C8A45D'],
  [/brown|leather|chocolate/, '#5B3A27'], [/blue|navy|midnight|pre-dawn/, '#16263D'], [/sky|ice/, '#A8C7DE'],
  [/sodium|orange|amber/, '#D88432'], [/volt|yellow/, '#E6D84A'], [/red|crimson/, '#A83B3B'],
  [/pink|magenta/, '#C95787'], [/purple|violet/, '#5A3E75'], [/green|forest/, '#244B37'],
  [/grey|gray|silver/, '#8B8F94'], [/concrete/, '#6F7276'],
];
const DARK_COLOUR = /black|charcoal|noir|brown|leather|chocolate|blue|navy|midnight|pre-dawn|green|forest|purple|violet|concrete/i;
const LIGHT_COLOUR = /white|ivory|cream|bone|paper|ecru|grey|gray|silver|sky|ice/i;

function paletteHex(words, category) {
  const list = (Array.isArray(words) ? words : []).map((x) => String(x).toLowerCase()).filter(Boolean);
  // Respect the order the goal gave the palette in: the first matching colour word wins.
  for (const word of list) {
    for (const [pattern, hex] of PALETTE_HEX) {
      if (pattern.test(word) && category.test(pattern.source)) return hex;
    }
  }
  return null;
}

export function paletteDesign(words = [], fallback = {}) {
  const list = Array.isArray(words) ? words.filter(Boolean).map(String) : [];
  return {
    background: paletteHex(list, DARK_COLOUR) || fallback.background || '#101114',
    accent: paletteHex(list, /caramel|tan|camel|brass|gold|sodium|orange|amber|volt|yellow|red|crimson|pink|magenta/i) || paletteHex(list, LIGHT_COLOUR) || fallback.accent || '#C8A45D',
    text: paletteHex(list, /white|ivory|cream|bone|paper|ecru/i) || fallback.text || '#F7F5EF',
  };
}

function inferTypography(modality) {
  if (['ugc-creator', 'pov', 'mockumentary'].includes(modality)) return 'native';
  if (['kinetic-type', 'ui-demo', 'athlete-talent', 'lifestyle-montage'].includes(modality)) return 'bold';
  return 'editorial';
}

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

  // Join: each segment's `xfadeIn` (seconds of overlap with the previous one) is a cross-dissolve; 0 is a hard
  // cut (concat). Without per-segment values every join uses `transition`.
  const xf = (i) => (i === 0 ? 0 : segments[i].xfadeIn ?? transition);
  const args = [];
  norm.forEach((n) => args.push('-i', n.out));
  // One timebase for every input, so xfade accepts the output of an earlier concat.
  // Order matters: settb before fps — settb after fps resets the link's frame-rate metadata to 1/0,
  // which xfade rejects ("inputs need to be a constant frame rate").
  let filter = norm.map((_, i) => `[${i}:v]settb=1/${fps * 1000},setpts=PTS-STARTPTS,fps=${fps}[s${i}];`).join('');
  let last = '[s0]';
  let length = segments[0].seconds;
  for (let i = 1; i < norm.length; i++) {
    const T = xf(i);
    const label = `[x${i}]`;
    // xfade fails at the exact EOF boundary (offset+duration == input length loses the last
    // frame), so pull the offset back by one frame.
    const offset = Math.max(0, length - T - 1 / fps);
    filter += T > 0
      ? `${last}[s${i}]xfade=transition=fade:duration=${T}:offset=${offset.toFixed(3)},settb=1/${fps * 1000},fps=${fps}${label};`
      : `${last}[s${i}]concat=n=2:v=1:a=0,settb=1/${fps * 1000},fps=${fps}${label};`;
    length += segments[i].seconds - T;
    last = label;
  }
  const total = length;
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
  if (process.env.RECLINER_DEBUG_FILTER) console.error('FILTER:', filter, '\nARGS:', final.join(' '));
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

function splitCardText(text) {
  const value = String(text || '').trim();
  const lines = value.split(/\n+/).map((x) => x.trim()).filter(Boolean);
  if (lines.length > 1) return [lines[0], lines.slice(1).join(' ')];
  const explicit = value.match(/^(.*?)(?:\s+[—–|]\s+|\s+-\s+|:\s+)(.+)$/);
  if (explicit) return [explicit[1], explicit[2]];
  const idx = value.lastIndexOf('. ');
  if (idx > 0) return [value.slice(0, idx + 1), value.slice(idx + 2)];
  return [value, ''];
}

// End card: the last designed beat of the film, not a generic title slide. The default visual mode uses a
// frame from the final scene; product-texture uses ground-truth product imagery; solid is the explicit fallback.
export function endCardSpec(card, plan = {}) {
  if (!card) return null;
  let headline = card.headline || '';
  let subline = card.subline || '';
  if (!headline && card.text) [headline, subline] = splitCardText(card.text);
  headline = String(headline).trim().replace(/[.]+$/, '');
  if (!headline) return null;
  const seconds = Number(card.durationSeconds ?? card.seconds) || 1.5;
  const palette = Array.isArray(card.palette) && card.palette.length
    ? card.palette
    : (Array.isArray(plan?.styleTags?.palette) ? plan.styleTags.palette : []);
  const design = paletteDesign(palette);
  const hex = (v) => (/^#[0-9a-f]{3,8}$/i.test(String(v || '')) ? v : null);
  const mode = ['final-frame', 'product-texture', 'solid'].includes(card.visualMode) ? card.visualMode : 'final-frame';
  const typography = ['editorial', 'bold', 'native'].includes(card.typography) ? card.typography : inferTypography(plan?.styleTags?.modality);
  return {
    headline,
    subline: String(subline).trim(),
    seconds: Math.min(4, Math.max(1, seconds)),
    visualMode: mode,
    palette,
    typography,
    materialCue: card.materialCue || null,
    color: hex(card.color || card.background) || design.background,
    accent: hex(card.accent) || design.accent,
    textColor: hex(card.textColor) || design.text,
  };
}

async function endCardBackgroundData(image, { width, height, file }) {
  if (!image || !fs.existsSync(image)) return null;
  const bgFile = file.replace(/\.mp4$/, '-background.jpg');
  await ff([
    '-i', image,
    '-vf', `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},eq=brightness=-0.10:saturation=0.95`,
    '-frames:v', '1', '-q:v', '3', bgFile,
  ]);
  return fs.readFileSync(bgFile).toString('base64');
}

export async function endCardClip(spec, { width, height, fps = 30, file, backgroundImage = null }) {
  if (!which('rsvg-convert')) return null;
  const vertical = height > width;
  const bold = spec.typography === 'bold';
  const native = spec.typography === 'native';
  const hSize = Math.round((vertical ? width : height) * (bold ? 0.086 : native ? 0.078 : 0.072));
  const sSize = Math.round(hSize * (bold ? 0.46 : 0.42));
  const display = native ? spec.headline : spec.headline.toUpperCase();
  const widthFactor = native ? 0.58 : 0.66;
  const hLines = wrap(display, Math.max(6, Math.floor((width * 0.82) / (hSize * widthFactor))), 3);
  const sLines = spec.subline ? wrap(spec.subline, Math.max(10, Math.floor((width * 0.78) / (sSize * 0.54))), 2) : [];
  const hLH = Math.round(hSize * 1.06), sLH = Math.round(sSize * 1.28);
  const ruleW = Math.round(Math.min(width * 0.12, hSize * 2.4));
  const ruleH = Math.max(2, Math.round(hSize * 0.035));
  const ruleGap = Math.round(hSize * 0.52);
  const subGap = sLines.length ? Math.round(hSize * 0.42) : 0;
  const blockH = ruleH + ruleGap + hLines.length * hLH + subGap + sLines.length * sLH;
  const centerY = Math.round(height * (vertical ? 0.74 : 0.72));
  const ruleY = Math.round(centerY - blockH / 2);
  const firstBaseline = Math.round(ruleY + ruleH + ruleGap + hSize * 0.78);
  const tracking = bold ? hSize * 0.012 : native ? hSize * 0.005 : hSize * 0.042;
  const headX = width / 2 - tracking / 2;
  const head = hLines.map((l, i) => `<tspan x="${headX}" y="${firstBaseline + i * hLH}">${esc(l)}</tspan>`).join('');
  const subY = firstBaseline + (hLines.length - 1) * hLH + subGap + sLH * 0.72;
  const sub = sLines.map((l, i) => `<tspan x="${width / 2}" y="${Math.round(subY + i * sLH)}">${esc(l)}</tspan>`).join('');
  const fontWeight = bold ? 800 : 600;

  let imageData = null;
  try {
    imageData = backgroundImage ? await endCardBackgroundData(backgroundImage, { width, height, file }) : null;
  } catch {
    imageData = null;
  }

  const bg = spec.color || '#101114';
  const textFill = spec.textColor || '#F7F5EF';
  const accent = spec.accent || '#C8A45D';
  spec.backgroundUsed = Boolean(imageData);
  const imageLayer = imageData
    ? `<image href="data:image/jpeg;base64,${imageData}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice"/>`
    : `<rect width="100%" height="100%" fill="${bg}"/><rect width="100%" height="100%" fill="url(#brandGlow)"/>`;
  const scrim = imageData
    ? `<rect width="100%" height="100%" fill="#000" opacity="0.12"/><rect width="100%" height="100%" fill="url(#legibility)"/>`
    : '';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <defs>
    <radialGradient id="brandGlow" cx="0.5" cy="0.44" r="0.78"><stop offset="0" stop-color="${accent}" stop-opacity="0.16"/><stop offset="1" stop-color="#000000" stop-opacity="0.36"/></radialGradient>
    <linearGradient id="legibility" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#000" stop-opacity="0.03"/><stop offset="0.48" stop-color="#000" stop-opacity="0.16"/>
      <stop offset="0.72" stop-color="#000" stop-opacity="0.56"/><stop offset="1" stop-color="#000" stop-opacity="0.76"/>
    </linearGradient>
    <filter id="typeShadow" x="-20%" y="-80%" width="140%" height="260%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="${Math.max(1, Math.round(hSize * 0.045))}" result="blur"/>
      <feComponentTransfer in="blur" result="shadow"><feFuncA type="linear" slope="0.65"/></feComponentTransfer>
      <feMerge><feMergeNode in="shadow"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  ${imageLayer}
  ${scrim}
  <rect x="${Math.round(width / 2 - ruleW / 2)}" y="${ruleY}" width="${ruleW}" height="${ruleH}" fill="${accent}" fill-opacity="0.9"/>
  <text font-family="'Helvetica Neue', Helvetica, Arial, sans-serif" font-weight="${fontWeight}" font-size="${hSize}" fill="${textFill}" text-anchor="middle" letter-spacing="${tracking.toFixed(1)}" filter="url(#typeShadow)">${head}</text>
  ${sub ? `<text font-family="'Helvetica Neue', Helvetica, Arial, sans-serif" font-weight="500" font-size="${sSize}" fill="${textFill}" fill-opacity="0.84" text-anchor="middle" letter-spacing="${(sSize * 0.018).toFixed(1)}" filter="url(#typeShadow)">${sub}</text>` : ''}
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
