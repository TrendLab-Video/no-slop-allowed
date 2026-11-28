import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assemble, hasDrawtext } from '../src/film/assemble.ts'
import { download } from '../src/film/download.ts'
import { probe } from '../src/film/probe.ts'
import {
  StepRecorder,
  buildTrace,
  slugFromBriefPath,
  writeRunOutputs,
} from '../src/film/traces.ts'

const FFMPEG = Bun.which('ffmpeg') ?? '/opt/homebrew/bin/ffmpeg'

let dir = ''
const f = (name: string) => join(dir, name)
const clip = (name: string) => ({ path: f(name) })

function ffmpeg(...args: string[]) {
  const r = Bun.spawnSync([FFMPEG, '-y', '-loglevel', 'error', ...args])
  if (r.exitCode !== 0) throw new Error(r.stderr.toString())
}

function maxVolumeDb(path: string): number {
  const r = Bun.spawnSync([
    FFMPEG,
    ...['-i', path, '-af', 'volumedetect', '-vn', '-f', 'null', '-'],
  ])
  const m = /max_volume: (-?[\d.]+|-inf) dB/.exec(r.stderr.toString())
  if (!m?.[1]) throw new Error('no volumedetect output')
  return m[1] === '-inf' ? -Infinity : Number(m[1])
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'film-test-'))
  ffmpeg(
    ...['-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=25:duration=1'],
    ...['-pix_fmt', 'yuv420p', f('land.mp4')],
  )
  ffmpeg(
    ...['-f', 'lavfi', '-i', 'color=c=red:size=360x640:rate=24:duration=1'],
    ...['-f', 'lavfi', '-i', 'sine=frequency=330:duration=1'],
    ...['-c:a', 'aac', '-pix_fmt', 'yuv420p', f('port.mp4')],
  )
  ffmpeg(
    ...['-f', 'lavfi', '-i', 'testsrc2=size=480x480:rate=15:duration=0.8'],
    ...['-pix_fmt', 'yuv420p', f('square.mp4')],
  )
  ffmpeg(
    ...['-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.5'],
    f('music.wav'),
  )
  ffmpeg(
    ...['-f', 'lavfi', '-i', 'sine=frequency=880:duration=0.5'],
    f('voice.wav'),
  )
})

afterAll(async () => {
  await rm(dir, { force: true, recursive: true })
})

describe('probe', () => {
  test('reads duration, size, fps and audio presence', async () => {
    const p = await probe(f('land.mp4'))
    expect(p.width).toBe(640)
    expect(p.height).toBe(360)
    expect(p.fps).toBe(25)
    expect(p.hasAudio).toBe(false)
    expect(p.pixFmt).toBe('yuv420p')
    expect(Math.abs(p.durationS - 1)).toBeLessThan(0.1)
    expect((await probe(f('port.mp4'))).hasAudio).toBe(true)
  })

  test('a missing file throws with the path', async () => {
    await expect(probe(f('nope.mp4'))).rejects.toThrow('nope.mp4')
  })
})

