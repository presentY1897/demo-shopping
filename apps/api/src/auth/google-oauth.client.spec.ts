import { ServiceUnavailableException } from '@nestjs/common'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { GoogleOAuthConfig } from '../config/google-config.js'
import type { GoogleOAuthClient } from './google-oauth.client.js'
import {
  createGoogleOAuthClient,
  FetchGoogleOAuthClient,
  GoogleOAuthError,
  UnconfiguredGoogleOAuthClient,
} from './google-oauth.client.js'

/**
 * The two HTTPS calls the sign-in makes, and what happens when Google answers
 * something this code cannot use.
 *
 * `fetch` is stubbed here rather than replaced by a provider because this is the
 * implementation *of* the port — `search.health-indicator.spec.ts` is the same
 * situation and the same technique. Everything above this file swaps the whole
 * client instead, which is why nothing else in the repository needs to know the
 * URLs below.
 */

const CONFIG: GoogleOAuthConfig = { clientId: 'client-id', clientSecret: 'client-secret' }

const REDIRECT_URI = 'http://localhost:4040/api/v1/auth/google/callback'

/** Only the parts of a request this spec inspects. */
interface FetchInit {
  readonly signal?: unknown
  readonly method?: string
  readonly headers?: Readonly<Record<string, string>>
  readonly body?: unknown
}

interface Answer {
  readonly ok?: boolean
  readonly status?: number
  readonly body?: unknown
  /** For an answer that is not JSON at all — Google serves HTML error pages. */
  readonly unparseable?: boolean
}

function stubFetch(answer: Answer = {}): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((_url: string, _init?: FetchInit) =>
    Promise.resolve({
      ok: answer.ok ?? true,
      status: answer.status ?? 200,
      json: () =>
        answer.unparseable === true
          ? Promise.reject(new SyntaxError('Unexpected token < in JSON'))
          : Promise.resolve(answer.body),
    }),
  )

  vi.stubGlobal('fetch', fetchMock)

  return fetchMock
}

function requestOf(fetchMock: ReturnType<typeof vi.fn>): { url: string; init: FetchInit } {
  const call = fetchMock.mock.calls[0] as [string, FetchInit | undefined] | undefined
  if (call === undefined) throw new Error('nothing was requested')

  return { url: call[0], init: call[1] ?? {} }
}

function formOf(init: FetchInit): URLSearchParams {
  if (!(init.body instanceof URLSearchParams)) throw new Error('the body was not form encoded')

  return init.body
}

/** The error, so a test can look at the stage it names — and at what it does not say. */
async function rejection(promise: Promise<unknown>): Promise<GoogleOAuthError> {
  try {
    await promise
    throw new Error('expected the call to reject')
  } catch (error) {
    if (error instanceof GoogleOAuthError) return error
    throw error
  }
}

const client = new FetchGoogleOAuthClient(CONFIG)

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the consent screen URL', () => {
  const url = new URL(client.authorizeUrl({ redirectUri: REDIRECT_URI, state: 'state-token' }))

  it('goes to Google', () => {
    expect(url.origin).toBe('https://accounts.google.com')
  })

  it('carries the authorization code request', () => {
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: 'client-id',
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      state: 'state-token',
    })
  })

  it('asks for openid, email and profile — and nothing else (D-209)', () => {
    // All three are non-sensitive, which is what lets the consent screen be
    // published without Google's app verification. A fourth scope is not a code
    // change, it is a review that takes weeks.
    expect(url.searchParams.get('scope')).toBe('openid email profile')
  })

  it('asks for the account chooser every time', () => {
    // Without it Google silently reuses the one signed-in account, and the three
    // consoles cannot be demonstrated side by side — the thing this project is for.
    expect(url.searchParams.get('prompt')).toBe('select_account')
  })

  it('never carries the client secret', () => {
    // This URL is in the browser's address bar and in its history.
    expect(url.toString()).not.toContain('client-secret')
  })
})

