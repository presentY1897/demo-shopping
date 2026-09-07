import type { ApiClient } from '@shopping/shared'
import { ApiClientError } from '@shopping/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { ConsistencyService } from '../../src/consistency/consistency.service.js'
import { useApiApp } from '../support/api-app.js'
import { useDatabase } from '../support/database.js'
import { createSellableVariant, createUser } from '../support/factories.js'
import type { TestCaller } from '../support/principal.js'

/**
 * 정합성 점검 (TASK-0097 F7), 실제 HTTP 로 실제 데이터베이스에 대고.
 *
 * **이 배치가 있는 이유는 어긋남이 조용하기 때문이다.** 별점이 4.2 여야 하는데 3.8 로
 * 남아 있어도 화면은 멀쩡히 그리고, 팔로워 수가 37 대신 42 여도 아무도 검산하지
 * 않는다. 그래서 검사도 「맞을 때 0건」이 아니라 **「어긋뜨려 놓으면 잡는가」**를 잰다 —
 * 앞의 것만 재면 아무것도 안 세는 구현이 통과한다.
 */

const db = useDatabase()
const api = useApiApp({ database: db, authenticate: true })

const NOW = '2026-09-25T00:00:00.000Z'

let operator: TestCaller
let buyer: TestCaller
let store: Awaited<ReturnType<typeof createSellableVariant>>

beforeEach(async () => {
  api.clock.set(NOW)

  operator = { userId: (await createUser(db)).id, roles: ['ADMIN_OPERATOR'] }
  buyer = { userId: (await createUser(db)).id, roles: ['BUYER'] }
  store = await createSellableVariant(db, { stock: 10 })
  await makeConsistent()
})

/**
 * 픽스처를 **정합한 상태로** 만든다.
 *
 * `createSellableVariant` 는 서비스를 우회해 재고를 직접 적고 `minPrice` 를 채우지
 * 않는다 — 다른 스펙에는 문제가 없지만 여기서는 그것 자체가 불일치라, 놔두면
 * **재고 검사가 거저 통과한다**(어긋뜨리기 전에 이미 1건이므로).
 *
 * 그래서 원장 한 줄과 최저가를 채워 0에서 시작한다. 이 함수가 하는 일이 곧 운영에서
 * 상품 서비스와 재고 서비스가 하는 일이다.
 */
async function makeConsistent(): Promise<void> {
  await db.execute(
    // 복합 기본키다 — 대리키가 없다. 「어느 조합의 몇 번째 움직임인가」가 곧 키다.
    // `ADJUST` 는 사유가 필수다 (`StockLedger_adjust_reason_check`) — 사람의 판단이
    // 유일한 근거인 유형이라, 적립금의 `ADJUST` 와 같은 규칙을 진다.
    `INSERT INTO "StockLedger" ("variantId", "seq", "type", "quantity", "balanceAfter", "reason")
     VALUES ($1, 1, 'ADJUST'::"StockLedgerType", 10, 10, '픽스처 초기 재고')`,
    [store.variant.id],
  )
  await db.execute(
    `UPDATE "Product" SET "minPrice" = (
       SELECT MIN("price") FROM "ProductVariant"
        WHERE "productId" = "Product"."id" AND "deletedAt" IS NULL AND "isActive" = true
     ) WHERE "id" = $1`,
    [store.product.id],
  )
}

function client(caller: TestCaller): ApiClient {
  return api.clientAs(caller)
}

const reportSchema = z.object({
  at: z.iso.datetime(),
  total: z.int(),
  checks: z.array(
    z.object({ key: z.string(), discrepancies: z.int(), samples: z.array(z.unknown()) }),
  ),
})

function check(caller: TestCaller) {
  return client(caller).request({ path: '/admin/consistency', schema: reportSchema })
}

function countOf(report: z.infer<typeof reportSchema>, key: string): number {
  return report.checks.find((entry) => entry.key === key)?.discrepancies ?? -99
}

describe('맞을 때', () => {
  it('finds nothing, and says so for every axis', async () => {
    const report = await check(operator)

    expect(report.total).toBe(0)
    expect(report.checks).toHaveLength(7)
    expect(report.checks.every((entry) => entry.discrepancies === 0)).toBe(true)
  })
})

