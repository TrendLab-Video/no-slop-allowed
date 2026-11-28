import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

import { FFMPEG, runCmd, tail } from './probe.ts'

export type StillMove = 'left' | 'pull' | 'push' | 'right'

export type StillOpts = {
  fps?: number
  height?: number
  move?: StillMove
  seconds: number
  width?: number
  zoom?: number
}

const TIMEOUT_MS = 120_000
const OVERSAMPLE = 1

export function stillInput(
  imagePath: string,
  opts: { fps: number; seconds: number },
): string[] {
  return [
    ...['-loop', '1', '-framerate', String(opts.fps)],
    ...['-t', String(opts.seconds), '-i', imagePath],
  ]
}

// perspective takes fractional corner coordinates, so the move is
// sub-pixel smooth; zoompan and crop round to whole pixels and judder.
export function stillFilter(opts: Required<StillOpts>): string {
  const { fps, height, move, seconds, width, zoom } = opts
  const frames = Math.max(2, Math.round(seconds * fps))
  const p = `min(1,on/${frames - 1})`
  const win = {
    left: `${1 / (1 + zoom)}`,
    pull: `(1/(${1 + zoom}-${zoom}*${p}))`,
    push: `(1/(1+${zoom}*${p}))`,
    right: `${1 / (1 + zoom)}`,
  }[move]
  const lead = {
    left: `(1-${win})*(1-${p})`,
    pull: `(1-${win})/2`,
    push: `(1-${win})/2`,
    right: `(1-${win})*${p}`,
  }[move]
  const top = `(1-${win})/2`
  const x = (f: string) => `W*(${lead}+${win}*${f})`
  const y = (f: string) => `H*(${top}+${win}*${f})`
  const big = `${width * OVERSAMPLE}:${height * OVERSAMPLE}`
  const corners = [
    `x0='${x('0')}':y0='${y('0')}'`,
    `x1='${x('1')}':y1='${y('0')}'`,
    `x2='${x('0')}':y2='${y('1')}'`,
    `x3='${x('1')}':y3='${y('1')}'`,
  ].join(':')
  return [
    `scale=${big}:force_original_aspect_ratio=increase:flags=lanczos`,
    `crop=${big}`,
    'setsar=1',
    `perspective=${corners}:eval=frame:interpolation=cubic`,
    `scale=${width}:${height}:flags=area`,
    'format=yuv420p',
  ].join(',')
}

export async function stillToClip(
  imagePath: string,
  outPath: string,
  opts: StillOpts,
): Promise<string> {
  if (!existsSync(imagePath)) {
    throw new Error(`still: image not found: ${imagePath}`)
  }
  const full: Required<StillOpts> = {
    fps: opts.fps ?? 30,
    height: opts.height ?? 1920,
    move: opts.move ?? 'push',
    seconds: opts.seconds,
    width: opts.width ?? 1080,
    zoom: opts.zoom ?? 0.08,
  }
  if (!(full.seconds > 0)) throw new Error('still: seconds must be positive')
  await mkdir(dirname(outPath), { recursive: true })
  const r = await runCmd(
    [
      FFMPEG,
      ...['-y', '-hide_banner', '-loglevel', 'error', '-nostdin'],
      ...stillInput(imagePath, full),
      ...['-vf', stillFilter(full)],
      ...['-c:v', 'libx264', '-crf', '14', '-preset', 'veryfast'],
      ...['-pix_fmt', 'yuv420p', '-r', String(full.fps)],
      ...['-movflags', '+faststart', outPath],
    ],
    TIMEOUT_MS,
  )
  if (r.timedOut) throw new Error(`still: ffmpeg timed out for ${imagePath}`)
  if (r.code !== 0) {
    throw new Error(`still: ffmpeg failed (exit ${r.code}):\n${tail(r.stderr)}`)
  }
  return outPath
}
