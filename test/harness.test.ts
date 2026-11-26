import { describe, expect, test } from 'bun:test'
import { defaultOptions } from '../src/config.ts'
import { normaliseCritique } from '../src/harness/critic.ts'
import { runHarness } from '../src/harness/loop.ts'
import { tournament } from '../src/harness/selector.ts'
import { Run } from '../src/trace.ts'
import type { Concept } from '../src/types.ts'
import { config } from '../src/config.ts'
import { extractJson } from '../src/util/json.ts'

test('tests run in mock mode with no key', () => {
  expect(config.mock).toBe(true)
  expect(config.falKey).toBe('')
  expect(config.runsDir).toBe('.test-runs')
})
import { createLimiter } from '../src/util/limit.ts'

describe('extractJson', () => {
  test('plain object', () => expect(extractJson('{"a":1}')).toEqual({ a: 1 }))
  test('fenced with chatter', () => expect(extractJson('Sure!\n```json\n{"a":[1,2]}\n```\nHope that helps')).toEqual({ a: [1, 2] }))
  test('braces inside strings', () => expect(extractJson('x {"s":"a } b {","n":2} y')).toEqual({ s: 'a } b {', n: 2 }))
  test('no json throws', () => expect(() => extractJson('nothing here')).toThrow())
})

describe('createLimiter', () => {
  test('never exceeds the cap', async () => {
    const limit = createLimiter(2)
    let active = 0
    let peak = 0
    await Promise.all(
      Array.from({ length: 8 }, () =>
        limit(async () => {
          active++
          peak = Math.max(peak, active)
          await Bun.sleep(10)
          active--
        }),
      ),
    )
    expect(peak).toBe(2)
  })
  test('a rejection does not jam the queue', async () => {
    const limit = createLimiter(1)
    await expect(limit(() => Promise.reject(new Error('x')))).rejects.toThrow('x')
    expect(await limit(async () => 42)).toBe(42)
  })
})

describe('tournament', () => {
  test('ranks every contender and plays log2(n) rounds', async () => {
    const field = Array.from({ length: 8 }, (_, i) => ({ concept: fakeConcept(i) }))
    const { ranked, matches } = await tournament('brief', field, 'T')
    expect(ranked).toHaveLength(8)
    expect(new Set(ranked.map((c) => c.concept.id)).size).toBe(8)
    expect(matches).toHaveLength(3 * 4)
    expect(matches.every((m) => m.consistent)).toBe(true)
  })
  test('odd field gives a bye without crashing', async () => {
    const field = Array.from({ length: 5 }, (_, i) => ({ concept: fakeConcept(i) }))
    const { ranked } = await tournament('brief', field, 'T')
    expect(ranked).toHaveLength(5)
  })
})

describe('runHarness (mock)', () => {
  test('end to end: diverge, select, develop, showdown, final', async () => {
    const run = new Run('A test brief', defaultOptions)
    await runHarness(run, { ...defaultOptions, video: true })
    const s = run.state
    expect(s.status).toBe('done')
    expect(s.concepts).toHaveLength(defaultOptions.concepts)
    expect(s.concepts.filter((c) => c.status === 'winner')).toHaveLength(1)
    expect(s.concepts.filter((c) => c.status === 'eliminated')).toHaveLength(defaultOptions.concepts - defaultOptions.finalists)
    // mock critic scores rise per version, so finalists should be revised at least once
    const v2 = s.renders.filter((r) => r.version === 2 && r.id.includes('-v'))
    expect(v2.length).toBeGreaterThan(0)
    expect(v2[0]!.changeSummary).toBeTruthy()
    expect(s.final?.image?.critique).toBeDefined()
    expect(s.final?.video?.kind).toBe('video')
    expect(s.events.at(-1)?.stage).toBe('done')
  })

  test('slop caps the score at 5', async () => {
    const run = new Run('brief', defaultOptions)
    await runHarness(run, { ...defaultOptions, finalists: 1, concepts: 2 })
    const v1 = run.state.renders.find((r) => r.version === 1)!
    expect(v1.critique!.slop.length).toBeGreaterThan(0)
    expect(v1.critique!.score).toBeLessThanOrEqual(5)
  })
})