describe('exchanging the code for a token', () => {
  it('posts a form to the token endpoint', async () => {
    const fetchMock = stubFetch({ body: { access_token: 'access-token' } })

    await client.exchangeCode({ code: 'auth-code', redirectUri: REDIRECT_URI })

    const { url, init } = requestOf(fetchMock)

    expect(url).toBe('https://oauth2.googleapis.com/token')
    expect(init.method).toBe('POST')
    expect(init.headers?.['content-type']).toBe('application/x-www-form-urlencoded')
  })

  it('sends the secret and the redirect URI, both of which Google checks', async () => {
    // The redirect URI is not decoration: Google compares it byte for byte
    // against the one the code was issued for, and a mismatch fails the exchange
    // with an error nobody sees except in this response.
    const fetchMock = stubFetch({ body: { access_token: 'access-token' } })

    await client.exchangeCode({ code: 'auth-code', redirectUri: REDIRECT_URI })

    const form = formOf(requestOf(fetchMock).init)

    expect(Object.fromEntries(form)).toEqual({
      code: 'auth-code',
      client_id: 'client-id',
      client_secret: 'client-secret',
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    })
  })

  it('returns the access token', async () => {
    stubFetch({ body: { access_token: 'access-token', id_token: 'unused' } })

    await expect(client.exchangeCode({ code: 'c', redirectUri: REDIRECT_URI })).resolves.toEqual({
      accessToken: 'access-token',
    })
  })

  it('fails at the exchange stage when Google refuses the code', async () => {
    stubFetch({ ok: false, status: 400, body: { error: 'invalid_grant' } })

    const error = await rejection(client.exchangeCode({ code: 'c', redirectUri: REDIRECT_URI }))

    // The stage is what the caller turns into `reason=exchange_failed`, so the
    // person reading the redirect learns which half of the flow gave up.
    expect(error.stage).toBe('exchange')
  })

  it('fails at the exchange stage when a 200 carries no access token', async () => {
    // A malformed success is the case that would otherwise reach the profile
    // call with `undefined` in the Authorization header.
    stubFetch({ body: { token_type: 'Bearer' } })

    expect(
      (await rejection(client.exchangeCode({ code: 'c', redirectUri: REDIRECT_URI }))).stage,
    ).toBe('exchange')
  })

  it('fails at the exchange stage when the answer is not JSON', async () => {
    // Google's outage pages are HTML. Letting the parse error escape would make
    // this a 500 instead of a redirect a person can read (F5).
    stubFetch({ unparseable: true })

    expect(
      (await rejection(client.exchangeCode({ code: 'c', redirectUri: REDIRECT_URI }))).stage,
    ).toBe('exchange')
  })
})

describe('fetching the profile', () => {
  const PROFILE_BODY = {
    sub: '110000000000000000001',
    email: 'somebody@example.test',
    name: '홍길동',
    picture: 'https://lh3.googleusercontent.com/a/photo',
  }

  it('presents the access token as a bearer credential', async () => {
    const fetchMock = stubFetch({ body: PROFILE_BODY })

    await client.fetchProfile('access-token')

    const { url, init } = requestOf(fetchMock)

    expect(url).toBe('https://www.googleapis.com/oauth2/v3/userinfo')
    expect(init.headers?.authorization).toBe('Bearer access-token')
  })

  it('maps the account onto the fields the sign-in stores', async () => {
    stubFetch({ body: PROFILE_BODY })

    await expect(client.fetchProfile('access-token')).resolves.toEqual({
      sub: '110000000000000000001',
      email: 'somebody@example.test',
      name: '홍길동',
      picture: 'https://lh3.googleusercontent.com/a/photo',
    })
  })

  const NAME_CASES: [string, Record<string, unknown>][] = [
    ['is missing', {}],
    ['is empty', { name: '' }],
    ['is not a string', { name: 42 }],
  ]

  it.each(NAME_CASES)(
    'falls back to the email local part when the name %s',
    async (_case, overrides) => {
      // `User.name` is NOT NULL. Refusing here would lock a person out of the only
      // sign-in this product has, over a display label they never chose.
      stubFetch({ body: { ...PROFILE_BODY, name: undefined, ...overrides } })

      await expect(client.fetchProfile('access-token')).resolves.toMatchObject({ name: 'somebody' })
    },
  )

  const PICTURE_CASES: [string, Record<string, unknown>][] = [
    ['is missing', {}],
    ['is empty', { picture: '' }],
  ]

  it.each(PICTURE_CASES)('reports no picture as null when it %s', async (_case, overrides) => {
    stubFetch({ body: { ...PROFILE_BODY, picture: undefined, ...overrides } })

    await expect(client.fetchProfile('access-token')).resolves.toMatchObject({ picture: null })
  })

  it.each(['sub', 'email'])('fails at the profile stage without %s', async (field) => {
    // `sub` is the identity and `email` is what the account is recognised by on
    // screen; a row created without either is a user nobody can sign in as again.
    stubFetch({ body: { ...PROFILE_BODY, [field]: undefined } })

    expect((await rejection(client.fetchProfile('access-token'))).stage).toBe('profile')
  })

  it('fails at the profile stage when the token is refused', async () => {
    stubFetch({ ok: false, status: 401, body: { error: 'invalid_credentials' } })

    expect((await rejection(client.fetchProfile('access-token'))).stage).toBe('profile')
  })

  it('fails at the profile stage when the answer is not JSON', async () => {
    stubFetch({ unparseable: true })

    expect((await rejection(client.fetchProfile('access-token'))).stage).toBe('profile')
  })
})

