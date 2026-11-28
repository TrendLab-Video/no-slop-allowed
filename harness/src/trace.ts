import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { config } from './config.ts'
import type { RunState, Stage } from './types.ts'

// Every decision the harness makes is an event on the run. The UI polls the run,
// and runs are saved to runs/<id>.json so you can replay a good one in the demo.

const runs = new Map<string, Run>()

export class Run {
  state: RunState
  private saveTimer: ReturnType<typeof setTimeout> | undefined

  constructor(brief: string, options: Record<string, unknown>, id = makeId()) {
    this.state = {
      id,
      brief,
      status: 'running',
      startedAt: Date.now(),
      options,
      concepts: [],
      matches: [],
      renders: [],
      spend: { usd: 0, calls: 0 },
      events: [],
    }
    runs.set(id, this)
  }

  get id() {
    return this.state.id
  }

  emit(stage: Stage, message: string, data?: unknown) {
    this.state.events.push({ t: Date.now() - this.state.startedAt, stage, message, data })
    if (!process.env.QUIET) console.log(`[${this.id}] ${stage.padEnd(9)} ${message}`)
    this.scheduleSave()
  }

  addSpend(usd: number) {
    this.state.spend.usd += usd
    this.state.spend.calls += 1
  }

  finish(status: 'done' | 'error', error?: string) {
    this.state.status = status
    this.state.finishedAt = Date.now()
    if (error) this.state.error = error
    this.save()
  }

  private scheduleSave() {
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined
      this.save()
    }, 250)
  }

  save() {
    mkdirSync(config.runsDir, { recursive: true })
    writeFileSync(join(config.runsDir, `${this.id}.json`), JSON.stringify(this.state, null, 2))
  }
}

/**
 * Call once at server boot. Any saved run still marked 'running' was cut off by a
 * restart (nothing in this process owns it), so mark it as an error instead of
 * leaving the UI polling it forever.
 */
export function reconcileOrphanedRuns(): number {
  let fixed = 0
  for (const f of safeReaddir(config.runsDir)) {
    if (!f.endsWith('.json')) continue
    const path = join(config.runsDir, f)
    try {
      const s = JSON.parse(readFileSync(path, 'utf8')) as RunState
      if (s.status !== 'running' || runs.has(s.id)) continue
      s.status = 'error'
      s.error = 'interrupted (server restarted)'
      s.finishedAt = statSync(path).mtimeMs
      s.events.push({ t: s.finishedAt - s.startedAt, stage: 'error', message: 'Run interrupted: the server restarted mid-run' })
      writeFileSync(path, JSON.stringify(s, null, 2))
      fixed++
    } catch {
      // unreadable file, leave it
    }
  }
  return fixed
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

export function getRun(id: string): RunState | undefined {
  const live = runs.get(id)
  if (live) return live.state
  try {
    return JSON.parse(readFileSync(join(config.runsDir, `${safeId(id)}.json`), 'utf8')) as RunState
  } catch {
    return undefined
  }
}

export function listRuns(): Array<Pick<RunState, 'id' | 'brief' | 'status' | 'startedAt'>> {
  const saved = new Map<string, RunState>()
  try {
    for (const f of readdirSync(config.runsDir)) {
      if (!f.endsWith('.json')) continue
      try {
        const s = JSON.parse(readFileSync(join(config.runsDir, f), 'utf8')) as RunState
        saved.set(s.id, s)
      } catch {
        // half-written file, skip
      }
    }
  } catch {
    // no runs dir yet
  }
  for (const r of runs.values()) saved.set(r.id, r.state)
  return [...saved.values()]
    .sort((a, b) => b.startedAt - a.startedAt)
    .map(({ id, brief, status, startedAt }) => ({ id, brief, status, startedAt }))
}

function makeId() {
  const d = new Date()
  const stamp = `${d.getHours()}`.padStart(2, '0') + `${d.getMinutes()}`.padStart(2, '0')
  return `${stamp}-${Math.random().toString(36).slice(2, 6)}`
}

function safeId(id: string) {
  return id.replace(/[^a-zA-Z0-9-]/g, '')
}