describe('assemble', () => {
  test('mixed sizes and rates give one 1080x1920 30fps film', async () => {
    const r = await assemble({
      clips: [clip('land.mp4'), clip('port.mp4'), clip('square.mp4')],
      outPath: f('out/mixed.mp4'),
    })
    expect(r.outPath).toBe(f('out/mixed.mp4'))
    expect(r.probe.width).toBe(1080)
    expect(r.probe.height).toBe(1920)
    expect(r.probe.fps).toBe(30)
    expect(r.probe.pixFmt).toBe('yuv420p')
    expect(r.probe.hasAudio).toBe(false)
    expect(Math.abs(r.probe.durationS - 2.8)).toBeLessThan(0.25)
    expect(r.ffmpegArgs).toContain('libx264')
    expect(r.ms).toBeGreaterThan(0)
  })

  test('width, height and fps can be overridden', async () => {
    const r = await assemble({
      clips: [clip('land.mp4')],
      fps: 24,
      height: 640,
      outPath: f('out/small.mp4'),
      width: 360,
    })
    expect([r.probe.width, r.probe.height, r.probe.fps]).toEqual([
      360, 640, 24,
    ])
  })

  test('trimStart and duration cut a clip', async () => {
    const both = await assemble({
      clips: [{ duration: 0.5, path: f('land.mp4'), trimStart: 0.3 }],
      outPath: f('out/trim-both.mp4'),
    })
    expect(Math.abs(both.probe.durationS - 0.5)).toBeLessThan(0.15)
    const start = await assemble({
      clips: [{ path: f('land.mp4'), trimStart: 0.4 }],
      outPath: f('out/trim-start.mp4'),
    })
    expect(Math.abs(start.probe.durationS - 0.6)).toBeLessThan(0.15)
  })

  test('music adds audio and the film is not longer than video', async () => {
    const r = await assemble({
      clips: [clip('land.mp4'), clip('square.mp4')],
      music: { gainDb: -10, path: f('music.wav') },
      outPath: f('out/music.mp4'),
    })
    expect(r.probe.hasAudio).toBe(true)
    expect(Math.abs(r.probe.durationS - 1.8)).toBeLessThan(0.25)
  })

  test('voice with music plays and honours startAt', async () => {
    const r = await assemble({
      clips: [clip('land.mp4'), clip('square.mp4')],
      music: { path: f('music.wav') },
      outPath: f('out/voice.mp4'),
      voice: { path: f('voice.wav'), startAt: 0.7 },
    })
    expect(r.probe.hasAudio).toBe(true)
    expect(Math.abs(r.probe.durationS - 1.8)).toBeLessThan(0.25)
  })

  test('voice alone gives an audible audio stream', async () => {
    const r = await assemble({
      clips: [clip('land.mp4')],
      outPath: f('out/voice-only.mp4'),
      voice: { path: f('voice.wav') },
    })
    expect(r.probe.hasAudio).toBe(true)
    expect(maxVolumeDb(r.outPath)).toBeGreaterThan(-40)
  })

  test('clip audio is dropped unless keepClipAudio is set', async () => {
    const dropped = await assemble({
      clips: [clip('port.mp4')],
      outPath: f('out/dropped.mp4'),
    })
    expect(dropped.probe.hasAudio).toBe(false)
    const kept = await assemble({
      clips: [clip('land.mp4'), clip('port.mp4')],
      keepClipAudio: true,
      outPath: f('out/kept.mp4'),
    })
    expect(kept.probe.hasAudio).toBe(true)
    expect(Math.abs(kept.probe.durationS - 2)).toBeLessThan(0.25)
    expect(maxVolumeDb(kept.outPath)).toBeGreaterThan(-40)
  })

  test('the end card adds its seconds, or is skipped with a note', async () => {
    const r = await assemble({
      clips: [clip('land.mp4')],
      endCard: { seconds: 1, subtext: 'Just do it', text: 'Nike' },
      outPath: f('out/card.mp4'),
    })
    if (await hasDrawtext()) {
      expect(Math.abs(r.probe.durationS - 2)).toBeLessThan(0.25)
      expect(r.notes).toEqual([])
    } else {
      expect(Math.abs(r.probe.durationS - 1)).toBeLessThan(0.25)
      expect(r.notes.join(' ')).toContain('drawtext')
    }
  })

  test('a missing font file skips the card with a note', async () => {
    const r = await assemble({
      clips: [clip('land.mp4')],
      endCard: { fontFile: f('no-such.ttf'), text: 'Nike' },
      outPath: f('out/card-nofont.mp4'),
    })
    expect(Math.abs(r.probe.durationS - 1)).toBeLessThan(0.25)
    expect(r.notes.length).toBeGreaterThan(0)
  })

  test('zero clips throws', async () => {
    await expect(
      assemble({ clips: [], outPath: f('out/none.mp4') }),
    ).rejects.toThrow(/no clips/i)
  })

  test('a missing clip throws with the path in the message', async () => {
    await expect(
      assemble({ clips: [clip('ghost.mp4')], outPath: f('out/ghost.mp4') }),
    ).rejects.toThrow('ghost.mp4')
  })

  test('an unreadable clip throws', async () => {
    await writeFile(f('garbage.mp4'), 'not a video')
    await expect(
      assemble({ clips: [clip('garbage.mp4')], outPath: f('out/bad.mp4') }),
    ).rejects.toThrow(/garbage\.mp4/)
  })
})

