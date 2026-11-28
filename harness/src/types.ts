import { z } from 'zod'

// Schemas double as the contract for LLM JSON output (validated with zod).

export const ConceptSchema = z.object({
  title: z.string(),
  /** What stops the scroll in the first second. */
  hook: z.string(),
  idea: z.string(),
  /** What is actually happening in the frame. Concepts without an event came back as stock photos. */
  moment: z.string(),
  /** The axis this concept explores, so the set stays diverse (tone, format, mechanism...). */
  axis: z.string(),
  medium: z.enum(['image', 'video']),
  visualPrompt: z.string(),
  whyItWorks: z.string(),
})
export type ConceptDraft = z.infer<typeof ConceptSchema>
export type Concept = ConceptDraft & { id: string; status: 'pending' | 'eliminated' | 'finalist' | 'winner' }

export const DivergeSchema = z.object({
  /** The obvious images for the category, listed first so the director can refuse them. */
  cliches: z.array(z.string()).default([]),
  concepts: z.array(ConceptSchema).min(1),
})

export const CompareSchema = z.object({
  winner: z.enum(['A', 'B']),
  reason: z.string(),
  confidence: z.number().min(0).max(1),
})
export type Compare = z.infer<typeof CompareSchema>

export const CritiqueSchema = z.object({
  score: z.number().min(0).max(10),
  slop: z.array(z.object({ flag: z.string(), evidence: z.string() })),
  strengths: z.array(z.string()),
  fixes: z.array(z.string()),
  // Critics occasionally omit the verdict; defaulting beats dropping a finalist (seen in a live run). Slop still blocks shipping.
  verdict: z.enum(['ship', 'revise', 'kill']).default('revise'),
})
export type Critique = z.infer<typeof CritiqueSchema>

/** One shot of the final video. Shot 1 starts on the hero image. */
export const ShotSchema = z.object({ prompt: z.string(), seconds: z.number() })
export type Shot = z.infer<typeof ShotSchema>

export const StoryboardSchema = z.object({
  shots: z.array(ShotSchema).min(1).max(4),
  changeSummary: z.string().default(''),
})
export type Storyboard = z.infer<typeof StoryboardSchema>

export const ReviseSchema = z.object({
  visualPrompt: z.string(),
  changeSummary: z.string(),
})
export type Revision = z.infer<typeof ReviseSchema>

export type MediaKind = 'image' | 'video' | 'audio'

export type Render = {
  id: string
  conceptId: string
  version: number
  kind: MediaKind
  url: string
  prompt: string
  endpoint: string
  ms: number
  estUsd: number
  critique?: Critique
  changeSummary?: string
  /** A revision the critic judged unworkable; never used as a base or a winner. */
  discarded?: boolean
  /** Video only: the shot plan it was generated from. */
  shots?: Shot[]
  /** Video only: the frames the critic looked at (first, middle, last). */
  frames?: string[]
}

export type Match = {
  round: string
  a: string
  b: string
  winner: string
  reason: string
  /** False when swapping A/B changed the verdict: the judge was biased by order, not content. */
  consistent: boolean
}

export type Stage = 'brief' | 'diverge' | 'select' | 'draft' | 'critique' | 'revise' | 'showdown' | 'final' | 'video' | 'done' | 'error'

export type TraceEvent = { t: number; stage: Stage; message: string; data?: unknown }

export type RunState = {
  id: string
  brief: string
  status: 'running' | 'done' | 'error'
  startedAt: number
  finishedAt?: number
  options: Record<string, unknown>
  concepts: Concept[]
  matches: Match[]
  renders: Render[]
  final?: { conceptId: string; image?: Render; video?: Render; reason: string }
  /** Folder name under the output dir: the brief file name from the CLI, else the run id. */
  slug?: string
  /** The brief file this run read, if any (for traces.json). */
  source?: string
  /** Where writeOutputs put the deliverables. */
  outputs?: { dir: string; video?: string; image?: string; traces: string }
  spend: { usd: number; calls: number }
  events: TraceEvent[]
  error?: string
}
