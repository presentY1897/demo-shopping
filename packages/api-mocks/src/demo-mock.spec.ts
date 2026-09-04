import {
  API_PATH_PREFIX,
  APP_ID_HEADER,
  demoIssueResponseSchema,
  demoStatusResponseSchema,
  isApiErrorBody,
} from '@shopping/shared'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { demoAdminAccount, demoBuyerAccount, demoSellerAccount } from './fixtures/demo'
import { defaultHandlers, failNextDemoIssue, mockDemoAccount, resetDemoStore } from './handlers'
import { mockSession, resetSessionStore } from './handlers'

/**
 * What the demo double answers (TASK-0024).
 *
 * The double's job is to behave like the endpoint in the ways a screen can
 * observe: it refuses a request with no `X-App-Id`, refuses a persona the app
 * may not issue, can be told to answer the rate limit once, and — the part a
 * screen depends on most — leaves the browser **signed in** afterwards.
 */

const BASE = 'http://api.test.invalid'
const server = setupServer(...defaultHandlers)

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' })
})

afterEach(() => {
  server.resetHandlers()
  resetSessionStore()
  resetDemoStore()
})

afterAll(() => {
  server.close()
})

function issue(role: string, app?: string): Promise<Response> {
  return fetch(`${BASE}${API_PATH_PREFIX}/auth/demo`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(app === undefined ? {} : { [APP_ID_HEADER]: app }),
    },
    body: JSON.stringify({ role }),
  })
}

function status(): Promise<Response> {
  return fetch(`${BASE}${API_PATH_PREFIX}/auth/demo`, { headers: { [APP_ID_HEADER]: 'shop' } })
}

describe('데모 발급 대역', () => {
  it('세 앱이 각각 자기 페르소나를 발급한다', async () => {
    for (const [app, account] of [
      ['shop', demoBuyerAccount],
      ['seller', demoSellerAccount],
      ['admin', demoAdminAccount],
    ] as const) {
      resetDemoStore()

      const response = await issue(account.role, app)

      expect(response.status).toBe(200)
      expect(demoIssueResponseSchema.parse(await response.json())).toEqual({ demo: account })
    }
  })

  it('발급하고 나면 브라우저가 로그인 상태가 된다', async () => {
    expect(mockSession()).toBeNull()

    await (await issue('BUYER', 'shop')).text()

    // The cookie's stand-in: the app's next `renew()` finds a session.
    expect(mockSession()?.user.roles).toContain('BUYER')
    expect(mockDemoAccount()).toEqual(demoBuyerAccount)
  })

  it('앱이 발급할 수 없는 페르소나를 거절한다', async () => {
    const response = await issue('ADMIN', 'shop')
    const body: unknown = await response.json()

    expect(response.status).toBe(400)
    expect(isApiErrorBody(body)).toBe(true)
    expect(JSON.stringify(body)).toContain('"field":"role"')
    expect(mockSession()).toBeNull()
  })

  it('앱 헤더가 없으면 거절한다', async () => {
    const response = await issue('BUYER')

    expect(response.status).toBe(400)
    expect(JSON.stringify(await response.json())).toContain('"field":"app"')
  })

  it('본문이 계약에 맞지 않으면 거절한다', async () => {
    const response = await issue('SUPERUSER', 'shop')

    expect(response.status).toBe(400)
  })

  it('한 번만 429 를 답하도록 시킬 수 있다', async () => {
    failNextDemoIssue()

    const refused = await issue('BUYER', 'shop')

    expect(refused.status).toBe(429)
    await refused.text()

    // The recovery half: pressing the button again works.
    expect((await issue('BUYER', 'shop')).status).toBe(200)
  })
})

describe('데모 상태 대역', () => {
  it('기본은 실계정이라 아무것도 답하지 않는다', async () => {
    expect(demoStatusResponseSchema.parse(await (await status()).json())).toEqual({ demo: null })
  })

  it('씨앗을 주면 그 계정을 답한다', async () => {
    resetDemoStore(demoSellerAccount)

    expect(demoStatusResponseSchema.parse(await (await status()).json())).toEqual({
      demo: demoSellerAccount,
    })
  })

  it('발급한 뒤에는 발급된 계정을 답한다', async () => {
    await (await issue('ADMIN', 'admin')).text()

    expect(demoStatusResponseSchema.parse(await (await status()).json())).toEqual({
      demo: demoAdminAccount,
    })
  })
})
