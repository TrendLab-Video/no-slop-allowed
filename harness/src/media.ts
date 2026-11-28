import { config } from './config.ts'
import { callFal } from './fal.ts'
import type { MediaParams, MediaSpec } from './models.ts'
import type { Run } from './trace.ts'

// Render one piece of media. In mock mode returns a local placeholder so the loop and UI run fully offline.

export type MediaOut = { url: string; endpoint: string; ms: number; estUsd: number; kind: MediaSpec['kind'] }

/** Video renders take minutes; images and audio should not. */
// Kling multi-shot clips with sound can take several minutes.
const TIMEOUT_MS: Record<MediaSpec['kind'], number> = { image: 90_000, audio: 120_000, video: 600_000 }
/** How long fal may queue a job before dropping it. Video queues back up at busy times; keep below TIMEOUT_MS. */
const START_TIMEOUT_S: Record<MediaSpec['kind'], number> = { image: 120, audio: 120, video: 300 }

/** `ref` labels the call in traces.json, e.g. the render id. */
export async function generateMedia(spec: MediaSpec, params: MediaParams, run?: Run, ref?: string): Promise<MediaOut> {
  const estUsd = spec.estUsd(params)
  const input = spec.build(params)
  const started = Date.now()

  if (config.mock) {
    await Bun.sleep(150)
    // MOCK_FAIL also matches media calls as "media:<endpoint>", to rehearse a model being down.
    const fail = process.env.MOCK_FAIL
    if (fail && new RegExp(fail).test(`media:${spec.endpoint}`)) {
      const err = new Error(`mock failure for media:${spec.endpoint}`)
      run?.recordCall({ task: `media.${spec.kind}`, ref, tool: `mock:${spec.endpoint}`, model: spec.endpoint, inputs: input, output: { error: err.message }, ms: 150, usd: 0, at: started })
      throw err
    }
    const url = placeholder(`${spec.kind}: ${params.prompt}`)
    run?.recordCall({ task: `media.${spec.kind}`, ref, tool: `mock:${spec.endpoint}`, model: spec.endpoint, inputs: input, output: { url }, ms: 150, usd: 0, at: started })
    return { url, endpoint: `mock:${spec.endpoint}`, ms: 150, estUsd: 0, kind: spec.kind }
  }

  let res: Awaited<ReturnType<typeof callFal>>
  let url: string | undefined
  try {
    res = await callFal(spec.endpoint, input, { timeoutMs: TIMEOUT_MS[spec.kind], startTimeoutS: START_TIMEOUT_S[spec.kind] })
    url = spec.pick(res.data)
    if (!url) throw new Error(`${spec.endpoint} returned no media URL: ${JSON.stringify(res.data).slice(0, 300)}`)
  } catch (err) {
    // Failed calls go in traces.json too: a timed-out video take may still have been billed.
    run?.recordCall({ task: `media.${spec.kind}`, ref, tool: spec.endpoint, model: spec.endpoint, inputs: input, output: { error: String(err).slice(0, 500) }, ms: Date.now() - started, usd: 0, at: started })
    throw err
  }
  run?.addSpend(estUsd)
  run?.recordCall({ task: `media.${spec.kind}`, ref, tool: spec.endpoint, model: spec.endpoint, inputs: input, output: { url }, ms: res.ms, usd: estUsd, at: started })
  return { url, endpoint: spec.endpoint, ms: res.ms, estUsd, kind: spec.kind }
}

function placeholder(label: string): string {
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
  const words = label.slice(0, 120).split(/\s+/)
  const lines: string[] = []
  for (const w of words) {
    const last = lines.at(-1)
    if (last !== undefined && (last + ' ' + w).length <= 22) lines[lines.length - 1] = `${last} ${w}`
    else lines.push(w)
  }
  const text = lines
    .slice(0, 8)
    .map((l, i) => `<text x="288" y="${420 + i * 34}" text-anchor="middle">${esc(l)}</text>`)
    .join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="576" height="1024" viewBox="0 0 576 1024"><rect width="576" height="1024" fill="#1a1a1a"/><g fill="#bbb" font-family="sans-serif" font-size="26">${text}</g></svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}
