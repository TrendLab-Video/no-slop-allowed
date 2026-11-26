import type { LlmCall } from './llm.ts'

// Deterministic fake LLM so the whole loop and UI run with no key and no spend.
// Scores rise with each version so you can see the revise loop working.

const AXES = ['deadpan humour', 'intimate close-up', 'scale contrast', 'unexpected location', 'before/after', 'retro format', 'point-of-view shot', 'single bold colour']

export async function mockLlm(call: LlmCall): Promise<string> {
  await Bun.sleep(80)
  // MOCK_FAIL=<regex> makes matching calls throw, to rehearse failures. Vision calls match as "<task>:vision".
  const fail = process.env.MOCK_FAIL
  const tag = `${call.task}${call.imageUrls?.length ? ':vision' : ''}`
  if (fail && new RegExp(fail).test(tag)) throw new Error(`mock failure for ${tag}`)
  switch (call.task) {
    case 'director.diverge': {
      const n = Number(call.prompt.match(/Generate (\d+) concepts/)?.[1] ?? 6)
      const concepts = Array.from({ length: n }, (_, i) => {
        const axis = AXES[i % AXES.length]!
        return {
          title: `Concept ${i + 1}: ${axis}`,
          hook: `A ${axis} moment that lands in the first second`,
          idea: `Tell the brief through ${axis}.`,
          moment: `Someone is caught halfway through something, ${axis}.`,
          axis,
          medium: i % 3 === 0 ? 'video' : 'image',
          // Deliberately includes stock vocabulary, so the director's stripping step is exercised.
          visualPrompt: `${axis}, vertical 9:16, natural light, shallow depth of field, specific everyday detail, concept ${i + 1}`,
          whyItWorks: `It avoids the obvious image and uses ${axis} to create tension.`,
        }
      })
      return JSON.stringify({ cliches: ['latte art', 'a pour', 'beans on wood'], concepts })
    }
    case 'selector.compare': {
      // Content-based (not order-based), so the swap check stays consistent.
      const titles = [...call.prompt.matchAll(/Title: (.+)|"(Concept [^"]+)"/g)].map((m) => m[1] ?? m[2] ?? '')
      const [a = '', b = ''] = titles
      const winner = score(a) >= score(b) ? 'A' : 'B'
      return JSON.stringify({ winner, reason: `Mock judge prefers ${winner === 'A' ? a : b}.`, confidence: 0.7 })
    }
    case 'critic.critique': {
      const v = Number(call.prompt.match(/VERSION: (\d+)/)?.[1] ?? 1)
      // MOCK_SCORES="4,3,6" and MOCK_VERDICTS="revise,kill" script the critic per version, to test the loop's stopping rules.
      const scripted = (name: string) => process.env[name]?.split(',')[v - 1]?.trim()
      const s = Number(scripted('MOCK_SCORES') ?? Math.min(9.2, 4.6 + 1.7 * (v - 1)))
      return JSON.stringify({
        score: Math.round(s * 10) / 10,
        slop: [
          ...(v === 1 && !process.env.MOCK_SCORES ? [{ flag: 'Stock-photo composition', evidence: 'Centred subject, nothing happening' }] : []),
          // MOCK_TEXT_FLAG=1 adds a render-only fault, to check drafts and the final are judged at the right stage.
          ...(process.env.MOCK_TEXT_FLAG ? [{ flag: 'Garbled or misspelled text in the image', evidence: 'sign reads COFEE' }] : []),
          // MOCK_SLOP="0,1" adds a real slop flag to chosen versions, to test ranking and the ship gate.
          ...(scripted('MOCK_SLOP') === '1' ? [{ flag: 'Visual noise', evidence: 'too many props' }] : []),
        ],
        strengths: ['Clear focal point'],
        fixes: v < 3 ? ['Move the subject off-centre', 'Add one specific, odd detail'] : [],
        verdict: scripted('MOCK_VERDICTS') ?? (s >= 8.5 ? 'ship' : 'revise'),
      })
    }
    case 'reviser.revise': {
      const prev = call.prompt.match(/CURRENT PROMPT:\n([\s\S]*?)\n\nCRITIQUE/)?.[1] ?? ''
      // Echo how many failed attempts the loop passed in, so tests can see them arrive.
      const tried = (call.prompt.match(/ALREADY TRIED[^\n]*\n((?:- [^\n]*\n?)+)/)?.[1] ?? '').split('\n').filter((l) => l.startsWith('- ')).length
      const changeSummary = tried ? `Moved subject off-centre (avoiding ${tried} failed attempt(s)).` : 'Moved subject off-centre and added a specific detail.'
      return JSON.stringify({ visualPrompt: `${prev}, subject off-centre, one odd specific detail`, changeSummary })
    }
    default:
      return JSON.stringify({ note: `mock has no responder for ${call.task}` })
  }
}

function score(title: string) {
  let h = 0
  for (const ch of title) h = (h * 31 + ch.charCodeAt(0)) % 997
  return h
}
