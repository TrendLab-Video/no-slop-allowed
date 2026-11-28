import { fal } from '@fal-ai/client'
import { callFal } from '../../src/fal.ts'

export const OUT = new URL('./out/', import.meta.url).pathname
const LOG = `${OUT}calls.json`

export type CallEntry = {
  step: string
  endpoint: string
  input: Record<string, unknown>
  output_url: string | undefined
  ms: number
  est_usd: number
  error?: string
}

async function readLog(): Promise<CallEntry[]> {
  const f = Bun.file(LOG)
  return (await f.exists()) ? ((await f.json()) as CallEntry[]) : []
}

let chain: Promise<void> = Promise.resolve()
function append(entry: CallEntry): Promise<void> {
  chain = chain.then(async () => {
    const all = await readLog()
    all.push(entry)
    await Bun.write(LOG, JSON.stringify(all, null, 2))
  })
  return chain
}

export async function run(
  step: string,
  endpoint: string,
  input: Record<string, unknown>,
  estUsd: number,
  pick: (d: any) => string | undefined,
  timeoutMs = 240_000,
): Promise<string> {
  const t0 = performance.now()
  try {
    const res = await callFal(endpoint, input, { timeoutMs })
    const url = pick(res.data)
    await append({
      step, endpoint, input, output_url: url, ms: res.ms, est_usd: estUsd,
    })
    console.log(`${step} ${res.ms}ms ${url}`)
    if (!url) throw new Error(`${step}: no output url`)
    return url
  } catch (err) {
    const ms = Math.round(performance.now() - t0)
    const msg = err instanceof Error ? err.message : String(err)
    await append({
      step, endpoint, input, output_url: undefined, ms, est_usd: 0,
      error: msg,
    })
    console.log(`${step} FAILED ${msg}`)
    throw err
  }
}

export async function download(url: string, name: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`download ${url}: ${res.status}`)
  const path = `${OUT}${name}`
  await Bun.write(path, await res.arrayBuffer())
  return path
}

export async function upload(path: string): Promise<string> {
  fal.config({ credentials: process.env.FAL_KEY })
  return fal.storage.upload(Bun.file(path))
}

export async function readState(): Promise<Record<string, string>> {
  const f = Bun.file(`${OUT}state.json`)
  return (await f.exists()) ? await f.json() : {}
}

export async function saveState(s: Record<string, string>): Promise<void> {
  await Bun.write(`${OUT}state.json`, JSON.stringify(s, null, 2))
}

export const pickImage = (d: any): string | undefined => d?.images?.[0]?.url
export const pickVideo = (d: any): string | undefined => d?.video?.url
