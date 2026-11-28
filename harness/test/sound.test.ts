import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { probe } from '../src/film/probe.ts'
import {
  checkVoice,
  fitAudio,
  makeFoley,
  makeMusic,
  musicSections,
  planTimeline,
  sameWords,
  voiceLines,
} from '../src/film/sound.ts'
import type { Timeline, VoicedLine } from '../src/film/sound.ts'

const FFMPEG = Bun.which('ffmpeg') ?? '/opt/homebrew/bin/ffmpeg'

let dir = ''
const f = (name: string) => join(dir, name)

function ffmpeg(...args: string[]) {
  const r = Bun.spawnSync([FFMPEG, '-y', '-loglevel', 'error', ...args])
  if (r.exitCode !== 0) throw new Error(r.stderr.toString())
}

function voiced(shotId: string, durationS: number): VoicedLine {
  return { durationS, path: `/v/${shotId}.wav`, shotId, text: 'x' }
}

function shot(id: string, minS = 2.5, maxS = 5) {
  return { id, maxS, minS }
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sound-test-'))
})

afterAll(async () => {
  await rm(dir, { force: true, recursive: true })
})

describe('planTimeline', () => {
  test('WHEN a line is shorter than minS THEN the shot keeps minS', () => {
    const t = planTimeline([shot('a')], [voiced('a', 1)])
    expect(t.shots[0]?.durationS).toBe(2.5)
  })

  test('WHEN a line sets the length THEN lead + line + pad rules', () => {
    const t = planTimeline([shot('a')], [voiced('a', 3.2)])
    expect(t.shots[0]?.durationS).toBeCloseTo(3.95, 6)
  })

  test('WHEN a line is over maxS THEN the shot is capped and flagged', () => {
    const t = planTimeline([shot('a'), shot('b')], [voiced('b', 5.5)])
    expect(t.shots[1]?.durationS).toBe(5)
    expect(t.overlong).toEqual(['b'])
  })

  test('WITHOUT a line the shot lasts minS and has no voice entry', () => {
    const t = planTimeline([shot('a', 3)], [])
    expect(t.shots[0]?.durationS).toBe(3)
    expect(t.voice).toEqual([])
    expect(t.overlong).toEqual([])
  })

  test('voice entries start at the shot start plus the lead', () => {
    const t = planTimeline(
      [shot('a'), shot('b'), shot('c')],
      [voiced('a', 1), voiced('c', 1)],
      { leadS: 0.4 },
    )
    expect(t.voice.map((v) => v.startAt)).toEqual([0.4, 5.4])
  })

  test('totalS is the sum of the shot lengths', () => {
    const t = planTimeline(
      [shot('a'), shot('b'), shot('c')],
      [voiced('a', 3), voiced('c', 4.8)],
    )
    const sum = t.shots.reduce((a, s) => a + s.durationS, 0)
    expect(t.totalS).toBeCloseTo(sum, 9)
    expect(t.shots.map((s) => s.startS)).toEqual([
      0,
      t.shots[0]!.durationS,
      t.shots[0]!.durationS + t.shots[1]!.durationS,
    ])
  })
})

describe('musicSections', () => {
  const timeline = (durations: number[]): Timeline => {
    let at = 0
    const shots = durations.map((durationS, i) => {
      const s = { durationS, id: `s${i}`, startS: at }
      at += durationS
      return s
    })
    return { shots, totalS: at, voice: [] }
  }
  const mood = { endS: 3, styles: ['warm', 'acoustic'] }

  test('sections sum exactly to the film length with the end card', () => {
    const t = timeline([2.5, 2.5, 2.5, 4.75])
    const s = musicSections(t, mood)
    const sum = s.reduce((a, x) => a + x.durationS, 0)
    expect(sum).toBeCloseTo(t.totalS + mood.endS, 9)
  })

  test('no section is under 3 s', () => {
    const cuts = [[2, 2, 2], [6, 2], [2.5, 2.5, 2.5, 2.5], [3]]
    for (const d of cuts) {
      const s = musicSections(timeline(d), { endS: 2.5, styles: ['warm'] })
      expect(s.every((x) => x.durationS >= 3)).toBe(true)
    }
  })

  test('a 2 s shot is merged into a neighbour', () => {
    const s = musicSections(timeline([6, 2]), { endS: 2, styles: ['warm'] })
    expect(s.length).toBe(2)
    const sum = s.reduce((a, x) => a + x.durationS, 0)
    expect(sum).toBeCloseTo(10, 9)
  })

  test('the last section is the end card and resolves', () => {
    const s = musicSections(timeline([4, 4, 4]), mood)
    const last = s[s.length - 1]
    expect(last?.durationS).toBe(mood.endS)
    expect(last?.label).toBe('Resolve')
    expect(s.map((x) => x.label)).toEqual(['Opening', 'Lift', 'Resolve'])
  })

  test('the lift lands on the cut nearest 55 per cent of the film', () => {
    const s = musicSections(timeline([4, 4, 4, 4]), mood)
    expect(s[0]?.durationS).toBe(8)
  })
})

