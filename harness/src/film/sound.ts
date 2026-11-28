import { mkdir } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'

import { uploadBytes } from '../brand/rehost.ts'
import { config } from '../config.ts'
import { callFal, falLimit } from '../fal.ts'
import { AUDIO } from '../models.ts'
import type { Run } from '../trace.ts'
import { download } from './download.ts'
import { FFMPEG, probe, runCmd, tail } from './probe.ts'

export type ScriptLine = { shotId: string; text: string }
export type VoicedLine = ScriptLine & { durationS: number; path: string }
export type ShotPlan = { id: string; maxS: number; minS: number }
export type Timeline = {
  /** Shot ids whose line is longer than the shot may hold. */
  overlong?: string[]
  shots: { durationS: number; id: string; startS: number }[]
  totalS: number
  voice: { path: string; startAt: number }[]
}
export type MusicSection = {
  durationS: number
  label: string
  styles: string[]
}
export type MusicResult = {
  durationS: number
  path: string
  route: 'plan' | 'prompt'
}
export type Heard = { heard: string; line: ScriptLine; ok: boolean }
export type Word = {
  end: number
  start: number
  text: string
  type: string
}

const DEFAULT_VOICE = 'George'
const WORDS_PER_S = 2.6
const MIN_CHUNK_MS = 3000
const MAX_CHUNK_MS = 120_000
const PAD_LIMIT_S = 0.5
const LIFT_AT = 0.55
const NO_VOCALS = ['vocals', 'singing', 'speech', 'lyrics', 'spoken word']
const SILENCE =
  'silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.02'

const OPENING_STYLES = ['sparse intro', 'restrained']
const LIFT_STYLES = ['builds', 'fuller arrangement', 'rising energy']
const RESOLVE_STYLES = ['resolving final chord', 'ends cleanly']

