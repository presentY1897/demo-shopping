import { randomUUID } from 'node:crypto'

import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import type {
  Checkout,
  CheckoutResponse,
  CreateCheckoutRequest,
  PricingDiscount,
} from '@shopping/shared'

import { assertResourceAccess } from '../auth/access-denied.js'
import type { AccountRow } from '../auth/resource-ownership.js'
import { accountOwnership, accountOwnershipSelect } from '../auth/resource-ownership.js'
import type { RequestPrincipal } from '../auth/request-principal.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { ReservationService } from '../reservation/reservation.service.js'
import type { CartLineRow } from './order-lines.js'
import { assertOrderable, policiesOf, toLine, VARIANT_LINE_SELECT } from './order-lines.js'
import type { OrderSource } from './order-source.js'
import { priceOf } from './order-source.js'

/**
 * 주문서 (TASK-0050 4.1).
 *
 * **표가 아니다.** 주문서 하나는 곧 같은 `checkoutId` 를 가진 `HELD` 예약들이고,
 * 화면이 그려야 하는 나머지 — 상품명 · 옵션 · 사진 · 브랜드 · 가격 — 는 그 예약이
 * 가리키는 `ProductVariant` 에서 따라간다. 표를 하나 더 만들면 같은 사실이 두 곳에
 * 살고, 갈리는 날 어느 쪽이 맞는지 아무도 모른다.
 *
 * 그래서 이 서비스에는 스키마 변경이 없다. 여는 일은 예약을 잡는 일이고, 읽는 일은
 * 그 예약을 다시 그리는 일이며, 닫는 일은 푸는 일이다.
 *
 * **여는 것은 장바구니의 「주문하기」다.** 주문서 화면이 진입과 동시에 열면
 * 새로고침 한 번에 예약이 한 벌 더 잡힌다. 화면은 이미 열린 것을 id 로 읽는다.
 */
@Injectable()
export class CheckoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reservations: ReservationService,
  ) {}

  /**
   * 고른 장바구니 줄로 주문서를 연다 — 즉 재고를 잡는다.
   *
   * 한 트랜잭션이다. 셋 중 마지막이 품절이면 앞의 둘도 없던 일이 되어야 하고,
   * 트랜잭션 안에서 잡으면 그것이 롤백으로 공짜가 된다.
   */
  async open(
    principal: RequestPrincipal,
    input: CreateCheckoutRequest,
    discounts: readonly PricingDiscount[] = [],
  ): Promise<CheckoutResponse> {
    const account = await this.account(principal, 'order.write')
    const rows = await this.orderableLines(account.id, input.itemIds)
    const checkoutId = randomUUID()

    await this.prisma.$transaction(async (tx) => {
      for (const row of rows) {
        await this.reservations.reserve(tx, {
          variantId: row.variant.id,
          quantity: row.quantity,
          userId: account.id,
          checkoutId,
        })
      }
    })

    return this.read(principal, checkoutId, discounts)
  }

  /** 열려 있는 주문서 하나. 만료됐거나 풀렸으면 없는 것으로 답한다. */
  async read(
    principal: RequestPrincipal,
    checkoutId: string,
    discounts: readonly PricingDiscount[] = [],
  ): Promise<CheckoutResponse> {
    const account = await this.account(principal, 'order.read')
    const source = await this.linesOf(account.id, checkoutId)

    return { checkout: present(checkoutId, source, discounts) }
  }

  /**
   * 이탈. 이 시도의 예약 전부를 푼다.
   *
   * 이미 풀렸어도 성공이다 — 부르는 쪽은 페이지를 떠나는 중이고, 「이미 풀렸다」에
   * 대해 할 수 있는 일이 없다. 확정된 것은 `releaseCheckout` 이 건드리지 않는다.
   */
  async close(principal: RequestPrincipal, checkoutId: string): Promise<{ released: number }> {
    const account = await this.account(principal, 'order.write')

    await this.assertOwner(account, checkoutId)

    return { released: await this.reservations.releaseCheckout(checkoutId) }
  }

  /**
   * 이 주문서의 줄들 — 예약에서 되짚어 만든다.
   *
   * `OrderService` 도 이것을 부른다. 주문이 저장하는 줄과 주문서가 보여 주는 줄이
   * **같은 함수에서 나와야** 「보여 준 것과 산 것이 다르다」가 표현 불가능해진다.
   */
  async linesOf(userId: string, checkoutId: string): Promise<OrderSource> {
    const holds = await this.prisma.stockReservation.findMany({
      where: { checkoutId, status: 'HELD' },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        userId: true,
        quantity: true,
        expiresAt: true,
        variant: { select: VARIANT_LINE_SELECT },
      },
    })

    if (holds.length === 0) throw new NotFoundException('주문서를 찾을 수 없어요.')

    const owner = holds[0]?.userId

    if (owner !== userId) throw new ForbiddenException('다른 사람의 주문서예요.')

    const rows: CartLineRow[] = holds.map((hold) => ({
      // 예약 id 가 이 계산 안에서 줄을 가리키는 이름이다. 장바구니 줄은 그 사이에
      // 지워졌을 수 있고, 지워졌다고 해서 이미 잡아 둔 재고가 사라지지는 않는다.
      id: hold.id,
      quantity: hold.quantity,
      variant: hold.variant,
    }))

    for (const row of rows) assertOrderable(row)

    return {
      lines: rows.map((row) => toLine(row)),
      policies: policiesOf(rows),
      checkoutId,
      // 함께 만들어졌으므로 전부 같다. 가장 이른 것을 고르는 것은 그래도 옳다 —
      // 언젠가 연장이 붙으면 「가장 먼저 풀리는 것」이 화면이 보여 줄 시각이다.
      expiresAt: holds.reduce(
        (earliest, hold) => (hold.expiresAt < earliest ? hold.expiresAt : earliest),
        holds[0]?.expiresAt ?? new Date(0),
      ),
    }
  }

  // ---------------------------------------------------------------- internals

  private async account(
    principal: RequestPrincipal,
    permission: 'order.read' | 'order.write',
  ): Promise<AccountRow> {
    const account = await this.prisma.user.findFirst({
      where: { id: principal.userId, deletedAt: null },
      select: accountOwnershipSelect,
    })

    if (account === null) throw new NotFoundException('계정을 찾을 수 없어요.')

    assertResourceAccess(principal, permission, accountOwnership(account))

    return account
  }

  /** 이 주문서가 이 계정의 것인가. 닫기는 줄을 다시 그릴 필요가 없다. */
  private async assertOwner(account: AccountRow, checkoutId: string): Promise<void> {
    const held = await this.prisma.stockReservation.findFirst({
      where: { checkoutId },
      select: { userId: true },
    })

    if (held === null) throw new NotFoundException('주문서를 찾을 수 없어요.')
    if (held.userId !== account.id) throw new ForbiddenException('다른 사람의 주문서예요.')
  }

  /** 담긴 것이 지금도 팔 수 있는가 (`OrderService` 와 같은 규칙). */
  private async orderableLines(
    userId: string,
    itemIds: readonly string[],
  ): Promise<readonly CartLineRow[]> {
    const rows = await this.prisma.cartItem.findMany({
      where: { id: { in: [...itemIds] }, cart: { userId } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, quantity: true, variant: { select: VARIANT_LINE_SELECT } },
    })

    if (rows.length !== itemIds.length) {
      throw new NotFoundException('장바구니에서 사라진 상품이 있어요.')
    }

    for (const row of rows) assertOrderable(row)

    return rows
  }
}

