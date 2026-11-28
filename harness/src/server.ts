import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { extname, isAbsolute, join, relative, resolve } from 'node:path'
import { config, defaultOptions, sanitiseOptions } from './config.ts'
import { startRun } from './harness/loop.ts'
import { getRun, listRuns, reconcileOrphanedRuns } from './trace.ts'

// Minimal API + static UI. The UI polls /api/runs/:id, which is the whole trace.
// For the live demo use `bun run start` (no --watch): a file save would restart the
// server and cut off any run in progress.

const json = (data: unknown, status = 200) => Response.json(data, { status })

const orphaned = reconcileOrphanedRuns()
if (orphaned) console.log(`marked ${orphaned} interrupted run(s) as error`)

const server = Bun.serve({
  port: config.port,
  routes: {
    // Served per request so UI edits show on refresh without a restart.
    '/': () => new Response(Bun.file('public/index.html')),
    '/stylebook': () => new Response(Bun.file('public/stylebook.html')),
    '/design-system.css': () => new Response(Bun.file('public/design-system.css')),
    '/api/health': () => json({ mock: config.mock, concurrency: config.concurrency, defaults: defaultOptions }),
    '/api/briefs': () => {
      const seen = new Set<string>()
      const out: Array<{ name: string; text: string }> = []
      for (const dir of ['../briefs', 'briefs']) {
        for (const f of safeList(dir).filter((x) => x.endsWith('.md')).sort()) {
          if (seen.has(f)) continue
          seen.add(f)
          out.push({ name: f, text: readFileSync(`${dir}/${f}`, 'utf8') })
        }
      }
      return json(out)
    },
    '/api/outputs': () => json(listOutputs()),
    '/api/runs': {
      GET: () => json(listRuns()),
      POST: async (req) => {
        const body: unknown = await req.json().catch(() => null)
        const { brief, options } = (body && typeof body === 'object' ? body : {}) as { brief?: unknown; options?: unknown }
        if (typeof brief !== 'string' || !brief.trim()) return json({ error: 'brief is required' }, 400)
        if (brief.length > 8000) return json({ error: 'brief is too long (8000 chars max)' }, 400)
        const opts = options && typeof options === 'object' ? (options as Record<string, unknown>) : {}
        const run = startRun(brief.trim(), sanitiseOptions(opts))
        return json({ id: run.id }, 201)
      },
    },
    '/api/runs/:id': (req) => {
      const run = getRun(req.params.id)
      return run ? json(run) : json({ error: 'not found' }, 404)
    },
  },
  fetch: (req) => {
    const url = new URL(req.url)
    if (url.pathname === '/outputs' || url.pathname.startsWith('/outputs/')) {
      return serveOutputFile(req.method, url.pathname)
    }
    return json({ error: 'not found' }, 404)
  },
  error: (err) => json({ error: err.message }, 500),
})

console.log(`creative-harness on http://localhost:${server.port} (${config.mock ? 'MOCK mode' : 'live fal'}, concurrency ${config.concurrency})`)

function safeList(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

const OUTPUT_MIMES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
}

function serveOutputFile(method: string, pathname: string): Response {
  if (method !== 'GET' && method !== 'HEAD') return json({ error: 'method not allowed' }, 405)
  if (!pathname.startsWith('/outputs/')) return json({ error: 'not found' }, 404)

  let relPath: string
  try {
    relPath = decodeURIComponent(pathname.slice('/outputs/'.length))
  } catch {
    return json({ error: 'bad request' }, 400)
  }

  if (!relPath || relPath.includes('\0') || relPath.includes('\\')) {
    return json({ error: 'forbidden' }, 403)
  }
  const segments = relPath.split('/')
  if (segments.some((seg) => !seg || seg === '.' || seg === '..' || seg.startsWith('.'))) {
    return json({ error: 'forbidden' }, 403)
  }

  const root = resolve(config.outputDir)
  if (!existsSync(root)) return json({ error: 'not found' }, 404)

  const candidate = resolve(root, ...segments)
  const relToRoot = relative(root, candidate)
  if (!relToRoot || relToRoot.startsWith('..') || isAbsolute(relToRoot)) {
    return json({ error: 'forbidden' }, 403)
  }
  if (!existsSync(candidate)) return json({ error: 'not found' }, 404)

  try {
    const rootReal = realpathSync(root)
    const targetReal = realpathSync(candidate)
    const realRel = relative(rootReal, targetReal)
    if (!realRel || realRel.startsWith('..') || isAbsolute(realRel) || !statSync(targetReal).isFile()) {
      return json({ error: 'not found' }, 404)
    }
    const mime = OUTPUT_MIMES[extname(candidate).toLowerCase()]
    const file = mime ? Bun.file(candidate, { type: mime }) : Bun.file(candidate)
    return new Response(file, mime ? { headers: { 'content-type': mime } } : undefined)
  } catch {
    return json({ error: 'not found' }, 404)
  }
}

