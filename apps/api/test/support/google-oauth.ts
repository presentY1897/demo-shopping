import type {
  GoogleOAuthClient,
  GoogleProfile,
  GoogleTokens,
} from '../../src/auth/google-oauth.client.js'
import { GoogleOAuthError } from '../../src/auth/google-oauth.client.js'

/**
 * Google, on command.
 *
 * Google is a mocked dependency (QUALITY-GATES 6장) — its responses are not ours
 * to control and its failures are not ours to produce — and `GOOGLE_OAUTH` is
 * the port that mocking goes through. Nothing else in the flow is replaced: the
 * database is real (A6), the HTTP stack is real, and the service under test is
 * the one that ships.
 */
export interface FakeGoogle extends GoogleOAuthClient {
  /** Who the next sign-in will turn out to be. */
  setProfile: (profile: GoogleProfile) => void
  /** Makes every later call to that stage fail. */
  failAt: (stage: 'exchange' | 'profile') => void
  /** Back to answering normally. The app boots once per file; state does not. */
  reset: () => void
  /** Every `redirect_uri` this client was handed, in order. */
  readonly redirectUris: readonly string[]
  readonly exchangeCount: number
}

export const A_GOOGLE_PROFILE: GoogleProfile = {
  sub: '117312345678901234567',
  email: 'buyer@example.com',
  name: '김구매',
  picture: 'https://lh3.googleusercontent.com/a/default',
}

export function createFakeGoogle(initial: GoogleProfile = A_GOOGLE_PROFILE): FakeGoogle {
  let profile = initial
  let failing: 'exchange' | 'profile' | null = null
  const redirectUris: string[] = []
  let exchangeCount = 0

  return {
    authorizeUrl({ redirectUri, state }): string {
      redirectUris.push(redirectUri)

      // Shaped like Google's, so a spec asserting on the `Location` is asserting
      // on something with the same parts as the real thing.
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
      url.searchParams.set('redirect_uri', redirectUri)
      url.searchParams.set('state', state)
      return url.toString()
    },

    exchangeCode({ redirectUri }): Promise<GoogleTokens> {
      redirectUris.push(redirectUri)
      exchangeCount += 1

      if (failing === 'exchange') {
        return Promise.reject(new GoogleOAuthError('exchange', 'test'))
      }
      return Promise.resolve({ accessToken: 'test-access-token' })
    },

    fetchProfile(): Promise<GoogleProfile> {
      if (failing === 'profile') {
        return Promise.reject(new GoogleOAuthError('profile', 'test'))
      }
      return Promise.resolve(profile)
    },

    setProfile(next: GoogleProfile): void {
      profile = next
    },

    failAt(stage: 'exchange' | 'profile'): void {
      failing = stage
    },

    reset(): void {
      profile = initial
      failing = null
      redirectUris.length = 0
      exchangeCount = 0
    },

    get redirectUris(): readonly string[] {
      return redirectUris
    },

    get exchangeCount(): number {
      return exchangeCount
    },
  }
}
