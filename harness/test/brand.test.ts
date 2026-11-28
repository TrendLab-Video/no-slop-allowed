import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { parseBrief } from '../src/brand/brief.ts'
import { buildBrandKit } from '../src/brand/kit.ts'
import { prepareImage } from '../src/brand/prepare.ts'
import { rehost } from '../src/brand/rehost.ts'
import { scrapePage } from '../src/brand/scrape.ts'
import { Run } from '../src/trace.ts'

const BRIEFS_DIR = join(import.meta.dir, '..', '..', 'briefs')
const BRIEF_FILES = readdirSync(BRIEFS_DIR).filter((f) => f.endsWith('.md'))

function pngOfSize(kb: number): Uint8Array<ArrayBuffer> {
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length)
    const view = new DataView(out.buffer)
    view.setUint32(0, data.length)
    const body = new Uint8Array(4 + data.length)
    body.set(new TextEncoder().encode(type), 0)
    body.set(data, 4)
    out.set(body, 4)
    view.setUint32(8 + data.length, Bun.hash.crc32(body))
    return out
  }
  const ihdr = new Uint8Array(13)
  const dv = new DataView(ihdr.buffer)
  dv.setUint32(0, 1)
  dv.setUint32(4, 1)
  ihdr.set([8, 2, 0, 0, 0], 8)
  const pad = new Uint8Array(Math.max(0, kb * 1024 - 80))
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('tEXt', pad),
    chunk('IDAT', new Uint8Array([8, 29, 99, 248, 15, 0, 1, 1, 1, 0])),
    chunk('IEND', new Uint8Array()),
  ]
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

const FLAT_WEBP_1000 = Buffer.from(
  'UklGRk4AAABXRUJQVlA4TEEAAAAv58P5AAfQssI0uf8BAUnS//9kRP8z/vOf//znP/' +
    '/5z3/+85///Oc///nPf/7zn//85z//+c9//vOf//znP/8nAwA=',
  'base64',
)

const MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
}

let picDir: string
const pics = new Map<string, Uint8Array<ArrayBuffer>>()
const hits = new Map<string, number>()

function ffmpegImage(name: string, source: string, jpeg = false): void {
  const file = join(picDir, name)
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi']
  args.push('-i', source, '-frames:v', '1')
  if (jpeg) args.push('-q:v', '3')
  const done = Bun.spawnSync(['ffmpeg', ...args, file])
  if (done.exitCode !== 0) throw new Error(done.stderr.toString())
  pics.set(name, new Uint8Array(readFileSync(file)))
}

const NOISE = (size: string) => `color=c=gray:s=${size},noise=alls=100:allf=t`
const TEST = (size: string) => `testsrc2=size=${size}:rate=1`

function makeFixtures(): void {
  picDir = mkdtempSync(join(tmpdir(), 'brand-test-'))
  ffmpegImage('big.png', TEST('600x600'))
  ffmpegImage('huge.jpg', TEST('3000x2000'), true)
  ffmpegImage('small.png', TEST('300x300'))
  ffmpegImage('thumb1.png', NOISE('128x128'))
  ffmpegImage('thumb2.png', NOISE('128x128'))
  ffmpegImage('wide.jpg', TEST('1000x700'), true)
  const padded = new Uint8Array(20_000 + FLAT_WEBP_1000.length)
  padded.set(FLAT_WEBP_1000)
  pics.set('pad.webp', padded)
  pics.set('flat.webp', new Uint8Array(FLAT_WEBP_1000))
}

const html = (body: string) =>
  new Response(body, {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  })

