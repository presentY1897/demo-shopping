import { Injectable } from '@nestjs/common'
import type {
  OrderStatus,
  SellerOrderListItem,
  SellerOrderListQuery,
  SellerOrderListResponse,
  SellerOrderSummaryResponse,
} from '@shopping/shared'
import { SELLER_ORDER_LIST_DEFAULT_LIMIT } from '@shopping/shared'

import { accessDenied } from '../auth/access-denied.js'
import type { RequestPrincipal } from '../auth/request-principal.js'
import { nameSearchPattern } from '../catalog/seller-product-filters.js'
import { PrismaService } from '../prisma/prisma.service.js'
import type { SellerOrderStatusCount } from './seller-order-console.js'
import {
  maskRecipientName,
  sellerOrderHeadline,
  sellerOrderSummaryOf,
} from './seller-order-console.js'

/** 목록 한 줄이 데이터베이스에서 나오는 모양. */
interface ListRow {
  readonly id: string
  readonly status: OrderStatus
  readonly paidAmount: number
  readonly trackingNumber: string | null
  readonly orderNumber: string
  readonly orderedAt: Date
  readonly recipientName: string
  readonly itemCount: number
  readonly totalQuantity: number
  readonly productName: string | null
  readonly thumbnailUrl: string | null
}

/**
 * 판매자 콘솔의 주문 목록과 뱃지 (TASK-0060 1장).
 *
 * **`OrderService` 와 따로 있는 이유는 읽는 방향이 다르기 때문이다.** 그쪽의 목록은
 * 「내가 산 주문」이고 여기는 「내 가게에 들어온 몫」이다 — 같은 표를 읽지만 소유의
 * 축이 `Order.userId` 와 `SellerOrder.sellerId` 로 다르고, 응답의 모양도 다르다
 * (남의 몫이 섞인 주문 합계를 판매자에게 줄 수 없다).
 *
 * **`SellerOrderService`(전이의 문)에도 두지 않았다.** 그 모듈은 `PrismaModule`
 * 하나만 알고, 그 좁음이 예약 스케줄러와 결제 확정이 순환 없이 그 문을 지날 수 있는
 * 이유다. 목록은 주문·수령인·항목을 함께 읽으므로 그 좁음을 깬다.
 *
 * ## 커서
 *
 * `SellerOrder.id` 는 UUIDv7 이라 그 자체로 시간순이다. 그래서 정렬은
 * `ORDER BY id DESC` 이고 커서는 마지막으로 본 id 하나다 — `OrderService.list` 와
 * `SellerProductService` 가 같은 규약을 쓰고, **새 규약을 만들지 않는 것**이 여기서
 * 지켜야 할 것이다. `createdAt` 으로 정렬하면 같은 밀리초의 두 몫에서 커서가 한 건을
 * 건너뛰거나 두 번 보여 준다(F7).
 *
 * ## N+1 (F8 · A5)
 *
 * 한 문장이다. 항목 개수·수량 합계와 대표 상품은 **횡단 조인(LATERAL)** 으로 붙고,
 * 스무 줄을 그리는 데 스물한 번 왕복하지 않는다. Prisma 의 `include` 로 항목을
 * 통째로 가져오면 한 화면이 수백 줄을 내려받는데, 화면이 그리는 것은 이름 하나와
 * 숫자 둘이다.
 */
