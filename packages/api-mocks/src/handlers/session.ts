import type { SessionFailureReason, SessionResponse } from '@shopping/shared'
import { APP_ID_HEADER, isAppId } from '@shopping/shared'
import type { RequestHandler } from 'msw'
import { http, HttpResponse } from 'msw'

import { mockResponseHeaders } from '../failures'
import { mockPaths } from '../paths'
import { answering, MockApiError } from './refusal'

/**
 * Renewing and ending a session (TASK-0022 `SessionController`).
 *
 * **There is no cookie here, and there does not need to be one.** The real
 * endpoint reads `shopping_refresh_<app>`; msw runs inside the test process
 * where no browser is storing anything, so what the double models is the *state
 * the cookie stands for* — "this browser holds a live session for this app, or
 * it does not". Reproducing the cookie would test `document.cookie`, which no
 * front-end code ever reads: the token is `HttpOnly` by design.
 *
 * **`X-App-Id` is checked**, because that header is the one thing the client
 * genuinely has to get right — it is what selects the cookie name, and therefore
 * which of the three sessions is renewed (D-218). A client that forgot it would
 * work against a lenient double and fail against the API.
 */

/** Who is signed in right now. `null` is a browser holding no session. */
let current: SessionResponse | null = null

/**
 * Says who is signed in for the next render, and clears any pending failure.
 *
 * Signed out by default, which is what the per-test reset in `node.ts` restores:
 * a spec that signed in, signed out or borrowed another role must not decide who
 * the next one is. Each app's `renderWithAuth` names the account its screens are
 * ordinarily read by.
 */
export function resetSessionStore(session: SessionResponse | null = null): void {
  current = session
  nextFailure = null
}

/** What the double would answer right now. Lets a spec assert a sign-out. */
export function mockSession(): SessionResponse | null {
  return current
}

function appOf(request: Request): void {
  if (!isAppId(request.headers.get(APP_ID_HEADER))) {
    throw new MockApiError(400, '어느 앱에서 온 요청인지 알 수 없어요.', {
      code: 'INVALID',
      field: 'app',
    })
  }
}

/**
 * The 401 a failed renewal answers.
 *
 * `AUTH_REQUIRED` on the envelope and the reason on `details[].params`, exactly
 * as `SessionController.refused` builds it — the code does not fork per reason
 * because each new domain code obliges every app's catalog to grow a sentence.
 */
function refused(reason: SessionFailureReason): MockApiError {
  return new MockApiError(
    401,
    reason === 'reused'
      ? '보안을 위해 로그아웃했어요. 다시 로그인해 주세요.'
      : '다시 로그인해 주세요.',
    { code: 'AUTH_REQUIRED', field: 'session', params: { reason } },
  )
}

/** Answers the next renewal with this failure, once. Then the store is normal. */
let nextFailure: SessionFailureReason | null = null

/**
 * Makes the next renewal fail, and only the next one.
 *
 * One-shot rather than sticky so a spec can prove the *recovery* half — a
 * request that met a 401, refreshed, and went through — without a second handler
 * override to undo the first.
 */
export function failNextRefresh(reason: SessionFailureReason = 'expired'): void {
  nextFailure = reason
}

export const sessionHandlers: readonly RequestHandler[] = [
  http.post(mockPaths.authRefresh, ({ request }) =>
    answering(() => {
      appOf(request)

      if (nextFailure !== null) {
        const reason = nextFailure
        nextFailure = null
        current = null
        throw refused(reason)
      }
      if (current === null) throw refused('unknown')

      return HttpResponse.json(current, { headers: mockResponseHeaders })
    }),
  ),

  http.post(mockPaths.authLogout, ({ request }) =>
    answering(() => {
      appOf(request)
      current = null

      return new HttpResponse(null, { status: 204, headers: mockResponseHeaders })
    }),
  ),
]