/** 계산 엔진의 답을 화면이 읽는 모양으로. 주문이 저장할 모양과 같다. */
function present(
  checkoutId: string,
  source: OrderSource,
  discounts: readonly PricingDiscount[],
): Checkout {
  const priced = priceOf(source, discounts)
  const bySeller = new Map(priced.sellerOrders.map((entry) => [entry.sellerId, entry]))
  const amounts = new Map(priced.items.map((item) => [item.itemId, item]))
  const groups = new Map<
    string,
    { brandName: string; items: Checkout['sellerOrders'][number]['items'] }
  >()

  for (const line of source.lines) {
    const amount = amounts.get(line.itemId)

    if (amount === undefined) throw new Error(`계산 결과에 없는 주문서 줄입니다: ${line.itemId}`)

    const item = {
      variantId: line.variantId,
      snapshot: line.snapshot,
      unitPrice: line.unitPrice,
      quantity: line.quantity,
      productAmount: amount.productAmount,
      couponDiscountAmount: amount.couponDiscountAmount,
      pointDiscountAmount: amount.pointDiscountAmount,
      discountAmount: amount.discountAmount,
    }
    const held = groups.get(line.sellerId)

    if (held === undefined) {
      groups.set(line.sellerId, { brandName: line.brandName, items: [item] })
      continue
    }

    held.items.push(item)
  }

  return {
    id: checkoutId,
    expiresAt: (source.expiresAt ?? new Date(0)).toISOString(),
    sellerOrders: [...groups].map(([sellerId, group]) => {
      const totals = bySeller.get(sellerId)

      if (totals === undefined) throw new Error(`계산 결과에 없는 판매자입니다: ${sellerId}`)

      return {
        sellerId,
        brandName: group.brandName,
        items: group.items,
        productAmount: totals.productAmount,
        couponDiscountAmount: totals.couponDiscountAmount,
        pointDiscountAmount: totals.pointDiscountAmount,
        shippingPointAmount: totals.shippingPointAmount,
        shippingFee: totals.shippingFee,
        paidAmount: totals.paidAmount,
      }
    }),
    totalProductAmount: priced.totalProductAmount,
    totalCouponDiscountAmount: priced.totalCouponDiscountAmount,
    totalPointDiscountAmount: priced.totalPointDiscountAmount,
    totalShippingFee: priced.totalShippingFee,
    paidAmount: priced.paidAmount,
  }
}
