import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import type {
  AdminOrderPaymentsResponse,
  AdminOrderRow,
  AdminOrderSearchQueryParams,
  AdminOrderSearchResponse,
  HideProductRequest,
  ProductModerationResponse,
} from '@shopping/shared'
import { ADMIN_LIST_DEFAULT_LIMIT, grantedScopes } from '@shopping/shared'

import { accessDenied } from '../auth/access-denied.js'
import { domainFailure } from '../common/domain-failure.js'
import { accountOwnership, accountOwnershipSelect } from '../auth/resource-ownership.js'
import { assertResourceAccess } from '../auth/access-denied.js'
import type { RequestPrincipal } from '../auth/request-principal.js'
import type { Clock } from '../common/clock.js'
import { CLOCK } from '../common/clock.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { SearchOutboxService } from '../search/search-outbox.service.js'
import { maskName } from './personal-data.js'

interface OrderRow {
  readonly orderId: string
  readonly orderNumber: string
  readonly buyerName: string
  readonly paidAmount: number
  readonly createdAt: Date
}

/**
 * 전체 상품 · 주문 조회 (TASK-0095).
 *
 * ## 목록은 이미 있다
 *
 * `GET /products` 가 `product.read:any` 를 든 사람에게 이미 모든 스토어의 상품을
 * 답한다 (F1). 여기 있는 것은 **관리자만 하는 일** — 강제로 내리기와, 주문을
 * 사람·스토어·기간으로 가로질러 찾기다.
 *
 * ## 주문 상태를 직접 바꾸는 문은 없다 (F7)
 *
 * 일부러 없다. 상태를 손으로 옮기면 재고·정산·환불이 따라오지 않고, 그 어긋남은
 * 몇 단계 뒤에 「정산 금액이 이상하다」로 나타난다 — 원인과 증상이 멀어서 아무도 그
 * 둘을 잇지 못한다. 관리자가 결과를 바꿔야 하면 클레임 개입으로 간다 (TASK-0071).
 */