function say(run: Run | undefined, message: string, data?: unknown): void {
  if (run) run.emit('final', message, data)
  else if (!process.env.QUIET) console.log(message)
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function safeName(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, '_')
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

async function ffmpeg(args: string[], what: string): Promise<void> {
  const r = await runCmd(
    [FFMPEG, '-y', '-hide_banner', '-loglevel', 'error', '-nostdin', ...args],
    120_000,
  )
  if (r.timedOut || r.code !== 0) {
    throw new Error(`${what}: ffmpeg failed\n${tail(r.stderr)}`)
  }
}

async function mockTone(
  path: string,
  seconds: number,
  hz: number,
  edgeS = 0,
): Promise<void> {
  const args = [
    ...['-f', 'lavfi', '-i'],
    `sine=frequency=${hz}:sample_rate=48000:duration=${seconds.toFixed(3)}`,
  ]
  if (edgeS > 0) {
    const ms = Math.round(edgeS * 1000)
    args.push('-af', `adelay=${ms}:all=1,apad=pad_dur=${edgeS}`)
  }
  await ffmpeg([...args, '-c:a', 'pcm_s16le', path], 'mock tone')
}

async function trimSilence(src: string, dest: string): Promise<void> {
  const chain = `${SILENCE},areverse,${SILENCE},areverse`
  await ffmpeg(
    ['-i', src, '-af', chain, '-ar', '48000', '-c:a', 'pcm_s16le', dest],
    'trim silence',
  )
}

function describeShape(timestamps: unknown): unknown {
  if (!Array.isArray(timestamps)) return { type: typeof timestamps }
  const first: unknown = timestamps[0]
  const keys =
    first && typeof first === 'object' ? Object.keys(first).sort() : []
  return { keys, length: timestamps.length, sample: first }
}

export async function voiceLines(
  lines: ScriptLine[],
  opts: { outDir: string; voice?: string },
  run?: Run,
): Promise<VoicedLine[]> {
  await mkdir(opts.outDir, { recursive: true })
  let shapeLogged = false

  async function voiceOne(line: ScriptLine): Promise<VoicedLine> {
    if (!line.text.trim()) throw new Error('empty line')
    const name = safeName(line.shotId)
    const trimmed = join(opts.outDir, `${name}.wav`)
    const raw = join(opts.outDir, `${name}.raw.mp3`)
    if (config.mock) {
      const secs = wordCount(line.text) / WORDS_PER_S
      const rawWav = join(opts.outDir, `${name}.raw.wav`)
      await mockTone(rawWav, secs, 220, 0.2)
      await trimSilence(rawWav, trimmed)
    } else {
      const res = await callFal(
        AUDIO.tts.endpoint,
        {
          language_code: 'en',
          text: line.text,
          timestamps: true,
          voice: opts.voice ?? DEFAULT_VOICE,
        },
        { timeoutMs: 120_000 },
      )
      const url = res.data?.audio?.url
      if (!url) throw new Error('tts returned no audio url')
      const usd = (line.text.length / 1000) * AUDIO.tts.usdPer1kChars
      run?.addSpend(usd)
      say(run, `voice ${line.shotId}: ${res.ms}ms $${usd.toFixed(4)}`, {
        ms: res.ms,
        usd,
      })
      if (!shapeLogged && res.data?.timestamps !== undefined) {
        shapeLogged = true
        say(run, 'tts timestamps shape', describeShape(res.data.timestamps))
      }
      await download(url, raw)
      await trimSilence(raw, trimmed)
    }
    const durationS = (await probe(trimmed)).durationS
    if (durationS <= 0.05) throw new Error('voice is silent after trim')
    return { ...line, durationS, path: trimmed }
  }

  const done = await Promise.all(
    lines.map(async (line) => {
      try {
        return await voiceOne(line)
      } catch (err) {
        say(run, `voice failed for ${line.shotId}: ${errText(err)}`)
        return undefined
      }
    }),
  )
  return done.filter((v): v is VoicedLine => v !== undefined)
}

export function planTimeline(
  shots: ShotPlan[],
  voiced: VoicedLine[],
  opts: { leadS?: number; padS?: number } = {},
): Timeline {
  const lead = opts.leadS ?? 0.25
  const pad = opts.padS ?? 0.5
  const byShot = new Map(voiced.map((v) => [v.shotId, v]))
  const out: Timeline = { overlong: [], shots: [], totalS: 0, voice: [] }
  let at = 0
  for (const shot of shots) {
    const line = byShot.get(shot.id)
    let durationS = shot.minS
    if (line) {
      const want = Math.max(shot.minS, lead + line.durationS + pad)
      durationS = Math.min(want, shot.maxS)
      if (lead + line.durationS > shot.maxS) out.overlong?.push(shot.id)
      out.voice.push({ path: line.path, startAt: at + lead })
    }
    out.shots.push({ durationS, id: shot.id, startS: at })
    at += durationS
  }
  out.totalS = at
  return out
}

type Part = { label: string; ms: number; styles: string[] }

function mergeShortParts(parts: Part[]): Part[] {
  const list = [...parts]
  for (;;) {
    let shortest = -1
    list.forEach((p, i) => {
      const best = shortest < 0 ? undefined : list[shortest]
      if (p.ms < MIN_CHUNK_MS && (!best || p.ms < best.ms)) shortest = i
    })
    if (shortest < 0 || list.length < 2) return list
    const prev = list[shortest - 1]
    const next = list[shortest + 1]
    let into = shortest + 1
    if (!next || (prev && prev.ms <= next.ms)) into = shortest - 1
    const low = Math.min(into, shortest)
    const a = list[low] as Part
    const b = list[low + 1] as Part
    list.splice(low, 2, {
      label: a.label,
      ms: a.ms + b.ms,
      styles: [...new Set([...a.styles, ...b.styles])],
    })
  }
}

export function musicSections(
  timeline: Timeline,
  mood: { endS: number; styles: string[] },
): MusicSection[] {
  const bodyMs = Math.round(timeline.totalS * 1000)
  const endMs = Math.round(mood.endS * 1000)
  const cuts = timeline.shots.slice(1).map((s) => Math.round(s.startS * 1000))
  const target = bodyMs * LIFT_AT
  const lift = cuts.reduce<number | undefined>(
    (best, c) =>
      best === undefined || Math.abs(c - target) < Math.abs(best - target)
        ? c
        : best,
    undefined,
  )
  const parts: Part[] = []
  const base = mood.styles
  if (lift === undefined) {
    parts.push({ label: 'Opening', ms: bodyMs, styles: base })
  } else {
    parts.push({
      label: 'Opening',
      ms: lift,
      styles: [...base, ...OPENING_STYLES],
    })
    parts.push({
      label: 'Lift',
      ms: bodyMs - lift,
      styles: [...base, ...LIFT_STYLES],
    })
  }
  if (endMs > 0) {
    parts.push({
      label: 'Resolve',
      ms: endMs,
      styles: [...base, ...RESOLVE_STYLES],
    })
  }
  return mergeShortParts(parts.filter((p) => p.ms > 0)).map((p) => ({
    durationS: p.ms / 1000,
    label: p.label,
    styles: p.styles,
  }))
}

function chunksFor(sections: MusicSection[]) {
  return sections.flatMap((s) => {
    const ms = Math.round(s.durationS * 1000)
    const n = Math.ceil(ms / MAX_CHUNK_MS)
    const each = Math.floor(ms / n)
    return Array.from({ length: n }, (_, i) => ({
      context_adherence: 'medium',
      duration_ms: i === n - 1 ? ms - each * (n - 1) : each,
      negative_styles: NO_VOCALS,
      positive_styles: [...s.styles, 'instrumental'],
      text: `[${s.label}]`,
    }))
  })
}

function clock(seconds: number): string {
  const whole = Math.round(seconds)
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

function promptFor(sections: MusicSection[]): string {
  let at = 0
  const parts = sections.map((s) => {
    const from = at
    at += s.durationS
    const styles = s.styles.join(', ')
    return `${clock(from)} to ${clock(at)} ${s.label}: ${styles}`
  })
  return (
    'Instrumental film score, no vocals, no singing, no speech. ' +
    `Sections: ${parts.join('; ')}.`
  )
}

export async function fitAudio(
  src: string,
  dest: string,
  totalS: number,
): Promise<{ durationS: number; shortByS: number }> {
  const before = (await probe(src)).durationS
  const t = totalS.toFixed(3)
  await ffmpeg(
    [
      ...['-i', src, '-af', `apad=whole_dur=${t},atrim=duration=${t}`],
      ...['-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', dest],
    ],
    'fit audio',
  )
  return {
    durationS: (await probe(dest)).durationS,
    shortByS: Math.max(0, totalS - before),
  }
}

export async function makeMusic(
  args: { outDir: string; sections: MusicSection[] },
  run?: Run,
): Promise<MusicResult> {
  const { outDir, sections } = args
  await mkdir(outDir, { recursive: true })
  const lengths = sections.map((s) => Math.round(s.durationS * 1000))
  const totalMs = lengths.reduce((a, b) => a + b, 0)
  const totalS = totalMs / 1000
  const raw = join(outDir, config.mock ? 'music.raw.wav' : 'music.raw.mp3')
  const dest = join(outDir, 'music.wav')

  async function generate(route: 'plan' | 'prompt'): Promise<number> {
    if (config.mock) {
      await mockTone(raw, totalS, 330)
      return totalS
    }
    const input =
      route === 'plan'
        ? { composition_plan: { chunks: chunksFor(sections) } }
        : {
            force_instrumental: true,
            music_length_ms: Math.min(600_000, Math.max(3000, totalMs)),
            prompt: promptFor(sections),
          }
    const res = await callFal(AUDIO.music.endpoint, input, {
      startTimeoutS: 180,
      timeoutMs: 180_000,
    })
    const url = res.data?.audio?.url
    if (!url) throw new Error('music returned no audio url')
    await download(url, raw, { timeoutMs: 90_000 })
    const got = (await probe(raw)).durationS
    const usd = Math.ceil(got / 60) * AUDIO.music.usdPerMinute
    run?.addSpend(usd)
    say(run, `music ${route}: ${res.ms}ms ${got.toFixed(2)}s $${usd}`, {
      ms: res.ms,
      usd,
    })
    return got
  }

  let lastErr: unknown
  for (const route of ['plan', 'prompt'] as const) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const got = await generate(route)
        if (totalS - got >= PAD_LIMIT_S && attempt === 1) {
          say(run, `music ${route} ${got.toFixed(2)}s is short, retrying`)
          continue
        }
        const fit = await fitAudio(raw, dest, totalS)
        return { durationS: fit.durationS, path: dest, route }
      } catch (err) {
        lastErr = err
        say(run, `music ${route} attempt ${attempt} failed: ${errText(err)}`)
        break
      }
    }
  }
  throw new Error(`music failed on both routes: ${errText(lastErr)}`)
}