type TraceDigest = {
  brief?: string | null
  brief_text?: string
  spend_usd_estimate?: number
  finished_at?: string
  steps?: unknown[]
  concepts?: Array<{ id?: string; title?: string; hook?: string; axis?: string }>
  renders?: Array<{ id?: string; url?: string; critique?: { score?: number } }>
  final?: {
    conceptId?: string
    reason?: string
    image?: string
    video_critique?: { score?: number; slop?: unknown[] }
    shots?: Array<{ prompt?: string; seconds?: number }>
  } | null
}

function listOutputs() {
  const root = resolve(config.outputDir)
  if (!existsSync(root)) return []

  const items: Array<Record<string, unknown>> = []
  for (const slug of safeList(root).sort()) {
    if (!slug || slug.startsWith('.') || slug.startsWith('_')) continue
    const dir = join(root, slug)
    try {
      if (!statSync(dir).isDirectory()) continue
    } catch {
      continue
    }

    const files = safeList(dir)
    const videoFile = files.find((f) => /^final\.mp4$/i.test(f))
    const keyframeFile = files.find((f) => /^keyframe\.(png|jpe?g|webp)$/i.test(f))
    const tracesFile = files.find((f) => /^traces\.json$/i.test(f))
    if (!videoFile && !keyframeFile && !tracesFile) continue

    let trace: TraceDigest | null = null
    if (tracesFile) {
      try {
        trace = JSON.parse(readFileSync(join(dir, tracesFile), 'utf8')) as TraceDigest
      } catch {
        trace = null
      }
    }

    const heading = trace?.brief_text?.match(/^#+\s*(.+)$/m)?.[1]?.trim()
    const conceptId = trace?.final?.conceptId ?? null
    const winConcept = conceptId ? trace?.concepts?.find((c) => c.id === conceptId) : undefined
    const heroRender = conceptId
      ? trace?.renders?.find((r) => r.id === `${conceptId}-final` || (trace?.final?.image && r.url === trace.final.image))
      : undefined
    const shots = (trace?.final?.shots ?? [])
      .filter((s): s is { prompt: string; seconds: number } => typeof s?.prompt === 'string' && typeof s?.seconds === 'number')
      .map((s) => ({ prompt: s.prompt, seconds: s.seconds }))

    const encSlug = encodeURIComponent(slug)
    items.push({
      slug,
      videoUrl: videoFile ? `/outputs/${encSlug}/${encodeURIComponent(videoFile)}` : null,
      keyframeUrl: keyframeFile ? `/outputs/${encSlug}/${encodeURIComponent(keyframeFile)}` : null,
      tracesUrl: tracesFile ? `/outputs/${encSlug}/${encodeURIComponent(tracesFile)}` : null,
      brief: trace?.brief ?? null,
      briefTitle: heading || slug,
      conceptId,
      conceptTitle: winConcept?.title ?? null,
      hook: winConcept?.hook ?? null,
      axis: winConcept?.axis ?? null,
      reason: trace?.final?.reason ?? null,
      videoScore: typeof trace?.final?.video_critique?.score === 'number' ? trace.final.video_critique.score : null,
      imageScore: typeof heroRender?.critique?.score === 'number' ? heroRender.critique.score : null,
      slopCount: Array.isArray(trace?.final?.video_critique?.slop) ? trace.final.video_critique.slop.length : 0,
      shots,
      spendUsd: typeof trace?.spend_usd_estimate === 'number' ? trace.spend_usd_estimate : null,
      stepsCount: Array.isArray(trace?.steps) ? trace.steps.length : null,
      conceptsCount: Array.isArray(trace?.concepts) ? trace.concepts.length : null,
      finishedAt: trace?.finished_at ?? null,
    })
  }
  return items
}
