export type ImageCandidate = {
  url: string
  source: 'jsonld' | 'og' | 'twitter' | 'img' | 'icon'
  alt?: string
  width?: number
  height?: number
}

export type PageFacts =
  | {
      ok: true
      finalUrl: string
      title?: string
      description?: string
      siteName?: string
      themeColor?: string
      jsonLd: { type: string; name?: string; description?: string }[]
      images: ImageCandidate[]
      truncated?: boolean
    }
  | { ok: false; url: string; error: string }

type Opts = { timeoutMs?: number; maxBytes?: number }

const MAX_IMAGES = 30
const MIN_SIDE = 64
const JSONLD_TYPES = ['Product', 'Organization', 'WebSite']

export const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,' +
    'image/webp,*/*;q=0.8',
  'Accept-Language': 'en-GB,en;q=0.9',
}

export async function scrapePage(
  url: string,
  opts: Opts = {},
): Promise<PageFacts> {
  const timeoutMs = opts.timeoutMs ?? 10_000
  const maxBytes = opts.maxBytes ?? 4 * 1024 * 1024
  try {
    const res = await fetch(url, {
      headers: BROWSER_HEADERS,
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) return { ok: false, url, error: `HTTP ${res.status}` }
    const type = res.headers.get('content-type') ?? ''
    if (type && !/html/i.test(type)) {
      return { ok: false, url, error: `not HTML (${type.split(';')[0]})` }
    }
    const { text, truncated } = await readCapped(res, maxBytes)
    const facts = await extract(text, res.url || url)
    if (facts.ok && truncated) facts.truncated = true
    return facts
  } catch (err) {
    return { ok: false, url, error: describe(err) }
  }
}

function describe(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      return 'timed out'
    }
    return err.message
  }
  return String(err)
}

async function readCapped(
  res: Response,
  maxBytes: number,
): Promise<{ text: string; truncated: boolean }> {
  if (!res.body) return { text: '', truncated: false }
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  let truncated = false
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    const room = maxBytes - total
    if (value.length > room) {
      chunks.push(value.subarray(0, room))
      truncated = true
      await reader.cancel()
      break
    }
    total += value.length
    chunks.push(value)
  }
  return { text: new TextDecoder().decode(Buffer.concat(chunks)), truncated }
}

type Raw = { url: string; alt?: string; width?: number; height?: number }

function dimension(value: string | null | undefined): number | undefined {
  const m = value?.trim().match(/^(\d+)(?:px)?$/)
  return m ? Number(m[1]) : undefined
}

function largestSrcset(srcset: string): Raw | undefined {
  const entries: { url: string; w?: number; x?: number }[] = []
  const re = /(\S+)(?:\s+(\d+(?:\.\d+)?)([wx]))?\s*(?:,|$)/g
  for (const m of srcset.matchAll(re)) {
    const entry: { url: string; w?: number; x?: number } = { url: m[1]! }
    if (m[3] === 'w') entry.w = Number(m[2])
    else entry.x = m[3] === 'x' ? Number(m[2]) : 1
    entries.push(entry)
  }
  const byWidth = entries.filter((e) => e.w !== undefined)
  const pool = byWidth.length ? byWidth : entries
  let best: (typeof entries)[number] | undefined
  for (const e of pool) {
    if (!best || (e.w ?? e.x ?? 0) > (best.w ?? best.x ?? 0)) best = e
  }
  if (!best) return undefined
  const out: Raw = { url: best.url }
  if (best.w !== undefined) out.width = best.w
  return out
}

function asList<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return []
  return Array.isArray(value) ? value : [value]
}

function imageUrls(value: unknown): string[] {
  return asList(value).flatMap((v): string[] => {
    if (typeof v === 'string') return [v]
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>
      const inner = o.url ?? o.contentUrl
      return typeof inner === 'string' ? [inner] : []
    }
    return []
  })
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function jsonLdNodes(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data.flatMap(jsonLdNodes)
  if (!data || typeof data !== 'object') return []
  const o = data as Record<string, unknown>
  const graph = Array.isArray(o['@graph']) ? jsonLdNodes(o['@graph']) : []
  return [o, ...graph]
}

