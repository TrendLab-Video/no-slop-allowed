// Blender VSE compositor: runs Blender headless with blender_compose.py. Same interface as ffmpeg.mjs compose().
// Set RECLINER_REMOTE_BLENDER_HOST (and optionally RECLINER_REMOTE_BLENDER_BIN) to execute the Blender step over SSH.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { which, sh, ff, probeDuration, textLayout, finalize, FONT_FILES } from './ffmpeg.mjs';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'blender_compose.py');
const MAC_APP = '/Applications/Blender.app/Contents/MacOS/Blender';
const DEFAULT_REMOTE_BIN = '/home/linuxuser/recliner-tools/blender-4.5.9-linux-x64/blender';
const DEFAULT_REMOTE_FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';

export function findBlender() {
  if (process.env.BLENDER_BIN && fs.existsSync(process.env.BLENDER_BIN)) return process.env.BLENDER_BIN;
  return which('blender') || (fs.existsSync(MAC_APP) ? MAC_APP : null);
}

export function remoteBlenderHost() {
  return process.env.RECLINER_REMOTE_BLENDER_HOST || null;
}

export function blenderAvailable() {
  return Boolean(remoteBlenderHost() || findBlender());
}

const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

async function cleanupRemote(host, remoteDir) {
  try {
    await sh('ssh', [host, `rm -rf ${q(remoteDir)}`], { timeoutMs: 15000 });
  } catch {}
}

async function composeRemote({ job, raw, workDir, notes }) {
  const host = remoteBlenderHost();
  const bin = process.env.RECLINER_REMOTE_BLENDER_BIN || DEFAULT_REMOTE_BIN;
  const key = crypto.createHash('sha1').update(`${workDir}:${Date.now()}:${process.pid}`).digest('hex').slice(0, 12);
  const configuredRoot = (process.env.RECLINER_REMOTE_WORKDIR || 'recliner-compose').replace(/\/+$/, '');
  let remoteRoot = configuredRoot;
  if (!configuredRoot.startsWith('/')) {
    const home = (await sh('ssh', [host, 'pwd'], { timeoutMs: 15000 })).out.trim();
    remoteRoot = `${home}/${configuredRoot}`;
  }
  const remoteDir = `${remoteRoot}/job-${key}`;
  const remoteOut = `${remoteDir}/blender.mp4`;
  const uploads = [];
  const remoteSegments = job.segments.map((segment, i) => {
    const remoteName = `input_${i}${path.extname(segment.file) || '.mp4'}`;
    uploads.push([segment.file, remoteName]);
    return { ...segment, file: `${remoteDir}/${remoteName}` };
  });
  let remoteBed = null;
  if (job.bed) {
    remoteBed = `${remoteDir}/bed${path.extname(job.bed) || '.wav'}`;
    uploads.push([job.bed, path.basename(remoteBed)]);
  }

  const remoteJob = {
    ...job,
    segments: remoteSegments,
    bed: remoteBed,
    out: remoteOut,
    fontFile: process.env.RECLINER_REMOTE_FONT || DEFAULT_REMOTE_FONT,
  };
  const remoteJobFile = path.join(workDir, 'blender_remote_job.json');
  fs.writeFileSync(remoteJobFile, JSON.stringify(remoteJob, null, 2));

  try {
    await sh('ssh', [host, `mkdir -p ${q(remoteDir)}`], { timeoutMs: 20000 });
    for (const [local, remoteName] of uploads) {
      await sh('scp', [local, `${host}:${remoteDir}/${remoteName}`], { timeoutMs: 120000 });
    }
    await sh('scp', [SCRIPT, `${host}:${remoteDir}/blender_compose.py`], { timeoutMs: 30000 });
    await sh('scp', [remoteJobFile, `${host}:${remoteDir}/blender_job.json`], { timeoutMs: 30000 });

    const cpuSet = process.env.RECLINER_REMOTE_BLENDER_CPUSET;
    const prefix = cpuSet && /^[0-9,-]+$/.test(cpuSet) ? `taskset -c ${cpuSet} nice -n 10` : 'nice -n 10';
    const command = `cd ${q(remoteDir)} && ${[
      prefix,
      q(bin),
      '-b --factory-startup -noaudio',
      '-P', q(`${remoteDir}/blender_compose.py`),
      '--', q(`${remoteDir}/blender_job.json`),
    ].join(' ')}`;
    const { out } = await sh('ssh', [host, command], { timeoutMs: 8 * 60000 });
    try {
      await sh('scp', [`${host}:${remoteOut}`, raw], { timeoutMs: 120000 });
    } catch (err) {
      let listing = 'remote listing unavailable';
      try {
        listing = (await sh('ssh', [host, `ls -la ${q(remoteDir)}`], { timeoutMs: 15000 })).out.trim();
      } catch {}
      throw new Error(`remote Blender output missing: ${err.message}; Blender output: ${out.split('\n').filter(Boolean).slice(-8).join(' | ')}; ${listing}`);
    }
    notes.push(`Blender VSE rendered remotely on ${host}`);
    return { output: out, command: `ssh ${host} ${command}` };
  } finally {
    if (!process.env.RECLINER_REMOTE_KEEP) await cleanupRemote(host, remoteDir);
    else notes.push(`remote Blender workdir kept at ${host}:${remoteDir}`);
  }
}

export async function compose({ segments, width, height, fps = 30, transition = 0.4, bed = null, outFile, workDir }) {
  const remoteHost = remoteBlenderHost();
  const bin = remoteHost ? null : findBlender();
  if (!remoteHost && !bin) throw new Error('Blender not found locally and RECLINER_REMOTE_BLENDER_HOST is not set');
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
    fontFile: FONT_FILES.find((f) => fs.existsSync(f)) || null,
  };
  const jobFile = path.join(workDir, 'blender_job.json');
  fs.writeFileSync(jobFile, JSON.stringify(job, null, 2));

  let render;
  if (remoteHost) {
    render = await composeRemote({ job, raw, workDir, notes });
  } else {
    const args = ['-b', '--factory-startup', '-noaudio', '-P', SCRIPT, '--', jobFile];
    const { out } = await sh(bin, args, { timeoutMs: 5 * 60000 });
    render = { output: out, command: `${bin} ${args.join(' ')}` };
  }
  if (!fs.existsSync(raw) || !(await probeDuration(raw))) throw new Error(`Blender produced no video: ${String(render.output).split('\n').slice(-5).join(' | ')}`);
  // Re-mux with the exact bed and +faststart so the file plays everywhere.
  await finalize(raw, outFile, { bed, copyVideo: true });
  return { file: outFile, durationSeconds: await probeDuration(outFile), notes, commands: [render.command] };
}

async function frameRate(file) {
  const { out } = await sh('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=avg_frame_rate', '-of', 'csv=p=0', file]);
  const [n, d] = out.trim().split('/').map(Number);
  return d ? Math.round((n / d) * 100) / 100 : null;
}
