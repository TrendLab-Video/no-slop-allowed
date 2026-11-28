import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { assemble } from '../src/film/assemble.ts'
import { FFMPEG, runCmd, tail } from '../src/film/probe.ts'

const dir = join(import.meta.dir, '..', 'runs', 'demo')
const inputs = join(dir, 'inputs')
await mkdir(inputs, { recursive: true })

async function make(out: string, ...args: string[]) {
  const r = await runCmd(
    [FFMPEG, '-y', '-hide_banner', '-loglevel', 'error', ...args, out],
    60_000,
  )
  if (r.code !== 0) throw new Error(`demo input failed:\n${tail(r.stderr)}`)
  return out
}

const landscape = await make(
  join(inputs, 'landscape.mp4'),
  ...['-f', 'lavfi', '-i', 'testsrc=size=1280x720:rate=24:duration=1.5'],
  ...['-pix_fmt', 'yuv420p'],
)
const portrait = await make(
  join(inputs, 'portrait.mp4'),
  ...['-f', 'lavfi', '-i', 'testsrc2=size=720x1280:rate=25:duration=1.5'],
  ...['-f', 'lavfi', '-i', 'sine=frequency=330:duration=1.5'],
  ...['-c:a', 'aac', '-pix_fmt', 'yuv420p'],
)
const square = await make(
  join(inputs, 'square.mp4'),
  ...['-f', 'lavfi', '-i', 'mandelbrot=size=600x600:rate=15'],
  ...['-t', '1.5', '-pix_fmt', 'yuv420p'],
)
const music = await make(
  join(inputs, 'music.wav'),
  ...['-f', 'lavfi', '-i', 'sine=frequency=440:duration=3'],
)

const result = await assemble({
  clips: [{ path: landscape }, { path: portrait }, { path: square }],
  endCard: { subtext: 'Made by the demo', text: 'Demo film' },
  keepClipAudio: true,
  music: { gainDb: -12, path: music },
  outPath: join(dir, 'final.mp4'),
})

const p = result.probe
console.log(
  `probe: ${p.width}x${p.height} ${p.fps}fps ${p.durationS.toFixed(2)}s ` +
    `${p.pixFmt} audio=${p.hasAudio} (${result.ms}ms) -> ${result.outPath}`,
)
for (const note of result.notes) console.log(`note: ${note}`)
