import { randomUUID } from 'node:crypto'

import type { ApiClient, OrderStatus } from '@shopping/shared'
import { notificationListResponseSchema, readNotificationsResponseSchema } from '@shopping/shared'
import { beforeEach, describe, expect, it } from 'vitest'

import { NotificationService } from '../../src/notifications/notification.service.js'
import { NOTIFICATION_RETENTION_DAYS } from '../../src/notifications/notification-rules.js'
import { PrismaService } from '../../src/prisma/prisma.service.js'
import { SellerOrderService } from '../../src/orders/seller-order.service.js'
import { useApiApp } from '../support/api-app.js'
import { useDatabase } from '../support/database.js'
import { createSellableVariant, createUser } from '../support/factories.js'
import type { TestCaller } from '../support/principal.js'

/**
 * 알림 (TASK-0090), 실제 HTTP 로 실제 데이터베이스에 대고.
 *
 * **가장 중요한 검사는 「알림이 원래 작업을 실패시키지 않는가」다** (F6). 알림을 못
 * 받는 것과 물건이 안 가는 것은 다른 일이고, 후자가 전자 때문에 일어나면 그것은
 * 배송 사고다.
 */

const db = useDatabase()
const api = useApiApp({ database: db, authenticate: true })

const NOW = '2026-09-10T00:00:00.000Z'
const DAY_MS = 24 * 60 * 60 * 1_000

let buyer: TestCaller
let store: Awaited<ReturnType<typeof createSellableVariant>>
let sequence = 0

beforeEach(async () => {
  api.clock.set(NOW)
  sequence = 0

  buyer = { userId: (await createUser(db)).id, roles: ['BUYER'] }
  store = await createSellableVariant(db, { stock: 10 })
})

function client(caller: TestCaller): ApiClient {
  return api.clientAs(caller)
}

function notifications(): NotificationService {
  return api.resolve<NotificationService>(NotificationService)
}

/**
 * 상태를 옮기고 **커밋한 뒤에** 알린다.
 *
 * 라우트를 지나지 않는 이유는 여기서 재는 것이 퍼미션이 아니어서다. 대신 서비스가
 * 실제로 하는 두 문(`applyWithin` 과 `publish`)을 같은 순서로 부른다 — 그 순서가
 * 곧 「커밋되지 않은 사실을 밖에 알리지 않는다」이고, 그것이 이 스펙의 전제다.
 */
async function move(sellerOrderId: string, to: OrderStatus): Promise<void> {
  const transitions = api.resolve<SellerOrderService>(SellerOrderService)
  const prisma = api.resolve<PrismaService>(PrismaService)
  const event = await prisma.$transaction((tx) =>
    transitions.applyWithin(tx, sellerOrderId, to, { actor: 'SELLER', actorId: null }),
  )

  await transitions.publish(event === null ? [] : [event])
}

function inbox(
  caller: TestCaller,
  query = '',
): Promise<{
  notifications: readonly {
    id: string
    type: string
    title: string
    link: string | null
    readAt: string | null
  }[]
  unreadCount: number
}> {
  return client(caller).request({
    path: `/me/notifications${query}`,
    schema: notificationListResponseSchema,
  })
}

