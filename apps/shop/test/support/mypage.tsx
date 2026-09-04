/**
 * Rendering an account screen the way the app assembles one.
 *
 * The two screens sit inside three things the route file does not carry: the
 * session (`AuthProvider`), the density store (`DensityProvider`, wrapped by
 * `AccountDensityProvider`, which is what saves a step to the account) and the
 * shell. Rendering a page without them would either throw — `useDensity`
 * refuses to default outside a provider — or quietly test a screen nobody can
 * reach.
 *
 * **`AccountDensityProvider` is the real one**, so a spec that changes a step
 * exercises the same `PATCH /me/preferences` the storefront sends, against the
 * same mock API. That is what makes the promotion test (F8) a test of the app
 * rather than of a stub.
 *
 * A fresh `SessionClient` per render, for the reason `renderWithAuth` gives:
 * the app's singleton holds the access token for the life of the module, and
 * reusing it would carry one spec's session into the next.
 */

import { resetSessionStore } from '@shopping/api-mocks'
import type { SessionResponse } from '@shopping/shared'
import { DENSITY_ATTRIBUTE, DEFAULT_DENSITY } from '@shopping/ui'
import type { RenderResult } from '@testing-library/react'
import { render } from '@testing-library/react'
import type { ReactElement } from 'react'

import { AccountDensityProvider } from '@/components/layout/account-density-provider'
import { AuthProvider } from '@/lib/auth/auth-context'
import { createSessionClient } from '@/lib/auth/session-client'

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://api.test.invalid'

export function renderAccountScreen(
  ui: ReactElement,
  { session = null }: { readonly session?: SessionResponse | null } = {},
): RenderResult {
  resetSessionStore(session)

  return render(
    <AuthProvider client={createSessionClient({ appId: 'shop', baseUrl: BASE_URL })}>
      <AccountDensityProvider>{ui}</AccountDensityProvider>
    </AuthProvider>,
  )
}

/** The step the document is currently rendering, as the stylesheet reads it. */
export function appliedDensity(): string | null {
  return document.documentElement.getAttribute(DENSITY_ATTRIBUTE)
}

/**
 * Back to a browser that has never chosen a step.
 *
 * Both the attribute and localStorage, because `getDensitySnapshot` prefers the
 * attribute and a leftover one would make the next spec start at whatever the
 * last one picked.
 */
export function resetDensity(): void {
  localStorage.clear()
  document.documentElement.setAttribute(DENSITY_ATTRIBUTE, String(DEFAULT_DENSITY))
}
