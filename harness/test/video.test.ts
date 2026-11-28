import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { config, defaultOptions, sanitiseOptions } from '../src/config.ts'
import { runHarness } from '../src/harness/loop.ts'
import { fitShots } from '../src/harness/video.ts'
import { clip, SPECS } from '../src/models.ts'
import { briefSlug } from '../src/outputs.ts'
import { Run } from '../src/trace.ts'

const withEnv = async (vars: Record<string, string>, fn: () => Promise<void>) => {
  Object.assign(process.env, vars)
  try {
    await fn()
  } finally {
    for (const k of Object.keys(vars)) delete process.env[k]
  }
}
// Small runs: the video stage is what's under test here.
const small = { ...defaultOptions, concepts: 2, finalists: 1, maxIters: 1 }
const videos = (run: Run) => run.state.renders.filter((r) => r.kind === 'video')

describe('fitShots', () => {
  test('sums exactly to the requested length, whole seconds, at least 1 each', () => {
    const shots = fitShots([{ prompt: 'a', seconds: 2.6 }, { prompt: 'b', seconds: 2.6 }, { prompt: 'c', seconds: 7 }], 8)
    expect(shots.reduce((a, s) => a + s.seconds, 0)).toBe(8)
    expect(shots.every((s) => Number.isInteger(s.seconds) && s.seconds >= 1)).toBe(true)
  })
  test('drops empty shots, keeps at most 3, and never more shots than seconds', () => {
    expect(fitShots([{ prompt: '', seconds: 3 }, { prompt: 'a', seconds: 3 }], 8)).toHaveLength(1)
    expect(fitShots(Array.from({ length: 4 }, (_, i) => ({ prompt: `s${i}`, seconds: 2 })), 10)).toHaveLength(3)
    const tight = fitShots(Array.from({ length: 4 }, (_, i) => ({ prompt: `s${i}`, seconds: 5 })), 3)
    expect(tight).toHaveLength(3)
    expect(tight.every((s) => s.seconds === 1)).toBe(true)
  })
  test('copes with zero or nonsense lengths, and strips stock vocabulary', () => {
    const shots = fitShots([{ prompt: 'slow push in, shallow depth of field', seconds: 0 }, { prompt: 'b', seconds: Number.NaN }], 6)
    expect(shots.reduce((a, s) => a + s.seconds, 0)).toBe(6)
    expect(shots[0]!.prompt).not.toContain('depth of field')
  })
  test('throws when nothing is usable', () => expect(() => fitShots([{ prompt: ' ', seconds: 3 }], 5)).toThrow())
})

describe('Kling spec', () => {
  test('multi-shot sends multi_prompt with string durations and no prompt', () => {
    const input = SPECS.klingV3ProI2V.build({ prompt: 'x', imageUrl: 'u', shots: [{ prompt: 'a', seconds: 5 }, { prompt: 'b', seconds: 3 }] }) as Record<string, unknown>
    expect(input.multi_prompt).toEqual([{ prompt: 'a', duration: '5' }, { prompt: 'b', duration: '3' }])
    expect(input.duration).toBe('8')
    expect(input.prompt).toBeUndefined()
    expect(input.generate_audio).toBe(true)
    expect(input.start_image_url).toBe('u')
  })
  test('single shot sends prompt and duration as a string', () => {
    const input = SPECS.klingV3ProI2V.build({ prompt: 'x', imageUrl: 'u', seconds: 6 }) as Record<string, unknown>
    expect(input.prompt).toBe('x')
    expect(input.duration).toBe('6')
    expect(input.multi_prompt).toBeUndefined()
  })
})

describe('video options', () => {
  test('video is on by default, 8 seconds, up to 2 takes', () => {
    expect(defaultOptions.video).toBe(true)
    expect(defaultOptions.videoSeconds).toBe(8)
    expect(defaultOptions.videoTakes).toBe(2)
  })
  test('sanitise clamps seconds to 3-15 and takes to 1-3', () => {
    expect(sanitiseOptions({ videoSeconds: 40, videoTakes: 9 })).toEqual({ videoSeconds: 15, videoTakes: 3 })
    expect(sanitiseOptions({ videoSeconds: 1, videoTakes: 0 })).toEqual({ videoSeconds: 3, videoTakes: 1 })
  })
  test('briefSlug takes the brief file name', () => {
    expect(briefSlug('../briefs/01-ep-133.md')).toBe('01-ep-133')
    expect(briefSlug('briefs/02 nike.md')).toBe('02-nike')
  })
})