@Injectable()
export class SellerOrderListService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 한 페이지 (F1 · F2 · F7).
   *
   * 필터는 전부 선택이고, 없는 것은 SQL 안에서 `IS NULL` 갈래로 사라진다 —
   * 조건을 문자열로 이어 붙이지 않는 것은 그렇게 만든 질의가 파라미터 자리를
   * 잃기 때문이다(`SellerProductService.rows` 가 같은 모양이다).
   */
  async list(
    principal: RequestPrincipal,
    query: SellerOrderListQuery,
  ): Promise<SellerOrderListResponse> {
    const sellerId = this.ownStore(principal)
    const limit = query.limit ?? SELLER_ORDER_LIST_DEFAULT_LIMIT
    const statuses = query.status ?? null
    const from = query.from === undefined ? null : new Date(query.from)
    const to = query.to === undefined ? null : new Date(query.to)
    const pattern = nameSearchPattern(query.q)
    const cursor = query.cursor ?? null

    // 한 줄 더 읽어 「다음이 있는가」를 답한다. 세어 보는 것보다 싸고, 세는 순간
    // 그 수는 이미 낡는다.
    const rows = await this.prisma.$queryRaw<ListRow[]>`
      SELECT so."id",
             so."status"::text AS "status",
             so."paidAmount",
             so."trackingNumber",
             o."orderNumber",
             o."createdAt" AS "orderedAt",
             o."recipientName",
             agg."itemCount",
             agg."totalQuantity",
             lead."productName",
             lead."thumbnailUrl"
        FROM "SellerOrder" so
        JOIN "Order" o ON o."id" = so."orderId"
        LEFT JOIN LATERAL (
          SELECT count(*)::int AS "itemCount",
                 COALESCE(sum("quantity"), 0)::int AS "totalQuantity"
            FROM "OrderItem"
           WHERE "sellerOrderId" = so."id"
        ) agg ON true
        LEFT JOIN LATERAL (
          SELECT "productSnapshot"->>'productName' AS "productName",
                 "productSnapshot"->>'thumbnailUrl' AS "thumbnailUrl"
            FROM "OrderItem"
           WHERE "sellerOrderId" = so."id"
           ORDER BY "id"
           LIMIT 1
        ) lead ON true
       WHERE so."sellerId" = ${sellerId}::uuid
         AND (${statuses}::text[] IS NULL OR so."status"::text = ANY (${statuses}::text[]))
         AND (${from}::timestamptz IS NULL OR o."createdAt" >= ${from}::timestamptz)
         AND (${to}::timestamptz IS NULL OR o."createdAt" <= ${to}::timestamptz)
         AND (${pattern}::text IS NULL
              OR o."orderNumber" ILIKE ${pattern}::text ESCAPE '\\'
              OR o."recipientName" ILIKE ${pattern}::text ESCAPE '\\')
         AND (${cursor}::uuid IS NULL OR so."id" < ${cursor}::uuid)
       ORDER BY so."id" DESC
       LIMIT ${limit + 1}::int
    `
    const page = rows.slice(0, limit)

    return {
      sellerOrders: page.map((row) => toItem(row)),
      nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
    }
  }

  /**
   * 상태별 건수와 그 위의 두 뱃지 (2장).
   *
   * **필터를 받지 않는다.** 뱃지가 답하는 것은 「내 가게에 처리할 것이 몇 건인가」이지
   * 「지금 보고 있는 목록에 몇 건인가」가 아니다. 필터를 받으면 탭을 옮길 때마다
   * 뱃지가 흔들리고, 그것은 사이드바에 그릴 수 없는 숫자가 된다.
   */
  async summary(principal: RequestPrincipal): Promise<SellerOrderSummaryResponse> {
    const sellerId = this.ownStore(principal)
    const rows = await this.prisma.$queryRaw<SellerOrderStatusCount[]>`
      SELECT "status"::text AS "status", count(*)::int AS "count"
        FROM "SellerOrder"
       WHERE "sellerId" = ${sellerId}::uuid
       GROUP BY "status"
    `

    return { summary: sellerOrderSummaryOf(rows) }
  }

  /**
   * 부르는 사람의 스토어, 아니면 403.
   *
   * `out_of_scope` 이지 `missing_permission` 이 아니다 — 퍼미션은 있는데 **그것을
   * 걸 스토어가 없는** 상태이고, 콘솔 라우트를 부른 운영자가 정확히 거기 있다
   * (`SellerProductService.ownStore` 와 같은 판단이다). 「전체 판매자의 주문
   * 목록」이 필요하면 그것은 관리자 화면이고 다른 라우트다.
   */
  private ownStore(principal: RequestPrincipal): string {
    if (principal.sellerId === null) throw accessDenied('order.read', 'out_of_scope')

    return principal.sellerId
  }
}

/** 행을 계약의 모양으로. **이름을 가리는 자리가 여기다** — 응답을 만드는 곳. */
function toItem(row: ListRow): SellerOrderListItem {
  return {
    id: row.id,
    orderNumber: row.orderNumber,
    orderedAt: row.orderedAt.toISOString(),
    status: row.status,
    headline: sellerOrderHeadline(row.productName === null ? [] : [row.productName]),
    itemCount: row.itemCount,
    totalQuantity: row.totalQuantity,
    paidAmount: row.paidAmount,
    maskedRecipientName: maskRecipientName(row.recipientName),
    thumbnailUrl: row.thumbnailUrl,
    trackingNumber: row.trackingNumber,
  }
}
