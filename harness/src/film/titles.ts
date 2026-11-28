import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, extname } from 'node:path'

import { Resvg } from '@resvg/resvg-js'
import satori from 'satori'

import { probe } from './probe.ts'

export type CardSpec = {
  accent?: string
  align?: 'centre' | 'lower' | 'upper'
  bg: string | null
  fg: string
  height: number
  imagePath?: string
  logoPath?: string
  sub?: string
  title: string
  width: number
}

export type SuperOpts = {
  fg?: string
  height: number
  plate?: 'box' | 'none' | 'scrim'
  plateOpacity?: number
  position?: 'centre' | 'lower' | 'upper'
  width: number
}

const LIGHT = '#FFFFFF'
const DARK = '#111111'
const FONT_DIR = '@fontsource/inter/files/'
const TITLE_LINES = 3
const TEXT_FRACTION = 0.84

type Font = {
  data: ArrayBuffer
  name: string
  style: 'normal'
  weight: 400 | 700
}

let fonts: Promise<Font[]> | undefined

function loadFonts(): Promise<Font[]> {
  fonts ??= Promise.all(
    ([400, 700] as const).map(async (weight) => {
      const file = `${FONT_DIR}inter-latin-${weight}-normal.woff`
      const bytes = await readFile(Bun.resolveSync(file, import.meta.dir))
      const data = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer
      return { data, name: 'Inter', style: 'normal' as const, weight }
    }),
  )
  return fonts
}

function parseHex(colour: string): [number, number, number] {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(colour.trim())
  if (!m?.[1]) {
    throw new Error(`titles: colour must be #rgb or #rrggbb: ${colour}`)
  }
  const hex =
    m[1].length === 3
      ? m[1]
          .split('')
          .map((c) => c + c)
          .join('')
      : m[1]
  const n = Number.parseInt(hex, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function luminance(colour: string): number {
  const [r, g, b] = parseHex(colour).map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return ((hi as number) + 0.05) / ((lo as number) + 0.05)
}

export function pickTextColour(bg: string): string {
  return contrast(bg, LIGHT) >= contrast(bg, DARK) ? LIGHT : DARK
}

type Node = {
  props: { children?: unknown; style?: Record<string, unknown> } & Record<
    string,
    unknown
  >
  type: string
}

function el(
  type: string,
  style: Record<string, unknown>,
  children?: unknown,
  extra: Record<string, unknown> = {},
): Node {
  return { props: { ...extra, children, style }, type }
}

async function toSvg(
  tree: Node,
  size: { height?: number; width: number },
): Promise<string> {
  return satori(tree as never, { ...size, fonts: await loadFonts() })
}

async function writePng(
  svg: string,
  width: number,
  outPath: string,
): Promise<string> {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: width } })
    .render()
    .asPng()
  await mkdir(dirname(outPath), { recursive: true })
  await writeFile(outPath, png)
  return outPath
}

type TextStyle = {
  color: string
  fontSize: number
  fontWeight: 400 | 700
  letterSpacing: number
  lineHeight: number
  textAlign: 'center'
}

async function countLines(
  text: string,
  style: TextStyle,
  maxWidth: number,
): Promise<number> {
  const tree = el('div', { display: 'flex', width: maxWidth }, [
    el('div', { ...style, wordBreak: 'break-word' }, text),
  ])
  const svg = await toSvg(tree, { width: maxWidth })
  const h = /<svg[^>]* height="([\d.]+)"/.exec(svg)?.[1]
  return Math.round(Number(h) / (style.fontSize * style.lineHeight))
}

function titleStyle(fg: string, size: number): TextStyle {
  return {
    color: fg,
    fontSize: size,
    fontWeight: 700,
    letterSpacing: -size * 0.02,
    lineHeight: 1.1,
    textAlign: 'center',
  }
}

async function fitTitle(
  text: string,
  fg: string,
  width: number,
  maxWidth: number,
): Promise<{ lines: number; size: number }> {
  const floor = Math.round(width * 0.055)
  let size = Math.round(width * 0.105)
  for (;;) {
    const lines = await countLines(text, titleStyle(fg, size), maxWidth)
    if (lines <= TITLE_LINES || size <= floor) return { lines, size }
    size = Math.max(floor, Math.round(size * 0.93))
  }
}

const SPACER: Record<NonNullable<CardSpec['align']>, [number, number]> = {
  centre: [9, 11],
  lower: [2, 1],
  upper: [1, 2],
}

const MIME: Record<string, string> = {
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
}

async function imageNode(
  path: string,
  box: { h: number; w: number },
): Promise<Node> {
  const mime = MIME[extname(path).toLowerCase()]
  if (!mime) throw new Error(`titles: unsupported image type: ${path}`)
  const [info, bytes] = await Promise.all([probe(path), readFile(path)])
  if (!info.width || !info.height) {
    throw new Error(`titles: cannot read image size: ${path}`)
  }
  const scale = Math.min(box.w / info.width, box.h / info.height)
  const width = Math.round(info.width * scale)
  const height = Math.round(info.height * scale)
  const src = `data:${mime};base64,${bytes.toString('base64')}`
  return el('img', { height, width }, undefined, { height, src, width })
}

