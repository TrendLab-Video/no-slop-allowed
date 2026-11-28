import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { FFMPEG, probe, runCmd, tail } from './probe.ts'
import type { Probe } from './probe.ts'
import { stillFilter, stillInput } from './still.ts'
import { pickTextColour, renderCard } from './titles.ts'

export type Clip = { duration?: number; path: string; trimStart?: number }

export type EndCard = {
  accent?: string
  bg?: string
  fg?: string
  fontFile?: string
  imagePath?: string
  logoPath?: string
  seconds?: number
  subtext?: string
  text: string
}

export type Overlay = {
  endS: number
  fadeS?: number
  imagePath: string
  startS: number
}

export type Voice = { path: string; startAt?: number }

export type AssembleInput = {
  clips: Clip[]
  endCard?: EndCard
  fps?: number
  height?: number
  keepClipAudio?: boolean
  music?: { gainDb?: number; path: string }
  outPath: string
  overlays?: Overlay[]
  voice?: Voice | Voice[]
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
const CARD_BG = '#0E0E10'
const CARD_PUSH = 0.03
const FADE_DEFAULT_S = 0.15
const MUSIC_END_FADE_S = 0.06
const DUCK = 'threshold=0.0316:ratio=20:attack=5:release=350:makeup=1'
const LOUDNORM = 'I=-14:TP=-1.5:LRA=11'
const STEREO = 'aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo'
const NAMED: Record<string, string> = { black: '#000000', white: '#FFFFFF' }

function requireFile(kind: string, path: string) {
  if (!existsSync(path)) throw new Error(`assemble: ${kind} not found: ${path}`)
}

function asList(voice: AssembleInput['voice']): Voice[] {
  if (!voice) return []
  return Array.isArray(voice) ? voice : [voice]
}

function hexColour(
  value: string | undefined,
  fallback: string,
  notes: string[],
): string {
  if (value === undefined) return fallback
  const named = NAMED[value.toLowerCase()]
  if (named) return named
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) return value
  notes.push(`end card colour "${value}" is invalid, using ${fallback}`)
  return fallback
}

type CardPlan = { png: string; seconds: number }

async function planEndCard(
  card: EndCard,
  size: { h: number; w: number },
  workDir: string,
  notes: string[],
): Promise<CardPlan> {
  if (card.imagePath) requireFile('end card image', card.imagePath)
  if (card.logoPath) requireFile('end card logo', card.logoPath)
  if (card.fontFile) notes.push('end card fontFile ignored: Inter is bundled')
  const bg = hexColour(card.bg, CARD_BG, notes)
  const fg = hexColour(card.fg, pickTextColour(bg), notes)
  const png = join(workDir, 'card.png')
  await renderCard(
    {
      accent: card.accent,
      bg,
      fg,
      height: size.h,
      imagePath: card.imagePath,
      logoPath: card.logoPath,
      sub: card.subtext,
      title: card.text,
      width: size.w,
    },
    png,
  )
  return { png, seconds: card.seconds ?? 2 }
}

type Indices = {
  card: number
  music: number
  overlays: number[]
  voices: number[]
}

type AudioPlan = { graph: string[]; mixed: boolean }

function planAudio(
  input: AssembleInput,
  probes: Probe[],
  effective: number[],
  card: CardPlan | undefined,
  total: number,
  idx: Indices,
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

  const voices = asList(input.voice)
  voices.forEach((v, i) => {
    const delayMs = Math.round((v.startAt ?? 0) * 1000)
    const delay = delayMs > 0 ? `,adelay=${delayMs}:all=1` : ''
    g.push(
      `[${idx.voices[i]}:a]${STEREO}${delay},atrim=duration=${t},` +
        `asetpts=PTS-STARTPTS[vox${i}]`,
    )
  })
  const pad = `apad=whole_dur=${t},atrim=duration=${t}`
  if (voices.length === 1) {
    g.push(`[vox0]${pad}[vox]`)
  } else if (voices.length > 1) {
    const ins = voices.map((_, i) => `[vox${i}]`).join('')
    g.push(
      `${ins}amix=inputs=${voices.length}:duration=longest:normalize=0:` +
        `dropout_transition=0,${pad}[vox]`,
    )
  }

  if (input.music) {
    const gain = input.music.gainDb ?? -6
    const fade = Math.min(MUSIC_END_FADE_S, total)
    const fadeAt = Math.max(0, total - fade).toFixed(3)
    g.push(
      `[${idx.music}:a]${STEREO},atrim=duration=${t},asetpts=PTS-STARTPTS,` +
        `volume=${gain}dB,afade=t=out:st=${fadeAt}:d=${fade}[mus]`,
    )
    if (voices.length > 0) {
      g.push('[vox]asplit=2[voxk][voxm]')
      g.push(`[mus][voxk]sidechaincompress=${DUCK}[musd]`)
      mix.push('[musd]', '[voxm]')
    } else {
      mix.push('[mus]')
    }
  } else if (voices.length > 0) {
    mix.push('[vox]')
  }

  if (mix.length === 1) {
    g.push(`${mix[0]}anull[amix]`)
  } else if (mix.length > 1) {
    g.push(
      `${mix.join('')}amix=inputs=${mix.length}:duration=longest:` +
        'normalize=0:dropout_transition=0[amix]',
    )
  }
  return { graph: g, mixed: mix.length > 0 }
}

type Measured = Record<string, string>

