import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  BUSYNESS_MAX,
  MIN_CONTRAST,
  measureZone,
  planSuper,
  sampleFrames,
} from '../src/film/legibility.ts'
import type { Frames } from '../src/film/legibility.ts'

const FFMPEG = Bun.which('ffmpeg') ?? '/opt/homebrew/bin/ffmpeg'
const TEXT = 'Twelve hours under a bus.'
const SIZE = { height: 1920, width: 1080 }
const ONE = ['-frames:v', '1']

let dir = ''
const f = (name: string) => join(dir, name)

function ffmpeg(...args: string[]) {
  const r = Bun.spawnSync([FFMPEG, '-y', '-loglevel', 'error', ...args])
  if (r.exitCode !== 0) throw new Error(r.stderr.toString())
}

function colour(hex: string, out: string) {
  ffmpeg('-f', 'lavfi', '-i', `color=c=${hex}:s=540x960`, ...ONE, out)
}

const only = (s: Frames, i: number): Frames => ({
  ...s,
  frames: [s.frames[i] as Uint8Array],
})

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'legibility-test-'))
  colour('0x101820', f('dark.png'))
  colour('0xF0EAD8', f('light.png'))
  ffmpeg('-f', 'lavfi', '-i', 'testsrc2=s=540x960', ...ONE, f('busy.png'))
  ffmpeg(
    ...['-f', 'lavfi', '-i', 'color=c=0x808080:s=540x960,noise=alls=80'],
    ...[...ONE, f('noise.png')],
  )
  ffmpeg(
    ...['-f', 'lavfi', '-i', 'color=c=0x203040:s=540x960'],
    ...['-f', 'lavfi', '-i', 'testsrc2=s=540x432'],
    ...['-filter_complex', 'overlay=y=528', ...ONE, f('top-calm.png')],
  )
  ffmpeg(
    ...['-filter_complex'],
    ...[
      'color=c=0x203040:s=540x960:r=25:d=1[a];' +
        'color=c=0x808080:s=540x960:r=25:d=1,noise=alls=80:allf=t[b];' +
        '[a][b]concat=n=2:v=1:a=0',
    ],
    ...['-pix_fmt', 'yuv420p', f('calm-then-busy.mp4')],
  )
})

afterAll(async () => {
  await rm(dir, { force: true, recursive: true })
})

describe('sampleFrames', () => {
  test('an image gives one 270x480 frame', async () => {
    const s = await sampleFrames(f('dark.png'))
    expect([s.w, s.h, s.frames.length]).toEqual([270, 480, 1])
    expect(s.frames[0]?.length).toBe(270 * 480 * 3)
  })

  test('a video gives start, middle and end frames', async () => {
    const s = await sampleFrames(f('calm-then-busy.mp4'), {
      endS: 2,
      startS: 0,
    })
    expect(s.frames.length).toBe(3)
    const rect = { h: 100, w: 200, x: 20, y: 200 }
    expect(measureZone(only(s, 0), rect).busyness).toBeLessThan(0.5)
    expect(measureZone(only(s, 2), rect).busyness).toBeGreaterThan(
      BUSYNESS_MAX,
    )
  })
})

describe('measureZone', () => {
  test('a flat dark zone is dark and calm', async () => {
    const s = await sampleFrames(f('dark.png'))
    const z = measureZone(s, { h: 100, w: 200, x: 20, y: 300 })
    expect(z.meanL).toBeLessThan(0.05)
    expect(z.busyness).toBe(0)
    expect(z.p95).toBeLessThan(0.05)
  })
})

describe('planSuper', () => {
  test('a calm dark frame gives white text and no plate', async () => {
    const p = await planSuper(TEXT, { ...SIZE, imagePath: f('dark.png') })
    expect(p.fg).toBe('#FFFFFF')
    expect(p.plate).toBe('none')
    expect(p.plateOpacity).toBe(0)
    expect(p.contrast).toBeGreaterThanOrEqual(MIN_CONTRAST)
    expect(p.position).toBe('lower')
  })

  test('a calm light frame gives dark text and no plate', async () => {
    const p = await planSuper(TEXT, { ...SIZE, imagePath: f('light.png') })
    expect(p.fg).toBe('#111111')
    expect(p.plate).toBe('none')
    expect(p.contrast).toBeGreaterThanOrEqual(MIN_CONTRAST)
  })

  test('a busy frame gets a plate and a contrast of 4.5 or more', async () => {
    const p = await planSuper(TEXT, { ...SIZE, imagePath: f('busy.png') })
    expect(p.plate).not.toBe('none')
    expect(p.plateOpacity).toBeGreaterThanOrEqual(0.35)
    expect(p.contrast).toBeGreaterThanOrEqual(MIN_CONTRAST)
    expect(p.reason.length).toBeGreaterThan(0)
  })

  test('a textured frame gets a plate whatever its contrast', async () => {
    const p = await planSuper(TEXT, { ...SIZE, imagePath: f('noise.png') })
    expect(p.busyness).toBeGreaterThan(BUSYNESS_MAX)
    expect(p.plate).not.toBe('none')
    expect(p.contrast).toBeGreaterThanOrEqual(MIN_CONTRAST)
  })

  test('calm top and busy bottom moves the text up', async () => {
    const p = await planSuper(TEXT, {
      ...SIZE,
      imagePath: f('top-calm.png'),
      prefer: 'lower',
    })
    expect(['upper', 'centre']).toContain(p.position)
    expect(p.reason).toContain('moved')
  })

  test('the preferred zone stays when nothing is calmer', async () => {
    const p = await planSuper(TEXT, {
      ...SIZE,
      imagePath: f('busy.png'),
      prefer: 'upper',
    })
    expect(p.position).toBe('upper')
  })

  test('a span whose last frame is busy uses that frame', async () => {
    const calm = await planSuper(TEXT, {
      ...SIZE,
      clipPath: f('calm-then-busy.mp4'),
      endS: 0.8,
      startS: 0,
    })
    expect(calm.plate).toBe('none')
    const whole = await planSuper(TEXT, {
      ...SIZE,
      clipPath: f('calm-then-busy.mp4'),
      endS: 2,
      startS: 0,
    })
    expect(whole.plate).not.toBe('none')
    expect(whole.busyness).toBeGreaterThan(BUSYNESS_MAX)
    expect(whole.contrast).toBeGreaterThanOrEqual(MIN_CONTRAST)
  })

  test('no source throws', async () => {
    await expect(planSuper(TEXT, SIZE)).rejects.toThrow(/clipPath/)
  })
})
