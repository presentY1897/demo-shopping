import { randomUUID } from 'node:crypto'

import type { ApiClient } from '@shopping/shared'
import {
  ApiClientError,
  notificationListResponseSchema,
  productQuestionResponseSchema,
  questionListResponseSchema,
  reportListResponseSchema,
  reportResponseSchema,
} from '@shopping/shared'
import { beforeEach, describe, expect, it } from 'vitest'

import { REPORT_AUTO_HIDE_THRESHOLD } from '../../src/reports/report-rules.js'
import { useApiApp } from '../support/api-app.js'
import { useDatabase } from '../support/database.js'
import { createSellableVariant, createUser } from '../support/factories.js'
import type { TestCaller } from '../support/principal.js'

/**
 * 신고 (TASK-0091), 실제 HTTP 로 실제 데이터베이스에 대고.
 *
 * **자동 임시 숨김이 이 기능의 요점이다.** 관리자가 즉시 대응할 수 없는 시간대에
 * 악성 콘텐츠가 노출된 채 남는 것을 막는다 — 그리고 반려하면 **복구된다.** 그 복구가
 * 빠지면 「아니라고 판단했는데 계속 가려져 있는」 상태가 남고, 그것은 신고 한 번으로
 * 남의 글을 영영 가리는 길이 된다.
 */

const db = useDatabase()
const api = useApiApp({ database: db, authenticate: true })

const NOW = '2026-09-10T00:00:00.000Z'

let author: TestCaller
let operator: TestCaller
let demoAdmin: TestCaller
let store: Awaited<ReturnType<typeof createSellableVariant>>
let reporters: TestCaller[]

beforeEach(async () => {
  api.clock.set(NOW)

  author = { userId: (await createUser(db, { name: '홍길동' })).id, roles: ['BUYER'] }
  operator = { userId: (await createUser(db)).id, roles: ['ADMIN_OPERATOR'] }
  demoAdmin = { userId: (await createUser(db)).id, roles: ['DEMO_ADMIN'] }
  store = await createSellableVariant(db, { stock: 5 })
  reporters = []

  for (let index = 0; index < REPORT_AUTO_HIDE_THRESHOLD + 1; index += 1) {
    reporters.push({ userId: (await createUser(db)).id, roles: ['BUYER'] })
  }
})

function client(caller: TestCaller): ApiClient {
  return api.clientAs(caller)
}

/** 신고할 대상 하나 — 공개 문의. */
async function question(): Promise<string> {
  const { question: created } = await client(author).request({
    path: `/products/${store.product.id}/questions`,
    method: 'POST',
    body: { content: '이거 짝퉁 아닌가요?', isPublic: true },
    schema: productQuestionResponseSchema,
  })

  return created.id
}

function report(
  caller: TestCaller,
  targetId: string,
  overrides: Record<string, unknown> = {},
): Promise<{
  report: { id: string; status: string; targetReportCount: number; targetHidden: boolean }
}> {
  return client(caller).request({
    path: '/reports',
    method: 'POST',
    body: { targetType: 'QUESTION', targetId, reason: 'ABUSE', ...overrides },
    schema: reportResponseSchema,
  })
}

function handle(
  caller: TestCaller,
  reportId: string,
  outcome: 'HIDDEN' | 'REMOVED' | 'REJECTED',
): Promise<{ report: { status: string; handledNote: string | null } }> {
  return client(caller).request({
    path: `/reports/${reportId}/handle`,
    method: 'POST',
    body: { outcome, note: '검토했습니다.' },
    schema: reportResponseSchema,
  })
}

function visible(): Promise<{ questions: readonly { id: string }[] }> {
  return api.client.request({
    path: `/products/${store.product.id}/questions`,
    schema: questionListResponseSchema,
  })
}

/** 기다리지 않고 나가는 일이 끝나기를 기다린다. 없으면 검사가 가끔 빨간불이 된다. */
async function eventually(check: () => Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await check()) return

    await new Promise((resolve) => setTimeout(resolve, 20))
  }

  throw new Error('기다린 상태가 되지 않았습니다.')
}