function parseLoudnorm(stderr: string): Measured | undefined {
  const m = /\{[^{}]*"input_i"[^{}]*\}/.exec(stderr)
  if (!m) return undefined
  try {
    const data = JSON.parse(m[0]) as Measured
    return Number.isFinite(Number(data.input_i)) ? data : undefined
  } catch {
    return undefined
  }
}

function loudnormStage(measured: Measured | undefined): string {
  if (!measured) return `loudnorm=${LOUDNORM},aresample=48000`
  return (
    `loudnorm=${LOUDNORM}:measured_I=${measured.input_i}` +
    `:measured_TP=${measured.input_tp}:measured_LRA=${measured.input_lra}` +
    `:measured_thresh=${measured.input_thresh}` +
    `:offset=${measured.target_offset}:linear=true,aresample=48000`
  )
}

function planOverlays(
  overlays: Overlay[],
  idx: number[],
  size: { h: number; w: number },
  from: string,
): { graph: string[]; last: string } {
  const g: string[] = []
  let last = from
  overlays.forEach((o, k) => {
    const span = o.endS - o.startS
    const fade = Math.min(o.fadeS ?? FADE_DEFAULT_S, span / 2)
    const s = o.startS.toFixed(3)
    const e = o.endS.toFixed(3)
    const outAt = (o.endS - fade).toFixed(3)
    g.push(
      `[${idx[k]}:v]scale=${size.w}:${size.h},format=rgba,` +
        `fade=t=in:st=${s}:d=${fade}:alpha=1,` +
        `fade=t=out:st=${outAt}:d=${fade}:alpha=1[ov${k}]`,
    )
    g.push(
      `[${last}][ov${k}]overlay=enable='between(t,${s},${e})':` +
        `format=auto[vo${k}]`,
    )
    last = `vo${k}`
  })
  return { graph: g, last }
}

export async function assemble(
  input: AssembleInput,
): Promise<AssembleResult> {
  const t0 = performance.now()
  if (input.clips.length === 0) throw new Error('assemble: no clips given')
  for (const c of input.clips) requireFile('clip', c.path)
  if (input.music) requireFile('music', input.music.path)
  const voices = asList(input.voice)
  for (const v of voices) requireFile('voice', v.path)
  const overlays = input.overlays ?? []
  for (const o of overlays) {
    requireFile('overlay', o.imagePath)
    if (!(o.endS > o.startS)) {
      throw new Error(`assemble: overlay ends before it starts: ${o.imagePath}`)
    }
  }

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
      ? await planEndCard(input.endCard, { h, w }, workDir, notes)
      : undefined
    const total =
      effective.reduce((a, b) => a + b, 0) + (card?.seconds ?? 0)

    const inputs: string[] = []
    input.clips.forEach((c, i) => {
      if (c.trimStart) inputs.push('-ss', String(c.trimStart))
      inputs.push('-t', (effective[i] as number).toFixed(3), '-i', c.path)
    })
    const idx: Indices = { card: -1, music: -1, overlays: [], voices: [] }
    let next = input.clips.length
    if (input.music) {
      inputs.push('-stream_loop', '-1', '-i', input.music.path)
      idx.music = next++
    }
    for (const v of voices) {
      inputs.push('-i', v.path)
      idx.voices.push(next++)
    }
    for (const o of overlays) {
      inputs.push(...stillInput(o.imagePath, { fps, seconds: total }))
      idx.overlays.push(next++)
    }
    if (card) {
      inputs.push(...stillInput(card.png, { fps, seconds: card.seconds }))
      idx.card = next++
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
      const move = stillFilter({
        fps,
        height: h,
        move: 'push',
        seconds: card.seconds,
        width: w,
        zoom: CARD_PUSH,
      })
      g.push(`[${idx.card}:v]${move}[vend]`)
      vLabels.push('[vend]')
    }
    g.push(`${vLabels.join('')}concat=n=${vLabels.length}:v=1:a=0[vcat]`)
    const ov = planOverlays(overlays, idx.overlays, { h, w }, 'vcat')
    g.push(...ov.graph)
    g.push(`[${ov.last}]format=yuv420p[vout]`)

    const audio = planAudio(input, probes, effective, card, total, idx)
    const base = ['-y', '-hide_banner', '-nostdin', '-loglevel', 'error']
    let stage = loudnormStage(undefined)
    if (audio.mixed) {
      const probeRun = await runCmd(
        [
          FFMPEG,
          ...['-y', '-hide_banner', '-nostdin', '-loglevel', 'info'],
          ...inputs,
          ...[
            '-filter_complex',
            [
              ...audio.graph,
              `[amix]loudnorm=${LOUDNORM}:print_format=json[ln]`,
            ].join(';'),
          ],
          ...['-map', '[ln]', '-t', total.toFixed(3), '-f', 'null', '-'],
        ],
        FFMPEG_TIMEOUT_MS,
      )
      stage = loudnormStage(parseLoudnorm(probeRun.stderr))
      if (!parseLoudnorm(probeRun.stderr)) {
        notes.push('loudnorm measure failed, used single pass')
      }
      g.push(...audio.graph, `[amix]${stage}[aout]`)
    }

    const args: string[] = [
      ...base,
      ...inputs,
      ...['-filter_complex', g.join(';'), '-map', '[vout]'],
    ]
    if (audio.mixed) args.push('-map', '[aout]')
    args.push(
      ...['-c:v', 'libx264', '-crf', '18', '-preset', 'veryfast'],
      ...['-pix_fmt', 'yuv420p', '-r', String(fps)],
    )
    if (audio.mixed) args.push('-c:a', 'aac', '-b:a', '160k', '-ar', '48000')
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
