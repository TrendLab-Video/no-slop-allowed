import { readFileSync } from 'node:fs'
import { config, defaultOptions, sanitiseOptions } from './config.ts'
import { runHarness } from './harness/loop.ts'
import { briefSlug } from './outputs.ts'
import { Run } from './trace.ts'

// bun run harness "your brief"            run on a brief string
// bun run harness briefs/example.md       run on a brief file
// bun run harness briefs/example.md --video --concepts 6 --finalists 2 --iters 2

const USAGE = 'Usage: bun run harness "<brief>" | <brief-file> [--no-video] [--seconds N] [--takes N] [--concepts N] [--finalists K] [--iters N] [--patience N]'
const NUMERIC = { concepts: 'concepts', finalists: 'finalists', iters: 'maxIters', patience: 'patience', seconds: 'videoSeconds', takes: 'videoTakes' } as const

const opts: Record<string, unknown> = {}
const positional: string[] = []
const argv = process.argv.slice(2)

for (let i = 0; i < argv.length; i++) {
  const arg = argv[i]!
  if (!arg.startsWith('--')) {
    positional.push(arg)
    continue
  }
  const [name, inline] = arg.slice(2).split('=', 2) as [string, string | undefined]
  if (name === 'video' || name === 'no-video') {
    if (name === 'no-video' && inline !== undefined) fail('--no-video takes no value')
    if (inline === undefined) opts.video = name === 'video'
    else if (/^(1|true|yes|on)$/i.test(inline)) opts.video = true
    else if (/^(0|false|no|off)$/i.test(inline)) opts.video = false
    else fail(`--video needs true or false, got ${JSON.stringify(inline)}`)
    continue
  }
  if (name in NUMERIC) {
    const raw = inline ?? argv[++i]
    const n = Number(raw)
    if (raw === undefined || !Number.isFinite(n)) fail(`--${name} needs a number, got ${JSON.stringify(raw)}`)
    opts[NUMERIC[name as keyof typeof NUMERIC]] = n
    continue
  }
  fail(`Unknown flag --${name}`)
}

const input = positional[0]
if (!input) fail('No brief given')

let brief = input
let source: string | undefined
try {
  brief = readFileSync(input, 'utf8')
  source = input
} catch {
  // not a file, treat as the brief itself
}

const options = { ...defaultOptions, ...sanitiseOptions(opts) }
console.log(`mode: ${config.mock ? 'MOCK (no network)' : 'live fal'}, concurrency ${config.concurrency}, ${JSON.stringify(options)}`)

const run = new Run(brief.trim(), options)
// Outputs go to <output dir>/<brief file name>/, e.g. ../outputs/01-ep-133/final.mp4
if (source) {
  run.state.source = source
  run.state.slug = briefSlug(source)
}
try {
  await runHarness(run, options)
  const f = run.state.final
  const out = run.state.outputs
  console.log(`\nWinner: ${f?.conceptId}\nImage: ${short(f?.image?.url)}${f?.video ? `\nVideo: ${short(f.video.url)}` : ''}\nOutputs: ${out ? `${out.video ?? '(no video file)'}, ${out.traces}` : '(not written)'}\nRun: ${config.runsDir}/${run.id}.json`)
} catch (err) {
  run.finish('error', String(err))
  console.error(err)
  process.exit(1)
}

function fail(msg: string): never {
  console.error(`${msg}\n${USAGE}`)
  process.exit(1)
}

function short(url?: string) {
  if (!url) return '(none)'
  return url.startsWith('data:') ? '(mock placeholder)' : url
}
