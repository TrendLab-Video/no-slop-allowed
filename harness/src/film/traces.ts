import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

export type ToolCall = { arguments: unknown; result: unknown; tool: string }

export type StepRecord = {
  duration_ms: number
  id: string
  inputs: Record<string, unknown>
  model: string | null
  name: string
  outputs: Record<string, unknown>
  prompt: string | null
  tool_calls: ToolCall[]
}

export type TraceFile = {
  brief: string
  finished_at: string
  output_video: string
  started_at: string
  steps: StepRecord[]
} & Record<string, unknown>

export type StepInit = {
  inputs?: Record<string, unknown>
  model?: string | null
  prompt?: string | null
}

export type StepHandle = {
  end(outputs?: Record<string, unknown>): StepRecord
  tool(tool: string, args: unknown, result: unknown): void
}

type Live = { endedAt: number | null; record: StepRecord; startedAt: number }

function snapshot(live: Live): StepRecord {
  const until = live.endedAt ?? performance.now()
  return {
    ...live.record,
    duration_ms: Math.round(until - live.startedAt),
    tool_calls: [...live.record.tool_calls],
  }
}

export class StepRecorder {
  private readonly lives: Live[] = []

  start(name: string, init: StepInit = {}): StepHandle {
    const live: Live = {
      endedAt: null,
      record: {
        duration_ms: 0,
        id: `step-${this.lives.length + 1}`,
        inputs: init.inputs ?? {},
        model: init.model ?? null,
        name,
        outputs: {},
        prompt: init.prompt ?? null,
        tool_calls: [],
      },
      startedAt: performance.now(),
    }
    this.lives.push(live)
    return {
      end: (outputs) => {
        if (live.endedAt === null) {
          live.endedAt = performance.now()
          if (outputs) live.record.outputs = outputs
        }
        return snapshot(live)
      },
      tool: (tool, args, result) => {
        live.record.tool_calls.push({ arguments: args, result, tool })
      },
    }
  }

  steps(): StepRecord[] {
    return this.lives.map(snapshot)
  }
}

export function slugFromBriefPath(p: string): string {
  const isPath = /[\\/]/.test(p) || /^\S+\.(json|md|txt)$/i.test(p)
  if (isPath) {
    const base = p.split(/[\\/]/).filter(Boolean).pop() ?? ''
    const stem = base.replace(/\.[A-Za-z0-9]+$/, '')
    const slug = stem.replace(/[^A-Za-z0-9._-]+/g, '-')
    return trimSlug(slug) || 'brief'
  }
  const slug = p.slice(0, 40).toLowerCase().replace(/[^a-z0-9]+/g, '-')
  return trimSlug(slug) || 'brief'
}

function trimSlug(s: string): string {
  return s.replace(/^[-.]+|[-.]+$/g, '')
}

function iso(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

export function buildTrace(a: {
  brief: string
  extra?: Record<string, unknown>
  finishedAt: number
  outputVideo: string
  startedAt: number
  steps: StepRecord[]
}): TraceFile {
  const trace: TraceFile = {
    brief: a.brief,
    output_video: a.outputVideo,
    started_at: iso(a.startedAt),
    finished_at: iso(a.finishedAt),
    steps: a.steps,
  }
  for (const [key, value] of Object.entries(a.extra ?? {})) {
    if (!(key in trace)) trace[key] = value
  }
  return trace
}

export function writeRunOutputs(a: {
  outputsDir: string
  slug: string
  trace: TraceFile
  videoPath: string
}): { tracePath: string; videoPath: string } {
  const dir = join(a.outputsDir, a.slug)
  const videoPath = join(dir, 'final.mp4')
  const tracePath = join(dir, 'traces.json')
  mkdirSync(dir, { recursive: true })
  if (resolve(a.videoPath) !== resolve(videoPath)) {
    copyFileSync(a.videoPath, videoPath)
  }
  const trace = { ...a.trace, output_video: `outputs/${a.slug}/final.mp4` }
  writeFileSync(tracePath, `${JSON.stringify(trace, null, 2)}\n`)
  return { tracePath, videoPath }
}
