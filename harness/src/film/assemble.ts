import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { FFMPEG, probe, runCmd, tail } from './probe.ts'
import type { Probe } from './probe.ts'

export type Clip = { duration?: number; path: string; trimStart?: number }

export type EndCard = {
  bg?: string
  fg?: string
  fontFile?: string
  seconds?: number
  subtext?: string
  text: string
}

export type AssembleInput = {
  clips: Clip[]
  endCard?: EndCard
  fps?: number
  height?: number
  keepClipAudio?: boolean
  music?: { gainDb?: number; path: string }
  outPath: string
  voice?: { path: string; startAt?: number }
  width?: number
}

export type AssembleResult = {
  ffmpegArgs: string[]
  ms: number
  notes: string[]
  outPath: string
  probe: Probe
}

const FFMPEG_TIMEOUT_MS = 180_000
const VOICE_DUCK_DB = 8
const SAFE_PATH = /^[A-Za-z0-9_./-]+$/
const SAFE_COLOUR = /^[#A-Za-z0-9@.]+$/
const STEREO = 'aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo'

const FONT_CANDIDATES = [
  '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
  '/System/Library/Fonts/Supplemental/Arial.ttf',
  '/System/Library/Fonts/Helvetica.ttc',
  '/Library/Fonts/Arial.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
  '/usr/share/fonts/liberation/LiberationSans-Regular.ttf',
  '/usr/share/fonts/TTF/DejaVuSans.ttf',
]

let drawtextCheck: Promise<boolean> | undefined

export function hasDrawtext(): Promise<boolean> {
  drawtextCheck ??= runCmd([FFMPEG, '-hide_banner', '-filters'], 30_000).then(
    (r) => /\sdrawtext\s/.test(r.stdout),
  )
  return drawtextCheck
}

function findFont(fontFile?: string): string | undefined {
  if (fontFile) return existsSync(fontFile) ? fontFile : undefined
  return FONT_CANDIDATES.find((p) => existsSync(p))
}

function wrap(text: string, maxChars: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > maxChars) {
      lines.push(line)
      line = word
    } else {
      line = line ? `${line} ${word}` : word
    }
  }
  if (line) lines.push(line)
  return lines
}

type CardPlan = { filter: string; seconds: number }

async function planEndCard(
  card: EndCard,
  size: { fps: number; h: number; w: number },
  workDir: string,
  notes: string[],
): Promise<CardPlan | undefined> {
  const { fps, h, w } = size
  if (!(await hasDrawtext())) {
    notes.push('end card skipped: this ffmpeg build has no drawtext filter')
    return undefined
  }
  const font = findFont(card.fontFile)
  if (!font) {
    const missing = card.fontFile ?? ''
    notes.push(`end card skipped: no usable font ${missing}`.trim())
    return undefined
  }
  if (!SAFE_PATH.test(workDir)) {
    notes.push('end card skipped: temp folder path has unsafe characters')
    return undefined
  }
  let fontPath = font
  if (!SAFE_PATH.test(font)) {
    fontPath = join(workDir, 'font.ttf')
    copyFileSync(font, fontPath)
  }
  const colour = (value: string | undefined, fallback: string) => {
    if (value === undefined) return fallback
    if (SAFE_COLOUR.test(value)) return value
    notes.push(`end card colour "${value}" is invalid, using ${fallback}`)
    return fallback
  }
  const bg = colour(card.bg, 'black')
  const fg = colour(card.fg, 'white')
  const seconds = card.seconds ?? 2
  const titleSize = Math.round(w / 11)
  const subSize = Math.round(titleSize / 2)
  const maxChars = (px: number) => Math.floor((w * 0.84) / (px * 0.55))
  const titleLines = wrap(card.text, maxChars(titleSize))
  const subLines = wrap(card.subtext ?? '', maxChars(subSize))
  const titleStep = Math.round(titleSize * 1.2)
  const subStep = Math.round(subSize * 1.3)
  const gap = subLines.length > 0 && titleLines.length > 0 ? subSize : 0
  const block = titleLines.length * titleStep + gap + subLines.length * subStep
  let y = Math.round((h - block) / 2)
  const rows = [
    ...titleLines.map((text) => ({ px: titleSize, step: titleStep, text })),
    ...subLines.map((text) => ({ px: subSize, step: subStep, text })),
  ]
  const draws: string[] = []
  for (const [i, row] of rows.entries()) {
    if (i === titleLines.length) y += gap
    const file = join(workDir, `line${i}.txt`)
    await writeFile(file, row.text)
    draws.push(
      `drawtext=fontfile=${fontPath}:textfile=${file}:fontsize=${row.px}` +
        `:fontcolor=${fg}:x=(w-text_w)/2:y=${y}`,
    )
    y += row.step
  }
  const base = `color=c=${bg}:s=${w}x${h}:r=${fps}:d=${seconds}`
  return {
    filter: [base, ...draws, 'setsar=1', 'format=yuv420p'].join(','),
    seconds,
  }
}