const PRODUCT_PAGE = `<!doctype html><html><head>
<title>Fixture Page</title>
<meta name="description" content="Meta description">
<meta property="og:title" content="OG Title">
<meta property="og:description" content="OG description">
<meta property="og:site_name" content="Fixture Co">
<meta property="og:image" content="/img/20.png">
<meta name="twitter:image" content="/img/21.png">
<meta name="theme-color" content="#ff0000">
<link rel="icon" href="/img/22.png" sizes="192x192">
<link rel="apple-touch-icon" href="/img/23.png">
<script type="application/ld+json">
{"@context":"https://schema.org","@graph":[
{"@type":"Organization","name":"Fixture Co","logo":"/img/24.png"},
{"@type":"Product","name":"Widget","description":"A widget",
 "image":["/img/30.png",{"@type":"ImageObject","url":"/img/31.png"}]}
]}
</script>
</head><body>
<img src="/img/25.png" alt="Shot" width="800" height="600">
<img src="/img/20.png" alt="Duplicate of og">
<img
  src="/img/26.png"
  srcset="/img/26.png 400w, /img/27.png 1200w, /img/28.png 800w"
  alt="Srcset">
<img src="/img/2.png" width="32" height="32" alt="Tiny">
<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="Inline">
</body></html>`

const manyImages = () => {
  const tags = Array.from(
    { length: 40 },
    (_, i) => `<img src="/img/${100 + i}.png">`,
  )
  return `<html><body>${tags.join('')}</body></html>`
}

const KIT_PAGE = `<html><head><title>Kit Co</title>
<meta property="og:image" content="/img/22.png">
<meta name="twitter:image" content="/img/2.png">
<script type="application/ld+json">
{"@type":"Product","name":"Kit","image":["/img/20.png","/img/21.png"]}
</script></head><body>
<img src="/img/23.png" width="500" height="500">
<img src="/img/24.png" width="500" height="500">
<img src="/img/25.png" width="500" height="500">
<img src="/img/26.png" width="500" height="500">
<img src="/missing.png" width="500" height="500">
</body></html>`

const THUMBS_PAGE = `<html><head><title>Thumb Co</title>
<meta property="og:image" content="/pic/thumb1.png">
</head><body>
<img src="/pic/thumb2.png">
<img src="/pic/pad.webp">
<img src="/pic/wide.jpg">
<img src="/pic/big.png">
<img src="/pic/huge.jpg">
</body></html>`

let server: ReturnType<typeof Bun.serve>
let base: string

beforeAll(() => {
  makeFixtures()
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const { pathname } = new URL(req.url)
      hits.set(pathname, (hits.get(pathname) ?? 0) + 1)
      const png = pathname.match(/^\/img\/(\d+)\.png$/)
      if (png) {
        const kb = Number(png[1])
        const body = kb >= 15 ? pics.get('big.png')! : pngOfSize(kb)
        return new Response(body, { headers: { 'content-type': 'image/png' } })
      }
      const pic = pathname.match(/^\/pic\/(.+\.(\w+))$/)
      if (pic) {
        const body = pics.get(pic[1]!)
        if (!body) return new Response('nope', { status: 404 })
        const type = MIME[pic[2]!] ?? 'application/octet-stream'
        return new Response(body, { headers: { 'content-type': type } })
      }
      switch (pathname) {
        case '/product':
          return html(PRODUCT_PAGE)
        case '/many':
          return html(manyImages())
        case '/kit':
          return html(KIT_PAGE)
        case '/thumbs':
          return html(THUMBS_PAGE)
        case '/redirect':
          return Response.redirect('/product', 302)
        case '/slow':
          await Bun.sleep(1500)
          return html('<html></html>')
        case '/json':
          return Response.json({ a: 1 })
        case '/huge':
          return html(
            '<html><head><title>Early Title</title></head><body>' +
              '<img src="/img/20.png">' +
              `${'x'.repeat(20_000)}<img src="/img/21.png"></body></html>`,
          )
        default:
          return new Response('nope', { status: 404 })
      }
    },
  })
  base = `http://localhost:${server.port}`
})

afterAll(() => {
  server.stop(true)
  rmSync(picDir, { force: true, recursive: true })
})