describe('video stage (mock)', () => {
  test('a rejected first take gets one re-take with a revised storyboard; the better take wins', async () => {
    // Mock critic: take 1 scores 4.6 with a slop flag (3.6 after slop), take 2 scores 6.3 clean.
    const run = new Run('brief', small)
    await runHarness(run, small)
    const v = videos(run)
    expect(v).toHaveLength(2)
    expect(v[1]!.changeSummary).toBeTruthy()
    expect(run.state.final?.video?.id).toBe(v[1]!.id)
    for (const take of v) {
      expect(take.shots!.reduce((a, s) => a + s.seconds, 0)).toBe(8)
      expect(take.frames).toHaveLength(3)
      expect(take.frames![0]).toBe(run.state.final!.image!.url)
    }
    expect(run.state.events.some((e) => e.message.includes('re-taking'))).toBe(true)
  })

  test('a good first take is not re-taken', () =>
    withEnv({ MOCK_SCORES: '7,7,7', MOCK_SLOP: '' }, async () => {
      const run = new Run('brief', small)
      await runHarness(run, small)
      expect(videos(run)).toHaveLength(1)
    }))

  test('takes 1 never re-takes', async () => {
    const run = new Run('brief', small)
    await runHarness(run, { ...small, videoTakes: 1 })
    expect(videos(run)).toHaveLength(1)
  })

  test('a failed storyboard falls back to a single-shot prompt and still makes a video', () =>
    withEnv({ MOCK_FAIL: '^video\\.storyboard' }, async () => {
      const run = new Run('brief', small)
      await runHarness(run, { ...small, videoTakes: 1 })
      const v = videos(run)
      expect(v).toHaveLength(1)
      expect(v[0]!.shots).toHaveLength(1)
      expect(v[0]!.shots![0]!.seconds).toBe(8)
    }))

  test('if the video model is down, the run still finishes with the hero image', () =>
    withEnv({ MOCK_FAIL: '^media:fal-ai/kling' }, async () => {
      const run = new Run('brief', small)
      await runHarness(run, small)
      expect(run.state.status).toBe('done')
      expect(run.state.final?.video).toBeUndefined()
      expect(run.state.final?.image).toBeDefined()
      expect(run.state.events.some((e) => e.message.includes('No video was produced'))).toBe(true)
    }))

  test('if frame extraction fails, the video is kept but not re-taken blind', () =>
    withEnv({ MOCK_FAIL: '^media:fal-ai/ffmpeg' }, async () => {
      const run = new Run('brief', small)
      await runHarness(run, small)
      expect(videos(run)).toHaveLength(1)
      expect(run.state.final?.video).toBeDefined()
      expect(run.state.final?.video?.critique).toBeUndefined()
    }))

  test('video off skips the stage entirely', async () => {
    const run = new Run('brief', small)
    await runHarness(run, { ...small, video: false })
    expect(videos(run)).toHaveLength(0)
    expect(run.calls.some((c) => c.task === 'video.storyboard')).toBe(false)
  })
})

describe('outputs and traces.json', () => {
  test('each run writes traces.json in the hackathon shape under outputs/<slug>/', async () => {
    const run = new Run('brief', small)
    run.state.source = '../briefs/01-ep-133.md'
    run.state.slug = briefSlug(run.state.source)
    await runHarness(run, small)
    // mock runs write under _mock/ so they can never overwrite real deliverables
    const dir = join(config.outputDir, '_mock', '01-ep-133')
    expect(run.state.outputs?.traces).toBe(join(dir, 'traces.json'))
    const t = JSON.parse(readFileSync(join(dir, 'traces.json'), 'utf8'))
    expect(t.brief).toBe('briefs/01-ep-133.md')
    // mock media are inline placeholders, so no video file is written
    expect(t.output_video).toBeNull()
    expect(existsSync(join(dir, 'final.mp4'))).toBe(false)
    expect(new Date(t.started_at).getTime()).toBeLessThanOrEqual(new Date(t.finished_at).getTime())
    expect(t.steps.length).toBe(run.calls.length)
    for (const s of t.steps) {
      for (const k of ['id', 'name', 'model', 'inputs', 'prompt', 'tool_calls', 'outputs', 'duration_ms']) expect(s).toHaveProperty(k)
      expect(s.tool_calls[0]).toHaveProperty('tool')
    }
    const names = t.steps.map((s: { name: string }) => s.name)
    expect(names.some((n: string) => n.startsWith('director.diverge'))).toBe(true)
    expect(names.some((n: string) => n.startsWith('video.storyboard'))).toBe(true)
    expect(t.steps.some((s: { model: string }) => s.model === 'fal-ai/kling-video/v3/pro/image-to-video')).toBe(true)
    expect(t.decisions.length).toBeGreaterThan(0)
    expect(t.final.shots.length).toBeGreaterThan(0)
  })

  test('a run without a brief file writes under its run id', async () => {
    const run = new Run('brief', small)
    await runHarness(run, { ...small, video: false })
    expect(existsSync(join(config.outputDir, '_mock', run.id, 'traces.json'))).toBe(true)
  })
})

