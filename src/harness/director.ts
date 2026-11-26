import { completeJson } from '../llm.ts'
import { DIRECTOR_SYSTEM, directorPrompt } from '../prompts.ts'
import type { Run } from '../trace.ts'
import { type Concept, DivergeSchema } from '../types.ts'

/** Diverge: one brief in, N deliberately different concepts out. */
export async function diverge(brief: string, n: number, run?: Run): Promise<Concept[]> {
  const out = await completeJson(
    { task: 'director.diverge', system: DIRECTOR_SYSTEM, prompt: directorPrompt(brief, n), temperature: 1, maxTokens: Math.min(16000, 800 + 500 * n) },
    DivergeSchema,
    run,
  )
  return out.concepts.slice(0, n).map((c, i) => ({ ...c, id: `c${i + 1}`, status: 'pending' }))
}