export async function renderCard(
  spec: CardSpec,
  outPath: string,
): Promise<string> {
  const { height, width } = spec
  const maxWidth = Math.round(width * TEXT_FRACTION)
  const fit = await fitTitle(spec.title, spec.fg, width, maxWidth)
  const { lines, size } = fit
  const clamp = lines > TITLE_LINES ? { lineClamp: TITLE_LINES } : {}
  const subSize = Math.round(Math.min(size * 0.52, width * 0.048))
  const gap = Math.round(size * 0.5)
  const [above, below] = SPACER[spec.align ?? 'centre']

  const children: Node[] = []
  if (spec.imagePath) {
    const box = { h: Math.round(height * 0.45), w: Math.round(width * 0.6) }
    children.push(
      el('div', { display: 'flex', marginBottom: Math.round(height * 0.04) }, [
        await imageNode(spec.imagePath, box),
      ]),
    )
  }
  children.push(
    el('div', {
      backgroundColor: spec.accent ?? spec.fg,
      height: Math.max(4, Math.round(width * 0.008)),
      marginBottom: gap,
      opacity: spec.accent ? 1 : 0.5,
      width: Math.round(width * 0.1),
    }),
    el(
      'div',
      { ...titleStyle(spec.fg, size), ...clamp, wordBreak: 'break-word' },
      spec.title,
    ),
  )
  if (spec.sub) {
    children.push(
      el(
        'div',
        {
          color: spec.fg,
          fontSize: subSize,
          fontWeight: 400,
          lineHeight: 1.3,
          marginTop: Math.round(size * 0.35),
          opacity: 0.72,
          textAlign: 'center',
          wordBreak: 'break-word',
        },
        spec.sub,
      ),
    )
  }
  const footer: Node[] = []
  if (spec.logoPath) {
    const box = { h: Math.round(height * 0.1), w: Math.round(width * 0.3) }
    footer.push(
      el(
        'div',
        {
          alignItems: 'center',
          display: 'flex',
          height: box.h,
          justifyContent: 'center',
          marginBottom: Math.round(height * 0.07),
          marginTop: Math.round(height * 0.03),
        },
        [await imageNode(spec.logoPath, box)],
      ),
    )
  }

  const tree = el(
    'div',
    {
      alignItems: 'center',
      backgroundColor: spec.bg ?? 'transparent',
      display: 'flex',
      flexDirection: 'column',
      fontFamily: 'Inter',
      height,
      width,
    },
    [
      el('div', { display: 'flex', flexGrow: above }),
      el(
        'div',
        {
          alignItems: 'center',
          display: 'flex',
          flexDirection: 'column',
          width: maxWidth,
        },
        children,
      ),
      el('div', { display: 'flex', flexGrow: below }),
      ...footer,
    ],
  )
  return writePng(await toSvg(tree, { height, width }), width, outPath)
}

export type Rect = { h: number; w: number; x: number; y: number }

export type SuperLayout = { fontSize: number; lines: number; rect: Rect }

type SuperLook = {
  fg: string
  plate: 'box' | 'none' | 'scrim'
  plateOpacity: number
}

type SuperMetrics = { lines: number; maxLines: number; size: number }

const SAFE_TOP = 0.12
const SAFE_BOTTOM = 0.2
const SAFE_LEFT = 0.08
const SAFE_RIGHT = 0.12
const SCRIM_PLATEAU = [0.28, 0.72]
const BOX_PAD_EM = 0.6
const BOX_RADIUS_EM = 0.3

const superWidth = (width: number) =>
  Math.round(width * (1 - SAFE_LEFT - SAFE_RIGHT))

const superStyle = (fg: string, px: number): TextStyle => ({
  ...titleStyle(fg, px),
  lineHeight: 1.15,
})

async function superMetrics(
  text: string,
  fg: string,
  box: { height: number; width: number },
): Promise<SuperMetrics> {
  const maxWidth = superWidth(box.width)
  const floor = Math.round(box.width * 0.05)
  let size = Math.round(box.width * 0.085)
  const lineBudget = Math.floor((box.height * 0.55) / (size * 1.15))
  const maxLines = Math.max(2, Math.min(4, lineBudget))
  let lines = await countLines(text, superStyle(fg, size), maxWidth)
  while (lines > maxLines && size > floor) {
    size = Math.max(floor, Math.round(size * 0.93))
    lines = await countLines(text, superStyle(fg, size), maxWidth)
  }
  return { lines, maxLines, size }
}

function plateColour(fg: string): [number, number, number] {
  return luminance(fg) > 0.5 ? [0, 0, 0] : [255, 255, 255]
}

function shadowFor(fg: string): string {
  const c = plateColour(fg).join(',')
  return (
    `0 2px 22px rgba(${c},0.6), 0 0 8px rgba(${c},0.4), ` +
    `0 1px 3px rgba(${c},0.6)`
  )
}

