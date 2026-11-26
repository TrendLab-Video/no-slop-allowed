import { completeJson } from '../llm.ts'
import { DIRECTOR_SYSTEM, directorPrompt } from '../prompts.ts'
import type { Run } from '../trace.ts'
import { type Concept, DivergeSchema } from '../types.ts'
import { stripStock } from '../util/stock.ts'

/** Diverge: one brief in, N deliberately different concepts out. */
export async function diverge(brief: string, n: number, video: boolean, run?: Run): Promise<Concept[]> {
  const out = await completeJson(
    { task: 'director.diverge', system: DIRECTOR_SYSTEM, prompt: directorPrompt(brief, n, video), temperature: 1, maxTokens: Math.min(16000, 800 + 500 * n) },
    DivergeSchema,
    run,
  )
  const cliches = out.cliches
  if (cliches.length) run?.emit('diverge', `Refused the obvious: ${cliches.join('; ')}`)
  const stripped = new Set<string>()
  const concepts: Concept[] = out.concepts.slice(0, n).map((c, i) => {
    const s = stripStock(c.visualPrompt)
    for (const w of s.removed) stripped.add(w)
    // With video off, nothing gets animated, so a "video" concept would be judged as a still it was never designed for.
    return { ...c, visualPrompt: s.prompt, medium: video ? c.medium : 'image', id: `c${i + 1}`, status: 'pending' }
  })
  if (stripped.size) run?.emit('diverge', `Stripped stock vocabulary from prompts: ${[...stripped].join(', ')}`)
  return concepts
}