describe('parseBrief', () => {
  test('finds the four real briefs', () => {
    expect(BRIEF_FILES).toHaveLength(4)
  })

  for (const file of BRIEF_FILES) {
    test(`real brief ${file}`, () => {
      const text = readFileSync(join(BRIEFS_DIR, file), 'utf8')
      const brief = parseBrief(text)
      expect(brief.name.length).toBeGreaterThan(1)
      expect(brief.name.startsWith('#')).toBe(false)
      expect(brief.url).toMatch(/^https:\/\//)
      expect(brief.description.length).toBeGreaterThan(40)
      expect(brief.description).not.toContain('URL:')
      expect(brief.raw).toContain(brief.name)
    })
  }

  test('nike brief fields', () => {
    const text = readFileSync(join(BRIEFS_DIR, '02-nike.md'), 'utf8')
    const brief = parseBrief(text)
    expect(brief.name).toBe('Nike')
    expect(brief.url).toBe('https://www.nike.com/')
    expect(brief.description.startsWith('A global sportswear brand')).toBe(
      true,
    )
  })

  test('no heading: the first non-empty line is the name', () => {
    const text = '\n\nAcme Rockets\nurl: https://acme.test\nThey sell rockets.'
    const brief = parseBrief(text)
    expect(brief.name).toBe('Acme Rockets')
    expect(brief.url).toBe('https://acme.test/')
    expect(brief.description).toBe('They sell rockets.')
  })

  test('URL line in any case', () => {
    const text = '# Acme\nuRl:   https://acme.test/shop\n\nRockets.'
    expect(parseBrief(text).url).toBe('https://acme.test/shop')
  })

  test('no URL', () => {
    const brief = parseBrief('# Acme\n\nRockets for everyone.')
    expect(brief.url).toBeUndefined()
    expect(brief.name).toBe('Acme')
    expect(brief.description).toBe('Rockets for everyone.')
  })

  test('a one-line plain string', () => {
    const brief = parseBrief('Oat milk for people who hate oat milk')
    expect(brief.name).toBe('Oat milk for people who hate oat milk')
    expect(brief.description).toBe('Oat milk for people who hate oat milk')
    expect(brief.url).toBeUndefined()
  })

  test('a scheme-less or invalid URL line', () => {
    expect(parseBrief('# A\nURL: www.granola.ai\n\nx').url).toBe(
      'https://www.granola.ai/',
    )
    expect(parseBrief('# A\nURL: not a url\n\nx').url).toBeUndefined()
  })

  test('empty text does not throw', () => {
    const brief = parseBrief('   ')
    expect(brief.name).toBe('')
    expect(brief.description).toBe('')
  })
})

describe('scrapePage', () => {
  test('reads titles, descriptions and colour', async () => {
    const facts = await scrapePage(`${base}/product`)
    if (!facts.ok) throw new Error(facts.error)
    expect(facts.finalUrl).toBe(`${base}/product`)
    expect(facts.title).toBe('OG Title')
    expect(facts.description).toBe('Meta description')
    expect(facts.siteName).toBe('Fixture Co')
    expect(facts.themeColor).toBe('#ff0000')
  })

  test('JSON-LD Product images lead, then og, twitter, img, icon', async () => {
    const facts = await scrapePage(`${base}/product`)
    if (!facts.ok) throw new Error(facts.error)
    expect(facts.jsonLd.map((j) => j.type)).toEqual(['Organization', 'Product'])
    expect(facts.jsonLd[1]).toEqual({
      type: 'Product',
      name: 'Widget',
      description: 'A widget',
    })
    const order = facts.images.map(
      (i) => `${i.source}:${new URL(i.url).pathname}`,
    )
    expect(order).toEqual([
      'jsonld:/img/30.png',
      'jsonld:/img/31.png',
      'jsonld:/img/24.png',
      'og:/img/20.png',
      'twitter:/img/21.png',
      'img:/img/25.png',
      'img:/img/27.png',
      'icon:/img/22.png',
      'icon:/img/23.png',
    ])
  })

  test('relative URLs resolve against the final page URL', async () => {
    const facts = await scrapePage(`${base}/redirect`)
    if (!facts.ok) throw new Error(facts.error)
    expect(facts.finalUrl).toBe(`${base}/product`)
    expect(facts.images[0]?.url).toBe(`${base}/img/30.png`)
  })

  test('srcset keeps the largest entry, with its width', async () => {
    const facts = await scrapePage(`${base}/product`)
    if (!facts.ok) throw new Error(facts.error)
    const srcset = facts.images.find((i) => i.alt === 'Srcset')
    expect(srcset?.url).toBe(`${base}/img/27.png`)
    expect(srcset?.width).toBe(1200)
  })

  test('drops duplicates, tiny images and data URIs', async () => {
    const facts = await scrapePage(`${base}/product`)
    if (!facts.ok) throw new Error(facts.error)
    const urls = facts.images.map((i) => i.url)
    expect(new Set(urls).size).toBe(urls.length)
    expect(urls.some((u) => u.startsWith('data:'))).toBe(false)
    expect(urls.some((u) => u.endsWith('/img/2.png'))).toBe(false)
  })

  test('caps the list at 30', async () => {
    const facts = await scrapePage(`${base}/many`)
    if (!facts.ok) throw new Error(facts.error)
    expect(facts.images).toHaveLength(30)
  })

  test('a 404 returns ok: false', async () => {
    const facts = await scrapePage(`${base}/gone`)
    expect(facts.ok).toBe(false)
    if (!facts.ok) expect(facts.error).toContain('404')
  })

  test('a timeout returns ok: false', async () => {
    const facts = await scrapePage(`${base}/slow`, { timeoutMs: 200 })
    expect(facts.ok).toBe(false)
  })

  test('a non-HTML body returns ok: false', async () => {
    const facts = await scrapePage(`${base}/json`)
    expect(facts.ok).toBe(false)
  })

  test('an over-cap body is parsed as far as it was read', async () => {
    const facts = await scrapePage(`${base}/huge`, { maxBytes: 300 })
    if (!facts.ok) throw new Error(facts.error)
    expect(facts.truncated).toBe(true)
    expect(facts.title).toBe('Early Title')
    expect(facts.images.map((i) => new URL(i.url).pathname)).toEqual([
      '/img/20.png',
    ])
  })

  test('a body within the cap is not marked truncated', async () => {
    const facts = await scrapePage(`${base}/product`)
    if (!facts.ok) throw new Error(facts.error)
    expect(facts.truncated).toBeUndefined()
  })

  test('a refused connection returns ok: false', async () => {
    const facts = await scrapePage('http://127.0.0.1:1/')
    expect(facts.ok).toBe(false)
  })

  test('a malformed URL returns ok: false', async () => {
    const facts = await scrapePage('not a url')
    expect(facts.ok).toBe(false)
  })
})

describe('prepareImage', () => {
  const pic = (name: string) => pics.get(name)!

  test('a 1000 x 1000 WebP becomes a JPEG of the same size', async () => {
    const out = await prepareImage(pic('flat.webp'), 'image/webp')
    if (!out.ok) throw new Error(out.reason)
    expect(out.type).toBe('image/jpeg')
    expect([out.width, out.height]).toEqual([1000, 1000])
    expect(out.bytes[0]).toBe(0xff)
    expect(out.bytes[1]).toBe(0xd8)
  })

  test('a 600 x 600 PNG passes through unchanged', async () => {
    const out = await prepareImage(pic('big.png'), 'image/png')
    if (!out.ok) throw new Error(out.reason)
    expect(out.type).toBe('image/png')
    expect([out.width, out.height]).toEqual([600, 600])
    expect(out.bytes).toEqual(pic('big.png'))
  })

  test('a 300 x 300 PNG is rejected with a reason', async () => {
    const out = await prepareImage(pic('small.png'), 'image/png')
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toContain('300')
  })

  test('a 3000 x 2000 JPEG comes back 2048 on the long side', async () => {
    const out = await prepareImage(pic('huge.jpg'), 'image/jpeg')
    if (!out.ok) throw new Error(out.reason)
    expect(out.type).toBe('image/jpeg')
    expect(out.width).toBe(2048)
    expect(out.height).toBeGreaterThan(1360)
    expect(out.height).toBeLessThan(1370)
  })

  test('an SVG is rejected', async () => {
    const svg = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900"/>',
    )
    const out = await prepareImage(svg, 'image/svg+xml')
    expect(out.ok).toBe(false)
  })

  test('garbage bytes are rejected', async () => {
    const junk = new Uint8Array(30_000).map((_, i) => (i * 31) % 251)
    const out = await prepareImage(junk, 'image/png')
    expect(out.ok).toBe(false)
  })

  test('an ICO is rejected', async () => {
    const ico = new Uint8Array(2000)
    ico.set([0, 0, 1, 0, 1, 0])
    const out = await prepareImage(ico, 'image/x-icon')
    expect(out.ok).toBe(false)
  })
})

