import { STOCK_PHRASES } from '../prompts.ts'

/**
 * Remove stock-photography vocabulary from an image prompt before it is rendered.
 * The director and reviser are told not to use these words, but models drift back to them,
 * and image models answer them with exactly the stock look the critic rejects.
 */
export function stripStock(prompt: string): { prompt: string; removed: string[] } {
  const removed: string[] = []
  let out = prompt
  for (const re of STOCK_PHRASES) {
    out = out.replace(re, (m) => {
      removed.push(m.trim().toLowerCase())
      return ' '
    })
  }
  if (!removed.length) return { prompt, removed }
  out = out
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;])/g, '$1')
    .replace(/([,;])(\s*[,;])+/g, '$1')
    .replace(/(^|[.;]\s*)[,;]\s*/g, '$1')
    .replace(/[,;]\s*\./g, '.')
    .replace(/[,;\s]+$/, '')
    .trim()
  return { prompt: out, removed: [...new Set(removed)] }
}
