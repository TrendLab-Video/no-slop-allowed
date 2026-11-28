import type { MediaKind } from './types.ts'

// Every fal endpoint id and input/output shape lives here and nowhere else.
// Schemas checked against each model's https://fal.ai/models/<id>/llms.txt on 2026-11-25.
// To swap a model: add a spec, point ROLES at it, run `bun run smoke`.

export type MediaParams = {
  prompt: string
  /** Start frame for image-to-video. */
  imageUrl?: string
  /** Reference images for multi-image edit models. */
  imageUrls?: string[]
  /** e.g. '9:16' or '16:9', for models that take an aspect ratio. */
  aspectRatio?: string
  /** Seconds, for video. */
  seconds?: number
}

export type MediaSpec = {
  endpoint: string
  kind: MediaKind
  build: (p: MediaParams) => Record<string, unknown>
  pick: (data: any) => string | undefined
  estUsd: (p: MediaParams) => number
}

const env = process.env

export const LLM = {
  textEndpoint: 'openrouter/router',
  visionEndpoint: 'openrouter/router/vision',
  // Model strings are passed through to OpenRouter. Both appear on fal's router pages.
  textModel: env.LLM_MODEL ?? 'anthropic/claude-sonnet-5',
  visionModel: env.VISION_MODEL ?? 'anthropic/claude-sonnet-5',
}

export const SPECS = {
  /** FLUX.1 schnell: ~1-2s, $0.003/MP. Drafts and critique rounds. */
  fluxSchnell: {
    endpoint: 'fal-ai/flux/schnell',
    kind: 'image',
    build: (p) => ({ prompt: p.prompt, image_size: 'portrait_16_9', num_images: 1 }),
    pick: (d) => d?.images?.[0]?.url,
    estUsd: () => 0.003 * 0.59, // 576x1024
  },
  /** FLUX.2 dev: better quality, $0.012/MP. */
  flux2: {
    endpoint: 'fal-ai/flux-2',
    kind: 'image',
    build: (p) => ({ prompt: p.prompt, image_size: 'portrait_16_9', num_images: 1 }),
    pick: (d) => d?.images?.[0]?.url,
    estUsd: () => 0.012 * 0.59,
  },
  /** Nano Banana (Gemini 2.5 Flash Image): $0.0398/image. Final hero image. */
  nanoBanana: {
    endpoint: 'fal-ai/nano-banana',
    kind: 'image',
    build: (p) => ({ prompt: p.prompt, aspect_ratio: '9:16', num_images: 1 }),
    pick: (d) => d?.images?.[0]?.url,
    estUsd: () => 0.0398,
  },
  /** Nano Banana edit: fix a specific image instead of re-rolling. Needs imageUrl. */
  nanoBananaEdit: {
    endpoint: 'fal-ai/nano-banana/edit',
    kind: 'image',
    build: (p) => ({ prompt: p.prompt, image_urls: p.imageUrl ? [p.imageUrl] : [], aspect_ratio: 'auto', num_images: 1 }),
    pick: (d) => d?.images?.[0]?.url,
    estUsd: () => 0.0398,
  },
  /** MiniMax H3 Max Turbo i2v: vendor says ~2s for 5s. $0.04/s at 768P. Cheapest motion. */
  h3TurboI2V: {
    endpoint: 'minimax/h3-max-turbo/image-to-video',
    kind: 'video',
    build: (p) => ({
      prompt: p.prompt,
      image_url: p.imageUrl,
      duration: p.seconds ?? 5,
      resolution: '768P', // uppercase P is required
      prompt_expansion_mode: 'balanced',
    }),
    pick: (d) => d?.video?.url,
    estUsd: (p) => 0.04 * (p.seconds ?? 5),
  },
  /** Kling v4 i2v: high quality, $0.157/s at 720p. Note: no fal-ai/ prefix, field is start_image_url. */
  klingV4I2V: {
    endpoint: 'kling/v4/image-to-video',
    kind: 'video',
    build: (p) => ({ prompt: p.prompt, start_image_url: p.imageUrl, duration: p.seconds ?? 5, resolution: '720p' }),
    pick: (d) => d?.video?.url,
    estUsd: (p) => 0.157 * (p.seconds ?? 5),
  },
  /** FLUX 3 Max t2v with native audio. Promo $0.1105/s at 720p until 7 Dec 2026, then $0.17/s. */
  flux3MaxT2V: {
    endpoint: 'blackforestlabs/flux-3-max/text-to-video',
    kind: 'video',
    build: (p) => ({ prompt: p.prompt, duration: p.seconds ?? 5, aspect_ratio: '9:16', resolution: '720p', generate_audio: true }),
    pick: (d) => d?.video?.url,
    estUsd: (p) => 0.1105 * (p.seconds ?? 5),
  },
  /** Kokoro TTS: $0.02 per 1k chars. */
  kokoro: {
    endpoint: 'fal-ai/kokoro/american-english',
    kind: 'audio',
    build: (p) => ({ prompt: p.prompt, voice: 'af_heart' }),
    pick: (d) => d?.audio?.url,
    estUsd: (p) => (0.02 * p.prompt.length) / 1000,
  },
  /** Lyria 2 music: $0.10 per 30s clip. */
  lyria2: {
    endpoint: 'fal-ai/lyria2',
    kind: 'audio',
    build: (p) => ({ prompt: p.prompt }),
    pick: (d) => d?.audio?.url,
    estUsd: () => 0.1,
  },
} satisfies Record<string, MediaSpec>

