import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { probe } from '../src/film/probe.ts'
import { stillToClip } from '../src/film/still.ts'

const FFMPEG = Bun.which('ffmpeg') ?? '/opt/homebrew/bin/ffmpeg'

let dir = ''
const f = (name: string) => join(dir, name)

function frameAt(path: string, t: number): Uint8Array {
  const r = Bun.spawnSync([
    FFMPEG,
    ...['-v', 'error', '-ss', String(t), '-i', path, '-frames:v', '1'],
    ...['-vf', 'scale=108:192', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
  ])
  if (r.exitCode !== 0) throw new Error(r.stderr.toString())
  return new Uint8Array(r.stdout)
}

function meanDiff(a: Uint8Array, b: Uint8Array): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) {
    sum += Math.abs((a[i] as number) - (b[i] as number))
  }
  return sum / a.length
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'still-test-'))
  const r = Bun.spawnSync([
    FFMPEG,
    ...['-y', '-v', 'error', '-f', 'lavfi'],
    ...['-i', 'testsrc2=size=1200x900:rate=1', '-frames:v', '1', f('in.png')],
  ])
  if (r.exitCode !== 0) throw new Error(r.stderr.toString())
})

afterAll(async () => {
  await rm(dir, { force: true, recursive: true })
})

describe('stillToClip', () => {
  test('gives the asked length and size, with a moving picture', async () => {
    const out = await stillToClip(f('in.png'), f('out/push.mp4'), {
      move: 'push',
      seconds: 2,
    })
    expect(out).toBe(f('out/push.mp4'))
    const p = await probe(out)
    expect([p.width, p.height, p.fps]).toEqual([1080, 1920, 30])
    expect(Math.abs(p.durationS - 2)).toBeLessThan(0.1)
    expect(meanDiff(frameAt(out, 0), frameAt(out, 1.9))).toBeGreaterThan(1)
  })

  test('every move changes the picture and honours the size', async () => {
    for (const move of ['pull', 'left', 'right'] as const) {
      const out = await stillToClip(f('in.png'), f(`out/${move}.mp4`), {
        height: 640,
        move,
        seconds: 1,
        width: 360,
      })
      const p = await probe(out)
      expect([p.width, p.height]).toEqual([360, 640])
      expect(meanDiff(frameAt(out, 0), frameAt(out, 0.95))).toBeGreaterThan(1)
    }
  })

  test('a missing image throws with the path', async () => {
    await expect(
      stillToClip(f('nope.png'), f('out/x.mp4'), { seconds: 1 }),
    ).rejects.toThrow('nope.png')
  })
})
