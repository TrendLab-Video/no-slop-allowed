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

export async function renderSuper(
  text: string,
  opts: SuperOpts,
  outPath: string,
): Promise<string> {
  const { height, width } = opts
  const fg = opts.fg ?? LIGHT
  const maxWidth = Math.round(width * TEXT_FRACTION)
  const floor = Math.round(width * 0.05)
  let size = Math.round(width * 0.085)
  const lineBudget = Math.floor((height * 0.55) / (size * 1.15))
  const maxLines = Math.max(2, Math.min(4, lineBudget))
  const style = (px: number): TextStyle => ({
    ...titleStyle(fg, px),
    lineHeight: 1.15,
  })
  let lines = await countLines(text, style(size), maxWidth)
  while (lines > maxLines && size > floor) {
    size = Math.max(floor, Math.round(size * 0.93))
    lines = await countLines(text, style(size), maxWidth)
  }
  const position = opts.position ?? 'lower'
  const justify = {
    centre: 'center',
    lower: 'flex-end',
    upper: 'flex-start',
  }[position]
  const edge = Math.round(height * 0.05)
  const padBottom = Math.round(height * 0.2) + (position === 'lower' ? edge : 0)
  const padTop = Math.round(height * 0.1) + (position === 'upper' ? edge : 0)
  const tree = el(
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
      paddingTop: padTop,
      width,
    },
    [
      el(
        'div',
        {
          ...style(size),
          ...(lines > maxLines ? { lineClamp: maxLines } : {}),
          textShadow:
            '0 2px 22px rgba(0,0,0,0.6), 0 0 8px rgba(0,0,0,0.4), ' +
            '0 1px 3px rgba(0,0,0,0.6)',
          width: maxWidth,
          wordBreak: 'break-word',
        },
        text,
      ),
    ],
  )
  return writePng(await toSvg(tree, { height, width }), width, outPath)
}