describe('a Google that does not answer', () => {
  /**
   * Every request carries a deadline.
   *
   * Without one a slow Google holds the callback — and the connection behind it
   * — open for as long as it likes, and the person watches a spinner instead of
   * getting the redirect that tells them to try again.
   */
  it('sends an abort signal with both calls', async () => {
    const exchange = stubFetch({ body: { access_token: 'token' } })
    await client.exchangeCode({ code: 'c', redirectUri: 'https://api.test.invalid/cb' })
    expect(requestOf(exchange).init.signal).toBeInstanceOf(AbortSignal)

    vi.unstubAllGlobals()

    const profile = stubFetch({ body: { sub: 's', email: 'a@b.test' } })
    await client.fetchProfile('token')
    expect(requestOf(profile).init.signal).toBeInstanceOf(AbortSignal)
  })

  it('turns a transport failure into the same error a refusal produces', async () => {
    // A caller cannot act differently on "no answer" than on "no": both end in
    // the same redirect, so both arrive as the same error with the same stage.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new DOMException('The operation timed out.', 'TimeoutError'))),
    )

    const failed = await rejection(
      client.exchangeCode({ code: 'c', redirectUri: 'https://api.test.invalid/cb' }),
    )

    expect(failed.stage).toBe('exchange')
  })

  it('names the profile stage when it is the profile call that dies', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('fetch failed'))),
    )

    expect((await rejection(client.fetchProfile('token'))).stage).toBe('profile')
  })
})

describe('what a failure is allowed to carry', () => {
  it('names the stage and the status, which is what the operator log needs', async () => {
    stubFetch({ ok: false, status: 503, body: {} })

    const error = await rejection(client.exchangeCode({ code: 'c', redirectUri: REDIRECT_URI }))

    expect(error.name).toBe('GoogleOAuthError')
    expect(error.message).toContain('exchange')
    expect(error.detail).toContain('503')
  })

  it('carries nothing from the response body', async () => {
    // The caller turns this into a redirect a person reads, and Google's error
    // bodies are written for operators — R4 splits the two on purpose. The
    // message also travels into logs, where an echoed body would be one more
    // place a token could come to rest.
    stubFetch({
      ok: false,
      status: 400,
      body: { error: 'invalid_grant', error_description: 'Token has been expired or revoked' },
    })

    const refused = await rejection(client.exchangeCode({ code: 'c', redirectUri: REDIRECT_URI }))

    expect(refused.message).not.toContain('invalid_grant')
    expect(refused.message).not.toContain('revoked')

    // Same on the path where the status was fine and the payload was not.
    stubFetch({ body: { id_token: 'header.payload.signature' } })

    const malformed = await rejection(client.exchangeCode({ code: 'c', redirectUri: REDIRECT_URI }))

    expect(malformed.message).not.toContain('header.payload.signature')
  })
})

describe('an API with no Google credentials', () => {
  const unconfigured: GoogleOAuthClient = new UnconfiguredGoogleOAuthClient()

  const CALLS: [string, () => unknown][] = [
    ['authorizeUrl', () => unconfigured.authorizeUrl({ redirectUri: REDIRECT_URI, state: 's' })],
    ['exchangeCode', () => unconfigured.exchangeCode({ code: 'c', redirectUri: REDIRECT_URI })],
    ['fetchProfile', () => unconfigured.fetchProfile('access-token')],
  ]

  it.each(CALLS)('answers 503 from %s rather than failing at startup (F8)', (_name, call) => {
    // CI never has these credentials and the API shipped before the OAuth client
    // existed, so "not configured" has to be a running process with two dead
    // endpoints — not a boot failure.
    const fetchMock = stubFetch()

    expect(call).toThrow(ServiceUnavailableException)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('says so in a sentence a person can read', () => {
    // The refusal reaches a browser, so it is not the place for the name of a
    // missing environment variable.
    const thrown = (): unknown => unconfigured.fetchProfile('access-token')

    expect(thrown).toThrow(/[가-힣]/)
    expect(thrown).not.toThrow(/GOOGLE_CLIENT/)
  })
})

describe('choosing the implementation', () => {
  it('takes the unconfigured client when there are no credentials', () => {
    expect(createGoogleOAuthClient(null)).toBeInstanceOf(UnconfiguredGoogleOAuthClient)
  })

  it('takes the fetch client when there are', () => {
    expect(createGoogleOAuthClient(CONFIG)).toBeInstanceOf(FetchGoogleOAuthClient)
  })
})
