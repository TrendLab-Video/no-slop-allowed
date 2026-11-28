import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { probe } from '../src/film/probe.ts'
import { pickTextColour, renderCard, renderSuper } from '../src/film/titles.ts'

const FFMPEG = Bun.which('ffmpeg') ?? '/opt/homebrew/bin/ffmpeg'

let dir = ''
const f = (name: string) => join(dir, name)

type Pixels = { data: Uint8Array; h: number; w: number }

async function decode(path: string): Promise<Pixels> {
  const p = await probe(path)
  const r = Bun.spawnSync([
    FFMPEG,
    ...['-v', 'error', '-i', path],
    ...['-f', 'rawvideo', '-pix_fmt', 'rgba', '-'],
  ])
  if (r.exitCode !== 0) throw new Error(r.stderr.toString())
  return { data: new Uint8Array(r.stdout), h: p.height, w: p.width }
}

const alphaAt = (px: Pixels, x: number, y: number) =>
  px.data[(y * px.w + x) * 4 + 3] as number

function inkIn(px: Pixels, x0: number, y0: number, x1: number, y1: number) {
  let n = 0
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) if (alphaAt(px, x, y) > 8) n++
  }
  return n
}

function diffIn(px: Pixels, rgb: number[], x0: number, x1: number) {
  let n = 0
  for (let y = 0; y < px.h; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * px.w + x) * 4
      const d = [0, 1, 2].some(
        (c) => Math.abs((px.data[i + c] as number) - (rgb[c] as number)) > 24,
      )
      if (d) n++
    }
  }
  return n
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'titles-test-'))
})

afterAll(async () => {
  await rm(dir, { force: true, recursive: true })
})

describe('pickTextColour', () => {
  test('dark backgrounds get white, light ones get near-black', () => {
    expect(pickTextColour('#000000')).toBe('#FFFFFF')
    expect(pickTextColour('#0B1F4B')).toBe('#FFFFFF')
    expect(pickTextColour('#FFFFFF')).toBe('#111111')
    expect(pickTextColour('#F5E9D0')).toBe('#111111')
  })

  test('picks the higher contrast on a mid tone', () => {
    expect(pickTextColour('#FF3B30')).toBe('#111111')
    expect(pickTextColour('#1E6B3A')).toBe('#FFFFFF')
  })

  test('accepts short hex and rejects junk', () => {
    expect(pickTextColour('#000')).toBe('#FFFFFF')
    expect(() => pickTextColour('banana')).toThrow()
  })
})

describe('renderCard', () => {
  test('writes a PNG of the exact size', async () => {
    const out = await renderCard(
      {
        bg: '#0B1F4B',
        fg: '#FFFFFF',
        height: 1920,
        title: 'Nike',
        width: 1080,
      },
      f('a/card.png'),
    )
    expect(out).toBe(f('a/card.png'))
    const p = await probe(out)
    expect([p.width, p.height]).toEqual([1080, 1920])
  })

  test('a transparent card is clear in corners and inked on text', async () => {
    await renderCard(
      {
        bg: null,
        fg: '#FFFFFF',
        height: 640,
        sub: 'Run faster',
        title: 'Hello world',
        width: 360,
      },
      f('clear.png'),
    )
    const px = await decode(f('clear.png'))
    expect([px.w, px.h]).toEqual([360, 640])
    expect(alphaAt(px, 2, 2)).toBe(0)
    expect(alphaAt(px, px.w - 3, px.h - 3)).toBe(0)
    expect(inkIn(px, 0, 0, px.w, px.h)).toBeGreaterThan(500)
  })

  test('an opaque card is filled with the background', async () => {
    await renderCard(
      { bg: '#FF3B30', fg: '#111111', height: 640, title: 'Hi', width: 360 },
      f('opaque.png'),
    )
    const px = await decode(f('opaque.png'))
    expect(alphaAt(px, 2, 2)).toBe(255)
    expect([px.data[0], px.data[1], px.data[2]]).toEqual([255, 59, 48])
  })

  test('a very long title keeps the outer 8% columns clear', async () => {
    const title =
      'The quick brown fox jumps over the lazy dog while Supercalifragilistic' +
      'expialidocious runners keep running further than anyone ever expected'
    await renderCard(
      {
        bg: '#0B1F4B',
        fg: '#FFFFFF',
        height: 1920,
        sub: 'Still fits inside the safe columns',
        title,
        width: 1080,
      },
      f('long.png'),
    )
    const px = await decode(f('long.png'))
    const edge = Math.floor(px.w * 0.08)
    const bg = [0x0b, 0x1f, 0x4b]
    expect(diffIn(px, bg, 0, edge)).toBe(0)
    expect(diffIn(px, bg, px.w - edge, px.w)).toBe(0)
    expect(diffIn(px, bg, 0, px.w)).toBeGreaterThan(2000)
  })

  test('a product image sits above the title, fitted', async () => {
    const img = f('product.png')
    const r = Bun.spawnSync([
      FFMPEG,
      ...['-y', '-v', 'error', '-f', 'lavfi'],
      ...['-i', 'color=c=red:s=900x300', '-frames:v', '1', img],
    ])
    expect(r.exitCode).toBe(0)
    await renderCard(
      {
        bg: '#FFFFFF',
        fg: '#111111',
        height: 1920,
        imagePath: img,
        title: 'Shoe',
        width: 1080,
      },
      f('with-image.png'),
    )
    const px = await decode(f('with-image.png'))
    let minX = px.w
    let maxX = 0
    let minY = px.h
    let maxY = 0
    for (let y = 0; y < px.h; y++) {
      for (let x = 0; x < px.w; x++) {
        const i = (y * px.w + x) * 4
        const red =
          (px.data[i] as number) > 200 && (px.data[i + 1] as number) < 60
        if (!red) continue
        minX = Math.min(minX, x)
        maxX = Math.max(maxX, x)
        minY = Math.min(minY, y)
        maxY = Math.max(maxY, y)
      }
    }
    const w = maxX - minX + 1
    const h = maxY - minY + 1
    expect(w).toBeLessThanOrEqual(Math.round(1080 * 0.6) + 2)
    expect(h).toBeLessThanOrEqual(Math.round(1920 * 0.45) + 2)
    expect(Math.abs(w / h - 3)).toBeLessThan(0.05)
    const below = Array.from({ length: px.w }, (_, x) => x).some((x) => {
      const rows = Array.from({ length: 400 }, (_, k) => maxY + 20 + k)
      return rows.some((y) => (px.data[(y * px.w + x) * 4] as number) < 100)
    })
    expect(below).toBe(true)
  })
})