describe('어긋뜨려 놓으면', () => {
  /**
   * **평점은 아무도 검산하지 않는다.** 4.2 여야 하는데 3.8 로 남아 있어도 화면은
   * 멀쩡하고, 그 상태로 검색 정렬의 근거가 된다.
   */
  it('catches a rating that drifted from its reviews', async () => {
    await db.execute(`UPDATE "Product" SET "ratingAvg" = 380, "ratingCount" = 7 WHERE "id" = $1`, [
      store.product.id,
    ])

    const report = await check(operator)

    expect(countOf(report, 'rating')).toBe(1)
    expect(report.total).toBeGreaterThan(0)
    // 표본이 **어느 상품인지** 말해야 사람이 원인을 짚으러 갈 수 있다.
    expect(JSON.stringify(report.checks)).toContain(store.product.id)
  })

  it('catches a minimum price that no live variant supports', async () => {
    await db.execute(`UPDATE "Product" SET "minPrice" = 1 WHERE "id" = $1`, [store.product.id])

    expect(countOf(await check(operator), 'minPrice')).toBe(1)
  })

  it('catches a follower count that no follow supports', async () => {
    await db.execute(`UPDATE "Seller" SET "followerCount" = 42 WHERE "id" = $1`, [store.seller.id])

    expect(countOf(await check(operator), 'followerCount')).toBe(1)
  })

  /** 재고 대사는 원장을 아는 쪽의 것이다 — 여기서는 그것을 **부르는지**만 본다. */
  it('calls the stock reconciler that already existed', async () => {
    await db.execute(`UPDATE "ProductVariant" SET "stock" = 999 WHERE "id" = $1`, [
      store.variant.id,
    ])

    expect(countOf(await check(operator), 'stock')).toBe(1)
  })
})

describe('고치지 않는다', () => {
  /**
   * **원인을 모르는 채 값을 고치면 문제가 숨는다.** 다음 주에 같은 자리가 또 어긋나도
   * 배치가 조용히 덮어써 버리고, 그러면 원인을 찾을 기회가 영영 사라진다.
   */
  it('leaves the wrong value exactly as it found it', async () => {
    await db.execute(`UPDATE "Seller" SET "followerCount" = 42 WHERE "id" = $1`, [store.seller.id])

    await check(operator)
    await check(operator)

    const [row] = await db.query<{ followerCount: number }>(
      `SELECT "followerCount" FROM "Seller" WHERE "id" = $1`,
      [store.seller.id],
    )

    expect(row?.followerCount).toBe(42)
    // 그리고 두 번째 점검도 여전히 잡는다 — 조용해지지 않는다.
    expect(countOf(await check(operator), 'followerCount')).toBe(1)
  })
})

describe('한 축이 터져도', () => {
  /**
   * 대사는 **진단**이다. 진단 하나가 실패했다고 나머지 여섯의 답을 버리면 사람이 볼
   * 것이 없어진다 — 그리고 그때가 바로 볼 것이 가장 필요한 순간이다.
   *
   * 못 센 축은 **0이 아니라 -1** 이다. 0은 「맞다」는 뜻이고 이것은 「모른다」다.
   */
  it('answers the other six, and does not call the failed one zero', async () => {
    const consistency = api.resolve<ConsistencyService>(ConsistencyService)
    const points = (consistency as unknown as { points: { reconcile: () => Promise<unknown> } })
      .points
    const broken = vi.spyOn(points, 'reconcile').mockRejectedValue(new Error('진단 실패'))

    try {
      const report = await check(operator)

      expect(countOf(report, 'pointBalance')).toBe(-1)
      expect(countOf(report, 'stock')).toBe(0)
      expect(report.checks).toHaveLength(7)
    } finally {
      broken.mockRestore()
    }
  })
})

describe('권한', () => {
  it('refuses a buyer, whose order.read is their own', async () => {
    await expect(check(buyer)).rejects.toBeInstanceOf(ApiClientError)
  })
})