type SuperGeometry = {
  height: number
  inkWidth?: number
  position: 'centre' | 'lower' | 'upper'
  rect?: Rect
  width: number
}

function superTree(
  text: string,
  m: SuperMetrics,
  look: SuperLook,
  geo: SuperGeometry,
  shadow: boolean,
): Node {
  const { height, position, width } = geo
  const justify = {
    centre: 'center',
    lower: 'flex-end',
    upper: 'flex-start',
  }[position]
  const edge = Math.round(height * 0.05)
  const padBottom =
    Math.round(height * SAFE_BOTTOM) + (position === 'lower' ? edge : 0)
  const padTop =
    Math.round(height * SAFE_TOP) + (position === 'upper' ? edge : 0)
  const isBox = look.plate === 'box' && geo.inkWidth !== undefined
  const pad = Math.round(m.size * BOX_PAD_EM)
  const [r, g, b] = plateColour(look.fg)
  const textStyle: Record<string, unknown> = {
    ...superStyle(look.fg, m.size),
    ...(m.lines > m.maxLines ? { lineClamp: m.maxLines } : {}),
    position: 'relative',
    width: superWidth(width),
    wordBreak: 'break-word',
  }
  if (isBox) {
    Object.assign(textStyle, {
      backgroundColor: `rgba(${r},${g},${b},${look.plateOpacity})`,
      borderRadius: Math.round(m.size * BOX_RADIUS_EM),
      padding: pad,
      width: (geo.inkWidth as number) + 8,
    })
  } else if (shadow) {
    textStyle.textShadow = shadowFor(look.fg)
  }
  const layers: Node[] = []
  if (look.plate === 'scrim' && geo.rect) {
    const band = Math.round(geo.rect.h * 2.4)
    const mid = geo.rect.y + geo.rect.h / 2
    const top = Math.max(0, Math.round(mid - band / 2))
    const [p0, p1] = SCRIM_PLATEAU as [number, number]
    const solid = `rgba(${r},${g},${b},${look.plateOpacity})`
    const clear = `rgba(${r},${g},${b},0)`
    layers.push(
      el('div', {
        backgroundImage:
          `linear-gradient(to bottom, ${clear} 0%, ` +
          `${solid} ${p0 * 100}%, ${solid} ${p1 * 100}%, ${clear} 100%)`,
        height: Math.min(band, height - top),
        left: 0,
        position: 'absolute',
        top,
        width,
      }),
    )
  }
  return el(
    'div',
    {
      alignItems: 'center',
      boxSizing: 'border-box',
      display: 'flex',
      flexDirection: 'column',
      fontFamily: 'Inter',
      height,
      justifyContent: justify,
      paddingBottom: padBottom,
      paddingLeft: Math.round(width * SAFE_LEFT),
      paddingRight: Math.round(width * SAFE_RIGHT),
      paddingTop: padTop,
      width,
    },
    [...layers, el('div', textStyle, text)],
  )
}

function inkRect(svg: string, width: number): Rect {
  const fit = { fitTo: { mode: 'width' as const, value: width } }
  const img = new Resvg(svg, fit).render()
  const px = img.pixels
  let x0 = img.width
  let y0 = img.height
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if ((px[(y * img.width + x) * 4 + 3] as number) <= 8) continue
      x0 = Math.min(x0, x)
      x1 = Math.max(x1, x)
      y0 = Math.min(y0, y)
      y1 = Math.max(y1, y)
    }
  }
  if (x1 < 0) return { h: 0, w: 0, x: 0, y: 0 }
  return { h: y1 - y0 + 1, w: x1 - x0 + 1, x: x0, y: y0 }
}

export async function layoutSuper(
  text: string,
  opts: Pick<SuperOpts, 'height' | 'position' | 'width'>,
): Promise<SuperLayout> {
  const look: SuperLook = { fg: LIGHT, plate: 'none', plateOpacity: 0 }
  const m = await superMetrics(text, LIGHT, opts)
  const geo = { ...opts, position: opts.position ?? 'lower' }
  const tree = superTree(text, m, look, geo, false)
  const svg = await toSvg(tree, opts)
  return { fontSize: m.size, lines: m.lines, rect: inkRect(svg, opts.width) }
}

export async function renderSuper(
  text: string,
  opts: SuperOpts,
  outPath: string,
): Promise<string> {
  const { height, width } = opts
  const look: SuperLook = {
    fg: opts.fg ?? LIGHT,
    plate: opts.plate ?? 'none',
    plateOpacity: opts.plateOpacity ?? 0,
  }
  const position = opts.position ?? 'lower'
  const m = await superMetrics(text, look.fg, opts)
  let geo: SuperGeometry = { height, position, width }
  if (look.plate !== 'none') {
    const plain = superTree(text, m, look, geo, false)
    const rect = inkRect(await toSvg(plain, { height, width }), width)
    geo = { ...geo, inkWidth: rect.w, rect }
  }
  const tree = superTree(text, m, look, geo, true)
  return writePng(await toSvg(tree, { height, width }), width, outPath)
}