describe('mock mode audio', () => {
  test('voiceLines writes trimmed files of about words / 2.6 s', async () => {
    const lines = [
      { shotId: 'a', text: 'Twelve hours under a bus.' },
      { shotId: 'b', text: 'Then this.' },
    ]
    const out = await voiceLines(lines, { outDir: f('voice') })
    expect(out.length).toBe(2)
    for (const v of out) {
      const words = v.text.split(' ').length
      const p = await probe(v.path)
      expect(p.hasAudio).toBe(true)
      expect(Math.abs(p.durationS - words / 2.6)).toBeLessThan(0.1)
      expect(v.durationS).toBeCloseTo(p.durationS, 3)
    }
  })

  test('voiceLines drops a failed line and returns the rest', async () => {
    const lines = [
      { shotId: 'ok', text: 'Fine line here.' },
      { shotId: 'dead', text: '' },
    ]
    const out = await voiceLines(lines, { outDir: f('voice-fail') })
    expect(out.map((v) => v.shotId)).toEqual(['ok'])
  })

  test('makeMusic writes a file of the exact total', async () => {
    const sections = [
      { durationS: 6, label: 'Opening', styles: ['warm'] },
      { durationS: 4.5, label: 'Lift', styles: ['warm'] },
      { durationS: 3, label: 'Resolve', styles: ['warm'] },
    ]
    const r = await makeMusic({ outDir: f('music'), sections })
    expect(r.route).toBe('plan')
    expect(Math.abs(r.durationS - 13.5)).toBeLessThan(0.05)
    expect(Math.abs((await probe(r.path)).durationS - 13.5)).toBeLessThan(0.05)
  })

  test('makeFoley writes a file as long as the clip', async () => {
    const clip = f('clip.mp4')
    ffmpeg(
      ...['-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=10:duration=2.4'],
      ...['-pix_fmt', 'yuv420p', clip],
    )
    const r = await makeFoley(clip, 'cup on a table', f('foley'))
    expect(r).not.toBeNull()
    expect(Math.abs((r?.durationS ?? 0) - 2.4)).toBeLessThan(0.1)
  })

  test('makeFoley returns null for a clip that does not exist', async () => {
    expect(await makeFoley(f('nope.mp4'), 'x', f('foley'))).toBeNull()
  })

  test('checkVoice passes lines the mock voice read back', async () => {
    const out = await voiceLines([{ shotId: 'a', text: 'Then this.' }], {
      outDir: f('voice-check'),
    })
    const checked = await checkVoice(out)
    expect(checked.map((c) => c.ok)).toEqual([true])
  })
})

describe('fitAudio', () => {
  test('trims a long file to the total', async () => {
    ffmpeg(...['-f', 'lavfi', '-i', 'sine=duration=9'], f('long.wav'))
    const r = await fitAudio(f('long.wav'), f('long.fit.wav'), 6)
    expect(Math.abs(r.durationS - 6)).toBeLessThan(0.05)
    expect(r.shortByS).toBe(0)
  })

  test('pads a slightly short file to the total', async () => {
    ffmpeg(...['-f', 'lavfi', '-i', 'sine=duration=5.7'], f('short.wav'))
    const r = await fitAudio(f('short.wav'), f('short.fit.wav'), 6)
    expect(Math.abs(r.durationS - 6)).toBeLessThan(0.05)
    expect(r.shortByS).toBeGreaterThan(0.25)
    expect(r.shortByS).toBeLessThan(0.35)
  })
})

describe('sameWords', () => {
  test('passes case and punctuation differences', () => {
    expect(sameWords('Then this.', 'then, this')).toBe(true)
    expect(sameWords("Don't stop.", 'Dont stop')).toBe(true)
    const script = 'Minor Figures. For the ones.'
    expect(sameWords(script, 'minor figures for the ones')).toBe(true)
  })

  test('ignores audio event tags in the transcript', () => {
    expect(sameWords('Then this.', '(sighs) Then this.')).toBe(true)
  })

  test('fails a missing word', () => {
    const script = 'Twelve hours under a bus.'
    expect(sameWords(script, 'Twelve hours a bus')).toBe(false)
  })

  test('reads digits as words and tolerates one slip in a long word', () => {
    expect(sameWords('Twelve hours under a bus.', '12 hours under a bus')).toBe(
      true,
    )
    expect(sameWords('made the morning', 'made the mourning')).toBe(true)
    expect(sameWords('Then this.', 'Them this.')).toBe(false)
  })

  test('fails a wrong word', () => {
    expect(sameWords('Then this.', 'Then that.')).toBe(false)
  })
})