/** 배송 중인 주문 하나. 상태를 옮겨 알림을 만들 대상이다. */
async function shipping(): Promise<string> {
  sequence += 1

  const orderId = randomUUID()
  const sellerOrderId = randomUUID()

  await db.execute(
    `INSERT INTO "Order"
       ("id", "orderNumber", "userId", "checkoutId", "recipientName", "recipientPhone",
        "postalCode", "addressLine1", "totalProductAmount", "paidAmount", "updatedAt")
     VALUES ($1, $2, $3, gen_random_uuid(), '홍길동', '010-0000-0000', '06234', '서울시 강남구',
             10000, 10000, now())`,
    [orderId, `20260909-${String(sequence).padStart(8, '0')}`, buyer.userId],
  )
  await db.execute(
    `INSERT INTO "SellerOrder"
       ("id", "orderId", "sellerId", "status", "brandName", "productAmount", "paidAmount",
        "shippingFee", "trackingNumber", "updatedAt")
     VALUES ($1, $2, $3, 'PREPARING'::"SellerOrderStatus", '가상브랜드', 10000, 10000, 0,
             NULL, now())`,
    [sellerOrderId, orderId, store.seller.id],
  )
  await db.execute(
    `INSERT INTO "OrderItem"
       ("id", "sellerOrderId", "variantId", "productId", "productSnapshot", "unitPrice",
        "quantity", "productAmount", "commissionRateBp", "updatedAt")
     VALUES (gen_random_uuid(), $1, $2, $3, '{}'::jsonb, 10000, 1, 10000, 1000, now())`,
    [sellerOrderId, store.variant.id, store.product.id],
  )
  await db.execute(
    `INSERT INTO "Shipment"
       ("id", "sellerOrderId", "carrierCode", "carrierName", "trackingNumber", "status",
        "shippedAt", "updatedAt")
     VALUES (gen_random_uuid(), $1, 'GA', '가상택배', $2, 'IN_TRANSIT'::"ShipmentStatus",
             now(), now())`,
    [sellerOrderId, `DEMO-GA-${String(sequence).padStart(12, '0')}`],
  )
  await db.execute(`UPDATE "SellerOrder" SET "trackingNumber" = $2 WHERE "id" = $1`, [
    sellerOrderId,
    `DEMO-GA-${String(sequence).padStart(12, '0')}`,
  ])

  return sellerOrderId
}

