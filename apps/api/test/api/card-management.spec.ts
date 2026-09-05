import type { ApiClient } from '@shopping/shared'
import { ApiClientError } from '@shopping/shared'
import { beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { VirtualCardService } from '../../src/payment/virtual-card.service.js'
import { useApiApp } from '../support/api-app.js'
import { useDatabase } from '../support/database.js'
import { createUser } from '../support/factories.js'
import type { TestCaller } from '../support/principal.js'

/**
 * 카드 관리 라우트 (TASK-0058 4.1).
 *
 * 6.2 는 「API 는 TASK-0053」이라고 적었지만 그 TASK 가 만든 것은 발급·목록·정지·
 * 삭제까지였다. **사용 내역은 여기서 생긴다** — 그리고 그것이 이 화면의 존재 이유다:
 * 환불이 정말 돌아왔는지를 사람이 눈으로 확인하는 자리.
 *
 * 새 라우트가 생겼으므로 「남의 카드 원장을 읽는다」가 표현 가능해졌다. 그 목록에는
 * 그 사람이 무엇을 샀는지가 그대로 적혀 있으므로, 막는 것이 이 스펙의 절반이다.
 */

const db = useDatabase()
const api = useApiApp({ database: db, authenticate: true })

const cardSchema = z.object({
  id: z.uuid(),
  maskedNumber: z.string(),
  brand: z.string(),
  creditLimit: z.int(),
  usedAmount: z.int(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'DELETED']),
  expiresAt: z.iso.datetime(),
})
const cardResponseSchema = z.object({ card: cardSchema })
const cardListSchema = z.object({ cards: z.array(cardSchema) })
const transactionsSchema = z.object({
  transactions: z.array(
    z.object({
      id: z.uuid(),
      kind: z.enum(['CHARGE', 'CANCEL', 'REFUND']),
      amount: z.int(),
      balanceAfter: z.int().min(0),
      createdAt: z.iso.datetime(),
      orderNumber: z.string().nullable(),
      orderId: z.uuid().nullable(),
    }),
  ),
})

let owner: TestCaller

function client(caller: TestCaller = owner): ApiClient {
  return api.clientAs(caller)
}

function cards(): VirtualCardService {
  return api.resolve<VirtualCardService>(VirtualCardService)
}

async function failure(work: Promise<unknown>): Promise<number> {
  const error: unknown = await work.then(
    () => null,
    (reason: unknown) => reason,
  )

  if (!(error instanceof ApiClientError) || error.kind !== 'http') {
    throw new Error(`HTTP 오류를 기대했지만 다른 결과가 나왔습니다: ${String(error)}`)
  }

  return error.status ?? 0
}

/** 한 장 발급하고 id 를 돌려준다. */
async function issue(limit: number, caller: TestCaller = owner): Promise<string> {
  const answer = await client(caller).request({
    path: '/cards',
    method: 'POST',
    body: { creditLimit: limit },
    schema: cardResponseSchema,
  })

  return answer.card.id
}

beforeEach(async () => {
  const account = await createUser(db, {})

  owner = { userId: account.id, roles: ['BUYER'] }
})

describe('발급과 목록 (F1 · F2)', () => {
  it('shows the limit, what is used and what is left', async () => {
    const cardId = await issue(1_000_000)

    await cards().charge(cardId, 189_000, '019596d0-1f1c-7c2e-9a0e-aa0000000001')

    const answer = await client().request({ path: '/cards', schema: cardListSchema })
    const card = answer.cards.find((each) => each.id === cardId)

    // 잔여는 응답에 없다 — 한도와 사용액의 차이라 화면이 뺀다. 두 수를 보내고 그
    // 차이도 보내면 셋이 어긋날 수 있는 자리가 하나 생긴다.
    expect(card).toMatchObject({ creditLimit: 1_000_000, usedAmount: 189_000 })
  })

  it('never sends the full number (F2)', async () => {
    await issue(500_000)

    const answer = await client().request({ path: '/cards', schema: cardListSchema })

    // 앞 4 + 뒤 4. 전문은 서비스 밖으로 나가지 않으므로 로그에 찍힐 수도 없다.
    expect(answer.cards[0]?.maskedNumber).toMatch(/^9999-\*{4}-\*{4}-[0-9]{4}$/u)
  })

  it('refuses a limit somebody fat-fingered', async () => {
    // 0을 하나 더 치면 열 배가 되고, 그 카드로는 무엇을 사도 한도 초과가 나지
    // 않아 **재현 장치로서 쓸모가 없어진다**.
    expect(await failure(issue(100_000_000))).toBe(400)
    expect(await failure(issue(0))).toBe(400)
  })
})

