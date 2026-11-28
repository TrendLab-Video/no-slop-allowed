// Blender VSE compositor: runs Blender headless with blender_compose.py. Same interface as ffmpeg.mjs compose().
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { which, sh, ff, probeDuration, textLayout, finalize } from './ffmpeg.mjs';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'blender_compose.py');
const MAC_APP = '/Applications/Blender.app/Contents/MacOS/Blender';
const FONTS = ['/System/Library/Fonts/Supplemental/Arial Bold.ttf', '/System/Library/Fonts/Helvetica.ttc', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'];

export function findBlender() {
  if (process.env.BLENDER_BIN && fs.existsSync(process.env.BLENDER_BIN)) return process.env.BLENDER_BIN;
  return which('blender') || (fs.existsSync(MAC_APP) ? MAC_APP : null);
}

export async function compose({ segments, width, height, fps = 30, transition = 0.4, bed = null, outFile, workDir }) {
  const bin = findBlender();
  if (!bin) throw new Error('Blender not found (PATH or /Applications/Blender.app)');
  fs.mkdirSync(workDir, { recursive: true });
  const raw = path.join(workDir, 'blender.mp4');
  // Blender does not retime movie strips, so every clip must share the scene frame rate.
  // Use the clips' own rate when they agree (one model, no re-encode); otherwise conform them to `fps`.
  const rates = await Promise.all(segments.map((s) => frameRate(s.file)));
  const common = rates.every((r) => r && r === rates[0]) && rates[0] >= 23 && rates[0] <= 60 ? rates[0] : null;
  const sceneFps = common || fps;
  const notes = [];
  const files = await Promise.all(segments.map(async (s, i) => {
    if (rates[i] === sceneFps) return s.file;
    const out = path.join(workDir, `conform_${i}.mp4`);
    await ff(['-i', s.file, '-an', '-vf', `fps=${sceneFps}`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-pix_fmt', 'yuv420p', out]);
    notes.push(`clip ${i + 1} conformed from ${rates[i]} to ${sceneFps} fps`);
    return out;
  }));
  const job = {
    segments: segments.map((s, i) => ({ ...s, file: files[i], layout: s.text ? textLayout(s.text, width, height) : null })),
    width, height, fps: sceneFps, transition, bed, out: raw,
    fontFile: FONTS.find((f) => fs.existsSync(f)) || null,
  };
  const jobFile = path.join(workDir, 'blender_job.json');
  fs.writeFileSync(jobFile, JSON.stringify(job, null, 2));
  const args = ['-b', '--factory-startup', '-noaudio', '-P', SCRIPT, '--', jobFile];
  const { out } = await sh(bin, args, { timeoutMs: 5 * 60000 });
  if (!fs.existsSync(raw) || !(await probeDuration(raw))) throw new Error(`Blender produced no video: ${out.split('\n').slice(-5).join(' | ')}`);
  // Re-mux with the exact bed and +faststart so the file plays everywhere.
  await finalize(raw, outFile, { bed, copyVideo: true });
  return { file: outFile, durationSeconds: await probeDuration(outFile), notes, commands: [`${bin} ${args.join(' ')}`] };
}

async function frameRate(file) {
  const { out } = await sh('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=avg_frame_rate', '-of', 'csv=p=0', file]);
  const [n, d] = out.trim().split('/').map(Number);
  return d ? Math.round((n / d) * 100) / 100 : null;
}
