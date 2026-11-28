import { readFileSync } from 'node:fs'
import { config } from '../src/config.ts'
import { completeJson } from '../src/llm.ts'
import { compareFinalPrompt, JUDGE_SYSTEM } from '../src/prompts.ts'
import { CompareSchema, type RunState } from '../src/types.ts'

// A/B test a change to the harness by judging the final images of saved runs head to head.
// Absolute critic scores drift; pairwise judgements, run in both orders, are the fairer signal.
//
//   bun run compare --a 0926-xts8,1353-txw9 --b 1416-ulrj,1423-1l3q
//
// Every hero in group A is judged against every hero in group B, twice with the order swapped.
// Costs one vision LLM call per judgement (about half a cent each).

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? (process.argv[i + 1] ?? '').split(',').filter(Boolean) : []
}
const groupA = arg('a')
const groupB = arg('b')
if (!groupA.length || !groupB.length) {
  console.error('Usage: bun run compare --a <runId,...> --b <runId,...>')
  process.exit(1)
}
if (config.mock) console.warn('MOCK mode: verdicts are fake. Set FAL_KEY for a real comparison.\n')

const load = (id: string) => {
  const s = JSON.parse(readFileSync(`${config.runsDir}/${id}.json`, 'utf8')) as RunState
  const url = s.final?.image?.url
  if (!url) throw new Error(`run ${id} has no final image`)
  return { id, brief: s.brief, url }
}
const A = groupA.map(load)
const B = groupB.map(load)
const brief = A[0]!.brief
if ([...A, ...B].some((r) => r.brief !== brief)) console.warn('Warning: the runs used different briefs; judging against the first.\n')

const ask = (first: string, second: string) =>
  completeJson({ task: 'compare.final', system: JUDGE_SYSTEM, prompt: compareFinalPrompt(brief), imageUrls: [first, second], temperature: 0.2, maxTokens: 400 }, CompareSchema)

let winsA = 0
let winsB = 0
let split = 0
const pairs = A.flatMap((a) => B.map((b) => ({ a, b })))
await Promise.all(
  pairs.map(async ({ a, b }) => {
    // Both orders. A pair only counts as a win when the two orders agree; otherwise it's a split.
    const [ab, ba] = await Promise.all([ask(a.url, b.url), ask(b.url, a.url)])
    const first = ab.winner === 'A' ? a.id : b.id
    const second = ba.winner === 'A' ? b.id : a.id
    if (first !== second) split++
    else if (first === a.id) winsA++
    else winsB++
    const verdict = first === second ? `${first} wins` : 'split (order-biased)'
    console.log(`${a.id} vs ${b.id}: ${verdict}\n  ${ab.reason}\n  ${ba.reason}`)
  }),
)
console.log(`\nGroup A (${groupA.join(', ')}): ${winsA} wins\nGroup B (${groupB.join(', ')}): ${winsB} wins\nSplit: ${split} of ${pairs.length}`)
