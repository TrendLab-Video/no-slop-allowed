import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { assemble } from '../src/film/assemble.ts'
import { FFMPEG, probe, runCmd, tail } from '../src/film/probe.ts'
import {
  checkVoice,
  makeMusic,
  musicSections,
  normaliseWords,
  planTimeline,
  sameWord,
  transcribe,
  voiceLines,
} from '../src/film/sound.ts'
import type { Word } from '../src/film/sound.ts'
import { Run } from '../src/trace.ts'

const root = join(import.meta.dir, '..')
const dir = join(root, 'runs', 'sound-demo')
const clipsDir = join(root, 'spikes', 'refpack', 'out')
const END_S = 2.5
const run = new Run('sound-demo', {}, 'sound-demo')

const script = [
  { shotId: 'F1', text: 'Twelve hours under a bus.' },
  { shotId: 'F3', text: 'Then this.' },
  {
    shotId: 'F4',
    text: 'Minor Figures. For the ones who made the morning.',
  },
]
const shots = ['F1', 'F2', 'F3', 'F4'].map((id) => ({
  id,
  maxS: 5,
  minS: 2.5,
}))
const mood = {
  endS: END_S,
  styles: [
    'warm acoustic guitar',
    'soft brushed drums',
    'dawn',
    'hopeful',
    'cinematic',
  ],
}

async function ff(args: string[]): Promise<void> {
  const r = await runCmd(
    [FFMPEG, '-y', '-hide_banner', '-loglevel', 'error', ...args],
    120_000,
  )
  if (r.code !== 0) throw new Error(`ffmpeg failed\n${tail(r.stderr)}`)
}

function firstWordStart(words: Word[], line: string, from: number) {
  const target = normaliseWords(line)
  const heard = words
    .filter((w) => w.type === 'word')
    .flatMap((w) =>
      normaliseWords(w.text).map((text) => ({ start: w.start, text })),
    )
  for (let i = from; i < heard.length; i++) {
    const hit = target.every((t, k) => sameWord(t, heard[i + k]?.text ?? ''))
    if (hit) return { next: i + target.length, start: heard[i]?.start ?? NaN }
  }
  return { next: from, start: NaN }
}

await mkdir(dir, { recursive: true })
const t0 = performance.now()
const wall = () => (performance.now() - t0) / 1000

const voiced = await voiceLines(script, { outDir: join(dir, 'voice') }, run)
const tVoice = wall()
const timeline = planTimeline(shots, voiced, { leadS: 0.25, padS: 0.5 })
const sections = musicSections(timeline, mood)
console.log('timeline', JSON.stringify(timeline.shots), timeline.overlong)
console.log(
  'sections',
  JSON.stringify(sections.map((s) => [s.label, s.durationS])),
)

const [music, checks] = await Promise.all([
  makeMusic({ outDir: join(dir, 'music'), sections }, run),
  checkVoice(voiced, run),
])
const soundWall = wall()
const planned = timeline.totalS + END_S

const inputs: string[] = []
for (const v of timeline.voice) inputs.push('-i', v.path)
const delayed = timeline.voice.map(
  (v, i) => `[${i}:a]adelay=${Math.round(v.startAt * 1000)}:all=1[d${i}]`,
)
const labels = timeline.voice.map((_, i) => `[d${i}]`).join('')
const mix = `amix=inputs=${timeline.voice.length}:normalize=0:duration=longest`
const voicePath = join(dir, 'voice-track.wav')
await ff([
  ...inputs,
  ...['-filter_complex', `${delayed.join(';')};${labels}${mix}[o]`],
  ...['-map', '[o]', '-ar', '48000', '-c:a', 'pcm_s16le', voicePath],
])

const final = await assemble({
  clips: timeline.shots.map((s) => ({
    duration: s.durationS,
    path: join(clipsDir, `clip-${s.id}.mp4`),
  })),
  endCard: {
    seconds: END_S,
    subtext: 'For the ones who made the morning.',
    text: 'Minor Figures',
  },
  music: { path: music.path },
  outPath: join(dir, 'final.mp4'),
  voice: { path: voicePath, startAt: 0 },
})
for (const n of final.notes) console.log('assemble note:', n)

const finalAudio = join(dir, 'final-audio.wav')
await ff(['-i', final.outPath, '-vn', '-ac', '1', '-ar', '16000', finalAudio])
const [filmWords, musicWords] = await Promise.all([
  transcribe(finalAudio, run),
  transcribe(music.path, run),
])

let cursor = 0
const starts = voiced.map((v) => {
  const at = timeline.voice.find((e) => e.path === v.path)?.startAt ?? NaN
  const hit = firstWordStart(filmWords, v.text, cursor)
  cursor = hit.next
  return {
    deltaS: hit.start - at,
    heard: hit.start,
    planned: at,
    shot: v.shotId,
  }
})
const spoken = musicWords.filter((w) => w.type === 'word')

const report = {
  checkVoice: checks.map((c) => ({
    heard: c.heard,
    ok: c.ok,
    shot: c.line.shotId,
  })),
  filmS: final.probe.durationS,
  music: { ...music, plannedS: planned, spokenWords: spoken.length },
  overlong: timeline.overlong,
  sectionsS: sections.map((s) => [s.label, s.durationS]),
  soundWallS: soundWall,
  spend: run.state.spend,
  starts,
  voiceDoneS: tVoice,
}
await writeFile(join(dir, 'report.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
console.log('\nper call:')
for (const e of run.state.events) {
  const d = e.data as { ms?: number; usd?: number } | undefined
  if (d?.ms === undefined) continue
  const secs = (d.ms / 1000).toFixed(1)
  console.log(`  ${e.message} (${secs}s, $${(d.usd ?? 0).toFixed(4)})`)
}
const filmS = (await probe(final.outPath)).durationS
console.log(`film: ${final.outPath} (${filmS}s)`)
run.finish('done')
