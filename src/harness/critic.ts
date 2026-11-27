import { completeJson } from '../llm.ts'
import { CRITIC_SYSTEM, type CritiqueStage, criticPrompt, type FailedAttempt, REVISER_SYSTEM, revisePrompt } from '../prompts.ts'
import type { Run } from '../trace.ts'
import { type Concept, type Critique, CritiqueSchema, type Render, ReviseSchema, type Revision } from '../types.ts'

/** Critic: a vision model looks at the actual render and scores it against rubric.md. */
export async function critique(brief: string, concept: Concept, render: Render, stage: CritiqueStage, run?: Run): Promise<Critique> {
  if (render.kind !== 'image') throw new Error('critic only handles images; critique a keyframe for video')
  const c = await completeJson(
    {
      task: 'critic.critique',
      system: CRITIC_SYSTEM,
      prompt: criticPrompt(brief, concept, render.version, stage),
      imageUrls: [render.url],
      temperature: 0.2,
      maxTokens: 900,
    },
    CritiqueSchema,
    run,
  )
  return normaliseCritique(c, stage)
}

// Rendering faults the fast draft model always makes and the final model fixes. Judging drafts on them
// capped every draft at 5 and sent the reviser chasing problems a prompt can't solve.
// Matches fault words only: a bare "text" or "hands" would also drop real flags such as
// "Made-up brand names ... packaging text" or "Stock-photo composition: hands holding a mug".
const RENDER_ONLY_FLAG = /\b(garbled|misspel\w*|illegible|typo\w*|lettering|anatomy)\b|\b(extra|sixth|six|missing|fused) (fingers?|limbs?|hands?)\b|\b(deformed|distorted|warped) (hands?|fingers?|teeth|limbs?|face)\b/i

/** Enforce the rubric's hard rules in code rather than trusting the model to apply them. */
export function normaliseCritique(c: Critique, stage: CritiqueStage = 'final'): Critique {
  const seen = new Set<string>()
  const slop = c.slop.filter((s) => {
    const flag = s.flag.trim()
    // Models often echo an empty or "none" slop entry when they found none.
    if (!flag || /^(none|n\/?a|no slop|-)$/i.test(flag)) return false
    if (stage === 'draft' && RENDER_ONLY_FLAG.test(flag)) return false
    // The same flag listed twice is one problem, not two.
    const key = flag.toLowerCase().split(':')[0]!.trim()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  // Models put render faults in fixes even when told not to flag them; the reviser must not chase them on drafts.
  const fixes = stage === 'draft' ? c.fixes.filter((f) => !RENDER_ONLY_FLAG.test(f)) : c.fixes
  // Slop blocks shipping but leaves the score alone. A hard cap ("any flag caps at 5") made every
  // critique in a live run exactly 5, so the loop could not tell a better revision from a worse one.
  return { ...c, slop, fixes, verdict: slop.length && c.verdict === 'ship' ? 'revise' : c.verdict }
}

/** Each slop flag costs this much when ranking renders against each other. */
export const SLOP_PENALTY = 1

/** The number the loop ranks by: the critic's score minus a point per slop flag. */
export function effectiveScore(c: Critique): number {
  return c.score - SLOP_PENALTY * c.slop.length
}

/** Reviser: turn a critique into a better prompt, changing only what was flagged. */
export async function revise(concept: Concept, prompt: string, crit: Critique, failed: FailedAttempt[] = [], run?: Run): Promise<Revision> {
  return completeJson(
    { task: 'reviser.revise', system: REVISER_SYSTEM, prompt: revisePrompt(concept, prompt, crit, failed), temperature: 0.6, maxTokens: 800 },
    ReviseSchema,
    run,
  )
}