describe('rehost', () => {
  test('mock mode returns the original URL', async () => {
    expect(await rehost(`${base}/img/20.png`)).toBe(`${base}/img/20.png`)
  })
})

describe('buildBrandKit (mock mode)', () => {
  const brief = (url: string) => `# Kit Co\nURL: ${url}\n\nSells kits.`

  test('picks map to the right fields and product refs cap at 3', async () => {
    const kit = await buildBrandKit(brief(`${base}/kit`))
    expect(kit.name).toBe('Kit Co')
    expect(kit.description).toBe('Sells kits.')
    expect(kit.isPhysical).toBe(true)
    expect(kit.productRefs).toEqual([
      `${base}/img/20.png`,
      `${base}/img/21.png`,
      `${base}/img/22.png`,
    ])
    expect(kit.logoRef).toBe(`${base}/img/24.png`)
    expect(kit.lifestyleRefs).toEqual([
      `${base}/img/25.png`,
      `${base}/img/26.png`,
    ])
    expect(kit.productDescription.length).toBeGreaterThan(0)
    expect(kit.mustNotInvent.length).toBeGreaterThan(0)
  })

  test('candidates under 15 KB and unfetchable ones are skipped', async () => {
    const kit = await buildBrandKit(brief(`${base}/kit`))
    const all = [...kit.productRefs, kit.logoRef, ...kit.lifestyleRefs]
    expect(all.some((u) => u?.endsWith('/img/2.png'))).toBe(false)
    expect(all.some((u) => u?.endsWith('/missing.png'))).toBe(false)
  })

  test('a failed scrape gives an empty kit with a note', async () => {
    const kit = await buildBrandKit(brief(`${base}/gone`))
    expect(kit.productRefs).toEqual([])
    expect(kit.lifestyleRefs).toEqual([])
    expect(kit.logoRef).toBeUndefined()
    expect(kit.productDescription).toBe('Sells kits.')
    expect(kit.notes.length).toBeGreaterThan(0)
  })

  test('no URL gives an empty kit with a note', async () => {
    const kit = await buildBrandKit('# Kit Co\n\nSells kits.')
    expect(kit.productRefs).toEqual([])
    expect(kit.notes.join(' ')).toMatch(/no url/i)
  })

  test('thumbnails are rejected and every image is fetched once', async () => {
    hits.clear()
    const run = new Run('t', {})
    const kit = await buildBrandKit(brief(`${base}/thumbs`), run)
    expect(kit.productRefs).toEqual([
      `${base}/pic/pad.webp`,
      `${base}/pic/wide.jpg`,
      `${base}/pic/big.png`,
    ])
    const all = [...kit.productRefs, kit.logoRef, ...kit.lifestyleRefs]
    expect(all.some((u) => u?.includes('thumb'))).toBe(false)
    for (const [path, n] of hits) expect(`${path} ${n}`).toBe(`${path} 1`)
    expect(hits.get('/thumbs')).toBe(1)
    expect(hits.get('/pic/thumb1.png')).toBe(1)

    const event = run.state.events.find((e) => e.stage === 'brief')
    const data = event?.data as Record<string, any>
    for (const key of ['scrapeMs', 'prepareMs', 'pickMs']) {
      expect(typeof data[key]).toBe('number')
    }
    expect(data.rejected.count).toBe(2)
    expect(data.rejected.reasons).toHaveLength(2)
  })

  test('emits one brief event', async () => {
    const run = new Run('b', {})
    await buildBrandKit(brief(`${base}/kit`), run)
    const events = run.state.events.filter((e) => e.stage === 'brief')
    expect(events).toHaveLength(1)
    expect(events[0]?.message).toContain('reference')
  })
})
