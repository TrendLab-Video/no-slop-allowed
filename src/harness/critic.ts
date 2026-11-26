import { completeJson } from '../llm.ts'
import { CRITIC_SYSTEM, criticPrompt, REVISER_SYSTEM, revisePrompt } from '../prompts.ts'
import type { Run } from '../trace.ts'
import { type Concept, type Critique, CritiqueSchema, type Render, ReviseSchema, type Revision } from '../types.ts'

/** Critic: a vision model looks at the actual render and scores it against rubric.md. */
export async function critique(brief: string, concept: Concept, render: Render, run?: Run): Promise<Critique> {
  if (render.kind !== 'image') throw new Error('critic only handles images; critique a keyframe for video')
  const c = await completeJson(
    {
      task: 'critic.critique',
      system: CRITIC_SYSTEM,
      prompt: criticPrompt(brief, concept, render.version, render.prompt),
      imageUrls: [render.url],
      temperature: 0.2,
      maxTokens: 900,
    },
    CritiqueSchema,
    run,
  )
  return normaliseCritique(c)
}

/** Enforce the rubric's hard rules in code rather than trusting the model to apply them. */
export function normaliseCritique(c: Critique): Critique {
  // Models often echo an empty or "none" slop entry when they found none. Drop those.
  const slop = c.slop.filter((s) => s.flag.trim() && !/^(none|n\/?a|no slop|-)$/i.test(s.flag.trim()))
  if (slop.length === 0) return { ...c, slop }
  return { ...c, slop, score: Math.min(c.score, 5), verdict: c.verdict === 'ship' ? 'revise' : c.verdict }
}

/** Reviser: turn a critique into a better prompt, changing only what was flagged. */
export async function revise(concept: Concept, prompt: string, crit: Critique, run?: Run): Promise<Revision> {
  return completeJson(
    { task: 'reviser.revise', system: REVISER_SYSTEM, prompt: revisePrompt(concept, prompt, crit), temperature: 0.6, maxTokens: 800 },
    ReviseSchema,
    run,
  )
}