describe('Kling prompt limits (422 in a live run)', () => {
  test('shot prompts over 512 characters are trimmed at a word boundary', () => {
    const long = 'word '.repeat(200)
    const input = SPECS.klingV3ProI2V.build({ prompt: 'x', imageUrl: 'u', shots: [{ prompt: long, seconds: 4 }, { prompt: 'short', seconds: 4 }] }) as { multi_prompt: { prompt: string }[] }
    expect(input.multi_prompt[0]!.prompt.length).toBeLessThanOrEqual(512)
    expect(input.multi_prompt[0]!.prompt.endsWith('word')).toBe(true)
    expect(input.multi_prompt[1]!.prompt).toBe('short')
  })
  test('clip leaves short text alone and hard-cuts text with no spaces', () => {
    expect(clip('hello world', 50)).toBe('hello world')
    expect(clip('x'.repeat(600), 512)).toHaveLength(512)
  })
})

describe('review fixes: deliverables always written, best take kept', () => {
  test('a worse re-take does not replace the better first take', () =>
    withEnv({ MOCK_SCORES: '5,4', MOCK_SLOP: '' }, async () => {
      const run = new Run('brief', small)
      await runHarness(run, small)
      const v = videos(run)
      expect(v).toHaveLength(2)
      expect(run.state.final?.video?.id).toBe(v[0]!.id)
    }))

  test('traces.json is written even when the run fails early', () =>
    withEnv({ MOCK_FAIL: '^media:' }, async () => {
      const run = new Run('brief', small)
      await expect(runHarness(run, small)).rejects.toThrow()
      const t = JSON.parse(readFileSync(join(config.outputDir, '_mock', run.id, 'traces.json'), 'utf8'))
      expect(t.error).toBeTruthy()
      expect(t.steps.length).toBeGreaterThan(0)
      // failed calls are recorded as steps too
      expect(t.steps.some((s: { outputs: { error?: string } }) => s.outputs?.error)).toBe(true)
    }))

  test('a re-run on the same brief clears stale media so files match traces.json', async () => {
    const dir = join(config.outputDir, '_mock', 'stale-check')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'final.mp4'), 'old')
    const run = new Run('brief', small)
    run.state.slug = 'stale-check'
    await runHarness(run, { ...small, video: false })
    expect(existsSync(join(dir, 'final.mp4'))).toBe(false)
    expect(existsSync(join(dir, 'traces.json'))).toBe(true)
  })

  test('a single-shot fallback uses Kling\'s plain prompt path, not multi_prompt', () =>
    withEnv({ MOCK_FAIL: '^video\\.storyboard' }, async () => {
      const run = new Run('brief', small)
      await runHarness(run, { ...small, videoTakes: 1 })
      const kling = run.calls.find((c) => c.model === 'fal-ai/kling-video/v3/pro/image-to-video')!
      const input = kling.inputs as Record<string, unknown>
      expect(input.prompt).toBeTruthy()
      expect(input.multi_prompt).toBeUndefined()
      expect(input.duration).toBe('8')
    }))

  test('steps are listed in start order', async () => {
    const run = new Run('brief', small)
    await runHarness(run, small)
    const t = JSON.parse(readFileSync(join(config.outputDir, '_mock', run.id, 'traces.json'), 'utf8'))
    const starts = t.steps.map((s: { started_at: string }) => Date.parse(s.started_at))
    expect(starts).toEqual([...starts].sort((a: number, b: number) => a - b))
  })
})
