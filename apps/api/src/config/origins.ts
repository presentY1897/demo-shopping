export interface OriginListResult {
  /** Normalised, de-duplicated origins in declaration order. */
  readonly origins: readonly string[]
  /** Entries that are not an `http(s)` origin, reported back to the operator. */
  readonly invalid: readonly string[]
}

/** `http://localhost:3040/` and `http://localhost:3040` are the same origin. */
function normalise(entry: string): string | null {
  let url: URL
  try {
    url = new URL(entry)
  } catch {
    return null
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  return url.origin
}

/**
 * Parses the comma separated `CORS_ORIGINS` variable.
 *
 * The browser compares the `Origin` header byte for byte, so every entry is
 * normalised to a scheme/host/port triple up front; comparing raw strings would
 * silently reject an allowed origin because someone left a trailing slash.
 */
export function parseOriginList(raw: string): OriginListResult {
  const origins: string[] = []
  const invalid: string[] = []
  const seen = new Set<string>()

  for (const entry of raw.split(',')) {
    const trimmed = entry.trim()
    if (trimmed === '') continue

    const origin = normalise(trimmed)
    if (origin === null) {
      invalid.push(trimmed)
      continue
    }
    if (seen.has(origin)) continue

    seen.add(origin)
    origins.push(origin)
  }

  return { origins, invalid }
}
