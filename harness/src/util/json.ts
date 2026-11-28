// Pull the first JSON object or array out of an LLM reply.
// Handles ```json fences and chatter before/after the JSON.

export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = (fenced?.[1] ?? text).trim()

  const start = body.search(/[[{]/)
  if (start === -1) throw new Error(`No JSON found in reply: ${preview(text)}`)

  const open = body[start]!
  const close = open === '{' ? '}' : ']'
  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < body.length; i++) {
    const ch = body[i]!
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === open) depth++
    else if (ch === close) {
      depth--
      if (depth === 0) return JSON.parse(body.slice(start, i + 1))
    }
  }
  throw new Error(`Unterminated JSON in reply: ${preview(text)}`)
}

function preview(text: string) {
  return text.length > 200 ? `${text.slice(0, 200)}...` : text
}