describe('renderCard logo', () => {
  test('a logo lands in the lower half, fitted and uncropped', async () => {
    const logo = f('logo.png')
    const r = Bun.spawnSync([
      FFMPEG,
      ...['-y', '-v', 'error', '-f', 'lavfi'],
      ...['-i', 'color=c=0x00ff00:s=400x200,format=rgba'],
      ...['-frames:v', '1', logo],
    ])
    expect(r.exitCode).toBe(0)
    await renderCard(
      {
        bg: '#0B1F4B',
        fg: '#FFFFFF',
        height: 1920,
        logoPath: logo,
        title: 'Nike',
        width: 1080,
      },
      f('with-logo.png'),
    )
    const px = await decode(f('with-logo.png'))
    let top = 0
    let bottom = 0
    let minX = px.w
    let maxX = 0
    let minY = px.h
    let maxY = 0
    for (let y = 0; y < px.h; y++) {
      for (let x = 0; x < px.w; x++) {
        const i = (y * px.w + x) * 4
        const lime =
          (px.data[i] as number) < 40 &&
          (px.data[i + 1] as number) > 215 &&
          (px.data[i + 2] as number) < 40
        if (!lime) continue
        if (y < px.h / 2) top++
        else bottom++
        minX = Math.min(minX, x)
        maxX = Math.max(maxX, x)
        minY = Math.min(minY, y)
        maxY = Math.max(maxY, y)
      }
    }
    expect(top).toBe(0)
    expect(bottom).toBeGreaterThan(1000)
    expect(maxX - minX + 1).toBeLessThanOrEqual(Math.round(1080 * 0.3) + 2)
    expect(maxY - minY + 1).toBeLessThanOrEqual(Math.round(1920 * 0.1) + 2)
    expect(Math.abs((maxX - minX + 1) / (maxY - minY + 1) - 2)).toBeLessThan(
      0.06,
    )
  })
})

describe('renderSuper', () => {
  test('is transparent, with the top 10% and bottom 20% empty', async () => {
    for (const position of ['upper', 'centre', 'lower'] as const) {
      const out = await renderSuper(
        'Built for the last mile of every long run',
        { height: 1920, position, width: 1080 },
        f(`super-${position}.png`),
      )
      const px = await decode(out)
      expect([px.w, px.h]).toEqual([1080, 1920])
      expect(alphaAt(px, 2, 2)).toBe(0)
      expect(inkIn(px, 0, 0, px.w, px.h)).toBeGreaterThan(1000)
      expect(inkIn(px, 0, 0, px.w, Math.floor(px.h * 0.1))).toBe(0)
      expect(inkIn(px, 0, Math.ceil(px.h * 0.8), px.w, px.h)).toBe(0)
    }
  })

  test('a very long super still keeps the safe area', async () => {
    const text = Array.from({ length: 30 }, () => 'relentless').join(' ')
    const out = await renderSuper(
      text,
      { height: 1920, position: 'lower', width: 1080 },
      f('super-long.png'),
    )
    const px = await decode(out)
    expect(inkIn(px, 0, 0, px.w, Math.floor(px.h * 0.1))).toBe(0)
    expect(inkIn(px, 0, Math.ceil(px.h * 0.8), px.w, px.h)).toBe(0)
  })
})