function requireFile(kind: string, path: string) {
  if (!existsSync(path)) throw new Error(`assemble: ${kind} not found: ${path}`)
}

type AudioPlan = { graph: string[]; mixed: boolean }

function planAudio(
  input: AssembleInput,
  probes: Probe[],
  effective: number[],
  card: CardPlan | undefined,
  total: number,
  idx: { music: number; voice: number },
): AudioPlan {
  const g: string[] = []
  const mix: string[] = []
  const t = total.toFixed(3)
  if (input.keepClipAudio && probes.some((p) => p.hasAudio)) {
    const labels: string[] = []
    input.clips.forEach((_, i) => {
      const d = (effective[i] as number).toFixed(3)
      const source = probes[i]?.hasAudio
        ? `[${i}:a]${STEREO},apad=whole_dur=${d}`
        : 'anullsrc=r=48000:cl=stereo'
      g.push(`${source},atrim=duration=${d},asetpts=PTS-STARTPTS[ca${i}]`)
      labels.push(`[ca${i}]`)
    })
    if (card) {
      g.push(
        `anullsrc=r=48000:cl=stereo,atrim=duration=${card.seconds},` +
          'asetpts=PTS-STARTPTS[caend]',
      )
      labels.push('[caend]')
    }
    g.push(`${labels.join('')}concat=n=${labels.length}:v=0:a=1[clipa]`)
    mix.push('[clipa]')
  }
  if (input.music) {
    const duck = input.voice ? VOICE_DUCK_DB : 0
    const gain = (input.music.gainDb ?? -6) - duck
    const fade = Math.min(1, total)
    const fadeAt = Math.max(0, total - fade).toFixed(3)
    g.push(
      `[${idx.music}:a]${STEREO},atrim=duration=${t},asetpts=PTS-STARTPTS,` +
        `volume=${gain}dB,afade=t=out:st=${fadeAt}:d=${fade}[mus]`,
    )
    mix.push('[mus]')
  }
  if (input.voice) {
    const delayMs = Math.round((input.voice.startAt ?? 0) * 1000)
    const delay = delayMs > 0 ? `,adelay=${delayMs}:all=1` : ''
    g.push(
      `[${idx.voice}:a]${STEREO}${delay},atrim=duration=${t},` +
        'asetpts=PTS-STARTPTS[vox]',
    )
    mix.push('[vox]')
  }
  if (mix.length === 1) {
    g.push(`${mix[0]}anull[aout]`)
  } else if (mix.length > 1) {
    g.push(
      `${mix.join('')}amix=inputs=${mix.length}:duration=longest:` +
        'normalize=0:dropout_transition=0[aout]',
    )
  }
  return { graph: g, mixed: mix.length > 0 }
}