describe('download', () => {
  let server: ReturnType<typeof Bun.serve>
  let flaky = 0
  const url = (p: string) => `http://127.0.0.1:${server.port}${p}`

  beforeAll(() => {
    server = Bun.serve({
      fetch: async (req) => {
        const p = new URL(req.url).pathname
        if (p === '/ok') return new Response('hello bytes')
        if (p === '/empty') return new Response('')
        if (p === '/flaky') {
          flaky++
          if (flaky <= 2) return new Response('no', { status: 500 })
          return new Response('finally')
        }
        if (p === '/slow') {
          await Bun.sleep(600)
          return new Response('late')
        }
        return new Response('gone', { status: 404 })
      },
      port: 0,
    })
  })

  afterAll(() => {
    server.stop(true)
  })

  test('streams to disk and creates parent folders', async () => {
    const dest = f('dl/deep/er/ok.bin')
    const r = await download(url('/ok'), dest)
    expect(r).toEqual({ bytes: 11, path: dest })
    expect(await readFile(dest, 'utf8')).toBe('hello bytes')
  })

  test('a non-2xx status throws and leaves no file', async () => {
    const dest = f('dl/missing.bin')
    await expect(
      download(url('/missing'), dest, { retries: 0 }),
    ).rejects.toThrow('404')
    expect(existsSync(dest)).toBe(false)
  })

  test('an empty body throws', async () => {
    await expect(
      download(url('/empty'), f('dl/empty.bin'), { retries: 0 }),
    ).rejects.toThrow(/empty/i)
  })

  test('retries twice by default', async () => {
    const r = await download(url('/flaky'), f('dl/flaky.bin'))
    expect(r.bytes).toBe(7)
    expect(flaky).toBe(3)
  })

  test('a slow server hits the timeout', async () => {
    await expect(
      download(url('/slow'), f('dl/slow.bin'), { retries: 0, timeoutMs: 100 }),
    ).rejects.toThrow()
  })
})

type Example = { steps: Record<string, unknown>[] } & Record<string, unknown>

