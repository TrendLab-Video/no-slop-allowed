import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { assemble } from '../src/film/assemble.ts'
import { FFMPEG, runCmd, tail } from '../src/film/probe.ts'
import { renderCard, renderSuper } from '../src/film/titles.ts'

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
  ...['-f', 'lavfi', '-i', 'sine=frequency=220:duration=8'],
)
const voice = await make(
  join(inputs, 'voice.wav'),
  ...['-f', 'lavfi', '-i', 'sine=frequency=600:duration=1.6'],
  ...['-af', 'tremolo=f=4:d=0.9'],
)
const product = await make(
  join(inputs, 'product.png'),
  ...['-f', 'lavfi', '-i', 'color=c=0xE8412C:s=900x600,format=rgba'],
  ...['-vf', 'drawbox=x=70:y=70:w=760:h=460:color=0xF5E9D0:t=fill'],
  ...['-frames:v', '1'],
)

const size = { height: 1920, width: 1080 }
const superPng = await renderSuper(
  'Built for the last mile.',
  { ...size, position: 'lower' },
  join(inputs, 'super.png'),
)

const samples = [
  {
    file: 'card-dark-image.png',
    spec: {
      accent: '#F2B705',
      bg: '#0F3D2E',
      fg: '#FFFFFF',
      imagePath: product,
      sub: 'The new Pegasus. Out now.',
      title: 'Run further.',
    },
  },
  {
    file: 'card-light.png',
    spec: {
      bg: '#F3EBDD',
      fg: '#111111',
      sub: 'Free returns for 60 days',
      title: 'Made to move',
    },
  },
  {
    file: 'card-long.png',
    spec: {
      bg: '#1B1B3A',
      fg: '#FFFFFF',
      sub: 'nike.com/pegasus',
      title: 'Every mile starts with one decision to go',
    },
  },
]
for (const s of samples) {
  await renderCard({ ...size, ...s.spec }, join(dir, s.file))
}

const result = await assemble({
  clips: [{ path: landscape }, { path: portrait }, { path: square }],
  endCard: {
    accent: '#F2B705',
    bg: '#0F3D2E',
    imagePath: product,
    seconds: 2.5,
    subtext: 'The new Pegasus. Out now.',
    text: 'Run further.',
  },
  keepClipAudio: false,
  music: { gainDb: -8, path: music },
  outPath: join(dir, 'final.mp4'),
  overlays: [{ endS: 3.2, imagePath: superPng, startS: 1.4 }],
  voice: { path: voice, startAt: 1.6 },
})

const p = result.probe
console.log(
  `probe: ${p.width}x${p.height} ${p.fps}fps ${p.durationS.toFixed(2)}s ` +
    `${p.pixFmt} audio=${p.hasAudio} (${result.ms}ms) -> ${result.outPath}`,
)
for (const note of result.notes) console.log(`note: ${note}`)
