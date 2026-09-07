import type { ApiClient } from '@shopping/shared'
import {
  ApiClientError,
  answerResponseSchema,
  myQuestionsResponseSchema,
  notificationListResponseSchema,
  productQuestionResponseSchema,
  questionListResponseSchema,
  sellerQuestionsResponseSchema,
} from '@shopping/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { NotificationService } from '../../src/notifications/notification.service.js'
import { useApiApp } from '../support/api-app.js'
import { useDatabase } from '../support/database.js'
import { createSellableVariant, createSeller, createUser } from '../support/factories.js'
import type { TestCaller } from '../support/principal.js'

/**
 * 상품 문의 (TASK-0088), 실제 HTTP 로 실제 데이터베이스에 대고.
 *
 * **가장 중요한 검사는 비공개다.** 남의 비공개 문의는 내용이 가려져 오는 것이 아니라
 * **줄 자체가 오지 않는다** — 「여기 뭔가 있다」가 새어 나가면 그 사실만으로도 알아서는
 * 안 될 것을 알게 되는 경우가 있다.
 */

const db = useDatabase()
const api = useApiApp({ database: db, authenticate: true })

const NOW = '2026-09-10T00:00:00.000Z'

let asker: TestCaller
let stranger: TestCaller
let seller: TestCaller
let rival: TestCaller
let store: Awaited<ReturnType<typeof createSellableVariant>>

beforeEach(async () => {
  api.clock.set(NOW)

  asker = { userId: (await createUser(db, { name: '홍길동' })).id, roles: ['BUYER'] }
  stranger = { userId: (await createUser(db)).id, roles: ['BUYER'] }
  store = await createSellableVariant(db, { stock: 5 })
  seller = {
    userId: (
      await db.one<{ userId: string }>(`SELECT "userId" FROM "Seller" WHERE "id" = $1`, [
        store.seller.id,
      ])
    ).userId,
    roles: ['SELLER_OWNER'],
    sellerId: store.seller.id,
  }

  const other = await createUser(db)
  const otherStore = await createSeller(db, { userId: other.id })

  rival = { userId: other.id, roles: ['SELLER_OWNER'], sellerId: otherStore.id }
})

function client(caller: TestCaller): ApiClient {
  return api.clientAs(caller)
}

async function ask(
  caller: TestCaller,
  isPublic = true,
  content = '사이즈가 어떻게 되나요?',
): Promise<string> {
  const { question } = await client(caller).request({
    path: `/products/${store.product.id}/questions`,
    method: 'POST',
    body: { content, isPublic },
    schema: productQuestionResponseSchema,
  })

  return question.id
}

function listed(caller: TestCaller | null): Promise<{
  questions: readonly { id: string; isPublic: boolean; mine: boolean; content: string }[]
}> {
  const target = caller === null ? api.client : client(caller)

  return target.request({
    path: `/products/${store.product.id}/questions`,
    schema: questionListResponseSchema,
  })
}

async function failure(work: Promise<unknown>): Promise<number> {
  try {
    await work
  } catch (error) {
    if (error instanceof ApiClientError && error.status !== undefined) return error.status

    throw error
  }

  throw new Error('실패했어야 하는 요청이 성공했습니다.')
}

describe('문의 (F1)', () => {
  it('로그인한 사람이 문의를 남긴다', async () => {
    const id = await ask(asker)

    expect((await listed(null)).questions.map((question) => question.id)).toEqual([id])
  })

  it('기본은 공개다 — 문의는 상품 정보의 일부다', async () => {
    const { question } = await client(asker).request({
      path: `/products/${store.product.id}/questions`,
      method: 'POST',
      body: { content: '재입고 되나요?' },
      schema: productQuestionResponseSchema,
    })

    expect(question.isPublic).toBe(true)
  })

  it('빈 문의는 거절한다', async () => {
    expect(
      await failure(
        client(asker).request({
          path: `/products/${store.product.id}/questions`,
          method: 'POST',
          body: { content: '   ' },
          schema: productQuestionResponseSchema,
        }),
      ),
    ).toBe(400)
  })

  it('이름을 가려서 내려보낸다', async () => {
    await ask(asker)

    expect((await listed(null)).questions[0]?.content).toBeTruthy()
    expect((await listed(null)).questions[0]).toMatchObject({ mine: false })
  })
})

