import { existsSync } from 'node:fs'

// Runtime config from env. Bun loads .env automatically.

const env = process.env

function positiveInt(name: string, fallback: number): number {
  const raw = env[name]
  if (raw === undefined || raw.trim() === '') return fallback
  const n = Number.parseInt(raw, 10)
  if (!Number.isInteger(n) || n < 1) throw new Error(`${name} must be a positive integer, got ${JSON.stringify(raw)}`)
  return n
}

export const config = {
  falKey: env.FAL_KEY ?? '',
  // Mock mode: no network, deterministic fake LLM + placeholder media.
  // On by default when there is no FAL_KEY, so the UI always runs.
  mock: env.MOCK === '1' || (!env.FAL_KEY && env.MOCK !== '0'),
  // fal starts new accounts at 2 concurrent requests. Raise once your dashboard says so.
  concurrency: positiveInt('CONCURRENCY', 2),
  port: positiveInt('PORT', 3000),
  runsDir: env.RUNS_DIR ?? 'runs',
  // Inside the hackathon repo (harness/ next to briefs/ and outputs/) results go to ../outputs, where judges look.
  outputDir: env.OUTPUT_DIR ?? (existsSync('../briefs') && existsSync('../outputs') ? '../outputs' : 'outputs'),
}

export type HarnessOptions = {
  /** How many concepts the director generates. Wider = more chance of something good. */
  concepts: number
  /** How many concepts survive the text tournament and get rendered. */
  finalists: number
  /** Max critique -> revise rounds per finalist. */
  maxIters: number
  /** Critic score (0-10) at which a finalist ships early. */
  shipScore: number
  /** Stop iterating when a revision improves the score by less than this. */
  plateau: number
  /** How many non-improving versions in a row to allow before stopping. Each retry revises from the best version so far. */
  patience: number
  /** Turn the winning image into a video with sound. The hackathon deliverable is a video, so this is on by default. */
  video: boolean
  /** Length of the final video in seconds (3 to 15). */
  videoSeconds: number
  /** How many video takes at most: a re-take only happens if the critic rejects the first. */
  videoTakes: number
}

export const defaultOptions: HarnessOptions = {
  concepts: 8,
  finalists: 3,
  maxIters: 3,
  shipScore: 8.5,
  plateau: 0.5,
  patience: 1,
  video: true,
  videoSeconds: 8,
  videoTakes: 2,
}

/** Clamp user-supplied options (UI or CLI) to sane bounds. Invalid values are dropped. */
export function sanitiseOptions(o: Partial<Record<keyof HarnessOptions, unknown>> = {}): Partial<HarnessOptions> {
  const out: Partial<HarnessOptions> = {}
  const int = (v: unknown, min: number, max: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : undefined
  const concepts = int(o.concepts, 2, 16)
  const finalists = int(o.finalists, 1, 6)
  const maxIters = int(o.maxIters, 0, 6)
  const patience = int(o.patience, 0, 3)
  const videoSeconds = int(o.videoSeconds, 3, 15)
  const videoTakes = int(o.videoTakes, 1, 3)
  if (concepts !== undefined) out.concepts = concepts
  if (finalists !== undefined) out.finalists = finalists
  if (maxIters !== undefined) out.maxIters = maxIters
  if (patience !== undefined) out.patience = patience
  if (videoSeconds !== undefined) out.videoSeconds = videoSeconds
  if (videoTakes !== undefined) out.videoTakes = videoTakes
  if (typeof o.video === 'boolean') out.video = o.video
  return out
}
