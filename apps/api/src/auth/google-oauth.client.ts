import { ServiceUnavailableException } from '@nestjs/common'

import type { GoogleOAuthConfig } from '../config/google-config.js'

/**
 * The seam every call to Google goes through (QUALITY-GATES 6장 — "모킹 대상은
 * 전부 포트 뒤에 둔다"; `OBJECT_STORAGE` is the precedent).
 *
 * Google is a mocked dependency in the test band: its responses are not ours to
 * control and its failure cases are not ours to produce. Putting it behind a
 * port means a spec replaces one provider instead of reaching into the global
 * `fetch`, which is what the only other external dependency in this repository
 * had to do (`search.health-indicator.spec.ts`) and what makes those specs care
 * about URLs they should not know about.
 *
 * **Why no library.** The flow needs two HTTPS calls, both documented and
 * stable, and a library would move the mocking boundary inside itself — the
 * spec would then stub whatever the library uses rather than what we call. It
 * would also pull in id_token verification we do not perform: the profile comes
 * from `userinfo`, so no JWT is parsed here at all (TASK-0021 4장).
 */
export const GOOGLE_OAUTH = Symbol('GOOGLE_OAUTH')

/** Where a person is sent to approve the request. */
const AUTHORIZE_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/userinfo'

/**
 * `openid email profile` and nothing else (D-209).
 *
 * All three are non-sensitive, which is what lets the consent screen be
 * published without Google's app verification. Adding a fourth is not a code
 * change — it is a review that takes weeks.
 */
const SCOPES = ['openid', 'email', 'profile'] as const

/**
 * How long Google gets to answer before the sign-in is treated as failed.
 *
 * Without it a slow Google holds the callback request — and a connection — open
 * for as long as it likes, and the person sees a spinner instead of the
 * "다시 시도해 주세요" an `exchange_failed` redirect gives them.
 * `search.health-indicator.ts` takes its deadline from configuration because a
 * probe's tolerance is an operational choice; this one is not, so it is a
 * constant: generous enough that a slow-but-working exchange completes, short
 * enough that nobody is left waiting on a dead endpoint.
 */
const REQUEST_TIMEOUT_MS = 10_000

/** What the token endpoint hands back, narrowed to what is used. */
export interface GoogleTokens {
  readonly accessToken: string
}

/**
 * A Google account, as `userinfo` describes it.
 *
 * `sub` is the only stable identifier: an email address can be changed by its
 * owner and reassigned by a workspace administrator, so it is stored for
 * display and never matched on (TASK-0021 R2).
 */
export interface GoogleProfile {
  readonly sub: string
  readonly email: string
  readonly name: string
  readonly picture: string | null
}

export interface GoogleOAuthClient {
  /** The consent screen URL to redirect a person to. */
  authorizeUrl: (params: { readonly redirectUri: string; readonly state: string }) => string
  exchangeCode: (params: {
    readonly code: string
    readonly redirectUri: string
  }) => Promise<GoogleTokens>
  fetchProfile: (accessToken: string) => Promise<GoogleProfile>
}

/**
 * Raised when Google answers something this code cannot use.
 *
 * Carries no detail from the response on purpose: the caller turns it into a
 * redirect a person reads, and Google's error bodies are for operators. The
 * operator's copy goes to the log next to the request id (TASK-0021 R4).
 */
export class GoogleOAuthError extends Error {
  constructor(
    readonly stage: 'exchange' | 'profile',
    readonly detail: string,
  ) {
    super(`google oauth ${stage} failed: ${detail}`)
    this.name = 'GoogleOAuthError'
  }
}

function requireString(value: unknown, field: string, stage: 'exchange' | 'profile'): string {
  if (typeof value !== 'string' || value === '') {
    throw new GoogleOAuthError(stage, `missing ${field}`)
  }
  return value
}

/** Google over HTTPS. */
export class FetchGoogleOAuthClient implements GoogleOAuthClient {
  constructor(private readonly config: GoogleOAuthConfig) {}

