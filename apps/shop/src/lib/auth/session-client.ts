import type { AppId, SessionFailureReason, SessionResponse } from '@shopping/shared'
import {
  API_PATH_PREFIX,
  APP_ID_HEADER,
  isApiFieldError,
  sessionFailureReasons,
  sessionResponseSchema,
} from '@shopping/shared'

/**
 * The access token, and the one request that renews it (TASK-0023 4장).
 *
 * **This file exists three times** — `apps/shop`, `apps/seller`, `apps/admin` —
 * and the three copies are byte-identical. The honest home is `packages/shared`,
 * beside `api/client.ts`, which is the other module in this repository that runs
 * in a browser and knows the API's shape. TASK-0023 does not own that package
 * (two API tasks are editing it in the same wave), so the copy is deliberate and
 * recorded rather than overlooked — `apps/seller/src/lib/api-failure.ts` carries
 * the same note for the same reason, and `docs/HANDOFF.md` 3.3 is where that
 * debt is tracked. TASK-0023 7장 R3.
 *
 * **The refresh token is never here.** It is an `HttpOnly` cookie on the API's
 * origin; the browser attaches it because every call is `credentials: 'include'`
 * and nothing in this process can read it. What this module holds is the access
 * token, which lives in memory for fifteen minutes and is meant to be read by
 * the code that sends it (TASK-0022 4장).
 *
 * **Why memory and not `localStorage`.** A token in storage survives the tab and
 * is readable by any script on the origin, which is the whole thing the
 * `HttpOnly` cookie exists to avoid. Losing it on reload costs one renewal — the
 * same call the app makes on boot anyway.
 */

/** How long before expiry a token is renewed rather than used (ms). */
const EXPIRY_SKEW_MS = 30_000

export type SessionRefusal = SessionFailureReason | 'unreachable'

export type SessionOutcome =
  | { readonly ok: true; readonly session: SessionResponse }
  | { readonly ok: false; readonly reason: SessionRefusal }

export interface SessionClient {
  /** The bearer token to send, or `null` when there is no session. */
  readonly accessToken: () => string | null
  /** The account this session belongs to, or `null`. */
  readonly user: () => SessionResponse['user'] | null
  /**
   * Exchanges the refresh cookie for a new pair.
   *
   * **Concurrent callers share one request.** Rotation issues a new refresh
   * token and revokes the old one, so two renewals in flight mean one of the two
   * results is thrown away and the browser keeps whichever cookie landed last.
   * The server has a ten second grace window for exactly this (TASK-0022 4장),
   * which makes the race survivable — not correct.
   */
  readonly renew: () => Promise<SessionOutcome>
  /** Renews only when the token in hand is about to stop working. */
  readonly ensureFresh: () => Promise<void>
  /** Ends this app's session. The other two consoles keep theirs (D-218). */
  readonly logout: () => Promise<void>
  /** Drops the token without calling the API. */
  readonly forget: () => void
}

export interface SessionClientOptions {
  readonly baseUrl: string
  readonly appId: AppId
  /** Injected by specs. Defaults to the global `fetch`. */
  readonly fetch?: typeof globalThis.fetch
  /** Injected by specs, so expiry can be reached without waiting. */
  readonly now?: () => number
}

/** Why a 401 refused the renewal, read off `details[].params.reason`. */
function refusalOf(body: unknown): SessionFailureReason {
  if (typeof body !== 'object' || body === null) return 'unknown'

  const details = (body as { error?: { details?: unknown } }).error?.details
  if (!Array.isArray(details)) return 'unknown'

  const reason = details.find(isApiFieldError)?.params?.reason

  return sessionSays(reason) ? reason : 'unknown'
}

function sessionSays(value: unknown): value is SessionFailureReason {
  return typeof value === 'string' && (sessionFailureReasons as readonly string[]).includes(value)
}