async function failure(work: Promise<unknown>): Promise<{ status: number; code: string }> {
  try {
    await work
  } catch (error) {
    if (error instanceof ApiClientError) {
      return { status: error.status ?? 0, code: error.code ?? '' }
    }

    throw error
  }

  throw new Error('실패했어야 하는 요청이 성공했습니다.')
}

describe('접수 (F1 · F2)', () => {
  it('신고하면 접수된다', async () => {
    const target = await question()
    const { report: created } = await report(reporters[0]!, target)

    expect(created).toMatchObject({ status: 'PENDING', targetReportCount: 1 })
  })

  /** 막지 않으면 한 사람이 임계치를 혼자 채우고, 신고가 검열 도구가 된다. */
  it('같은 사람이 두 번 신고할 수 없다 (F2)', async () => {
    const target = await question()

    await report(reporters[0]!, target)

    expect((await failure(report(reporters[0]!, target))).code).toBe('REPORT_ALREADY_FILED')
  })

  /** 신고로 자기 글을 가리는 길은 신고 통계를 흐리는 우회로가 된다. */
  it('자기 글은 신고할 수 없다', async () => {
    const target = await question()

    expect((await failure(report(author, target))).code).toBe('REPORT_OWN_CONTENT')
  })

  it('없는 대상은 신고할 수 없다', async () => {
    expect((await failure(report(reporters[0]!, randomUUID()))).status).toBe(404)
  })

  /** 분류되지 않는 신고에 설명까지 없으면 관리자가 판단할 근거가 하나도 없다. */
  it('기타 사유에는 설명이 필요하다', async () => {
    const target = await question()

    expect((await failure(report(reporters[0]!, target, { reason: 'OTHER' }))).status).toBe(400)
    expect(
      (await report(reporters[0]!, target, { reason: 'OTHER', detail: '광고 링크가 있어요' }))
        .report.status,
    ).toBe('PENDING')
  })
})

describe('자동 임시 숨김 (F3)', () => {
  async function reportUpTo(target: string, count: number): Promise<void> {
    for (let index = 0; index < count; index += 1) await report(reporters[index]!, target)
  }

  it('임계치 전에는 가려지지 않는다', async () => {
    const target = await question()

    await reportUpTo(target, REPORT_AUTO_HIDE_THRESHOLD - 1)

    expect((await visible()).questions.map((row) => row.id)).toEqual([target])
  })

  it('임계치에 닿으면 가려진다', async () => {
    const target = await question()

    await reportUpTo(target, REPORT_AUTO_HIDE_THRESHOLD)

    expect((await visible()).questions).toEqual([])
  })

  /** 자기 글이 사라진 것과 가려진 것은 다른 일이고, 뒤엣것은 이의를 제기할 수 있다. */
  it('쓴 사람에게는 여전히 보인다', async () => {
    const target = await question()

    await reportUpTo(target, REPORT_AUTO_HIDE_THRESHOLD)

    const mine = await client(author).request({
      path: `/products/${store.product.id}/questions`,
      schema: questionListResponseSchema,
    })

    expect(mine.questions.map((row) => row.id)).toEqual([target])
  })
})