export async function assemble(
  input: AssembleInput,
): Promise<AssembleResult> {
  const t0 = performance.now()
  if (input.clips.length === 0) throw new Error('assemble: no clips given')
  for (const c of input.clips) requireFile('clip', c.path)
  if (input.music) requireFile('music', input.music.path)
  if (input.voice) requireFile('voice', input.voice.path)

  const w = input.width ?? 1080
  const h = input.height ?? 1920
  const fps = input.fps ?? 30
  const notes: string[] = []

  const probes = await Promise.all(input.clips.map((c) => probe(c.path)))
  const effective = input.clips.map((c, i) => {
    const avail = (probes[i]?.durationS ?? 0) - (c.trimStart ?? 0)
    if (avail <= 0) {
      throw new Error(`assemble: trimStart is past the end of ${c.path}`)
    }
    return c.duration ? Math.min(c.duration, avail) : avail
  })

  const workDir = mkdtempSync(join(tmpdir(), 'film-card-'))
  try {
    const card = input.endCard
      ? await planEndCard(input.endCard, { fps, h, w }, workDir, notes)
      : undefined
    const total =
      effective.reduce((a, b) => a + b, 0) + (card?.seconds ?? 0)

    const args: string[] = ['-y', '-hide_banner', '-loglevel', 'error']
    args.push('-nostdin')
    input.clips.forEach((c, i) => {
      if (c.trimStart) args.push('-ss', String(c.trimStart))
      args.push('-t', (effective[i] as number).toFixed(3), '-i', c.path)
    })
    const idx = { music: -1, voice: -1 }
    let next = input.clips.length
    if (input.music) {
      args.push('-stream_loop', '-1', '-i', input.music.path)
      idx.music = next++
    }
    if (input.voice) {
      args.push('-i', input.voice.path)
      idx.voice = next++
    }

    const g: string[] = []
    const vLabels: string[] = []
    input.clips.forEach((_, i) => {
      g.push(
        `[${i}:v]setpts=PTS-STARTPTS,fps=${fps},` +
          `scale=${w}:${h}:force_original_aspect_ratio=increase,` +
          `crop=${w}:${h},setsar=1,format=yuv420p[v${i}]`,
      )
      vLabels.push(`[v${i}]`)
    })
    if (card) {
      g.push(`${card.filter}[vend]`)
      vLabels.push('[vend]')
    }
    g.push(`${vLabels.join('')}concat=n=${vLabels.length}:v=1:a=0[vout]`)
    const audio = planAudio(input, probes, effective, card, total, idx)
    g.push(...audio.graph)

    args.push('-filter_complex', g.join(';'), '-map', '[vout]')
    if (audio.mixed) args.push('-map', '[aout]')
    args.push(
      ...['-c:v', 'libx264', '-crf', '18', '-preset', 'veryfast'],
      ...['-pix_fmt', 'yuv420p', '-r', String(fps)],
    )
    if (audio.mixed) args.push('-c:a', 'aac', '-b:a', '160k')
    args.push('-movflags', '+faststart', '-t', total.toFixed(3))
    args.push(input.outPath)

    await mkdir(dirname(input.outPath), { recursive: true })
    const r = await runCmd([FFMPEG, ...args], FFMPEG_TIMEOUT_MS)
    if (r.timedOut) {
      const secs = FFMPEG_TIMEOUT_MS / 1000
      throw new Error(`ffmpeg timed out after ${secs}s:\n${tail(r.stderr)}`)
    }
    if (r.code !== 0) {
      throw new Error(`ffmpeg failed (exit ${r.code}):\n${tail(r.stderr)}`)
    }
    return {
      ffmpegArgs: args,
      ms: Math.max(1, Math.round(performance.now() - t0)),
      notes,
      outPath: input.outPath,
      probe: await probe(input.outPath),
    }
  } finally {
    rmSync(workDir, { force: true, recursive: true })
  }
}
