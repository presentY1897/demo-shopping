/**
 * Rendering a screen with somebody signed in.
 *
 * `AuthProvider` boots by calling `POST /auth/refresh`, which msw answers from
 * the session store in `@shopping/api-mocks`. So a spec says *who* is signed in
 * by seeding that store, and the provider gets there the same way the real app
 * does — through the network — rather than by being handed a session nobody
 * checked.
 *
 * **A fresh `SessionClient` per render.** The app's singleton holds the access
 * token for the life of the module, so reusing it would carry one spec's session
 * into the next and make the suite order-dependent.
 *
 * The default is `sessionSellerOwner`, because that is the account these screens are
 * ordinarily read by. A spec about a narrower role names it.
 */

import type { SessionResponse } from '@shopping/shared'
import { resetSessionStore, sessionSellerOwner } from '@shopping/api-mocks'
import { render, type RenderResult } from '@testing-library/react'
import type { ReactElement } from 'react'

import { AuthProvider } from '@/lib/auth/auth-context'
import type { SessionClient } from '@/lib/auth/session-client'
import { createSessionClient } from '@/lib/auth/session-client'

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://api.test.invalid'

export function freshSessionClient(overrides: { readonly now?: () => number } = {}): SessionClient {
  return createSessionClient({ appId: 'seller', baseUrl: BASE_URL, ...overrides })
}

export function renderWithAuth(
  ui: ReactElement,
  { session = sessionSellerOwner }: { readonly session?: SessionResponse | null } = {},
): RenderResult {
  resetSessionStore(session)

  return render(<AuthProvider client={freshSessionClient()}>{ui}</AuthProvider>)
}
