import { mkdir, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'

export type DownloadOptions = { retries?: number; timeoutMs?: number }

async function attempt(
  url: string,
  destPath: string,
  timeoutMs: number,
): Promise<number> {
  const part = `${destPath}.part`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) throw new Error(`download ${url}: HTTP ${res.status}`)
    await Bun.write(part, res)
    const bytes = Bun.file(part).size
    if (bytes === 0) throw new Error(`download ${url}: empty file`)
    await rename(part, destPath)
    return bytes
  } catch (err) {
    await rm(part, { force: true })
    throw err
  }
}

export async function download(
  url: string,
  destPath: string,
  opts: DownloadOptions = {},
): Promise<{ bytes: number; path: string }> {
  const retries = opts.retries ?? 2
  const timeoutMs = opts.timeoutMs ?? 60_000
  await mkdir(dirname(destPath), { recursive: true })
  let last: unknown
  for (let i = 0; i <= retries; i++) {
    try {
      const bytes = await attempt(url, destPath, timeoutMs)
      return { bytes, path: destPath }
    } catch (err) {
      last = err
      if (i < retries) await Bun.sleep(250 * (i + 1))
    }
  }
  throw last instanceof Error ? last : new Error(String(last))
}
