import { readFileSync } from 'node:fs'
import { buildBrandKit } from '../src/brand/kit.ts'
import { parseBrief } from '../src/brand/brief.ts'
import { scrapePage } from '../src/brand/scrape.ts'

const file = process.argv[2]
if (!file) {
  console.error('usage: bun scripts/brandkit.ts <brief-file>')
  process.exit(1)
}

const text = readFileSync(file, 'utf8')
const started = performance.now()
const kit = await buildBrandKit(text)
const seconds = ((performance.now() - started) / 1000).toFixed(1)
console.log(JSON.stringify(kit, null, 2))

const brief = parseBrief(text)
const facts = brief.url ? await scrapePage(brief.url) : undefined
const refs =
  kit.productRefs.length + kit.lifestyleRefs.length + (kit.logoRef ? 1 : 0)
const scrape = !facts ? 'no url' : facts.ok ? 'ok' : `blocked (${facts.error})`
const count = facts?.ok ? facts.images.length : 0
console.log(`scrape ${scrape} | ${count} candidates | ${refs} refs kept`)
console.log(`kit built in ${seconds}s`)
if (facts?.ok) {
  for (const img of facts.images.slice(0, 3)) console.log(`  ${img.url}`)
}
