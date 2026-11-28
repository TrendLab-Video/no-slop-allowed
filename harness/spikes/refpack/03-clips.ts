import { MOTION, R2V_F1 } from './prompts.ts'
import { download, pickVideo, readState, run, saveState } from './lib.ts'

const I2V = 'minimax/h3-max-turbo/image-to-video'
const R2V = 'minimax/h3-max-turbo/reference-to-video'
const PICKS: Record<string, string> = {
  F1: 'AF1-fix', F2: 'AF2', F3: 'AF3', F4: 'AF4',
}

const state = await readState()

const i2v = Object.entries(PICKS).map(async ([frame, key]) => {
  const url = await run(`i2v-${frame}`, I2V, {
    image_url: state[key],
    prompt: MOTION[frame],
    duration: 5,
    resolution: '768P',
    prompt_expansion_mode: 'balanced',
  }, 0.2, pickVideo, 300_000)
  await download(url, `clip-${frame}.mp4`)
  state[`clip_${frame}`] = url
})

const r2v = (async () => {
  const url = await run('r2v-F1', R2V, {
    reference_image_urls: [state.cast_url, state.product_url],
    prompt: R2V_F1,
    duration: 5,
    resolution: '768P',
    aspect_ratio: '9:16',
    prompt_expansion_mode: 'balanced',
  }, 0.4, pickVideo, 300_000)
  await download(url, 'clip-r2v-F1.mp4')
  state.clip_r2v_F1 = url
})()

await Promise.allSettled([...i2v, r2v])
await saveState(state)
