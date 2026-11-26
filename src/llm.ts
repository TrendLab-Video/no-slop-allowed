import type { z } from 'zod'
import { config } from './config.ts'
import { callFal } from './fal.ts'
import { LLM } from './models.ts'
import { mockLlm } from './mock.ts'
import type { Run } from './trace.ts'
import { extractJson } from './util/json.ts'

// LLM calls go through fal's OpenRouter router, so one FAL_KEY covers
// director, judge, critic and reviser. Vision calls (critic, showdown) send image URLs.

export type LlmCall = {
  /** Tag used for tracing and for the mock responder, e.g. 'critic.critique'. */
  task: string
  system: string
  prompt: string
  imageUrls?: string[]
  temperature?: number
  maxTokens?: number
}

export async function complete(call: LlmCall, run?: Run): Promise<string> {
  if (config.mock) return mockLlm(call)

  const vision = (call.imageUrls?.length ?? 0) > 0
  const endpoint = vision ? LLM.visionEndpoint : LLM.textEndpoint
  const input: Record<string, unknown> = {
    model: vision ? LLM.visionModel : LLM.textModel,
    system_prompt: call.system,
    prompt: call.prompt,
    temperature: call.temperature ?? 0.7,
    max_tokens: call.maxTokens ?? 2000,
  }
  if (vision) input.image_urls = call.imageUrls

  const res = await callFal(endpoint, input)
  const usd = Number(res.data?.usage?.cost ?? 0)
  run?.addSpend(Number.isFinite(usd) ? usd : 0)
  const text = res.data?.output
  if (typeof text !== 'string') throw new Error(`${call.task}: LLM returned no text output (${JSON.stringify(res.data).slice(0, 300)})`)
  return text
}

/** Ask for JSON, validate against a zod schema, retry once with the validation error. */
export async function completeJson<T>(call: LlmCall, schema: z.ZodType<T>, run?: Run, retries = 1): Promise<T> {
  let prompt = `${call.prompt}\n\nReply with JSON only. No prose before or after.`
  let lastError = ''
  for (let attempt = 0; attempt <= retries; attempt++) {
    const text = await complete({ ...call, prompt }, run)
    try {
      return schema.parse(extractJson(text))
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      prompt = `${call.prompt}\n\nYour previous reply was invalid: ${lastError.slice(0, 600)}\nReply with corrected JSON only.`
    }
  }
  throw new Error(`${call.task}: invalid JSON after ${retries + 1} attempts: ${lastError.slice(0, 300)}`)
}