describe('비공개 (F2)', () => {
  /** 내용을 비우고 보내면 「여기 뭔가 있다」가 새어 나간다. */
  it('남의 비공개 문의는 줄 자체가 오지 않는다', async () => {
    await ask(asker, false, '비밀 문의')

    expect((await listed(stranger)).questions).toEqual([])
    expect((await listed(null)).questions).toEqual([])
  })

  it('자기 비공개 문의는 보인다', async () => {
    const id = await ask(asker, false, '비밀 문의')
    const { questions } = await listed(asker)

    expect(questions.map((question) => question.id)).toEqual([id])
    expect(questions[0]).toMatchObject({ isPublic: false, mine: true })
  })

  /** 답할 사람이 읽지 못하면 비공개 문의라는 것이 성립하지 않는다. */
  it('판매자는 비공개 문의도 본다', async () => {
    const id = await ask(asker, false, '비밀 문의')
    const { questions } = await client(seller).request({
      path: `/seller-questions?sellerId=${store.seller.id}`,
      schema: sellerQuestionsResponseSchema,
    })

    expect(questions.map((question) => question.id)).toEqual([id])
  })

  it('공개 문의는 로그인하지 않아도 보인다', async () => {
    const id = await ask(asker)

    expect((await listed(null)).questions.map((question) => question.id)).toEqual([id])
  })
})

describe('답변 (F3 · F5)', () => {
  function answer(
    caller: TestCaller,
    questionId: string,
    content = '265mm 까지 있습니다.',
  ): Promise<{ answer: { content: string; brandName: string } }> {
    return client(caller).request({
      path: `/questions/${questionId}/answer`,
      method: 'PUT',
      body: { content },
      schema: answerResponseSchema,
    })
  }

  it('자기 상품 문의에 답한다', async () => {
    const id = await ask(asker)
    const { answer: written } = await answer(seller, id)

    expect(written.content).toBe('265mm 까지 있습니다.')
  })

  it('남의 상품 문의에는 답할 수 없다 (F3)', async () => {
    const id = await ask(asker)

    expect(await failure(answer(rival, id))).toBe(403)
  })

  it('물어본 사람도 답할 수 없다', async () => {
    const id = await ask(asker)

    expect(await failure(answer(asker, id))).toBe(403)
  })

  /** 문의당 답변은 하나다 — 기본키가 그것을 만든다. */
  it('두 번 답하면 고쳐진다', async () => {
    const id = await ask(asker)

    await answer(seller, id, '처음 답변')
    await answer(seller, id, '고친 답변')

    const rows = await db.query(`SELECT 1 FROM "ProductAnswer" WHERE "questionId" = $1`, [id])

    expect(rows).toHaveLength(1)
  })

  it('답변이 문의와 함께 온다', async () => {
    const id = await ask(asker)

    await answer(seller, id, '265mm 까지 있습니다.')

    const { questions } = await listed(null)

    expect(questions[0]?.id).toBe(id)
  })

  it('미답변이 위에 온다 (F5)', async () => {
    const answered = await ask(asker)

    await answer(seller, answered)

    const pending = await ask(stranger)
    const { questions } = await client(seller).request({
      path: `/seller-questions?sellerId=${store.seller.id}`,
      schema: sellerQuestionsResponseSchema,
    })

    expect(questions[0]?.id).toBe(pending)
  })

  it('미답변만 볼 수 있고, 건수는 필터와 무관하다', async () => {
    const answered = await ask(asker)

    await answer(seller, answered)
    await ask(stranger)

    const filtered = await client(seller).request({
      path: `/seller-questions?sellerId=${store.seller.id}&unansweredOnly=true`,
      schema: sellerQuestionsResponseSchema,
    })

    expect(filtered.questions).toHaveLength(1)
    expect(filtered.unansweredCount).toBe(1)
  })

  it('답변을 지우면 문의는 남는다', async () => {
    const id = await ask(asker)

    await answer(seller, id)
    await client(seller).request({
      path: `/questions/${id}/answer`,
      method: 'DELETE',
      schema: z.unknown(),
    })

    expect((await listed(null)).questions.map((question) => question.id)).toEqual([id])
  })

  it('남의 스토어 목록은 볼 수 없다', async () => {
    expect(
      await failure(
        client(rival).request({
          path: `/seller-questions?sellerId=${store.seller.id}`,
          schema: sellerQuestionsResponseSchema,
        }),
      ),
    ).toBe(403)
  })
})