  authorizeUrl({ redirectUri, state }: { redirectUri: string; state: string }): string {
    const url = new URL(AUTHORIZE_ENDPOINT)

    url.searchParams.set('client_id', this.config.clientId)
    url.searchParams.set('redirect_uri', redirectUri)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('scope', SCOPES.join(' '))
    url.searchParams.set('state', state)
    // Ask for the account chooser every time. Without it Google silently reuses
    // the single signed-in account, which makes it impossible to demonstrate the
    // three consoles side by side — the thing this project exists to show.
    url.searchParams.set('prompt', 'select_account')

    return url.toString()
  }

  async exchangeCode({
    code,
    redirectUri,
  }: {
    code: string
    redirectUri: string
  }): Promise<GoogleTokens> {
    const response = await this.call(TOKEN_ENDPOINT, 'exchange', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        // Google checks this against the code it issued; it is not decoration.
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    })

    if (!response.ok) throw new GoogleOAuthError('exchange', `status ${String(response.status)}`)

    const body: unknown = await response.json().catch(() => null)
    const accessToken = requireString(
      (body as { access_token?: unknown } | null)?.access_token,
      'access_token',
      'exchange',
    )

    return { accessToken }
  }

  async fetchProfile(accessToken: string): Promise<GoogleProfile> {
    const response = await this.call(USERINFO_ENDPOINT, 'profile', {
      headers: { authorization: `Bearer ${accessToken}` },
    })

    if (!response.ok) throw new GoogleOAuthError('profile', `status ${String(response.status)}`)

    const body = ((await response.json().catch(() => null)) ?? {}) as Record<string, unknown>
    // Read in the order the fields are required, so a response missing both
    // reports the identifier rather than the label.
    const sub = requireString(body.sub, 'sub', 'profile')
    const email = requireString(body.email, 'email', 'profile')

    return {
      sub,
      email,
      // Falls back to the local part rather than refusing: `name` is a display
      // string and `User.name` is NOT NULL, so an account without one has to be
      // representable. A refusal here would lock somebody out over a label.
      name: typeof body.name === 'string' && body.name !== '' ? body.name : localPart(email),
      picture: typeof body.picture === 'string' && body.picture !== '' ? body.picture : null,
    }
  }

  /**
   * One call to Google, with a deadline.
   *
   * A timeout surfaces as the same {@link GoogleOAuthError} a refusal does. From
   * the caller's side "Google did not answer" and "Google said no" lead to the
   * same redirect, and splitting them would offer a person a distinction they
   * cannot act on differently.
   */
  private async call(
    url: string,
    stage: 'exchange' | 'profile',
    init: RequestInit,
  ): Promise<Response> {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
    } catch (error) {
      throw new GoogleOAuthError(stage, error instanceof Error ? error.name : 'network')
    }
  }
}

/** The part of an address before the `@`, or the whole thing when there is none. */
function localPart(email: string): string {
  const at = email.indexOf('@')

  return at < 0 ? email : email.slice(0, at)
}

/**
 * What is bound when no Google variable is set (TASK-0021 4장 세트 검증).
 *
 * Same shape as `UnconfiguredObjectStorage`: the API has to boot and serve
 * everything else before an OAuth client exists — and CI never has one at all —
 * so "not configured" answers 503 rather than failing at startup.
 */
export class UnconfiguredGoogleOAuthClient implements GoogleOAuthClient {
  authorizeUrl(): never {
    return this.refuse()
  }

  exchangeCode(): never {
    return this.refuse()
  }

  fetchProfile(): never {
    return this.refuse()
  }

  private refuse(): never {
    throw new ServiceUnavailableException(
      '로그인이 아직 설정되지 않았어요. 잠시 후 다시 시도해 주세요.',
    )
  }
}

export function createGoogleOAuthClient(config: GoogleOAuthConfig | null): GoogleOAuthClient {
  return config === null ? new UnconfiguredGoogleOAuthClient() : new FetchGoogleOAuthClient(config)
}
