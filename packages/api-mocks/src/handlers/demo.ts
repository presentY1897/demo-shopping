import type { DemoAccount, DemoRole, SessionResponse } from '@shopping/shared'
import { APP_ID_HEADER, demoIssueRequestSchema, isAppId } from '@shopping/shared'
import type { RequestHandler } from 'msw'
import { http, HttpResponse } from 'msw'

import { defineFixture } from '../define'
import { demoAdminAccount, demoBuyerAccount, demoSellerAccount } from '../fixtures/demo'
import { sessionBuyer, sessionDemoAdmin, sessionSellerOwner } from '../fixtures/session'
import { mockResponseHeaders } from '../failures'
import { mockPaths } from '../paths'
import { answering, MockApiError, readBody } from './refusal'
import { resetSessionStore } from './session'

import { demoIssueResponseSchema, demoStatusResponseSchema } from '@shopping/shared'

/**
 * Issuing a demo account, and asking how long one has left (TASK-0024).
 *
 * **A successful issue signs the browser in**, because that is what the real one
 * does: the response sets a refresh cookie and the app then calls
 * `POST /auth/refresh`. msw has no cookie jar, so what the double reproduces is
 * the state the cookie stands for — the session store now holds a session — and
 * a screen that forgot to renew afterwards fails here exactly as it would
 * against the API.
 *
 * **`X-App-Id` is checked, and so is its agreement with the body.** Both are
 * refusals the API makes (`DemoController`), and both are refusals a client can
 * only discover by being told: a session issued into the wrong app's cookie is
 * not an error anywhere, it is a console the visitor can never enter.
 */

/** Which app may issue which persona, as `demo-persona.ts` states it. */
const ROLE_BY_APP: Readonly<Record<string, DemoRole>> = {
  shop: 'BUYER',
  seller: 'SELLER',
  admin: 'ADMIN',
}

/** The account each persona is issued, and the session it signs in as. */
const ISSUED: Readonly<Record<DemoRole, { account: DemoAccount; session: SessionResponse }>> = {
  BUYER: { account: demoBuyerAccount, session: sessionBuyer },
  SELLER: { account: demoSellerAccount, session: sessionSellerOwner },
  ADMIN: { account: demoAdminAccount, session: sessionDemoAdmin },
}

/** Who the caller is right now, as far as `GET /auth/demo` is concerned. */
let current: DemoAccount | null = null

/** Answers the next issue with the rate limit, once. */
let refuseNext = false

/**
 * Back to "this browser is a real account", which is the default on purpose: a
 * banner spec has to say which of the two states it is about, and the one that
 * draws nothing is the one it gets by saying nothing.
 */
export function resetDemoStore(seed: DemoAccount | null = null): void {
  current = seed
  refuseNext = false
}

/** The status the double would answer with. Lets a spec assert an issue. */
export function mockDemoAccount(): DemoAccount | null {
  return current
}

/**
 * Makes the next issue answer 429, and only the next one.
 *
 * One-shot rather than sticky so a spec can prove the recovery half — a visitor
 * who was refused, waited, and pressed the button again — without a second
 * handler override to undo the first.
 */
export function failNextDemoIssue(): void {
  refuseNext = true
}

function appOf(request: Request): string {
  const app = request.headers.get(APP_ID_HEADER)

  if (!isAppId(app)) {
    throw new MockApiError(400, '어느 앱에서 온 요청인지 알 수 없어요.', {
      code: 'INVALID',
      field: 'app',
    })
  }

  return app
}

export const demoHandlers: readonly RequestHandler[] = [
  http.post(mockPaths.authDemo, ({ request }) =>
    answering(async () => {
      const app = appOf(request)
      const { role } = await readBody(request, demoIssueRequestSchema)

      if (refuseNext) {
        refuseNext = false
        throw new MockApiError(429, '데모 계정을 너무 자주 발급했어요. 잠시 후 다시 시도해 주세요.')
      }

      const expected = ROLE_BY_APP[app]

      if (expected !== role) {
        throw new MockApiError(400, `${app} 앱에서는 ${expected ?? ''} 데모만 발급할 수 있어요.`, {
          code: 'INVALID',
          field: 'role',
          params: { app, expected: expected ?? '' },
        })
      }

      const issued = ISSUED[role]

      current = issued.account
      // The cookie's stand-in: from here on the browser holds a session, which
      // is what the app's `renew()` is about to discover.
      resetSessionStore(issued.session)

      return HttpResponse.json(defineFixture(demoIssueResponseSchema, { demo: issued.account }), {
        headers: mockResponseHeaders,
      })
    }),
  ),

  http.get(mockPaths.authDemo, () =>
    answering(() =>
      HttpResponse.json(defineFixture(demoStatusResponseSchema, { demo: current }), {
        headers: mockResponseHeaders,
      }),
    ),
  ),
]
