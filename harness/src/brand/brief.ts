export type Brief = {
  name: string
  url?: string
  description: string
  raw: string
}

const URL_LINE = /^\s*url\s*:\s*(\S+)\s*$/i
const HEADING = /^#+\s+(.+?)\s*$/
const BARE_URL = /^https?:\/\/\S+$/i

function normaliseUrl(value: string): string | undefined {
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value)
    ? value
    : `https://${value}`
  try {
    const url = new URL(withScheme)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    if (!url.hostname.includes('.') && url.hostname !== 'localhost') {
      return undefined
    }
    return url.href
  } catch {
    return undefined
  }
}

function hostName(url: string): string {
  return new URL(url).hostname.replace(/^www\./, '')
}

export function parseBrief(text: string): Brief {
  const raw = text.trim()
  let url: string | undefined
  let name: string | undefined
  const rest: string[] = []

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const urlLine = trimmed.match(URL_LINE)
    if (urlLine) {
      url ??= normaliseUrl(urlLine[1]!)
      continue
    }
    if (BARE_URL.test(trimmed) && url === undefined && !name && !rest.length) {
      url = normaliseUrl(trimmed)
      continue
    }
    const heading = trimmed.match(HEADING)
    if (heading && name === undefined) {
      name = heading[1]!
      continue
    }
    if (name === undefined) {
      name = trimmed
      continue
    }
    rest.push(trimmed)
  }

  name ??= url ? hostName(url) : ''
  const description = rest.join(' ').replace(/\s+/g, ' ').trim() || name
  const brief: Brief = { name, description: raw ? description : '', raw }
  if (url) brief.url = url
  return brief
}
