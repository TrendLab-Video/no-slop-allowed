import { CAST_SHEET } from './prompts.ts'
import {
  download, OUT, pickImage, readState, run, saveState, upload,
} from './lib.ts'

const state = await readState()
state.product_url = await upload(`${OUT}product.png`)
const cast = await run('cast-sheet', 'fal-ai/nano-banana', {
  prompt: CAST_SHEET, aspect_ratio: '16:9', num_images: 1,
}, 0.0398, pickImage)
await download(cast, 'cast.png')
state.cast_url = cast
await saveState(state)
