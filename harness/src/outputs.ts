import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join, relative, resolve } from 'node:path'
import { config } from './config.ts'
import type { Run } from './trace.ts'
import type { RunState } from './types.ts'

// The hackathon deliverables for one run: outputs/<slug>/final.mp4 and traces.json
// (shape from ../traces.example.json, plus extra fields that show how the harness decided).
// traces.json is ALWAYS written, even if a download fails or the run errored: the rules require one per run.

/** "../briefs/01-ep-133.md" -> "01-ep-133" */
export function briefSlug(path: string): string {
  return basename(path).replace(/\.[a-z0-9]+$/i, '').replace(/[^a-zA-Z0-9-_]/g, '-')
}

/** The hackathon repo root when the harness runs from harness/, else the harness itself. */
const repoRoot = () => (existsSync(resolve('..', 'briefs')) && existsSync(resolve('..', 'outputs')) ? resolve('..') : resolve('.'))
/** Paths in traces.json are relative to the repo root, as in traces.example.json (never absolute home paths). */
const fromRepoRoot = (p: string) => relative(repoRoot(), resolve(p)).replaceAll('\\', '/')

const DOWNLOAD_TIMEOUT_MS = 120_000

async function download(url: string, path: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`download ${res.status} for ${url}`)
  writeFileSync(path, Buffer.from(await res.arrayBuffer()))
}

/** Where this run's deliverables go. Mock runs never touch the real deliverable folders. */
export function outputDirFor(s: RunState): string {
  return join(config.outputDir, ...(config.mock ? ['_mock'] : []), briefSlug(s.slug ?? s.id))
}

export async function writeOutputs(run: Run): Promise<NonNullable<RunState['outputs']>> {
  const s = run.state
  const dir = outputDirFor(s)
  mkdirSync(dir, { recursive: true })
  // A re-run on the same brief replaces the folder's media, so files on disk always match traces.json.
  for (const name of readdirSync(dir)) if (/^(final\.mp4|keyframe\.(png|jpe?g|webp))$/i.test(name)) rmSync(join(dir, name))

  const f = s.final
  const errors: string[] = []
  let video: string | undefined
  let image: string | undefined
  // Mock mode media are inline placeholders: nothing to download.
  if (f?.video && !f.video.url.startsWith('data:')) {
    const p = join(dir, 'final.mp4')
    try {
      await download(f.video.url, p)
      video = p
    } catch (err) {
      errors.push(`video download failed: ${String(err).slice(0, 300)}`)
    }
  }
  if (f?.image && !f.image.url.startsWith('data:')) {
    const ext = new URL(f.image.url).pathname.match(/\.(png|jpe?g|webp)$/i)?.[1] ?? 'png'
    const p = join(dir, `keyframe.${ext}`)
    try {
      await download(f.image.url, p)
      image = p
    } catch (err) {
      errors.push(`keyframe download failed: ${String(err).slice(0, 300)}`)
    }
  }
  for (const e of errors) run.emit('error', e)
  const traces = join(dir, 'traces.json')
  writeFileSync(traces, JSON.stringify(buildTraces(run, { video, image, errors }), null, 2))
  s.outputs = { dir, video, image, traces }
  return s.outputs
}

export function buildTraces(run: Run, paths: { video?: string; image?: string; errors?: string[] }) {
  const s = run.state
  const iso = (ms: number) => new Date(ms).toISOString()
  // Parallel calls finish out of order; list them in the order they started.
  const calls = [...run.calls].sort((a, b) => a.at - b.at)
  return {
    brief: s.source ? fromRepoRoot(s.source) : null,
    output_video: paths.video ? fromRepoRoot(paths.video) : null,
    started_at: iso(s.startedAt),
    finished_at: iso(s.finishedAt ?? Date.now()),
    steps: calls.map((c, i) => {
      const args = c.prompt === undefined ? c.inputs : { ...(c.inputs as object), prompt: c.prompt }
      return {
        id: `step-${i + 1}`,
        name: c.ref ? `${c.task} (${c.ref})` : c.task,
        model: c.model,
        inputs: c.inputs,
        prompt: c.prompt ?? (c.inputs as { prompt?: string } | undefined)?.prompt ?? null,
        tool_calls: [{ tool: c.tool, arguments: args, result: c.output }],
        outputs: c.output,
        duration_ms: c.ms,
        // Extra fields beyond the example shape:
        started_at: iso(c.at),
        cost_usd: c.usd,
      }
    }),
    // Extra fields: the decisions behind the video, not just the calls.
    run_id: s.id,
    status: s.status,
    error: s.error ?? null,
    output_errors: paths.errors?.length ? paths.errors : undefined,
    brief_text: s.brief,
    output_keyframe: paths.image ? fromRepoRoot(paths.image) : null,
    options: s.options,
    spend_usd_estimate: Number(s.spend.usd.toFixed(4)),
    decisions: s.events.map((e) => ({ t_ms: e.t, stage: e.stage, message: e.message })),
    concepts: s.concepts.map(({ id, title, hook, idea, moment, axis, status, visualPrompt }) => ({ id, title, hook, idea, moment, axis, status, visualPrompt })),
    matches: s.matches,
    renders: s.renders.map(({ id, conceptId, version, kind, url, endpoint, prompt, critique, changeSummary, shots, frames, discarded }) => ({
      id,
      conceptId,
      version,
      kind,
      url,
      endpoint,
      prompt,
      critique,
      changeSummary,
      shots,
      frames,
      discarded,
    })),
    final: finalSummary(s),
  }
}

function finalSummary(s: RunState) {
  if (!s.final) return null
  return { conceptId: s.final.conceptId, reason: s.final.reason, image: s.final.image?.url, video: s.final.video?.url, video_critique: s.final.video?.critique, shots: s.final.video?.shots }
}
