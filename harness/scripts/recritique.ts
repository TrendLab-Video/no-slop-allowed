import { readFileSync } from 'node:fs'
import { config } from '../src/config.ts'
import { critique, effectiveScore } from '../src/harness/critic.ts'
import type { CritiqueStage } from '../src/prompts.ts'
import type { Critique, RunState } from '../src/types.ts'

// Re-score saved renders with the CURRENT critic and rubric, without re-rendering anything.
// Use it after editing rubric.md or the critic prompt, to see what changes before spending on new runs.
//
//   bun run recritique 1429-vu5l 1433-izee
//   bun run recritique 1433-izee --only final      just the hero images
//
// Costs one vision LLM call per render.

const args = process.argv.slice(2)
const onlyIdx = args.indexOf('--only')
const only = onlyIdx >= 0 ? args.splice(onlyIdx, 2)[1] : undefined
if (!args.length) {
  console.error('Usage: bun run recritique <runId...> [--only final|draft]')
  process.exit(1)
}
if (config.mock) console.warn('MOCK mode: scores are fake. Set FAL_KEY for a real re-score.\n')

const fmt = (c: Critique) => `${c.score}/10 -${c.slop.length} = ${effectiveScore(c)}`
const flags = (c: Critique) => c.slop.map((s) => s.flag.split(':')[0]).join('; ') || 'no slop'
let before = 0
let after = 0
let n = 0

for (const id of args) {
  const s = JSON.parse(readFileSync(`${config.runsDir}/${id}.json`, 'utf8')) as RunState
  const concepts = Object.fromEntries(s.concepts.map((c) => [c.id, c]))
  const renders = s.renders.filter((r) => r.kind === 'image' && r.critique)
  const stageOf = (rid: string): CritiqueStage => (rid.endsWith('-final') ? 'final' : 'draft')
  const picked = renders.filter((r) => !only || stageOf(r.id) === only)
  console.log(`\n${id}: ${picked.length} renders`)
  const results = await Promise.all(picked.map(async (r) => ({ r, now: await critique(s.brief, concepts[r.conceptId]!, r, stageOf(r.id)) })))
  for (const { r, now } of results) {
    before += effectiveScore(r.critique!)
    after += effectiveScore(now)
    n++
    console.log(`  ${r.id.padEnd(9)} saved ${fmt(r.critique!).padEnd(16)} now ${fmt(now).padEnd(16)} ${flags(now)}`)
  }
}
if (n) console.log(`\nMean score minus slop: saved ${(before / n).toFixed(2)}, now ${(after / n).toFixed(2)} (${n} renders)`)