export async function makeFoley(
  clipPath: string,
  prompt: string,
  outDir: string,
  run?: Run,
): Promise<{ durationS: number; path: string } | null> {
  try {
    await mkdir(outDir, { recursive: true })
    const stem = safeName(basename(clipPath, extname(clipPath)))
    const dest = join(outDir, `${stem}.foley.wav`)
    const clipS = (await probe(clipPath)).durationS
    if (config.mock) {
      await mockTone(dest, clipS, 440)
    } else {
      const bytes = new Uint8Array(await Bun.file(clipPath).arrayBuffer())
      const videoUrl = await falLimit(() => uploadBytes(bytes, 'video/mp4'))
      const res = await callFal(
        AUDIO.sfx.endpoint,
        {
          duration: Math.max(1, Math.round(clipS * 10) / 10),
          num_samples: 1,
          text_prompt: prompt,
          video_url: videoUrl,
        },
        { timeoutMs: 120_000 },
      )
      const url = res.data?.audio?.[0]?.url
      if (!url) throw new Error('sfx returned no audio url')
      const usd = clipS * AUDIO.sfx.usdPerSecond
      run?.addSpend(usd)
      say(run, `foley ${stem}: ${res.ms}ms $${usd.toFixed(3)}`, {
        ms: res.ms,
        usd,
      })
      await download(url, dest)
    }
    return { durationS: (await probe(dest)).durationS, path: dest }
  } catch (err) {
    say(run, `foley failed for ${clipPath}: ${errText(err)}`)
    return null
  }
}

const ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight',
  'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen',
  'sixteen', 'seventeen', 'eighteen', 'nineteen',
]
const TENS = [
  '', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty',
  'ninety',
]

function numberWords(word: string): string[] {
  if (!/^\d{1,2}$/.test(word)) return [word]
  const n = Number(word)
  if (n < 20) return [ONES[n] as string]
  const tens = TENS[Math.floor(n / 10)] as string
  return n % 10 === 0 ? [tens] : [tens, ONES[n % 10] as string]
}

export function normaliseWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/['’]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter(Boolean)
    .flatMap(numberWords)
}

function withinOneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  const restA = a.slice(i + (a.length >= b.length ? 1 : 0))
  const restB = b.slice(i + (b.length >= a.length ? 1 : 0))
  return restA === restB
}

export function sameWord(a: string, b: string): boolean {
  if (a === b) return true
  return Math.min(a.length, b.length) >= 6 && withinOneEdit(a, b)
}

export function sameWords(script: string, heard: string): boolean {
  const a = normaliseWords(script)
  const b = normaliseWords(heard)
  return a.length === b.length && a.every((w, i) => sameWord(w, b[i] ?? ''))
}

const MIME: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.wav': 'audio/wav',
}

export async function transcribe(path: string, run?: Run): Promise<Word[]> {
  if (config.mock) return []
  const bytes = new Uint8Array(await Bun.file(path).arrayBuffer())
  const type = MIME[extname(path).toLowerCase()] ?? 'audio/mpeg'
  const audioUrl = await falLimit(() => uploadBytes(bytes, type))
  const minutes = (await probe(path)).durationS / 60
  const res = await callFal(
    AUDIO.stt.endpoint,
    { audio_url: audioUrl, diarize: false, language_code: 'eng' },
    { timeoutMs: 120_000 },
  )
  const usd = minutes * AUDIO.stt.usdPerMinute
  run?.addSpend(usd)
  say(run, `transcribe ${basename(path)}: ${res.ms}ms $${usd.toFixed(4)}`, {
    ms: res.ms,
    usd,
  })
  const words: unknown = res.data?.words
  if (!Array.isArray(words)) return []
  return words.map((w) => ({
    end: Number(w?.end) || 0,
    start: Number(w?.start) || 0,
    text: String(w?.text ?? ''),
    type: String(w?.type ?? ''),
  }))
}

export async function checkVoice(
  voiced: VoicedLine[],
  run?: Run,
): Promise<Heard[]> {
  return Promise.all(
    voiced.map(async (v) => {
      const line = { shotId: v.shotId, text: v.text }
      if (config.mock) return { heard: v.text, line, ok: true }
      try {
        const words = await transcribe(v.path, run)
        const heard = words
          .filter((w) => w.type === 'word')
          .map((w) => w.text)
          .join(' ')
        return { heard, line, ok: sameWords(v.text, heard) }
      } catch (err) {
        say(run, `check failed for ${v.shotId}: ${errText(err)}`)
        return { heard: '', line, ok: false }
      }
    }),
  )
}
