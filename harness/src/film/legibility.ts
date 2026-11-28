import { extname } from 'node:path'

import { FFMPEG, probe, tail } from './probe.ts'
import { layoutSuper } from './titles.ts'
import type { Rect, SuperOpts } from './titles.ts'

export type Frames = { frames: Uint8Array[]; h: number; w: number }

export type ZoneStats = {
  busyness: number
  meanL: number
  p5: number
  p95: number
}

export type Position = 'centre' | 'lower' | 'upper'

export type SuperPlan = {
  busyness: number
  contrast: number
  fg: string
  plate: 'box' | 'none' | 'scrim'
  plateOpacity: number
  position: Position
  reason: string
}

export type PlanOpts = {
  clipPath?: string
  endS?: number
  height: number
  imagePath?: string
  prefer?: Position
  startS?: number
  width: number
}

export const MIN_CONTRAST = 4.5
export const BUSYNESS_MAX = 5
const SCRIM_STEPS = [0.35, 0.45, 0.55, 0.65, 0.75]
const BOX_OPACITY = 0.85
const MOVE_GAIN = 0.7
const EDGE_Q = 0.02
const SAMPLE_W = 270
const IMAGE_EXT = new Set(['.gif', '.jpeg', '.jpg', '.png', '.webp'])
const WHITE = '#FFFFFF'
const NEAR_BLACK = '#111111'
const ZONES: Position[] = ['upper', 'centre', 'lower']

const LUM = Float64Array.from({ length: 256 }, (_, v) => {
  const s = v / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
})
const NEAR_BLACK_L = LUM[0x11] as number

type Px = [number, number, number]

const byte = (frame: Uint8Array, i: number) => frame[i] as number

function relLum([r, g, b]: Px): number {
  return (
    0.2126 * (LUM[r] as number) +
    0.7152 * (LUM[g] as number) +
    0.0722 * (LUM[b] as number)
  )
}

function pixel(frame: Uint8Array, w: number, x: number, y: number): Px {
  const i = (y * w + x) * 3
  return [byte(frame, i), byte(frame, i + 1), byte(frame, i + 2)]
}

async function grab(
  args: string[],
  size: { h: number; w: number },
): Promise<Uint8Array> {
  const proc = Bun.spawn([FFMPEG, '-v', 'error', '-nostdin', ...args], {
    stderr: 'pipe',
    stdin: 'ignore',
    stdout: 'pipe',
  })
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).arrayBuffer(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (code !== 0 || out.byteLength !== size.w * size.h * 3) {
    throw new Error(`legibility: frame grab failed:\n${tail(err)}`)
  }
  return new Uint8Array(out)
}

export async function sampleFrames(
  path: string,
  span: { endS?: number; startS?: number } = {},
  size: { h: number; w: number } = { h: 480, w: SAMPLE_W },
): Promise<Frames> {
  const { h, w } = size
  const fit = `scale=${w}:${h}:force_original_aspect_ratio=increase`
  const one = ['-frames:v', '1', '-vf', `${fit},crop=${w}:${h}`]
  const raw = ['-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']
  if (IMAGE_EXT.has(extname(path).toLowerCase())) {
    return { frames: [await grab(['-i', path, ...one, ...raw], size)], h, w }
  }
  const dur = (await probe(path)).durationS
  const start = Math.max(0, span.startS ?? 0)
  const end = Math.max(start, Math.min(span.endS ?? dur, dur) - 0.05)
  const times = [start, (start + end) / 2, end]
  const frames = await Promise.all(
    times.map((t) =>
      grab(['-ss', t.toFixed(3), '-i', path, ...one, ...raw], size),
    ),
  )
  return { frames, h, w }
}

function clampRect(rect: Rect, w: number, h: number): Rect {
  const x = Math.max(0, Math.floor(rect.x))
  const y = Math.max(0, Math.floor(rect.y))
  const x1 = Math.min(w, Math.ceil(rect.x + rect.w))
  const y1 = Math.min(h, Math.ceil(rect.y + rect.h))
  return { h: Math.max(1, y1 - y), w: Math.max(1, x1 - x), x, y }
}

function percentile(sorted: number[], q: number): number {
  const i = Math.min(sorted.length - 1, Math.floor(q * sorted.length))
  return sorted[i] as number
}

const encodedLuma = ([r, g, b]: Px) => 0.2126 * r + 0.7152 * g + 0.0722 * b

function zoneOf(frame: Uint8Array, w: number, rect: Rect) {
  const lum: number[] = []
  let grad = 0
  let n = 0
  const x1 = rect.x + rect.w
  const y1 = rect.y + rect.h
  for (let y = rect.y; y < y1; y++) {
    for (let x = rect.x; x < x1; x++) {
      const here = pixel(frame, w, x, y)
      lum.push(relLum(here))
      if (x + 1 >= x1 || y + 1 >= y1) continue
      const l = encodedLuma(here)
      const dx = Math.abs(encodedLuma(pixel(frame, w, x + 1, y)) - l)
      const dy = Math.abs(encodedLuma(pixel(frame, w, x, y + 1)) - l)
      grad += (dx + dy) / 2
      n++
    }
  }
  lum.sort((a, b) => a - b)
  return {
    busyness: n ? grad / n : 0,
    meanL: lum.reduce((a, b) => a + b, 0) / lum.length,
    p5: percentile(lum, 0.05),
    p95: percentile(lum, 0.95),
  }
}