describe('tournament fairness (review fixes)', () => {
  test('3 contenders: round-robin, so every pair is decided directly', async () => {
    const field = Array.from({ length: 3 }, (_, i) => ({ concept: fakeConcept(i) }))
    const { ranked, matches } = await tournament('brief', field, 'Showdown')
    expect(matches).toHaveLength(3)
    // the top contender must not have lost to anyone it is tied with
    const top = ranked[0]!.concept.id
    const second = ranked[1]!.concept.id
    const direct = matches.find((m) => [m.a, m.b].includes(top) && [m.a, m.b].includes(second))!
    const winsOf = (id: string) => matches.filter((m) => m.winner === id).length
    if (winsOf(top) === winsOf(second)) expect(direct.winner).toBe(top)
  })

  for (const n of [5, 7]) {
    test(`${n} contenders: every contender is judged at least once`, async () => {
      const field = Array.from({ length: n }, (_, i) => ({ concept: fakeConcept(i) }))
      const { matches } = await tournament('brief', field, 'Concepts')
      for (const c of field) expect(matches.some((m) => m.a === c.concept.id || m.b === c.concept.id)).toBe(true)
    })
  }
})

describe('normaliseCritique', () => {
  const base = { score: 9, strengths: [], fixes: [], verdict: 'ship' as const }
  test('echoed empty slop entry does not cap the score', () => {
    const c = normaliseCritique({ ...base, slop: [{ flag: '', evidence: '' }, { flag: 'None', evidence: '' }] })
    expect(c.slop).toHaveLength(0)
    expect(c.score).toBe(9)
    expect(c.verdict).toBe('ship')
  })
  test('real slop caps at 5 and downgrades ship to revise', () => {
    const c = normaliseCritique({ ...base, slop: [{ flag: 'Mangled hands', evidence: 'six fingers' }] })
    expect(c.score).toBe(5)
    expect(c.verdict).toBe('revise')
  })
})

describe('resilience (review fixes)', () => {
  const withFail = async (pattern: string, fn: () => Promise<void>) => {
    process.env.MOCK_FAIL = pattern
    try {
      await fn()
    } finally {
      delete process.env.MOCK_FAIL
    }
  }

  test('showdown judge failing still finishes with a winner by critic score', () =>
    withFail('^selector\\.compare:vision$', async () => {
      const run = new Run('brief', defaultOptions)
      await runHarness(run, { ...defaultOptions, concepts: 4, finalists: 2 })
      expect(run.state.status).toBe('done')
      expect(run.state.final?.conceptId).toBeTruthy()
      expect(run.state.events.some((e) => e.stage === 'error')).toBe(true)
    }))

  test('reviser failing keeps the critiqued v1 instead of dropping the finalist', () =>
    withFail('^reviser', async () => {
      const run = new Run('brief', defaultOptions)
      await runHarness(run, { ...defaultOptions, concepts: 4, finalists: 2 })
      expect(run.state.status).toBe('done')
      expect(run.state.renders.filter((r) => r.id.endsWith('-v1') && r.critique)).toHaveLength(2)
    }))

  test('critic down entirely: the run fails loudly instead of hanging', () =>
    withFail('^critic\\.critique:vision$', async () => {
      const run = new Run('brief', defaultOptions)
      await expect(runHarness(run, { ...defaultOptions, concepts: 3, finalists: 1 })).rejects.toThrow()
    }))
})

function fakeConcept(i: number): Concept {
  return { id: `c${i}`, title: `Concept ${i}: t${i}`, hook: 'h', idea: 'i', axis: 'a', medium: 'image', visualPrompt: 'p', whyItWorks: 'w', status: 'pending' }
}