@Injectable()
export class AdminCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: SearchOutboxService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private assertPlatformRead(
    principal: RequestPrincipal,
    permission: 'product.read' | 'order.read',
  ): void {
    if (!grantedScopes(principal, permission).includes('any')) {
      throw accessDenied(permission, 'out_of_scope')
    }
  }

  /**
   * 상품을 내린다 (F2 · F3).
   *
   * **판매를 멈추는 것이 가리는 것이다** — 신고 처리가 이미 같은 판단을 했다
   * (`report.service.ts`). 그리고 색인에서도 빠져야 한다: 목록에서 사라졌는데
   * 검색으로는 나오면 그것은 안 가려진 것이다.
   */
  async hide(
    principal: RequestPrincipal,
    productId: string,
    request: HideProductRequest,
  ): Promise<ProductModerationResponse> {
    return this.moderate(principal, productId, request.reason)
  }

  async unhide(principal: RequestPrincipal, productId: string): Promise<ProductModerationResponse> {
    return this.moderate(principal, productId, null)
  }

  private async moderate(
    principal: RequestPrincipal,
    productId: string,
    reason: string | null,
  ): Promise<ProductModerationResponse> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, deletedAt: null },
      // 소유 판정에 필요한 칸은 **매퍼가 정한다** — 여기서 컬럼 이름을 적으면
      // 데모 판정이 서비스마다 퍼지고, 다음 서비스가 잊는 순간 구멍이 된다
      // (`demo-containment.spec.ts`).
      select: {
        id: true,
        status: true,
        seller: { select: { user: { select: accountOwnershipSelect } } },
      },
    })

    if (product === null) throw new NotFoundException('상품을 찾을 수 없습니다.')

    // **데모 관리자는 실계정의 상품을 내리지 못한다** (F8 · D-058). 스코프가
    // `demo` 로 좁혀져 있고, 그 판정은 대상의 주인이 데모인가로 한다 — 신고 처리가
    // 같은 장치를 쓴다 (`report.service.ts` 의 `assertMayModerate`).
    assertResourceAccess(principal, 'catalog.write', accountOwnership(product.seller.user))

    // **판매 중인 것만 내리고, 내려진 것만 올린다** — `report.service.ts` 가 같은
    // 판단을 먼저 했다. 초안을 `ACTIVE` 로 올리면 값이 없는 상품이 판매 중이 되어
    // `Product_active_price_check` 에 걸리고, 그 500 은 관리자에게 아무 뜻도 없다.
    //
    // 조용히 넘어가지 않고 답하는 이유는, 아무 일도 안 일어났는데 「내렸다」를 받은
    // 관리자가 그 상품을 다시 보러 오지 않기 때문이다.
    const expected = reason === null ? 'SUSPENDED' : 'ACTIVE'

    if (product.status !== expected) {
      throw new ConflictException(
        domainFailure(
          'PRODUCT_NOT_MODERATABLE',
          reason === null
            ? '내려져 있는 상품만 다시 올릴 수 있어요.'
            : '판매 중인 상품만 내릴 수 있어요.',
        ),
      )
    }

    const now = this.clock.now()

    await this.prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id: productId },
        data:
          reason === null
            ? {
                status: 'ACTIVE',
                moderatedAt: null,
                moderationReason: null,
                moderatedById: null,
                updatedAt: now,
              }
            : {
                status: 'SUSPENDED',
                moderatedAt: now,
                moderationReason: reason,
                moderatedById: principal.userId,
                updatedAt: now,
              },
      })

      // 색인도 따라간다. 안 하면 목록에는 없는 상품이 검색에는 남는다.
      await this.outbox.publish(tx, productId, reason === null ? 'UPSERT' : 'REMOVE')
    })

    const after = await this.prisma.product.findUniqueOrThrow({
      where: { id: productId },
      select: { id: true, status: true, moderatedAt: true, moderationReason: true },
    })

    return {
      product: {
        productId: after.id,
        hidden: after.status === 'SUSPENDED',
        moderatedAt: after.moderatedAt?.toISOString() ?? null,
        moderationReason: after.moderationReason,
      },
    }
  }

  /**
   * 주문을 가로질러 찾는다 (F4 · F5).
   *
   * **판매자별 묶음을 전부 싣는다.** 하나만 보이면 다중 판매자 주문의 절반이 화면에서
   * 사라지고, CS 는 「그 주문 맞는데 그 상품이 없다」를 보게 된다.
   */
  async searchOrders(
    principal: RequestPrincipal,
    params: AdminOrderSearchQueryParams,
  ): Promise<AdminOrderSearchResponse> {
    this.assertPlatformRead(principal, 'order.read')

    const limit = params.limit ?? ADMIN_LIST_DEFAULT_LIMIT
    const rows = await this.prisma.$queryRaw<OrderRow[]>`
      SELECT o."id"::text      AS "orderId",
             o."orderNumber"   AS "orderNumber",
             u."name"          AS "buyerName",
             o."paidAmount"    AS "paidAmount",
             o."createdAt"     AS "createdAt"
        FROM "Order" o
        JOIN "User" u ON u."id" = o."userId"
       WHERE (${params.orderNumber ?? null}::text IS NULL
              OR o."orderNumber" = ${params.orderNumber ?? null})
         AND (${params.buyerId ?? null}::uuid IS NULL OR o."userId" = ${params.buyerId ?? null}::uuid)
         AND (${params.sellerId ?? null}::uuid IS NULL OR EXISTS (
               SELECT 1 FROM "SellerOrder" so
                WHERE so."orderId" = o."id" AND so."sellerId" = ${params.sellerId ?? null}::uuid))
         AND (${params.from ?? null}::date IS NULL
              OR (o."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date >= ${params.from ?? null}::date)
         AND (${params.to ?? null}::date IS NULL
              OR (o."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date <= ${params.to ?? null}::date)
         AND (${params.cursor ?? null}::text IS NULL OR o."id"::text < ${params.cursor ?? null})
       ORDER BY o."id" DESC
       LIMIT ${limit + 1}`

    const page = rows.slice(0, limit)
    const bundles = await this.bundlesOf(page.map((row) => row.orderId))

    return {
      orders: page.map((row) => ({
        orderId: row.orderId,
        orderNumber: row.orderNumber,
        // 훑어보는 화면이라 산 사람은 가려서 나간다 (TASK-0093 F6 과 같은 판단).
        maskedBuyerName: maskName(row.buyerName),
        paidAmount: row.paidAmount,
        createdAt: row.createdAt.toISOString(),
        sellerOrders: bundles.get(row.orderId) ?? [],
      })),
      nextCursor: rows.length > limit ? (page.at(-1)?.orderId ?? null) : null,
    }
  }

  /** 묶음을 **한 번에** 읽는다. 주문마다 물으면 스무 줄이 스물한 번이 된다 (A5). */
  private async bundlesOf(
    orderIds: readonly string[],
  ): Promise<Map<string, AdminOrderRow['sellerOrders'][number][]>> {
    if (orderIds.length === 0) return new Map()

    const rows = await this.prisma.sellerOrder.findMany({
      where: { orderId: { in: [...orderIds] } },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        orderId: true,
        sellerId: true,
        brandName: true,
        status: true,
        paidAmount: true,
      },
    })
    const grouped = new Map<string, AdminOrderRow['sellerOrders'][number][]>()

    for (const row of rows) {
      const bundle = grouped.get(row.orderId) ?? []

      bundle.push({
        sellerOrderId: row.id,
        sellerId: row.sellerId,
        brandName: row.brandName,
        status: row.status,
        paidAmount: row.paidAmount,
      })
      grouped.set(row.orderId, bundle)
    }

    return grouped
  }

  /** 결제와 환불 (F6). 「돈이 어떻게 움직였나」에 한 화면에서 답한다. */
  async payments(
    principal: RequestPrincipal,
    orderId: string,
  ): Promise<AdminOrderPaymentsResponse> {
    this.assertPlatformRead(principal, 'order.read')

    const payments = await this.prisma.payment.findMany({
      where: { orderId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        provider: true,
        status: true,
        authorizedAmount: true,
        canceledAmount: true,
        approvedAt: true,
        createdAt: true,
      },
    })

    return {
      payments: payments.map((payment) => ({
        paymentId: payment.id,
        provider: payment.provider,
        status: payment.status,
        // 승인된 금액이 그 결제가 실제로 잡은 돈이다.
        amount: payment.authorizedAmount,
        canceledAmount: payment.canceledAmount,
        approvedAt: payment.approvedAt?.toISOString() ?? null,
        createdAt: payment.createdAt.toISOString(),
      })),
      // 취소된 몫의 합. 결제가 여럿일 수 있으므로(재시도·부분 취소) 줄마다 더한다.
      refundedAmount: payments.reduce((total, payment) => total + payment.canceledAmount, 0),
    }
  }
}