export function measureZone(frames: Frames, rect: Rect): ZoneStats {
  const r = clampRect(rect, frames.w, frames.h)
  const per = frames.frames.map((f) => zoneOf(f, frames.w, r))
  return {
    busyness: Math.max(...per.map((z) => z.busyness)),
    meanL: per.reduce((a, z) => a + z.meanL, 0) / per.length,
    p5: Math.min(...per.map((z) => z.p5)),
    p95: Math.max(...per.map((z) => z.p95)),
  }
}

type Plate = { colour: number; opacity: number }

function blend(px: Px, plate?: Plate): Px {
  if (!plate) return px
  const mix = (v: number) =>
    Math.round(v * (1 - plate.opacity) + plate.colour * plate.opacity)
  return [mix(px[0]), mix(px[1]), mix(px[2])]
}

function worstContrast(
  frames: Frames,
  rect: Rect,
  fg: string,
  plate?: Plate,
): number {
  const r = clampRect(rect, frames.w, frames.h)
  const light = fg === WHITE
  let worst = Infinity
  for (const frame of frames.frames) {
    const lum: number[] = []
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        lum.push(relLum(blend(pixel(frame, frames.w, x, y), plate)))
      }
    }
    lum.sort((a, b) => a - b)
    const bad = light ? percentile(lum, 1 - EDGE_Q) : percentile(lum, EDGE_Q)
    const ratio = light
      ? 1.05 / (bad + 0.05)
      : (bad + 0.05) / (NEAR_BLACK_L + 0.05)
    worst = Math.min(worst, ratio)
  }
  return worst
}

type ZoneInfo = {
  position: Position
  rect: Rect
  stats: ZoneStats
}

async function inspectZone(
  text: string,
  position: Position,
  opts: PlanOpts,
  frames: Frames,
): Promise<ZoneInfo> {
  const layout = await layoutSuper(text, {
    height: opts.height,
    position,
    width: opts.width,
  })
  const k = frames.w / opts.width
  const pad = layout.fontSize * 0.3
  const rect = {
    h: (layout.rect.h + 2 * pad) * k,
    w: (layout.rect.w + 2 * pad) * k,
    x: (layout.rect.x - pad) * k,
    y: (layout.rect.y - pad) * k,
  }
  return { position, rect, stats: measureZone(frames, rect) }
}

const round2 = (v: number) => Math.round(v * 100) / 100

export async function planSuper(
  text: string,
  opts: PlanOpts,
): Promise<SuperPlan> {
  const source = opts.clipPath ?? opts.imagePath
  if (!source) throw new Error('legibility: give clipPath or imagePath')
  const size = {
    h: Math.round((SAMPLE_W * opts.height) / opts.width / 2) * 2,
    w: SAMPLE_W,
  }
  const frames = await sampleFrames(source, opts, size)
  const zones = await Promise.all(
    ZONES.map((z) => inspectZone(text, z, opts, frames)),
  )
  const prefer = opts.prefer ?? 'lower'
  let zone = zones.find((z) => z.position === prefer) as ZoneInfo
  const notes: string[] = []
  const calmer = zones
    .filter(
      (z) =>
        z.position !== prefer &&
        z.stats.busyness < zone.stats.busyness * MOVE_GAIN,
    )
    .sort((a, b) => a.stats.busyness - b.stats.busyness)[0]
  if (calmer) {
    notes.push(
      `${prefer} busyness ${zone.stats.busyness.toFixed(1)}, ` +
        `${calmer.position} ${calmer.stats.busyness.toFixed(1)}: moved`,
    )
    zone = calmer
  }

  const onWhite = worstContrast(frames, zone.rect, WHITE)
  const onDark = worstContrast(frames, zone.rect, NEAR_BLACK)
  const fg = onWhite >= onDark ? WHITE : NEAR_BLACK
  const bare = Math.max(onWhite, onDark)
  const busyness = zone.stats.busyness
  const name = fg === WHITE ? 'white' : 'dark'
  const plan = (
    plate: SuperPlan['plate'],
    plateOpacity: number,
    contrast: number,
    why: string,
  ): SuperPlan => ({
    busyness: round2(busyness),
    contrast: round2(contrast),
    fg,
    plate,
    plateOpacity,
    position: zone.position,
    reason: [...notes, why].join('; '),
  })

  if (bare >= MIN_CONTRAST && busyness <= BUSYNESS_MAX) {
    return plan('none', 0, bare, `${name} text ${bare.toFixed(1)}:1, calm`)
  }
  const colour = fg === WHITE ? 0 : 255
  for (const opacity of SCRIM_STEPS) {
    const c = worstContrast(frames, zone.rect, fg, { colour, opacity })
    if (c >= MIN_CONTRAST) {
      return plan('scrim', opacity, c, `${name} text, scrim ${opacity}`)
    }
  }
  const opacity = BOX_OPACITY
  const boxed = worstContrast(frames, zone.rect, fg, { colour, opacity })
  return plan('box', opacity, boxed, `${name} text, scrims too weak: box`)
}

export function planToOpts(
  plan: SuperPlan,
  size: { height: number; width: number },
): SuperOpts {
  return {
    fg: plan.fg,
    height: size.height,
    plate: plan.plate,
    plateOpacity: plan.plateOpacity,
    position: plan.position,
    width: size.width,
  }
}