/**
 * 답변이 물어본 사람에게 닿는다 (F4).
 *
 * 서비스는 이것을 **기다리지 않고** 보낸다 (`question.service.ts` 의 `void`). 그래서
 * 「답변이 저장됐다」만 재는 검사는 알림이 한 번도 안 나가도 초록이다 — 그 사이를
 * 재는 검사가 없으면, 알림을 지워 버려도 아무것도 빨개지지 않는다.
 */
describe('답변 알림 (F4)', () => {
  async function inbox(
    caller: TestCaller,
  ): Promise<readonly { type: string; link: string | null }[]> {
    const answered = await client(caller).request({
      path: '/me/notifications',
      schema: notificationListResponseSchema,
    })

    return answered.notifications
  }

  /** 기다리지 않고 나가는 일이 끝나기를 기다린다. 없으면 가끔 빨간불이 된다. */
  async function eventually(check: () => Promise<boolean>): Promise<void> {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (await check()) return

      await new Promise((resolve) => setTimeout(resolve, 20))
    }

    throw new Error('기다린 상태가 되지 않았습니다.')
  }

  function answer(questionId: string): Promise<unknown> {
    return client(seller).request({
      path: `/questions/${questionId}/answer`,
      method: 'PUT',
      body: { content: '265mm 까지 있습니다.' },
      schema: answerResponseSchema,
    })
  }

  it('물어본 사람에게 알림이 간다', async () => {
    const id = await ask(asker)

    await answer(id)
    await eventually(async () => (await inbox(asker)).length === 1)

    const [notification] = await inbox(asker)

    expect(notification?.type).toBe('QUESTION_ANSWER')
    // 문의는 상품에 붙어 있으므로 돌아갈 곳은 그 상품이다.
    expect(notification?.link).toBe(`/products/${store.product.id}`)
  })

  /** 비공개 문의라고 알림이 없는 것은 아니다 — 물어본 사람에게는 자기 문의다. */
  it('비공개 문의에도 간다', async () => {
    const id = await ask(asker, false)

    await answer(id)
    await eventually(async () => (await inbox(asker)).length === 1)

    expect((await inbox(asker))[0]?.type).toBe('QUESTION_ANSWER')
  })

  /** 남의 문의에 달린 답변은 남의 일이다. */
  it('물어보지 않은 사람에게는 가지 않는다', async () => {
    const id = await ask(asker)

    await answer(id)
    await eventually(async () => (await inbox(asker)).length === 1)

    expect(await inbox(stranger)).toEqual([])
  })

  /**
   * **알림이 터져도 답변은 저장된다** (D-242 · TASK-0090 F6).
   *
   * 답을 쓴 판매자에게 「저장에 실패했다」를 보이는 것이 알림 한 통을 놓치는 것보다
   * 훨씬 나쁘다.
   */
  it('알림이 실패해도 답변은 남는다', async () => {
    const id = await ask(asker)
    const service = api.resolve<NotificationService>(NotificationService)
    const broken = vi.spyOn(service, 'send').mockRejectedValue(new Error('알림 실패'))

    try {
      await answer(id)
    } finally {
      broken.mockRestore()
    }

    const { questions } = await client(asker).request({
      path: '/me/questions',
      schema: myQuestionsResponseSchema,
    })

    expect(questions[0]?.answer?.content).toBe('265mm 까지 있습니다.')
  })
})

describe('내 문의 (F7)', () => {
  it('공개든 비공개든 내가 쓴 것이 전부 온다', async () => {
    const open = await ask(asker)
    const secret = await ask(asker, false, '비밀 문의')

    await ask(stranger)

    const { questions } = await client(asker).request({
      path: '/me/questions',
      schema: myQuestionsResponseSchema,
    })

    expect(questions.map((question) => question.id).sort()).toEqual([open, secret].sort())
  })

  it('어느 상품에 물었는지가 함께 온다', async () => {
    await ask(asker)

    const { questions } = await client(asker).request({
      path: '/me/questions',
      schema: myQuestionsResponseSchema,
    })

    expect(questions[0]?.productName).toBeTruthy()
  })
})
