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
  /** Labels the call in traces.json, e.g. the render id or match. */
  ref?: string
}

export async function complete(call: LlmCall, run?: Run): Promise<string> {
  const started = Date.now()
  const record = (tool: string, model: string, output: string, ms: number, usd: number) =>
    run?.recordCall({ task: call.task, ref: call.ref, tool, model, inputs: { system: call.system, image_urls: call.imageUrls }, prompt: call.prompt, output, ms, usd, at: started })
  if (config.mock) {
    const text = await mockLlm(call)
    record('mock:llm', 'mock', text, Date.now() - started, 0)
    return text
  }

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

  let res: Awaited<ReturnType<typeof callFal>>
  try {
    res = await callFal(endpoint, input)
  } catch (err) {
    record(endpoint, String(input.model), `ERROR: ${String(err).slice(0, 500)}`, Date.now() - started, 0)
    throw err
  }
  const usd = Number(res.data?.usage?.cost ?? 0)
  run?.addSpend(Number.isFinite(usd) ? usd : 0)
  const text = res.data?.output
  if (typeof text !== 'string') throw new Error(`${call.task}: LLM returned no text output (${JSON.stringify(res.data).slice(0, 300)})`)
  record(endpoint, String(input.model), text, res.ms, Number.isFinite(usd) ? usd : 0)
  return text
}

/** Ask for JSON, validate against a zod schema, retry once with the validation error. */
export async function completeJson<S extends z.ZodTypeAny>(call: LlmCall, schema: S, run?: Run, retries = 1): Promise<z.infer<S>> {
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