async function example(): Promise<Example> {
  const file = Bun.file(new URL('../../traces.example.json', import.meta.url))
  return (await file.json()) as Example
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/

describe('traces', () => {
  test('buildTrace matches the example keys and merges extras', async () => {
    const ex = await example()
    const rec = new StepRecorder()
    const s = rec.start('plan', { inputs: { a: 1 }, model: 'm', prompt: 'p' })
    s.tool('t', { x: 1 }, { y: 2 })
    s.end({ out: 1 })
    rec.start('bare').end()
    const t = buildTrace({
      brief: 'briefs/01-ep-133.md',
      extra: { brief: 'hijack', cost_usd: 1.5, steps: [] },
      finishedAt: Date.UTC(2026, 10, 28, 14, 5, 48, 999),
      outputVideo: 'outputs/01-ep-133/final.mp4',
      startedAt: Date.UTC(2026, 10, 28, 14, 2, 11),
      steps: rec.steps(),
    })
    expect(Object.keys(t).sort()).toEqual(
      [...Object.keys(ex), 'cost_usd'].sort(),
    )
    expect(t.brief).toBe('briefs/01-ep-133.md')
    expect(t.steps).toHaveLength(2)
    expect(t.started_at).toBe('2026-11-28T14:02:11Z')
    expect(t.finished_at).toBe('2026-11-28T14:05:48Z')
    expect(t.started_at).toMatch(ISO)
    expect(t.finished_at).toMatch(ISO)
    const stepKeys = Object.keys(ex.steps[0] ?? {}).sort()
    for (const step of t.steps) {
      expect(Object.keys(step).sort()).toEqual(stepKeys)
    }
    for (const k of ['brief', 'output_video', 'started_at', 'finished_at']) {
      expect(typeof t[k]).toBe(typeof ex[k])
    }
  })

  test('step defaults match the example types', () => {
    const s = new StepRecorder().start('x').end()
    expect(s).toMatchObject({
      inputs: {},
      model: null,
      outputs: {},
      prompt: null,
      tool_calls: [],
    })
    expect(typeof s.duration_ms).toBe('number')
  })

  test('ids follow start order and duration is measured', async () => {
    const rec = new StepRecorder()
    const a = rec.start('a')
    const b = rec.start('b')
    await Bun.sleep(30)
    const ra = a.end()
    expect(ra.id).toBe('step-1')
    expect(b.end().id).toBe('step-2')
    expect(ra.duration_ms).toBeGreaterThanOrEqual(25)
    expect(ra.duration_ms).toBeLessThan(500)
    expect(rec.steps().map((s) => s.name)).toEqual(['a', 'b'])
  })

  test('an unended step is returned with its duration so far', async () => {
    const rec = new StepRecorder()
    rec.start('open')
    await Bun.sleep(20)
    const first = rec.steps()[0]
    expect(first?.duration_ms).toBeGreaterThanOrEqual(15)
    await Bun.sleep(20)
    expect(rec.steps()[0]?.duration_ms).toBeGreaterThan(first?.duration_ms ?? 0)
  })

  test('concurrent steps do not corrupt each other', async () => {
    const rec = new StepRecorder()
    const results = await Promise.all(
      Array.from({ length: 8 }, async (_, i) => {
        const h = rec.start(`s${i}`, { inputs: { i } })
        await Bun.sleep(((i * 7) % 5) * 5)
        h.tool('t', { i }, { r: i })
        await Bun.sleep(((i * 3) % 4) * 5)
        h.tool('u', { i }, { r: i * 2 })
        return h.end({ i })
      }),
    )
    results.forEach((r, i) => {
      expect(r.id).toBe(`step-${i + 1}`)
      expect(r.name).toBe(`s${i}`)
      expect(r.tool_calls).toHaveLength(2)
      for (const c of r.tool_calls) expect(c.arguments).toEqual({ i })
      expect(r.outputs).toEqual({ i })
    })
    expect(rec.steps()).toHaveLength(8)
  })

  test('slugFromBriefPath', () => {
    expect(slugFromBriefPath('briefs/01-ep-133.md')).toBe('01-ep-133')
    expect(slugFromBriefPath('/abs/briefs/nike.md')).toBe('nike')
    expect(slugFromBriefPath('briefs\\win dows.md')).toBe('win-dows')
    expect(slugFromBriefPath('../../etc/passwd')).toBe('passwd')
    const long = slugFromBriefPath(
      "Make a bold ad for Nike's new running shoe, aimed at Gen Z",
    )
    expect(long).toBe('make-a-bold-ad-for-nike-s-new-running-sh')
    expect(long).toMatch(/^[a-z0-9-]+$/)
    expect(slugFromBriefPath('')).toBe('brief')
    expect(slugFromBriefPath('///')).toBe('brief')
  })

  test('writeRunOutputs lays out final.mp4 and traces.json', async () => {
    const video = f('src-video.mp4')
    await writeFile(video, 'fake video bytes')
    const outputsDir = f('outputs')
    const trace = buildTrace({
      brief: 'briefs/x.md',
      finishedAt: 2000,
      outputVideo: 'ignored/by/writer.mp4',
      startedAt: 1000,
      steps: [],
    })
    const r = writeRunOutputs({
      outputsDir,
      slug: 'x',
      trace,
      videoPath: video,
    })
    expect(r.videoPath).toBe(join(outputsDir, 'x', 'final.mp4'))
    expect(r.tracePath).toBe(join(outputsDir, 'x', 'traces.json'))
    expect(await readFile(r.videoPath, 'utf8')).toBe('fake video bytes')
    const text = await readFile(r.tracePath, 'utf8')
    expect(text.endsWith('}\n')).toBe(true)
    expect(text.endsWith('\n\n')).toBe(false)
    expect(text).toContain('\n  "brief": "briefs/x.md"')
    const parsed = JSON.parse(text)
    expect(parsed.output_video).toBe('outputs/x/final.mp4')
    expect(parsed.steps).toEqual([])
  })

  test('writeRunOutputs tolerates the video already in place', async () => {
    const outputsDir = f('outputs2')
    await mkdir(join(outputsDir, 'y'), { recursive: true })
    const video = join(outputsDir, 'y', 'final.mp4')
    await writeFile(video, 'same file')
    const trace = buildTrace({
      brief: 'b',
      finishedAt: 2000,
      outputVideo: 'o',
      startedAt: 1000,
      steps: [],
    })
    const r = writeRunOutputs({
      outputsDir,
      slug: 'y',
      trace,
      videoPath: video,
    })
    expect(await readFile(r.videoPath, 'utf8')).toBe('same file')
  })
})
