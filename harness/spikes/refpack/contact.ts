import { OUT } from './lib.ts'

// usage: bun contact.ts out.png cols "file:label" ...
const [outName, colsArg, ...items] = process.argv.slice(2)
if (!outName || !colsArg || items.length === 0) {
  throw new Error('usage: contact.ts out.png cols file:label ...')
}
const cols = Number(colsArg)
const H = 640
const W = 400
const FONT = '/System/Library/Fonts/Supplemental/Arial.ttf'

// This ffmpeg build has no drawtext, so ImageMagick renders the labels.
function labelPng(i: number, text: string): string {
  const path = `${OUT}label-${outName}-${i}.png`
  const p = Bun.spawnSync([
    'magick', '-size', `${W}x40`, 'xc:white', '-font', FONT,
    '-pointsize', '22', '-fill', 'black', '-annotate', '+8+28', text,
    path,
  ])
  if (p.exitCode !== 0) throw new Error(p.stderr.toString())
  return path
}

const n = items.length
const args: string[] = ['-y']
const filters: string[] = []
items.forEach((item, i) => {
  const [file, label] = item.split(':')
  const [path, time] = (file ?? '').split('#')
  if (time !== undefined) args.push('-ss', time)
  args.push('-i', `${OUT}${path}`)
})
items.forEach((item, i) => {
  args.push('-i', labelPng(i, item.split(':')[1] ?? ''))
  filters.push(
    `[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
      `pad=${W}:${H}:(ow-iw)/2:0:color=white,setsar=1,format=rgb24[i${i}];` +
      `[${n + i}:v]setsar=1,format=rgb24[l${i}];[l${i}][i${i}]vstack[v${i}]`,
  )
})
const layout = items
  .map((_, i) => `${(i % cols) * W}_${Math.floor(i / cols) * (H + 40)}`)
  .join('|')
const inputs = items.map((_, i) => `[v${i}]`).join('')
filters.push(
  `${inputs}xstack=inputs=${items.length}:layout=${layout}:fill=white[o]`,
)
args.push(
  '-filter_complex', filters.join(';'), '-map', '[o]', '-frames:v', '1',
  `${OUT}${outName}`,
)
const proc = Bun.spawnSync(['ffmpeg', ...args], { stderr: 'pipe' })
if (proc.exitCode !== 0) {
  console.error(proc.stderr.toString().slice(-1500))
  process.exit(1)
}
console.log(`wrote ${OUT}${outName}`)