describe('처리 (F4 · F5 · F6)', () => {
  it('숨김으로 처리하면 가려진 채로 남는다', async () => {
    const target = await question()
    const { report: filed } = await report(reporters[0]!, target)

    await handle(operator, filed.id, 'HIDDEN')

    expect((await visible()).questions).toEqual([])
  })

  /**
   * **반려는 아무 일도 안 하는 것이 아니다.** 자동 임시 숨김이 이미 가려 놓았으니,
   * 반려에서 복구하지 않으면 「아니라고 판단했는데 계속 가려져 있는」 상태가 남는다.
   */
  it('반려하면 다시 보인다 (F5)', async () => {
    const target = await question()

    for (let index = 0; index < REPORT_AUTO_HIDE_THRESHOLD; index += 1) {
      await report(reporters[index]!, target)
    }

    expect((await visible()).questions).toEqual([])

    const { reports } = await client(operator).request({
      path: '/reports?status=PENDING',
      schema: reportListResponseSchema,
    })

    await handle(operator, reports[0]!.id, 'REJECTED')

    expect((await visible()).questions.map((row) => row.id)).toEqual([target])
  })

  it('삭제하면 목록에서 사라진다', async () => {
    const target = await question()
    const { report: filed } = await report(reporters[0]!, target)

    await handle(operator, filed.id, 'REMOVED')

    expect((await visible()).questions).toEqual([])

    const rows = await db.query(`SELECT 1 FROM "ProductQuestion" WHERE "id" = $1`, [target])

    expect(rows).toEqual([])
  })

  /** 주문·정산·리뷰가 가리키는 행이라, 답은 판매를 멈추는 것이지 지우는 것이 아니다. */
  it('상품은 지울 수 없다', async () => {
    const { report: filed } = await report(reporters[0]!, store.product.id, {
      targetType: 'PRODUCT',
    })

    expect((await failure(handle(operator, filed.id, 'REMOVED'))).code).toBe('REPORT_NOT_REMOVABLE')
  })

  it('처리자와 시각과 사유가 남는다 (F6)', async () => {
    const target = await question()
    const { report: filed } = await report(reporters[0]!, target)

    await handle(operator, filed.id, 'HIDDEN')

    const [row] = await db.query<{ handledById: string; handledAt: Date; handledNote: string }>(
      `SELECT "handledById", "handledAt", "handledNote" FROM "Report" WHERE "id" = $1`,
      [filed.id],
    )

    expect(row).toMatchObject({ handledById: operator.userId, handledNote: '검토했습니다.' })
    expect(row?.handledAt).not.toBeNull()
  })

  /** 한 대상에 대한 판단은 하나다 — 남겨 두면 이미 결론 난 것을 몇 번씩 다시 읽는다. */
  it('같은 대상의 다른 신고도 함께 닫힌다', async () => {
    const target = await question()

    await report(reporters[0]!, target)
    await report(reporters[1]!, target)

    const { reports } = await client(operator).request({
      path: '/reports?status=PENDING',
      schema: reportListResponseSchema,
    })

    await handle(operator, reports[0]!.id, 'HIDDEN')

    const pending = await client(operator).request({
      path: '/reports?status=PENDING',
      schema: reportListResponseSchema,
    })

    expect(pending.reports).toEqual([])
    expect(pending.pendingCount).toBe(0)
  })

  it('이미 처리된 신고는 다시 처리하지 않는다', async () => {
    const target = await question()
    const { report: filed } = await report(reporters[0]!, target)

    await handle(operator, filed.id, 'HIDDEN')

    expect((await failure(handle(operator, filed.id, 'REJECTED'))).code).toBe(
      'REPORT_ALREADY_HANDLED',
    )
  })

  /**
   * 알림은 **기다리지 않고** 나간다 (TASK-0090 F6) — 그래서 잠깐 기다렸다 확인한다.
   *
   * 곧바로 단언하면 이 검사가 가끔 빨간불이 되고, 그 빨간불은 코드가 아니라 검사의
   * 문제다. 「보냈는가」가 아니라 「도착하는가」를 재는 것이 옳기도 하다.
   */
  it('신고자에게 결과가 도착한다', async () => {
    const target = await question()
    const { report: filed } = await report(reporters[0]!, target)

    await handle(operator, filed.id, 'REJECTED')

    await eventually(async () => {
      const inbox = await client(reporters[0]!).request({
        path: '/me/notifications',
        schema: notificationListResponseSchema,
      })

      return inbox.notifications[0]?.type === 'REPORT_HANDLED'
    })
  })
})

describe('권한 (F7)', () => {
  it('구매자는 신고 목록을 볼 수 없다', async () => {
    expect(
      (
        await failure(
          client(reporters[0]!).request({
            path: '/reports',
            schema: reportListResponseSchema,
          }),
        )
      ).status,
    ).toBe(403)
  })

  /**
   * **데모 관리자는 실계정의 글을 지우거나 가릴 수 없다** (D-058). 거절은 조건문이
   * 아니라 대상의 주인이 누구인가가 만든다 — 그쪽의 스코프가 `demo` 로 좁혀져 있다.
   */
  it('데모 관리자는 실계정의 글을 처리할 수 없다', async () => {
    const target = await question()
    const { report: filed } = await report(reporters[0]!, target)

    expect((await failure(handle(demoAdmin, filed.id, 'HIDDEN'))).status).toBe(403)
  })
})
