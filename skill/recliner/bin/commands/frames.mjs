import path from 'node:path';
import { extractFrames } from '../../lib/compositors/ffmpeg.mjs';
export const describe = 'frames <video> <outDir> [--count 6]: extract evenly spaced frames for validation';
export default async function ([video, outDir], flags) {
  if (!video || !outDir) throw new Error('usage: frames <video> <outDir> [--count 6]');
  const files = await extractFrames(path.resolve(video), path.resolve(outDir), parseInt(flags.count, 10) || 6);
  return { video, frames: files };
}
