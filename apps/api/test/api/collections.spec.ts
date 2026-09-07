import type { ApiClient } from '@shopping/shared'
import {
  ApiClientError,
  followListResponseSchema,
  followResultSchema,
  notificationListResponseSchema,
  productDetailResponseSchema,
  recentlyViewedResponseSchema,
  restockAlertResultSchema,
  storefrontSellerResponseSchema,
  toggleResultSchema,
  wishlistIdsResponseSchema,
  wishlistResponseSchema,
  followIdsResponseSchema,
  RECENTLY_VIEWED_MAX,
  WISHLIST_MAX_LIMIT,
} from '@shopping/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { CollectionsService } from '../../src/collections/collections.service.js'
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

function wishlistIds(caller: TestCaller): Promise<{ productIds: readonly string[] }> {
  return client(caller).request({ path: '/me/wishlist/ids', schema: wishlistIdsResponseSchema })
}

function followIds(caller: TestCaller): Promise<{ sellerIds: readonly string[] }> {
  return client(caller).request({ path: '/me/follows/ids', schema: followIdsResponseSchema })
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

describe('찜한 것의 id 만 (TASK-0086 F1)', () => {
  it('담은 것과 같은 것을 답한다', async () => {
    await toggleWishlist(me, store.product.id)

    expect((await wishlistIds(me)).productIds).toEqual([store.product.id])
  })

  it('빼면 사라진다', async () => {
    await toggleWishlist(me, store.product.id)
    await toggleWishlist(me, store.product.id)

    expect((await wishlistIds(me)).productIds).toEqual([])
  })

  it('남의 찜은 섞이지 않는다', async () => {
    await toggleWishlist(stranger, store.product.id)

    expect((await wishlistIds(me)).productIds).toEqual([])
  })

  /**
   * **이 검사가 이 문이 존재하는 이유다.**
   *
   * 목록은 한 쪽에 `WISHLIST_MAX_LIMIT` 개까지다. 화면이 「찜했나」를 목록으로 알아내면
   * 101번째부터는 답을 못 받고, 그 상품의 하트는 새로고침할 때마다 빈 채로 그려진다 —
   * F1 의 「새로고침 후 유지」가 깨진 모습이고, **화면에는 오류가 하나도 안 뜬다.**
   *
   * 그래서 여기서 재는 것은 「많이 담아도 동작한다」가 아니라 **「목록이 못 넘는 선을
   * 이 문은 넘는다」**이다. 상한과 같은 수로 재면 검사는 통과하면서 버그는 남는다.
   */
  it('목록 한 쪽에 들어가지 않는 수도 전부 답한다', async () => {
    const extra = WISHLIST_MAX_LIMIT + 1

    await db.execute(
      // `updatedAt` 은 Prisma 가 채우는 열이라 DB 에 기본값이 없다 — 서비스를 거치지
      // 않고 넣는 행은 직접 적어야 한다.
      `INSERT INTO "Product" ("id", "sellerId", "categoryId", "name", "status", "minPrice", "updatedAt")
       SELECT gen_random_uuid(), p."sellerId", p."categoryId", '찜 ' || i, p."status", p."minPrice", now()
         FROM "Product" p, generate_series(1, $2) AS i
        WHERE p."id" = $1`,
      [store.product.id, extra],
    )
    await db.execute(
      // 복합 기본키라 대리키가 없다 — 사람 하나가 상품 하나를 두 번 담을 수 없다는
      // 사실 자체가 키다.
      `INSERT INTO "Wishlist" ("userId", "productId")
       SELECT $1, p."id" FROM "Product" p WHERE p."name" LIKE '찜 %'`,
      [me.userId],
    )

    const { items, nextCursor } = await client(me).request({
      path: '/me/wishlist',
      schema: wishlistResponseSchema,
    })

    // 목록은 한 쪽에 다 못 담는다 — 그 사실이 이 검사의 전제다.
    expect(items.length).toBeLessThan(extra)
    expect(nextCursor).not.toBeNull()

    expect((await wishlistIds(me)).productIds).toHaveLength(extra)
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

  /**
   * **기록이 터져도 상품은 보인다** (F4).
   *
   * 실패를 만드는 자리가 중요하다. `recordView` 자체를 가짜로 바꿔 거절시키면 그
   * 함수 **안의** try/catch 는 한 번도 안 지나가므로, 그 catch 를 지워도 이 검사는
   * 초록으로 남는다 — 컨트롤러가 기다리지 않는다는 사실만 재는 셈이다.
   *
   * 그래서 더 아래를 부순다: 기록이 쓰는 문을 던지게 만든다. 그러면 `recordView` 의
   * catch 가 실제로 판정 대상이 되고, 그것을 지우는 순간 이 검사가 빨개진다.
   */
  it('기록이 실패해도 상품 상세는 정상이다 (F4)', async () => {
    const collections = api.resolve<CollectionsService>(CollectionsService)
    const prisma = (collections as unknown as { prisma: { recentlyViewed: { upsert: unknown } } })
      .prisma
    const broken = vi
      .spyOn(prisma.recentlyViewed as { upsert: () => Promise<unknown> }, 'upsert')
      .mockRejectedValue(new Error('이력을 적지 못했습니다'))

    try {
      const { product } = await client(me).request({
        path: `/products/${store.product.id}/detail`,
        schema: productDetailResponseSchema,
      })

      expect(product.id).toBe(store.product.id)
      // 삼켰다는 증거 — 던졌다면 처리되지 않은 거절이 남는다.
      await eventually(() => Promise.resolve(broken.mock.calls.length === 1))
    } finally {
      broken.mockRestore()
    }

    expect((await recent(me)).items).toEqual([])

    // 그리고 다음 조회는 멀쩡하다: 한 번의 실패가 이력 기능을 망가뜨리지 않는다.
    await view(me, store.product.id)
    await eventually(async () => (await recent(me)).items.length === 1)
  })

  /**
   * **기록이 상세를 붙잡지 않는다** (F3).
   *
   * 기준표는 「응답 시간 비교」라고 적었지만 시간으로 재면 빠른 기계에서 틀린 구현도
   * 통과한다 — 기록을 기다리는 코드도 데이터베이스가 한가하면 몇 밀리초다. 그래서
   * 시간 대신 **순서**를 잰다: 기록을 붙잡아 둔 채로 상세를 부르고, 답이 **기록보다
   * 먼저** 왔는지 본다.
   *
   * 붙잡은 것은 반드시 놓아준다. 안 놓으면 끝나지 않는 약속이 남고, 그것을 `void` 로
   * 들고 있는 컨트롤러도 함께 남는다 — 검사가 끝난 뒤에 프로세스에 남는 쓰레기다.
   *
   * **`await` 하는 구현이면 이 검사는 시간 초과로 죽는다.** 그 실패는 느리고 메시지도
   * 「timed out」뿐이라 좋은 실패는 아니지만, 답이 아예 오지 않는 구현을 그보다 빨리
   * 알아낼 방법이 없다 — 답을 기다리는 것 말고는 물어볼 것이 없기 때문이다.
   */
  it('기록을 기다리지 않고 상세를 답한다 (F3)', async () => {
    const collections = api.resolve<CollectionsService>(CollectionsService)

    let release = (): void => undefined
    let recorded = false

    const blocked = new Promise<void>((resolve) => {
      release = () => {
        recorded = true
        resolve()
      }
    })
    const held = vi.spyOn(collections, 'recordView').mockReturnValue(blocked)

    try {
      const { product } = await client(me).request({
        path: `/products/${store.product.id}/detail`,
        schema: productDetailResponseSchema,
      })

      // 답이 왔다 — 그리고 그때 기록은 아직 안 끝나 있었다. 뒤 줄이 이 검사의 전부다:
      // 앞 줄만 있으면 기다리는 구현도 (느리게) 통과한다.
      expect(product.id).toBe(store.product.id)
      expect(recorded).toBe(false)
    } finally {
      release()
      held.mockRestore()
    }
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

  /**
   * 홈의 신상품 줄이 이 순서에 기댄다 (F6).
   *
   * 50곳을 넘겨 팔로우한 사람의 줄은 앞에서부터 잘리므로, 순서가 없으면 그 줄이
   * 새로고침할 때마다 다른 가게로 채워진다 — 화면은 멀쩡하고 값만 흔들린다.
   */
  it('팔로우한 가게의 id 를 최근 순으로 답한다 (F1 · F6)', async () => {
    const other = await createSeller(db, { userId: (await createUser(db)).id, status: 'ACTIVE' })

    await toggleFollow(me, store.seller.id)
    api.clock.advance(1_000)
    await toggleFollow(me, other.id)

    expect((await followIds(me)).sellerIds).toEqual([other.id, store.seller.id])
  })

  it('언팔로우하면 id 도 사라진다', async () => {
    await toggleFollow(me, store.seller.id)
    await toggleFollow(me, store.seller.id)

    expect((await followIds(me)).sellerIds).toEqual([])
  })

  it('남의 팔로우는 섞이지 않는다', async () => {
    await toggleFollow(stranger, store.seller.id)

    expect((await followIds(me)).sellerIds).toEqual([])
  })

  /**
   * 브랜드관은 **팔로우하지 않은 사람에게도** 팔로워 수를 보여야 한다 (F3).
   *
   * 이 수가 팔로우 목록의 줄에만 있으면, 아직 안 누른 사람에게는 아예 안 보인다 —
   * 그리고 그 사람이 바로 이 수를 근거로 쓰는 사람이다. 「팔로우한 뒤에야 나타나는
   * 수」는 F3 을 지킨 것이 아니라 물어볼 수 없게 만든 것이다.
   *
   * 로그인하지 않은 채로 묻는 것이 요점이다: 이 문은 공개이고, 세어 놓은 값 하나일
   * 뿐 **누가 팔로우했는지는 실리지 않는다.**
   */
  it('공개 브랜드관이 팔로워 수를 싣는다 (F3)', async () => {
    const before = await api.client.request({
      path: `/sellers/${store.seller.id}`,
      schema: storefrontSellerResponseSchema,
    })

    expect(before.seller.followerCount).toBe(0)

    await toggleFollow(me, store.seller.id)
    await toggleFollow(stranger, store.seller.id)

    const after = await api.client.request({
      path: `/sellers/${store.seller.id}`,
      schema: storefrontSellerResponseSchema,
    })

    expect(after.seller.followerCount).toBe(2)
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