describe('주문 알림 (F1 · F2)', () => {
  it('발송 처리하면 구매자에게 알림이 온다', async () => {
    const sellerOrderId = await shipping()

    await move(sellerOrderId, 'SHIPPED')

    const answer = await inbox(buyer)

    expect(answer.notifications).toHaveLength(1)
    expect(answer.notifications[0]).toMatchObject({ type: 'ORDER_STATUS' })
    expect(answer.unreadCount).toBe(1)
  })

  /** 앱 안의 경로다 — 도메인을 실으면 옮기는 날 지난 알림이 남의 사이트를 가리킨다. */
  it('알림이 그 주문으로 가는 경로를 싣는다 (F2)', async () => {
    const sellerOrderId = await shipping()

    await move(sellerOrderId, 'SHIPPED')

    const [notification] = (await inbox(buyer)).notifications

    expect(notification?.link).toMatch(/^\/mypage\/orders\//u)
  })

  /**
   * **배지를 올리는 알림은 읽을 이유가 있어야 한다.** 준비중은 판매자의 내부
   * 상태이고 구매자에게는 아직 아무 일도 일어나지 않은 것과 같다.
   */
  it('알릴 만하지 않은 전이에는 알림이 없다', async () => {
    const sellerOrderId = await shipping()

    await db.execute(
      `UPDATE "SellerOrder" SET "status" = 'PAID'::"SellerOrderStatus" WHERE "id" = $1`,
      [sellerOrderId],
    )
    await move(sellerOrderId, 'PREPARING')

    expect((await inbox(buyer)).notifications).toEqual([])
  })
})

describe('수신 설정 (F5)', () => {
  it('거래 알림을 끄면 오지 않는다', async () => {
    await db.execute(
      `INSERT INTO "UserPreference" ("userId", "notifyOrder", "updatedAt")
       VALUES ($1, false, now())`,
      [buyer.userId],
    )

    const sellerOrderId = await shipping()

    await move(sellerOrderId, 'SHIPPED')

    expect((await inbox(buyer)).notifications).toEqual([])
  })

  /** 설정 행은 설정 화면을 열어야 생긴다 — 그때까지의 기본값은 「받는다」다. */
  it('설정 행이 없으면 받는다', async () => {
    const sellerOrderId = await shipping()

    await move(sellerOrderId, 'SHIPPED')

    expect((await inbox(buyer)).notifications).toHaveLength(1)
  })
})

describe('읽음 (F3 · F4)', () => {
  async function seedThree(): Promise<void> {
    await notifications().sendMany(
      Array.from({ length: 3 }, (_unused, index) => ({
        userId: buyer.userId,
        type: 'ORDER_STATUS' as const,
        title: `알림 ${String(index)}`,
        body: '본문',
      })),
    )
  }

  it('미읽음 수를 목록과 함께 답한다 (F3)', async () => {
    await seedThree()

    expect((await inbox(buyer)).unreadCount).toBe(3)
  })

  it('하나만 읽는다', async () => {
    await seedThree()

    const [first] = (await inbox(buyer)).notifications
    const answer = await client(buyer).request({
      path: '/me/notifications/read',
      method: 'POST',
      body: { ids: [first?.id] },
      schema: readNotificationsResponseSchema,
    })

    expect(answer.unreadCount).toBe(2)
  })

  it('id 를 주지 않으면 전부 읽는다 (F4)', async () => {
    await seedThree()

    const answer = await client(buyer).request({
      path: '/me/notifications/read',
      method: 'POST',
      body: {},
      schema: readNotificationsResponseSchema,
    })

    expect(answer.unreadCount).toBe(0)
  })

  /** 두 번 눌러도 처음 읽은 시각이 그대로 남는다. */
  it('이미 읽은 것을 다시 읽지 않는다', async () => {
    await seedThree()
    await client(buyer).request({
      path: '/me/notifications/read',
      method: 'POST',
      body: {},
      schema: readNotificationsResponseSchema,
    })

    const before = await db.query<{ readAt: Date }>(
      `SELECT "readAt" FROM "Notification" WHERE "userId" = $1 ORDER BY "id"`,
      [buyer.userId],
    )

    api.clock.set('2026-09-11T00:00:00.000Z')
    await client(buyer).request({
      path: '/me/notifications/read',
      method: 'POST',
      body: {},
      schema: readNotificationsResponseSchema,
    })

    const after = await db.query<{ readAt: Date }>(
      `SELECT "readAt" FROM "Notification" WHERE "userId" = $1 ORDER BY "id"`,
      [buyer.userId],
    )

    expect(after.map((row) => row.readAt.toISOString())).toEqual(
      before.map((row) => row.readAt.toISOString()),
    )
  })

  it('안 읽은 것만 볼 수 있다', async () => {
    await seedThree()

    const [first] = (await inbox(buyer)).notifications

    await client(buyer).request({
      path: '/me/notifications/read',
      method: 'POST',
      body: { ids: [first?.id] },
      schema: readNotificationsResponseSchema,
    })

    expect((await inbox(buyer, '?unreadOnly=true')).notifications).toHaveLength(2)
  })

  it('남의 알림은 보이지 않는다', async () => {
    const other = { userId: (await createUser(db)).id, roles: ['BUYER'] as const }

    await seedThree()

    expect((await inbox({ ...other, roles: ['BUYER'] })).notifications).toEqual([])
  })
})

describe('실패 격리 (F6)', () => {
  /**
   * **알림이 실패해도 원래 작업은 끝난다.** 여기서는 없는 사용자에게 보내 외래키를
   * 어기게 한다 — 그때 던지면 부르는 쪽의 트랜잭션이 아니라 **이미 끝난 작업**이
   * 실패한 것처럼 보인다.
   */
  it('알림 생성이 실패해도 던지지 않는다', async () => {
    await expect(
      notifications().send({
        userId: randomUUID(),
        type: 'ORDER_STATUS',
        title: '없는 사람에게',
        body: '본문',
      }),
    ).resolves.toBeUndefined()
  })

  it('보낼 것이 없으면 아무 일도 하지 않는다', async () => {
    await expect(notifications().sendMany([])).resolves.toBeUndefined()
  })
})

describe('정리 배치', () => {
  /** 배지에 영영 남는 숫자는 배지를 무의미하게 만든다. */
  it('보관 기간이 지난 알림을 지운다 — 안 읽었어도', async () => {
    await notifications().send({
      userId: buyer.userId,
      type: 'ORDER_STATUS',
      title: '오래된 알림',
      body: '본문',
    })
    await db.execute(
      `UPDATE "Notification" SET "createdAt" = $2::timestamptz WHERE "userId" = $1`,
      [
        buyer.userId,
        new Date(
          new Date(NOW).getTime() - (NOTIFICATION_RETENTION_DAYS + 1) * DAY_MS,
        ).toISOString(),
      ],
    )

    expect(await notifications().prune()).toBe(1)
    expect((await inbox(buyer)).notifications).toEqual([])
  })

  it('기간 안의 알림은 남는다', async () => {
    await notifications().send({
      userId: buyer.userId,
      type: 'ORDER_STATUS',
      title: '최근 알림',
      body: '본문',
    })

    expect(await notifications().prune()).toBe(0)
  })
})
