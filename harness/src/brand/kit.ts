import { z } from 'zod'
import { config } from '../config.ts'
import { completeJson } from '../llm.ts'
import type { Run } from '../trace.ts'
import { parseBrief } from './brief.ts'
import { MIN_SHORT_SIDE, type Prepared, prepareImage } from './prepare.ts'
import { downloadImage, uploadBytes } from './rehost.ts'
import { type ImageCandidate, scrapePage } from './scrape.ts'

export type BrandKit = {
  name: string
  url?: string
  description: string
  productDescription: string
  isPhysical: boolean
  productRefs: string[]
  logoRef?: string
  lifestyleRefs: string[]
  palette: string[]
  tone: string
  mustNotInvent: string[]
  notes: string[]
}

const MIN_BYTES = 15 * 1024
const TRIED = 16
const FETCH_AT_ONCE = 6
const MAX_SENT = 8
const RETRY_SENT = 4
const MAX_PRODUCT = 3
const MAX_LIFESTYLE = 2

type Ready = Extract<Prepared, { ok: true }>
type Kept = { candidate: ImageCandidate; image: Ready; url: string }
type Slot =
  | { kind: 'kept'; image: Ready }
  | { kind: 'rejected'; reason: string }
  | { kind: 'skipped' }

type Gathered = { kept: Kept[]; rejected: string[]; skipped: number }

async function inspect(candidate: ImageCandidate): Promise<Slot> {
  const got = await downloadImage(candidate.url)
  if (!got.ok || got.bytes.length < MIN_BYTES) return { kind: 'skipped' }
  const image = await prepareImage(got.bytes, got.type)
  if (!image.ok) return { kind: 'rejected', reason: image.reason }
  return { image, kind: 'kept' }
}

async function gather(candidates: ImageCandidate[]): Promise<Gathered> {
  const tried = candidates.slice(0, TRIED)
  const slots: (Slot | undefined)[] = new Array(tried.length).fill(undefined)
  let next = 0
  let kept = 0
  const worker = async () => {
    while (kept < MAX_SENT && next < tried.length) {
      const i = next++
      const slot = await inspect(tried[i]!)
      slots[i] = slot
      if (slot.kind === 'kept') kept++
    }
  }
  const lanes = Math.min(FETCH_AT_ONCE, tried.length)
  await Promise.all(Array.from({ length: lanes }, worker))

  const out: Gathered = { kept: [], rejected: [], skipped: 0 }
  slots.forEach((slot, i) => {
    if (!slot) return
    if (slot.kind === 'rejected') out.rejected.push(slot.reason)
    else if (slot.kind === 'skipped') out.skipped++
    else if (out.kept.length < MAX_SENT) {
      out.kept.push({ candidate: tried[i]!, image: slot.image, url: '' })
    }
  })
  return out
}

const PickSchema = z.object({
  productDescription: z.string(),
  isPhysical: z.boolean(),
  picks: z.array(
    z.object({
      index: z.number().int(),
      role: z.enum(['product', 'logo', 'lifestyle']),
      why: z.string(),
    }),
  ),
  palette: z.array(z.string()),
  tone: z.string(),
  mustNotInvent: z.array(z.string()),
})

const SYSTEM =
  'You are a brand researcher preparing reference material for an image ' +
  'model. You look at real images from a brand website and say exactly ' +
  'what the brand sells and how it looks. You never invent details.'

function pickPrompt(
  name: string,
  description: string,
  shown: Kept[],
  facts: { title?: string; description?: string; siteName?: string },
): string {
  const list = shown
    .map(({ candidate: c, image }, i) => {
      const bits = [`source: ${c.source}`, `${image.width}x${image.height}`]
      if (c.alt) bits.push(`alt: ${c.alt}`)
      return `Image ${i}: ${bits.join(', ')}`
    })
    .join('\n')
  return [
    `Brand: ${name}`,
    `Brief: ${description}`,
    facts.siteName ? `Site name: ${facts.siteName}` : '',
    facts.title ? `Page title: ${facts.title}` : '',
    facts.description ? `Page description: ${facts.description}` : '',
    '',
    `The ${shown.length} attached images are numbered in order from 0:`,
    list,
    '',
    'Look at the images and answer:',
    '- productDescription: what is sold and how it looks: shape, ' +
      'materials, colours and the exact wordmark text printed on it.',
    '- isPhysical: true if the brand sells a physical product.',
    "- picks: choose by index. role 'product' is a clean shot of the " +
      'whole product with no people (up to 3). Role ' +
      "'logo' is the logo (at most 1). Role 'lifestyle' is a photo that " +
      'shows the product or brand in use (up to 2). Skip images that fit ' +
      'no role. Give a short reason for each pick. For each role, prefer ' +
      'the largest and sharpest image. If the page shows several products, ' +
      'pick the one the brief text names first.',
    '- palette: the brand colours as hex codes.',
    '- tone: the brand voice in a few words.',
    '- mustNotInvent: the things an image model must copy from these ' +
      'references and never make up, such as the wordmark, the pack ' +
      'layout and the product shape.',
    '',
    'Schema: {"productDescription": string, "isPhysical": boolean, ' +
      '"picks": [{"index": number, "role": "product"|"logo"|"lifestyle", ' +
      '"why": string}], "palette": string[], "tone": string, ' +
      '"mustNotInvent": string[]}',
  ]
    .filter((l, i, all) => l !== '' || all[i - 1] !== '')
    .join('\n')
}

