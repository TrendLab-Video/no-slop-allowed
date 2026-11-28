export type Probe = {
  durationS: number
  fps: number
  hasAudio: boolean
  height: number
  pixFmt: string
  width: number
}

export type CmdResult = {
  code: number
  stderr: string
  stdout: string
  timedOut: boolean
}

export const FFMPEG = Bun.which('ffmpeg') ?? '/opt/homebrew/bin/ffmpeg'
export const FFPROBE = Bun.which('ffprobe') ?? '/opt/homebrew/bin/ffprobe'

export async function runCmd(
  args: string[],
  timeoutMs: number,
): Promise<CmdResult> {
  const proc = Bun.spawn(args, {
    stderr: 'pipe',
    stdin: 'ignore',
    stdout: 'pipe',
  })
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    proc.kill('SIGKILL')
  }, timeoutMs)
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    return { code, stderr, stdout, timedOut }
  } finally {
    clearTimeout(timer)
  }
}

export function tail(text: string, lines = 20): string {
  return text.trim().split('\n').slice(-lines).join('\n')
}

type Stream = {
  avg_frame_rate?: string
  codec_type?: string
  duration?: string
  height?: number
  pix_fmt?: string
  r_frame_rate?: string
  width?: number
}

function parseRate(rate: string | undefined): number {
  const [n, d] = (rate ?? '').split('/').map(Number)
  if (!n || !d) return 0
  return Math.round((n / d) * 1000) / 1000
}

export async function probe(path: string): Promise<Probe> {
  const r = await runCmd(
    [
      FFPROBE,
      ...['-v', 'error', '-print_format', 'json'],
      ...['-show_format', '-show_streams', path],
    ],
    30_000,
  )
  if (r.code !== 0) {
    throw new Error(`ffprobe failed for ${path}:\n${tail(r.stderr)}`)
  }
  const data = JSON.parse(r.stdout) as {
    format?: { duration?: string }
    streams?: Stream[]
  }
  const streams = data.streams ?? []
  const video = streams.find((s) => s.codec_type === 'video')
  const duration = Number(data.format?.duration) || Number(video?.duration)
  const fps =
    parseRate(video?.avg_frame_rate) || parseRate(video?.r_frame_rate)
  return {
    durationS: duration || 0,
    fps,
    hasAudio: streams.some((s) => s.codec_type === 'audio'),
    height: video?.height ?? 0,
    pixFmt: video?.pix_fmt ?? '',
    width: video?.width ?? 0,
  }
}
