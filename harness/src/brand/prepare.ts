import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export type Prepared =
  | {
      ok: true
      bytes: Uint8Array<ArrayBuffer>
      type: 'image/jpeg' | 'image/png'
      width: number
      height: number
    }
  | { ok: false; reason: string }

export const MIN_SHORT_SIDE = 400
const MAX_LONG_SIDE = 2048
const TOOL_TIMEOUT_MS = 15_000
const REJECTED_TYPES = /svg|icon|\bico\b/i

const startsWith = (bytes: Uint8Array, magic: number[]) =>
  magic.every((b, i) => bytes[i] === b)

function sniff(bytes: Uint8Array): 'jpeg' | 'png' | 'ico' | 'other' {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpeg'
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) return 'png'
  if (startsWith(bytes, [0, 0, 1, 0])) return 'ico'
  return 'other'
}

async function run(cmd: string[]): Promise<string | undefined> {
  try {
    const proc = Bun.spawn(cmd, {
      stderr: 'ignore',
      stdout: 'pipe',
      timeout: TOOL_TIMEOUT_MS,
    })
    const [out, code] = await Promise.all([
      new Response(proc.stdout).text(),
      proc.exited,
    ])
    return code === 0 ? out : undefined
  } catch {
    return undefined
  }
}

async function probe(
  file: string,
): Promise<{ width: number; height: number } | undefined> {
  const out = await run([
    'ffprobe',
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=width,height',
    '-of',
    'csv=p=0',
    file,
  ])
  const m = out?.trim().match(/^(\d+),(\d+)$/)
  if (!m) return undefined
  return { width: Number(m[1]), height: Number(m[2]) }
}

export async function prepareImage(
  bytes: Uint8Array<ArrayBuffer>,
  contentType: string,
): Promise<Prepared> {
  if (REJECTED_TYPES.test(contentType)) {
    return { ok: false, reason: `unsupported type ${contentType}` }
  }
  const kind = sniff(bytes)
  if (kind === 'ico') return { ok: false, reason: 'unsupported type ico' }

  const dir = await mkdtemp(join(tmpdir(), 'brand-prep-'))
  try {
    const input = join(dir, 'in.bin')
    await writeFile(input, bytes)
    const size = await probe(input)
    if (!size) return { ok: false, reason: 'unreadable image' }
    const short = Math.min(size.width, size.height)
    if (short < MIN_SHORT_SIDE) {
      return {
        ok: false,
        reason: `too small (${size.width}x${size.height})`,
      }
    }

    const long = Math.max(size.width, size.height)
    const keepsFormat = kind === 'jpeg' || kind === 'png'
    if (keepsFormat && long <= MAX_LONG_SIDE) {
      return {
        bytes,
        height: size.height,
        ok: true,
        type: kind === 'png' ? 'image/png' : 'image/jpeg',
        width: size.width,
      }
    }

    const type = kind === 'png' ? 'image/png' : 'image/jpeg'
    const output = join(dir, kind === 'png' ? 'out.png' : 'out.jpg')
    const args = ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y']
    args.push('-i', input, '-frames:v', '1')
    if (long > MAX_LONG_SIDE) {
      const box = `${MAX_LONG_SIDE}:${MAX_LONG_SIDE}`
      args.push('-vf', `scale=${box}:force_original_aspect_ratio=decrease`)
    }
    if (type === 'image/jpeg') args.push('-q:v', '3', '-pix_fmt', 'yuvj420p')
    args.push(output)
    if ((await run(args)) === undefined) {
      return { ok: false, reason: 'conversion failed' }
    }
    const done = await probe(output)
    if (!done) return { ok: false, reason: 'converted file unreadable' }
    return {
      bytes: new Uint8Array(await readFile(output)),
      height: done.height,
      ok: true,
      type,
      width: done.width,
    }
  } finally {
    await rm(dir, { force: true, recursive: true })
  }
}