export function createSessionClient({
  baseUrl,
  appId,
  fetch: doFetch = (input, init) => globalThis.fetch(input, init),
  now = () => Date.now(),
}: SessionClientOptions): SessionClient {
  let session: SessionResponse | null = null
  let expiresAt = 0
  let inFlight: Promise<SessionOutcome> | null = null

  const url = (path: string): string => `${baseUrl}${API_PATH_PREFIX}${path}`

  const headers = (): HeadersInit => ({
    Accept: 'application/json',
    [APP_ID_HEADER]: appId,
  })

  function adopt(next: SessionResponse): void {
    session = next
    expiresAt = Date.parse(next.accessExpiresAt)
  }

  function forget(): void {
    session = null
    expiresAt = 0
  }

  async function request(): Promise<SessionOutcome> {
    let response: Response
    try {
      response = await doFetch(url('/auth/refresh'), {
        method: 'POST',
        headers: headers(),
        credentials: 'include',
        cache: 'no-store',
      })
    } catch {
      // A dead network is not a refused session: the browser may still hold a
      // perfectly good cookie, so the caller is told to try again rather than to
      // sign in.
      return { ok: false, reason: 'unreachable' }
    }

    const body: unknown = await response.json().catch(() => undefined)

    if (!response.ok) {
      forget()
      return { ok: false, reason: refusalOf(body) }
    }

    const parsed = sessionResponseSchema.safeParse(body)
    if (!parsed.success) {
      // A body we cannot read is not a session. Treated as unreachable, because
      // the one thing it is definitely not is "sign in again".
      return { ok: false, reason: 'unreachable' }
    }

    adopt(parsed.data)
    return { ok: true, session: parsed.data }
  }

  function renew(): Promise<SessionOutcome> {
    if (inFlight !== null) return inFlight

    const started = request()
    inFlight = started
    // Cleared on the promise itself rather than on a `.finally` chain: the chain
    // returns a *different* promise, and clearing from it would leave the next
    // caller waiting on a settled one for a tick.
    void started.finally(() => {
      if (inFlight === started) inFlight = null
    })

    return started
  }

  return {
    accessToken: () => session?.accessToken ?? null,
    user: () => session?.user ?? null,
    renew,

    async ensureFresh(): Promise<void> {
      // Nothing in hand means the boot renewal already happened and answered
      // "anonymous". Renewing again on every request would turn one refusal into
      // one per call.
      if (session === null) return
      if (now() < expiresAt - EXPIRY_SKEW_MS) return

      await renew()
    },

    async logout(): Promise<void> {
      forget()

      try {
        await doFetch(url('/auth/logout'), {
          method: 'POST',
          headers: headers(),
          credentials: 'include',
          cache: 'no-store',
        })
      } catch {
        // The token is already gone from this tab, which is what the person
        // asked for. A failed call leaves a row the API sweeps on expiry.
      }
    },

    forget,
  }
}

/**
 * Wraps `fetch` so every API call carries the session and survives an expiry.
 *
 * Handed to `createApiClient` as its `fetch`, which is the seam
 * `packages/shared` already provides — the alternative was teaching the shared
 * client about tokens, and that package is not this task's to change.
 *
 * **The retry only fires when a token was actually sent.** A 401 for a request
 * that carried no `Authorization` is the expected answer for a signed-out
 * visitor, and renewing there would add a round trip to every anonymous page
 * view to be told again what boot already established.
 */
export function authenticatedFetch(
  session: SessionClient,
  baseFetch: typeof globalThis.fetch = (input, init) => globalThis.fetch(input, init),
): (input: string, init: RequestInit) => Promise<Response> {
  return async (input, init) => {
    await session.ensureFresh()

    const token = session.accessToken()
    const first = await baseFetch(input, withBearer(init, token))

    if (first.status !== 401 || token === null) return first

    const renewed = await session.renew()
    if (!renewed.ok) return first

    return baseFetch(input, withBearer(init, renewed.session.accessToken))
  }
}

function withBearer(init: RequestInit, token: string | null): RequestInit {
  if (token === null) return init

  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${token}`)

  return { ...init, headers }
}
