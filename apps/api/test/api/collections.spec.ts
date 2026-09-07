import type { ApiClient } from '@shopping/shared'
import {
  ApiClientError,
  followListResponseSchema,
  followResultSchema,
  notificationListResponseSchema,
  productDetailResponseSchema,
  recentlyViewedResponseSchema,
  restockAlertResultSchema,
  toggleResultSchema,
  wishlistResponseSchema,
  RECENTLY_VIEWED_MAX,
} from '@shopping/shared'
import { beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { RestockNotifier } from '../../src/notifications/restock.service.js'
import { useApiApp } from '../support/api-app.js'
import { useDatabase } from '../support/database.js'
import { createSellableVariant, createSeller, createUser } from '../support/factories.js'
import type { TestCaller } from '../support/principal.js'

/**
 * 찜 · 최근 본 상품 · 팔로우 (TASK-0086 · 0087 · 0089).
 *
 * 셋 다 「사람이 무엇을 가리킨다」 하나뿐이고, 재는 것도 셋이 닮았다 — **두 번 눌러도
 * 한 번인가**, **남의 것이 섞이지 않는가**, **세는 값이 실제와 맞는가**.
 */

const db = useDatabase()
const api = useApiApp({ database: db, authenticate: true })

const NOW = '2026-09-10T00:00:00.000Z'

let me: TestCaller
let stranger: TestCaller
let store: Awaited<ReturnType<typeof createSellableVariant>>

beforeEach(async () => {
  api.clock.set(NOW)

  me = { userId: (await createUser(db)).id, roles: ['BUYER'] }
  stranger = { userId: (await createUser(db)).id, roles: ['BUYER'] }
  store = await createSellableVariant(db, { stock: 10 })

  await db.execute(
    `UPDATE "Product" SET "status" = 'ACTIVE'::"ProductStatus", "minPrice" = 10000 WHERE "id" = $1`,
    [store.product.id],
  )
})

function client(caller: TestCaller): ApiClient {
  return api.clientAs(caller)
}

function toggleWishlist(caller: TestCaller, productId: string): Promise<{ active: boolean }> {
  return client(caller).request({
    path: `/me/wishlist/${productId}`,
    method: 'POST',
    schema: toggleResultSchema,
  })
}

function wishlist(caller: TestCaller): Promise<{
  items: readonly {
    productId: string
    soldOut: boolean
    price: number | null
    addedPrice: number | null
    notifyRestock: boolean
  }[]
}> {
  return client(caller).request({ path: '/me/wishlist', schema: wishlistResponseSchema })
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

describe('찜 (TASK-0086)', () => {
  /** 「눌렀다」가 아니라 「지금 이렇다」여야 낙관적 갱신이 되돌릴 값을 갖는다. */
  it('토글이 지금 상태를 답한다 (F1)', async () => {
    expect(await toggleWishlist(me, store.product.id)).toEqual({ active: true })
    expect(await toggleWishlist(me, store.product.id)).toEqual({ active: false })
  })

  it('담은 것이 목록에 남는다 (F3)', async () => {
    await toggleWishlist(me, store.product.id)

    expect((await wishlist(me)).items.map((item) => item.productId)).toEqual([store.product.id])
  })

  it('남의 찜은 보이지 않는다', async () => {
    await toggleWishlist(stranger, store.product.id)

    expect((await wishlist(me)).items).toEqual([])
  })

  /** 지금 값만 알면 「내렸다」를 말할 수 없다. */
  it('담을 때의 가격을 함께 적는다 (F5)', async () => {
    await toggleWishlist(me, store.product.id)
    await db.execute(`UPDATE "Product" SET "minPrice" = 8000 WHERE "id" = $1`, [store.product.id])

    const [item] = (await wishlist(me)).items

    expect(item).toMatchObject({ addedPrice: 10_000, price: 8_000 })
  })

  it('팔 수 있는 조합이 없으면 품절이다 (F4)', async () => {
    await toggleWishlist(me, store.product.id)
    // `Product_active_price_check` 가 「팔 수 있는데 값이 없다」를 막는다 — 품절은
    // 값이 사라지는 것이자 판매가 멈추는 것이고, 그 둘은 한 사실이다.
    await db.execute(
      `UPDATE "Product" SET "minPrice" = NULL, "status" = 'DRAFT'::"ProductStatus" WHERE "id" = $1`,
      [store.product.id],
    )

    const [item] = (await wishlist(me)).items

    expect(item).toMatchObject({ soldOut: true, price: null })
  })

  it('없는 상품은 담을 수 없다', async () => {
    expect(await failure(toggleWishlist(me, '0192f0c1-0000-7000-8000-0000000000ff'))).toBe(404)
  })
})

describe('최근 본 상품 (TASK-0087)', () => {
  function view(caller: TestCaller | null, productId: string): Promise<unknown> {
    const target = caller === null ? api.client : client(caller)

    return target.request({
      path: `/products/${productId}/detail`,
      schema: productDetailResponseSchema,
    })
  }

  function recent(caller: TestCaller): Promise<{
    items: readonly { productId: string; viewedAt: string }[]
  }> {
    return client(caller).request({
      path: '/me/recently-viewed',
      schema: recentlyViewedResponseSchema,
    })
  }

  /** 기록은 답을 만든 뒤에 일어난다 — 그래서 잠깐 기다렸다 확인한다. */
  async function eventually(check: () => Promise<boolean>): Promise<void> {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (await check()) return

      await new Promise((resolve) => setTimeout(resolve, 20))
    }

    throw new Error('기다린 상태가 되지 않았습니다.')
  }

  it('상품을 보면 기록된다 (F1)', async () => {
    await view(me, store.product.id)

    await eventually(async () => (await recent(me)).items.length === 1)
  })

  /** 같은 상품을 열 번 봐도 행은 하나다 — 열쇠가 `(사람, 상품)`이다. */
  it('세 번 봐도 행은 하나다 (F2)', async () => {
    await view(me, store.product.id)
    await view(me, store.product.id)
    await view(me, store.product.id)

    await eventually(async () => (await recent(me)).items.length === 1)

    const rows = await db.query(`SELECT 1 FROM "RecentlyViewed" WHERE "userId" = $1`, [me.userId])

    expect(rows).toHaveLength(1)
  })

  /** 로그인하지 않은 사람의 이력은 브라우저가 들고 있다가 로그인할 때 합쳐진다. */
  it('로그인하지 않으면 서버에 남지 않는다', async () => {
    await view(null, store.product.id)

    const rows = await db.query(`SELECT 1 FROM "RecentlyViewed"`)

    expect(rows).toEqual([])
  })

  it('브라우저의 이력을 합친다 (F6)', async () => {
    const answer = await client(me).request({
      path: '/me/recently-viewed',
      method: 'POST',
      body: {
        items: [{ productId: store.product.id, viewedAt: '2026-09-09T00:00:00.000Z' }],
      },
      schema: recentlyViewedResponseSchema,
    })

    expect(answer.items.map((item) => item.productId)).toEqual([store.product.id])
  })

  /** 브라우저에 남아 있던 옛 기록이 방금 본 것을 뒤로 밀면 안 된다. */
  it('합칠 때 더 최근 쪽이 이긴다 (F6)', async () => {
    await client(me).request({
      path: '/me/recently-viewed',
      method: 'POST',
      body: { items: [{ productId: store.product.id, viewedAt: NOW }] },
      schema: recentlyViewedResponseSchema,
    })
    await client(me).request({
      path: '/me/recently-viewed',
      method: 'POST',
      body: {
        items: [{ productId: store.product.id, viewedAt: '2026-01-01T00:00:00.000Z' }],
      },
      schema: recentlyViewedResponseSchema,
    })

    expect((await recent(me)).items[0]?.viewedAt).toBe(NOW)
  })

  it('없는 상품이 섞여 있어도 나머지는 합쳐진다', async () => {
    const answer = await client(me).request({
      path: '/me/recently-viewed',
      method: 'POST',
      body: {
        items: [
          { productId: store.product.id, viewedAt: NOW },
          { productId: '0192f0c1-0000-7000-8000-0000000000ff', viewedAt: NOW },
        ],
      },
      schema: recentlyViewedResponseSchema,
    })

    expect(answer.items).toHaveLength(1)
  })

  /**
   * 상한이 없으면 이 표가 사람마다 무한히 자란다.
   *
   * 한 번에 51개를 보내지 않는 이유는 **계약이 먼저 거절하기** 때문이다
   * (`RECENTLY_VIEWED_MERGE_MAX`). 실제로 상한을 넘는 길은 「가득 찬 상태에서 하나
   * 더 본다」이고, 그것이 여기서 재는 것이다.
   */
  it('최대 개수를 넘으면 오래된 것이 정리된다 (F5)', async () => {
    const products: string[] = []

    for (let index = 0; index < RECENTLY_VIEWED_MAX; index += 1) {
      const extra = await createSellableVariant(db, { stock: 1 })

      products.push(extra.product.id)
    }

    await client(me).request({
      path: '/me/recently-viewed',
      method: 'POST',
      body: {
        items: products.map((productId, index) => ({
          productId,
          // 뒤로 갈수록 오래된 것 — 마지막이 가장 먼저 밀려난다.
          viewedAt: new Date(new Date(NOW).getTime() - (index + 1) * 60_000).toISOString(),
        })),
      },
      schema: recentlyViewedResponseSchema,
    })

    const answer = await client(me).request({
      path: '/me/recently-viewed',
      method: 'POST',
      body: { items: [{ productId: store.product.id, viewedAt: NOW }] },
      schema: recentlyViewedResponseSchema,
    })
    const rows = await db.query(`SELECT 1 FROM "RecentlyViewed" WHERE "userId" = $1`, [me.userId])

    expect(rows).toHaveLength(RECENTLY_VIEWED_MAX)
    // 방금 본 것이 남고, 가장 오래된 것이 밀려났다.
    expect(answer.items[0]?.productId).toBe(store.product.id)
    expect(answer.items.map((item) => item.productId)).not.toContain(products.at(-1))
  })

  it('하나씩 지우고 전부 지운다 (F7)', async () => {
    await client(me).request({
      path: '/me/recently-viewed',
      method: 'POST',
      body: { items: [{ productId: store.product.id, viewedAt: NOW }] },
      schema: recentlyViewedResponseSchema,
    })
    await client(me).request({
      path: `/me/recently-viewed/${store.product.id}`,
      method: 'DELETE',
      schema: z.unknown(),
    })

    expect((await recent(me)).items).toEqual([])

    await client(me).request({
      path: '/me/recently-viewed',
      method: 'POST',
      body: { items: [{ productId: store.product.id, viewedAt: NOW }] },
      schema: recentlyViewedResponseSchema,
    })
    await client(me).request({
      path: '/me/recently-viewed',
      method: 'DELETE',
      schema: z.unknown(),
    })

    expect((await recent(me)).items).toEqual([])
  })
})

describe('팔로우 (TASK-0089)', () => {
  function toggleFollow(
    caller: TestCaller,
    sellerId: string,
  ): Promise<{ active: boolean; followerCount: number }> {
    return client(caller).request({
      path: `/me/follows/${sellerId}`,
      method: 'POST',
      schema: followResultSchema,
    })
  }

  it('토글이 지금 상태와 팔로워 수를 함께 답한다 (F1 · F3)', async () => {
    expect(await toggleFollow(me, store.seller.id)).toEqual({ active: true, followerCount: 1 })
    expect(await toggleFollow(me, store.seller.id)).toEqual({ active: false, followerCount: 0 })
  })

  /** 두 번 눌려도 두 번 세어지지 않는다 — 조건부 삭제가 0줄을 답하면 더하지 않는다. */
  it('같은 사람이 두 번 팔로우해도 하나다 (F2)', async () => {
    await toggleFollow(me, store.seller.id)
    await toggleFollow(me, store.seller.id)
    await toggleFollow(me, store.seller.id)

    const [seller] = await db.query<{ followerCount: number }>(
      `SELECT "followerCount" FROM "Seller" WHERE "id" = $1`,
      [store.seller.id],
    )
    const rows = await db.query(`SELECT 1 FROM "SellerFollow" WHERE "sellerId" = $1`, [
      store.seller.id,
    ])

    expect(rows).toHaveLength(1)
    expect(seller?.followerCount).toBe(1)
  })

  it('여러 사람이 팔로우하면 그만큼 센다 (F3)', async () => {
    await toggleFollow(me, store.seller.id)
    await toggleFollow(stranger, store.seller.id)

    const [seller] = await db.query<{ followerCount: number }>(
      `SELECT "followerCount" FROM "Seller" WHERE "id" = $1`,
      [store.seller.id],
    )

    expect(seller?.followerCount).toBe(2)
  })

  it('팔로우한 브랜드가 목록에 남는다', async () => {
    await toggleFollow(me, store.seller.id)

    const answer = await client(me).request({
      path: '/me/follows',
      schema: followListResponseSchema,
    })

    expect(answer.sellers.map((seller) => seller.sellerId)).toEqual([store.seller.id])
    expect(answer.sellers[0]?.followerCount).toBe(1)
  })

  it('남의 팔로우 목록은 보이지 않는다', async () => {
    await toggleFollow(stranger, store.seller.id)

    const answer = await client(me).request({
      path: '/me/follows',
      schema: followListResponseSchema,
    })

    expect(answer.sellers).toEqual([])
  })

  it('없는 스토어는 팔로우할 수 없다', async () => {
    const owner = await createUser(db)
    const gone = await createSeller(db, { userId: owner.id })

    await db.execute(`DELETE FROM "Seller" WHERE "id" = $1`, [gone.id])

    expect(await failure(toggleFollow(me, gone.id))).toBe(404)
  })
})

describe('재입고 알림 (TASK-0086 F4)', () => {
  function restockAlert(
    caller: TestCaller,
    productId: string,
    method: 'POST' | 'DELETE',
  ): Promise<{ notifyRestock: boolean }> {
    return client(caller).request({
      path: `/me/wishlist/${productId}/restock-alert`,
      method,
      schema: restockAlertResultSchema,
    })
  }

  it('찜한 상품에 재입고 알림을 신청한다', async () => {
    await toggleWishlist(me, store.product.id)

    expect(await restockAlert(me, store.product.id, 'POST')).toEqual({ notifyRestock: true })
    expect((await wishlist(me)).items[0]?.notifyRestock).toBe(true)
  })

  /** 「알림은 기다리는데 목록에는 없는」 상태를 만들지 않는다. */
  it('찜하지 않은 상품에는 걸 수 없다', async () => {
    expect(await failure(restockAlert(me, store.product.id, 'POST'))).toBe(404)
  })

  it('끌 수 있다', async () => {
    await toggleWishlist(me, store.product.id)
    await restockAlert(me, store.product.id, 'POST')

    expect(await restockAlert(me, store.product.id, 'DELETE')).toEqual({ notifyRestock: false })
  })

  /** 다시 들어오면 알림이 가고, **신청은 꺼진다** — 같은 재입고를 두 번 알리지 않는다. */
  it('다시 들어오면 알림이 가고 신청이 꺼진다', async () => {
    await toggleWishlist(me, store.product.id)
    await restockAlert(me, store.product.id, 'POST')

    const sent = await api.resolve<RestockNotifier>(RestockNotifier).sweep()

    expect(sent).toBe(1)
    expect((await wishlist(me)).items[0]?.notifyRestock).toBe(false)

    const inbox = await client(me).request({
      path: '/me/notifications',
      schema: notificationListResponseSchema,
    })

    expect(inbox.notifications[0]).toMatchObject({ type: 'RESTOCK' })
  })

  it('아직 품절이면 아무것도 보내지 않는다', async () => {
    await toggleWishlist(me, store.product.id)
    await restockAlert(me, store.product.id, 'POST')
    await db.execute(
      `UPDATE "Product" SET "minPrice" = NULL, "status" = 'DRAFT'::"ProductStatus" WHERE "id" = $1`,
      [store.product.id],
    )

    expect(await api.resolve<RestockNotifier>(RestockNotifier).sweep()).toBe(0)
  })

  it('신청하지 않은 찜에는 보내지 않는다', async () => {
    await toggleWishlist(me, store.product.id)

    expect(await api.resolve<RestockNotifier>(RestockNotifier).sweep()).toBe(0)
  })
})