const ms = (since: number) => Math.round(performance.now() - since)
const errText = (err: unknown) =>
  err instanceof Error ? err.message : String(err)

async function uploadAll(gathered: Kept[], notes: string[]): Promise<Kept[]> {
  if (config.mock) {
    return gathered.map((k) => ({ ...k, url: k.candidate.url }))
  }
  const sent = await Promise.all(
    gathered.map(async (k) => {
      try {
        const bytes = new Uint8Array(k.image.bytes)
        return { ...k, url: await uploadBytes(bytes, k.image.type) }
      } catch (err) {
        notes.push(
          `Could not upload ${k.candidate.url}: ${errText(err).slice(0, 120)}`,
        )
        return undefined
      }
    }),
  )
  return sent.filter((k): k is Kept => k !== undefined)
}

export async function buildBrandKit(
  briefText: string,
  run?: Run,
): Promise<BrandKit> {
  const brief = parseBrief(briefText)
  const kit: BrandKit = {
    name: brief.name,
    description: brief.description,
    productDescription: brief.description,
    isPhysical: false,
    productRefs: [],
    lifestyleRefs: [],
    palette: [],
    tone: '',
    mustNotInvent: [],
    notes: [],
  }
  if (brief.url) kit.url = brief.url

  const timing = { pickMs: 0, prepareMs: 0, scrapeMs: 0, uploadMs: 0 }
  let rejected: string[] = []
  let skipped = 0

  const finish = (where: string): BrandKit => {
    const found =
      kit.productRefs.length + kit.lifestyleRefs.length + (kit.logoRef ? 1 : 0)
    run?.emit(
      'brief',
      `Brand kit: ${found} reference image(s) found (${where})`,
      {
        logo: Boolean(kit.logoRef),
        notes: kit.notes,
        products: kit.productRefs.length,
        lifestyle: kit.lifestyleRefs.length,
        rejected: { count: rejected.length, reasons: rejected },
        skipped,
        ...timing,
      },
    )
    return kit
  }

  if (!brief.url) {
    kit.notes.push('No URL in the brief, so no reference images were fetched.')
    return finish('no url')
  }
  const host = new URL(brief.url).hostname

  const scrapeStart = performance.now()
  const facts = await scrapePage(brief.url)
  timing.scrapeMs = ms(scrapeStart)
  if (!facts.ok) {
    kit.notes.push(`Scrape of ${brief.url} failed: ${facts.error}.`)
    return finish(`scrape failed on ${host}`)
  }
  if (facts.themeColor) kit.palette = [facts.themeColor]

  const prepareStart = performance.now()
  const gathered = await gather(facts.images)
  rejected = gathered.rejected
  skipped = gathered.skipped
  timing.prepareMs = ms(prepareStart)
  if (!gathered.kept.length) {
    kit.notes.push(
      `No usable image (${MIN_BYTES / 1024} KB or more, ` +
        `${MIN_SHORT_SIDE} px or more on the short side) among ` +
        `${facts.images.length} candidate(s) on ${host}.`,
    )
    return finish(`no usable images on ${host}`)
  }

  const uploadStart = performance.now()
  const kept = await uploadAll(gathered.kept, kit.notes)
  timing.uploadMs = ms(uploadStart)
  if (!kept.length) return finish(`no image could be uploaded on ${host}`)

  const pickStart = performance.now()
  const ask = (shown: Kept[]) =>
    completeJson(
      {
        task: 'brand.pick',
        system: SYSTEM,
        prompt: pickPrompt(brief.name, brief.description, shown, facts),
        imageUrls: shown.map((k) => k.url),
        temperature: 0.2,
        maxTokens: 1500,
      },
      PickSchema,
      run,
    )
  let shown = kept
  let pick: z.infer<typeof PickSchema>
  try {
    pick = await ask(shown)
  } catch {
    shown = kept.slice(0, RETRY_SENT)
    try {
      pick = await ask(shown)
    } catch (err) {
      timing.pickMs = ms(pickStart)
      kit.notes.push(`Reference pick failed: ${errText(err).slice(0, 200)}`)
      return finish(`pick failed on ${host}`)
    }
  }
  timing.pickMs = ms(pickStart)

  kit.productDescription = pick.productDescription.trim() || kit.description
  kit.isPhysical = pick.isPhysical
  if (pick.palette.length) kit.palette = pick.palette
  kit.tone = pick.tone
  kit.mustNotInvent = pick.mustNotInvent

  const taken = new Set<number>()
  const chosen = (role: 'product' | 'logo' | 'lifestyle', max: number) => {
    const out: string[] = []
    for (const p of pick.picks) {
      if (p.role !== role || out.length >= max) continue
      const k = shown[p.index]
      if (!k || taken.has(p.index)) continue
      taken.add(p.index)
      out.push(k.url)
    }
    return out
  }
  kit.productRefs = chosen('product', MAX_PRODUCT)
  kit.lifestyleRefs = chosen('lifestyle', MAX_LIFESTYLE)
  const logo = chosen('logo', 1)[0]
  if (logo) kit.logoRef = logo
  if (!kit.productRefs.length) {
    kit.notes.push('No clean product image was found on the page.')
  }
  return finish(`${host}, ${shown.length} candidate(s) shown to model`)
}
