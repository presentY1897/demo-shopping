/**
 * 적립금 대역이 화면에 약속하는 것 (TASK-0077).
 *
 * 이 화면의 존재 이유가 「왜 줄었지」에 답하는 것이므로, 대역이 지켜야 하는 첫 번째
 * 규칙은 **원장이 잔액을 설명한다**는 것이다. 사슬이 끊긴 씨앗을 주는 대역이라면
 * 화면은 그것을 그대로 그리고, 검사는 「숫자가 보인다」만 확인하게 된다.
 *
 * 두 번째는 커서의 **방향**이다. 최신순이므로 다음 쪽은 더 오래된 쪽이고, 대역이
 * 거꾸로 자르면 화면의 「더 보기」는 이미 본 줄을 다시 붙인다.
 */

import type { PointLedgerResponse, PointSummaryResponse } from '@shopping/shared'
import {
  createApiClient,
  POINT_EXPIRING_SOON_DAYS,
  pointLedgerResponseSchema,
  pointSummaryResponseSchema,
} from '@shopping/shared'
import { beforeEach, describe, expect, it } from 'vitest'

import { emptyPointLedger, emptyPointSummary } from './fixtures/points'
import {
  MOCK_POINT_LEDGER_PAGE_SIZE,
  MOCK_POINT_NOW,
  MOCK_POINT_ORDER_ID,
  mockPointLedgerSeeds,
  resetPointStore,
} from './handlers'
import { setupTestServer } from './node'

setupTestServer()

const client = createApiClient({ appId: 'shop', baseUrl: 'http://api.test.invalid' })

const summary = (): Promise<PointSummaryResponse> =>
  client.request({ path: '/me/points', schema: pointSummaryResponseSchema })

const ledger = (query = ''): Promise<PointLedgerResponse> =>
  client.request({ path: `/me/points/transactions${query}`, schema: pointLedgerResponseSchema })

beforeEach(() => {
  resetPointStore()
})

describe('잔액', () => {
  it('is explained by the ledger — all five reconciliation statements hold', async () => {
    const { account } = await summary()
    const chained = [...mockPointLedgerSeeds].sort((left, right) => left.seq - right.seq)

    expect(account.ledgerBalance).toBe(account.balance)
    expect(account.lotBalance).toBe(account.balance)
    expect(account.entryCount).toBe(chained.length)
    // `seq` 가 1..n 이고, 각 줄의 잔액이 직전 값 + 자기 금액이다.
    expect(chained.map((entry) => entry.seq)).toEqual(chained.map((_row, index) => index + 1))
    expect(
      chained.reduce(
        (running, entry) =>
          entry.balanceAfter === running + entry.amount ? entry.balanceAfter : -1,
        0,
      ),
    ).toBe(account.balance)
  })

  it('says what is coming at 구매확정 (F6)', async () => {
    const { pendingEarn } = await summary()

    // 0 이면 화면이 그 줄을 그리는지 물어볼 자리가 없다.
    expect(pendingEarn).toBeGreaterThan(0)
  })

  it('says what disappears soon, and the server has already applied the window', async () => {
    const { account, expiringSoon } = await summary()
    const window =
      new Date(MOCK_POINT_NOW).getTime() + POINT_EXPIRING_SOON_DAYS * 24 * 60 * 60 * 1_000

    expect(expiringSoon).not.toBeNull()
    expect(new Date(expiringSoon?.at ?? 0).getTime()).toBeLessThanOrEqual(window)
    // 가장 먼저 사라질 통의 시각이 잔액이 말하는 그것과 같아야 한다.
    expect(expiringSoon?.at).toBe(account.nextExpiresAt)
  })

  it('has nothing to warn about on an account that has never earned', async () => {
    resetPointStore(emptyPointSummary, emptyPointLedger.entries)

    const { account, expiringSoon, pendingEarn } = await summary()

    expect(account.balance).toBe(0)
    expect(pendingEarn).toBe(0)
    expect(expiringSoon).toBeNull()
  })
})

describe('원장', () => {
  it('answers newest first', async () => {
    const { entries } = await ledger()

    expect(entries[0]?.seq).toBe(mockPointLedgerSeeds.length)
  })

  it('carries every type, so no label goes unchecked', async () => {
    const first = await ledger()
    const second = await ledger(`?cursor=${String(first.nextCursor)}`)
    const types = new Set([...first.entries, ...second.entries].map((entry) => entry.type))

    expect([...types].sort()).toEqual(['ADJUST', 'EARN', 'EXPIRE', 'RESTORE', 'USE'])
  })

  it('links a use to its order and leaves the rest without one', async () => {
    const { entries } = await ledger()
    const use = entries.find((entry) => entry.type === 'USE')

    expect(use?.refType).toBe('ORDER')
    expect(use?.refId).toBe(MOCK_POINT_ORDER_ID)
    expect(entries.find((entry) => entry.type === 'EARN')?.refType).toBe('SELLER_ORDER')
  })

  it('pages towards the older rows without repeating one', async () => {
    const first = await ledger()

    expect(first.entries).toHaveLength(MOCK_POINT_LEDGER_PAGE_SIZE)
    expect(first.nextCursor).toBe(first.entries.at(-1)?.seq)

    const second = await ledger(`?cursor=${String(first.nextCursor)}`)

    // 커서가 가리킨 줄은 **지나간 줄**이다. 포함해서 자르면 「더 보기」가 이미 본
    // 줄을 다시 붙인다.
    expect(second.entries.every((entry) => entry.seq < (first.nextCursor ?? 0))).toBe(true)
    expect(second.nextCursor).toBeNull()
  })

  it('reads the same balance the summary does', async () => {
    const [head, page] = await Promise.all([summary(), ledger()])

    expect(page.account).toEqual(head.account)
  })
})
