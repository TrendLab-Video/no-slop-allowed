import { FIX_SUFFIX, FRAMES } from './prompts.ts'
import { download, pickImage, readState, run, saveState } from './lib.ts'

const EDIT_A = 'google/nano-banana-2.1/edit'
const EDIT_B = 'blackforestlabs/flux-3/edit-image'

const state = await readState()
const refs = [state.cast_url, state.product_url]
const fix = process.argv.includes('--fix')
const only = process.argv.slice(2).filter((a) => a !== '--fix')
const tag = fix ? '-fix' : ''

type Job = { model: 'A' | 'B'; frame: string; prompt: string }
const jobs: Job[] = [
  ...['F1', 'F2', 'F3', 'F4'].map((f) => ({ model: 'A' as const, frame: f })),
  ...['F1', 'F2'].map((f) => ({ model: 'B' as const, frame: f })),
]
  .map((j) => ({
    ...j,
    prompt: (FRAMES[j.frame] ?? '') + (fix ? FIX_SUFFIX : ''),
  }))
  .filter((j) => only.length === 0 || only.includes(`${j.model}${j.frame}`))

function input(j: Job): Record<string, unknown> {
  if (j.model === 'A') {
    return {
      image_urls: refs, prompt: j.prompt, aspect_ratio: '9:16',
      resolution: '1K', thinking_level: 'medium', num_images: 1,
    }
  }
  return {
    image_urls: refs, prompt: j.prompt, aspect_ratio: '9:16',
    resolution: '1k',
  }
}

await Promise.all(jobs.map(async (j) => {
  const key = `${j.model}${j.frame}${tag}`
  const url = await run(
    `compose-${key}`, j.model === 'A' ? EDIT_A : EDIT_B, input(j),
    j.model === 'A' ? 0.044 : 0.048, pickImage,
  )
  await download(url, `${key}.png`)
  state[key] = url
}))
await saveState(state)
