/**
 * A cookie store for the integration harness.
 *
 * Node's `fetch` has none: it sends what the caller puts in the `Cookie` header
 * and drops every `Set-Cookie` it receives. Rebuilding that by hand looks like
 * an inconvenience and is actually the point — TASK-0022 has to assert that the
 * refresh cookie is `HttpOnly`, `SameSite`, correctly scoped by `Path` and given
 * a `Max-Age`, and a jar that silently swallowed those attributes would make
 * them unassertable.
 */

export interface ParsedCookie {
  readonly name: string
  readonly value: string
  /** Attribute names lowercased; a valueless attribute (`HttpOnly`) maps to `''`. */
  readonly attributes: Readonly<Record<string, string>>
}

/** Splits one `Set-Cookie` header value into its name, value and attributes. */
export function parseSetCookie(header: string): ParsedCookie | null {
  const [pair, ...rest] = header.split(';')
  if (pair === undefined) return null

  const separator = pair.indexOf('=')
  if (separator <= 0) return null

  const attributes: Record<string, string> = {}

  for (const part of rest) {
    const trimmed = part.trim()
    if (trimmed === '') continue

    const at = trimmed.indexOf('=')

    if (at === -1) attributes[trimmed.toLowerCase()] = ''
    else attributes[trimmed.slice(0, at).trim().toLowerCase()] = trimmed.slice(at + 1).trim()
  }

  return {
    name: pair.slice(0, separator).trim(),
    value: pair.slice(separator + 1).trim(),
    attributes,
  }
}

/** Whether the server asked for the cookie to be removed. */
function isExpired(cookie: ParsedCookie): boolean {
  const maxAge = cookie.attributes['max-age']

  return maxAge !== undefined && Number(maxAge) <= 0
}

export interface CookieJar {
  /** Reads every `Set-Cookie` of a response into the jar. */
  capture: (response: Response) => void
  /** Value for the next request's `Cookie` header, or `undefined` when empty. */
  header: () => string | undefined
  /** The stored cookie, attributes included, for assertions. */
  get: (name: string) => ParsedCookie | undefined
  names: () => readonly string[]
  clear: () => void
}

export function createCookieJar(): CookieJar {
  const cookies = new Map<string, ParsedCookie>()

  return {
    capture(response: Response): void {
      for (const header of response.headers.getSetCookie()) {
        const cookie = parseSetCookie(header)
        if (cookie === null) continue

        // A deletion is a `Set-Cookie` too; keeping it would send a dead value
        // back and make a logout test pass for the wrong reason.
        if (isExpired(cookie)) cookies.delete(cookie.name)
        else cookies.set(cookie.name, cookie)
      }
    },

    header(): string | undefined {
      if (cookies.size === 0) return undefined

      return [...cookies.values()].map((cookie) => `${cookie.name}=${cookie.value}`).join('; ')
    },

    get: (name: string) => cookies.get(name),
    names: () => [...cookies.keys()],
    clear: () => {
      cookies.clear()
    },
  }
}
