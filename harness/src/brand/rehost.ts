import { fal } from '@fal-ai/client'
import { config } from '../config.ts'
import { falLimit } from '../fal.ts'
import { BROWSER_HEADERS } from './scrape.ts'

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const TIMEOUT_MS = 10_000

export type Downloaded =
  | { ok: true; bytes: Uint8Array<ArrayBuffer>; type: string }
  | { ok: false; error: string }

export async function downloadImage(
  url: string,
  maxBytes = MAX_IMAGE_BYTES,
): Promise<Downloaded> {
  try {
    const res = await fetch(url, {
      headers: { ...BROWSER_HEADERS, Accept: 'image/*,*/*;q=0.8' },
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    const type = (res.headers.get('content-type') ?? '')
      .split(';')[0]!
      .trim()
      .toLowerCase()
    if (!type.startsWith('image/')) {
      return { ok: false, error: `not an image (${type || 'no type'})` }
    }
    if (Number(res.headers.get('content-length') ?? 0) > maxBytes) {
      return { ok: false, error: `over ${maxBytes} bytes` }
    }
    const reader = res.body?.getReader()
    if (!reader) return { ok: false, error: 'empty body' }
    const chunks: Uint8Array[] = []
    let total = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.length
      if (total > maxBytes) {
        await reader.cancel()
        return { ok: false, error: `over ${maxBytes} bytes` }
      }
      chunks.push(value)
    }
    return { ok: true, bytes: new Uint8Array(Buffer.concat(chunks)), type }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'failed' }
  }
}

let configured = false

export async function uploadBytes(
  bytes: Uint8Array<ArrayBuffer>,
  type: string,
): Promise<string> {
  if (!configured) {
    if (!config.falKey) throw new Error('FAL_KEY is not set')
    fal.config({ credentials: config.falKey })
    configured = true
  }
  const blob = new Blob([bytes], { type })
  return fal.storage.upload(blob)
}

export async function rehost(url: string): Promise<string> {
  if (config.mock) return url
  const image = await downloadImage(url)
  if (!image.ok) throw new Error(`rehost ${url}: ${image.error}`)
  return falLimit(() => uploadBytes(image.bytes, image.type))
}