describe('사용 내역 (F3 · F4)', () => {
  it('reads back approval and refund in the order they happened', async () => {
    const cardId = await issue(1_000_000)
    const paymentId = '019596d0-1f1c-7c2e-9a0e-aa0000000002'

    await cards().charge(cardId, 300_000, paymentId)
    await cards().release(cardId, 100_000, paymentId, 'REFUND')

    const answer = await client().request({
      path: `/cards/${cardId}/transactions`,
      schema: transactionsSchema,
    })

    // 부호가 방향이다 — 승인은 한도를 쓰고 환불은 돌려준다. 절댓값만 보내고 종류로
    // 추측하게 두면 화면이 그 규칙을 한 벌 더 갖게 된다.
    expect(answer.transactions.map((row) => [row.kind, row.amount, row.balanceAfter])).toEqual([
      ['CHARGE', 300_000, 300_000],
      ['REFUND', -100_000, 200_000],
    ])
  })

  it('leaves the order empty for a movement no payment caused (4.2)', async () => {
    const cardId = await issue(500_000)

    await cards().charge(cardId, 10_000, '019596d0-1f1c-7c2e-9a0e-aa0000000003')

    const answer = await client().request({
      path: `/cards/${cardId}/transactions`,
      schema: transactionsSchema,
    })

    // 링크가 없는 줄이지 잘못된 줄이 아니다. 원장의 참조는 결제가 아닐 수도 있다.
    expect(answer.transactions[0]).toMatchObject({ orderNumber: null, orderId: null })
  })

  it('is empty for a card nobody has used', async () => {
    const cardId = await issue(500_000)
    const answer = await client().request({
      path: `/cards/${cardId}/transactions`,
      schema: transactionsSchema,
    })

    expect(answer.transactions).toEqual([])
  })
})

describe('정지와 해제 (F5)', () => {
  it('stops the card and lets it back', async () => {
    const cardId = await issue(500_000)

    const stopped = await client().request({
      path: `/cards/${cardId}/suspend`,
      method: 'POST',
      body: {},
      schema: cardResponseSchema,
    })

    expect(stopped.card.status).toBe('SUSPENDED')

    const back = await client().request({
      path: `/cards/${cardId}/activate`,
      method: 'POST',
      body: {},
      schema: cardResponseSchema,
    })

    expect(back.card.status).toBe('ACTIVE')
  })

  it('keeps a deleted card out of the list but keeps its ledger', async () => {
    const cardId = await issue(500_000)

    await cards().charge(cardId, 10_000, '019596d0-1f1c-7c2e-9a0e-aa0000000004')
    await client().request({
      path: `/cards/${cardId}`,
      method: 'DELETE',
      schema: z.unknown(),
    })

    const listed = await client().request({ path: '/cards', schema: cardListSchema })

    expect(listed.cards.find((each) => each.id === cardId)).toBeUndefined()

    // 소프트 삭제다 — 원장이 이 카드를 가리키고, 그 기록은 남아야 한다.
    const ledger = await client().request({
      path: `/cards/${cardId}/transactions`,
      schema: transactionsSchema,
    })

    expect(ledger.transactions).toHaveLength(1)
  })
})

describe('남의 카드 (A3 · A4)', () => {
  it('will not show somebody else’s ledger', async () => {
    const cardId = await issue(500_000)
    const stranger = await createUser(db, {})

    // **있는지 없는지도 알려 주지 않는다.** 그 목록에는 그 사람이 무엇을 샀는지가
    // 그대로 적혀 있다.
    expect(
      await failure(
        api.clientAs({ userId: stranger.id, roles: ['BUYER'] }).request({
          path: `/cards/${cardId}/transactions`,
          schema: transactionsSchema,
        }),
      ),
    ).toBe(404)
  })

  it('will not stop somebody else’s card', async () => {
    const cardId = await issue(500_000)
    const stranger = await createUser(db, {})

    expect(
      await failure(
        api.clientAs({ userId: stranger.id, roles: ['BUYER'] }).request({
          path: `/cards/${cardId}/suspend`,
          method: 'POST',
          body: {},
          schema: cardResponseSchema,
        }),
      ),
    ).toBe(404)
  })

  it('refuses an anonymous caller (A4)', async () => {
    expect(await failure(api.client.request({ path: '/cards', schema: cardListSchema }))).toBe(401)
  })
})