async function extract(html: string, finalUrl: string): Promise<PageFacts> {
  const meta = new Map<string, string[]>()
  let titleText = ''
  let themeColor: string | undefined
  const jsonBlocks: string[] = []
  let jsonBuf = ''
  const imgs: Raw[] = []
  const icons: Raw[] = []

  const rewriter = new HTMLRewriter()
    .on('meta', {
      element(el) {
        const content = el.getAttribute('content')
        if (content === null) return
        const key = (el.getAttribute('property') ?? el.getAttribute('name'))
          ?.toLowerCase()
          .trim()
        if (!key) return
        if (key === 'theme-color') themeColor ??= content.trim()
        meta.set(key, [...(meta.get(key) ?? []), content.trim()])
      },
    })
    .on('title', {
      text(t) {
        titleText += t.text
      },
    })
    .on('link', {
      element(el) {
        const rel = (el.getAttribute('rel') ?? '').toLowerCase()
        const href = el.getAttribute('href')
        if (!href || !/\bicon\b|apple-touch-icon/.test(rel)) return
        const size = el.getAttribute('sizes')?.match(/^(\d+)x(\d+)/)
        const raw: Raw = { url: href }
        if (size) {
          raw.width = Number(size[1])
          raw.height = Number(size[2])
        }
        icons.push(raw)
      },
    })
    .on('img', {
      element(el) {
        const srcset =
          el.getAttribute('srcset') ?? el.getAttribute('data-srcset')
        const src = el.getAttribute('src') ?? el.getAttribute('data-src')
        const raw: Raw = { url: '' }
        const biggest = srcset ? largestSrcset(srcset) : undefined
        if (biggest) Object.assign(raw, biggest)
        else if (src) raw.url = src
        if (!raw.url) return
        const alt = el.getAttribute('alt')?.trim()
        if (alt) raw.alt = alt
        const width = dimension(el.getAttribute('width'))
        const height = dimension(el.getAttribute('height'))
        if (width !== undefined && raw.width === undefined) raw.width = width
        if (height !== undefined) raw.height = height
        imgs.push(raw)
      },
    })
    .on('script[type="application/ld+json"]', {
      text(t) {
        jsonBuf += t.text
        if (t.lastInTextNode) {
          jsonBlocks.push(jsonBuf)
          jsonBuf = ''
        }
      },
    })

  await rewriter.transform(new Response(html)).text()

  const jsonLd: { type: string; name?: string; description?: string }[] = []
  const productImages: Raw[] = []
  const otherLdImages: Raw[] = []
  for (const block of jsonBlocks) {
    let data: unknown
    try {
      data = JSON.parse(block)
    } catch {
      continue
    }
    for (const node of jsonLdNodes(data)) {
      const type = asList(node['@type'] as string | string[] | undefined).find(
        (t) => JSONLD_TYPES.includes(t),
      )
      if (!type) continue
      const entry: { type: string; name?: string; description?: string } = {
        type,
      }
      const name = str(node.name)
      const description = str(node.description)
      if (name) entry.name = name
      if (description) entry.description = description
      jsonLd.push(entry)
      const target = type === 'Product' ? productImages : otherLdImages
      for (const u of [...imageUrls(node.image), ...imageUrls(node.logo)]) {
        const raw: Raw = { url: u }
        if (name) raw.alt = name
        target.push(raw)
      }
    }
  }

  const first = (key: string) => meta.get(key)?.[0]
  const tagged: { source: ImageCandidate['source']; raw: Raw }[] = [
    ...productImages.map((raw) => ({ source: 'jsonld' as const, raw })),
    ...otherLdImages.map((raw) => ({ source: 'jsonld' as const, raw })),
    ...(meta.get('og:image') ?? []).map((url) => ({
      source: 'og' as const,
      raw: { url },
    })),
    ...(meta.get('twitter:image') ?? []).map((url) => ({
      source: 'twitter' as const,
      raw: { url },
    })),
    ...imgs.map((raw) => ({ source: 'img' as const, raw })),
    ...icons.map((raw) => ({ source: 'icon' as const, raw })),
  ]

  const seen = new Set<string>()
  const images: ImageCandidate[] = []
  for (const { source, raw } of tagged) {
    const resolved = resolve(raw.url, finalUrl)
    if (!resolved || seen.has(resolved)) continue
    if (raw.width !== undefined && raw.width < MIN_SIDE) continue
    if (raw.height !== undefined && raw.height < MIN_SIDE) continue
    seen.add(resolved)
    const candidate: ImageCandidate = { url: resolved, source }
    if (raw.alt) candidate.alt = raw.alt
    if (raw.width !== undefined) candidate.width = raw.width
    if (raw.height !== undefined) candidate.height = raw.height
    images.push(candidate)
    if (images.length >= MAX_IMAGES) break
  }

  const facts: PageFacts = { ok: true, finalUrl, jsonLd, images }
  const title = first('og:title') ?? (titleText.trim() || undefined)
  const description = first('description') ?? first('og:description')
  const siteName = first('og:site_name')
  if (title) facts.title = title.replace(/\s+/g, ' ')
  if (description) facts.description = description
  if (siteName) facts.siteName = siteName
  if (themeColor) facts.themeColor = themeColor
  return facts
}

function resolve(raw: string, base: string): string | undefined {
  const trimmed = raw.trim()
  if (!trimmed || /^data:/i.test(trimmed)) return undefined
  try {
    const url = new URL(trimmed, base)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    return url.href
  } catch {
    return undefined
  }
}