/** Which model does which job. Change these lines to change the pipeline. */
export const ROLES: { draft: MediaSpec; final: MediaSpec; edit: MediaSpec; video: MediaSpec } = {
  draft: SPECS.fluxSchnell,
  final: SPECS.nanoBanana,
  edit: SPECS.nanoBananaEdit,
  video: SPECS.h3TurboI2V,
}

// Audio endpoints for src/film/sound.ts. Schemas checked against each model's
// llms.txt on 2026-11-28.
export const AUDIO = {
  /** ElevenLabs music v2.5: $0.60 per output minute, rounded up. */
  music: { endpoint: 'elevenlabs/music/v2.5', usdPerMinute: 0.6 },
  /** Mirelo SFX 2.0 video-to-audio: $0.010 per second to 13/12/2026. */
  sfx: {
    endpoint: 'mirelo-ai/sfx2.0/video-to-audio',
    usdPerSecond: 0.01,
  },
  /** ElevenLabs Scribe v2: $0.008 per minute of input. */
  stt: {
    endpoint: 'fal-ai/elevenlabs/speech-to-text/scribe-v2',
    usdPerMinute: 0.008,
  },
  /** ElevenLabs Eleven v4 TTS: $0.08 per 1000 characters. */
  tts: { endpoint: 'elevenlabs/tts/eleven-v4', usdPer1kChars: 0.08 },
} as const

// Film pipeline specs (src/film/). Schemas checked against each model's
// llms.txt on 2026-11-28.
export const FILM_SPECS = {
  /** Nano Banana at 16:9: the cast sheet that carries identity. */
  castSheet: {
    endpoint: 'fal-ai/nano-banana',
    kind: 'image',
    build: (p) => ({
      aspect_ratio: p.aspectRatio ?? '16:9',
      num_images: 1,
      prompt: p.prompt,
    }),
    pick: (d) => d?.images?.[0]?.url,
    estUsd: () => 0.0398,
  },
  /** Nano Banana 2.1 edit: composes a shot from cast sheet + product. */
  composeFrame: {
    endpoint: 'google/nano-banana-2.1/edit',
    kind: 'image',
    build: (p) => ({
      aspect_ratio: p.aspectRatio ?? '9:16',
      image_urls: p.imageUrls ?? [],
      num_images: 1,
      prompt: p.prompt,
      resolution: '1K',
      thinking_level: 'medium',
    }),
    pick: (d) => d?.images?.[0]?.url,
    estUsd: () => 0.044,
  },
} satisfies Record<string, MediaSpec>

export const FILM_ROLES: {
  cast: MediaSpec
  frame: MediaSpec
  motion: MediaSpec
} = {
  cast: FILM_SPECS.castSheet,
  frame: FILM_SPECS.composeFrame,
  motion: SPECS.h3TurboI2V,
}

// Film quality gate (src/film/gate.ts). The video router schema was checked
// against https://fal.ai/models/openrouter/router/video/llms.txt on 2026-11-28.
export const GATE_LLM = {
  frameModel: env.GATE_MODEL ?? 'google/gemini-3.8-flash',
  videoEndpoint: 'openrouter/router/video',
  videoModel: env.GATE_VIDEO_MODEL ?? 'google/gemini-3.8-flash',
}
