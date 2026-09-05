import { randomBytes, randomUUID } from 'node:crypto'

import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import type {
  CreateOrderRequest,
  Order,
  OrderItemSnapshot,
  OrderListQuery,
  OrderListResponse,
  OrderResponse,
  OrderStatus,
  PricingDiscount,
  SellerOrder,
  SellerOrderResponse,
  ShippingPolicy,
} from '@shopping/shared'
import { calculateOrder, ORDER_LIST_DEFAULT_LIMIT } from '@shopping/shared'

import { assertResourceAccess } from '../auth/access-denied.js'
import type { AccountRow } from '../auth/resource-ownership.js'
import {
  accountOwnership,
  accountOwnershipSelect,
  sellerOwnership,
  sellerOwnershipSelect,
} from '../auth/resource-ownership.js'
import type { RequestPrincipal } from '../auth/request-principal.js'
import { resolvePurchaseLimit } from '../catalog/variant-rules.js'
import type { Clock } from '../common/clock.js'
import { CLOCK } from '../common/clock.js'
import { domainFailure } from '../common/domain-failure.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { ReservationService } from '../reservation/reservation.service.js'
import { ORDER_NUMBER_SUFFIX_LENGTH, orderNumberOf } from './order-number.js'
import type { OrderLine, PlannedSellerOrder } from './order-plan.js'
import { planOrder } from './order-plan.js'

type Tx = Prisma.TransactionClient

/** 유니크 위반. 주문번호가 겹쳤을 때만 본다. */
const UNIQUE_VIOLATION = 'P2002'

/** 장바구니에서 읽어 온 주문될 줄 하나. */
interface CartLineRow {
  readonly id: string
  readonly quantity: number
  readonly variant: {
    readonly id: string
    readonly sku: string
    readonly price: number
    readonly isActive: boolean
    readonly deletedAt: Date | null
    readonly sellerId: string
    readonly maxPurchaseQuantity: number | null
    readonly optionValues: readonly {
      readonly optionValue: { readonly value: string; readonly optionId: string }
    }[]
    readonly product: {
      readonly id: string
      readonly name: string
      readonly status: string
      readonly deletedAt: Date | null
      readonly maxPurchaseQuantity: number | null
      readonly images: readonly { readonly url: string }[]
      readonly options: readonly { readonly id: string; readonly sortOrder: number }[]
      readonly seller: {
        readonly id: string
        readonly brandName: string
        readonly shippingFee: number
        readonly freeShippingThreshold: number | null
      }
    }
  }
}

/**
 * 주문 생성과 조회 (TASK-0049).
 *
 * **2단이다** (D-023). `Order` 는 결제 단위이고 `SellerOrder` 는 배송·취소·정산의
 * 단위다. 여러 판매자의 물건이 한 주문에 섞이지만 결제는 한 번이고, 상태는 판매자
 * 몫마다 따로 움직인다.
 *
 * 만드는 일이 한 트랜잭션인 이유는 **재고 예약 때문**이다. 세 줄을 주문하다 마지막
 * 줄이 품절이면 앞의 두 예약도 없던 일이 되어야 한다(F5). 트랜잭션 안에서 예약하면
 * 그것이 롤백으로 공짜가 된다 — 예약을 밖에서 잡고 실패 시 보상하는 모양은, 보상이
 * 실패하는 경우를 또 다뤄야 한다.
 *
 * **재고는 한 개도 줄지 않는다** (4.4). 주문은 `PAYMENT_PENDING` 으로 생기고 예약은
 * `HELD` 로 남는다. 확정은 결제 승인(M08)의 일이고, 결제가 오지 않으면 TASK-0051 이
 * TTL 만료로 푼다. 이상해 보이지만 그것이 D-026 의 구조다 — 판 것이 아니라 잡아 둔
 * 것이다.
 */
@Injectable()
export class OrderService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly reservations: ReservationService,
  ) {}

  // ------------------------------------------------------------------ writes

  /**
   * 장바구니에서 고른 줄로 주문 하나를 만든다.
   *
   * `discounts` 를 인자로 받는 이유는 4.2 다. 쿠폰도 적립금도 M11 이라 컨트롤러는
   * 오늘 빈 배열을 넘기지만, **안분해서 저장하는 경로는 지금 만들어 둔다** — 나중에
   * 붙이면 그때 `OrderItem` 에 컬럼을 더하고 저장 코드를 고쳐야 하고, 그 시점에는
   * 이미 저장된 주문들이 그 값을 갖지 않는다.
   */
  async create(
    principal: RequestPrincipal,
    input: CreateOrderRequest,
    discounts: readonly PricingDiscount[] = [],
  ): Promise<OrderResponse> {
    const account = await this.account(principal, 'order.write')
    const recipient = await this.recipientOf(account.id, input.addressId)
    const rows = await this.orderableLines(account.id, input.itemIds)
    const lines = rows.map((row) => toLine(row))
    const policies = policiesOf(rows)
    const priced = calculateOrder({
      items: lines.map((line) => ({
        itemId: line.itemId,
        sellerId: line.sellerId,
        unitPrice: line.unitPrice,
        quantity: line.quantity,
      })),
      discounts,
      shippingPolicies: policies,
    })
    const plan = planOrder(lines, priced)
    const orderId = await this.store(account.id, recipient, plan)

    return this.get(principal, orderId)
  }

  /**
   * 예약하고 저장한다. 주문번호가 겹치면 **전부 다시 한다.**
   *
   * 다시 하는 단위가 트랜잭션 전체인 것이 중요하다. Postgres 는 트랜잭션 안의 한
   * 문장이 실패하면 그 트랜잭션을 통째로 중단시키므로(TASK-0045 가 장바구니에서
   * 겪었다), 유니크 위반을 안에서 잡아 다른 번호로 다시 쓰는 것은 불가능하다.
   * 롤백된 트랜잭션은 예약도 함께 되돌리므로 재시도가 안전하다.
   *
   * 한 번만 다시 한다. 40비트 난수가 같은 날 두 번 연달아 겹칠 확률은 이미 없는
   * 일이고, 무한히 다시 하는 고리는 **다른 이유로 실패할 때** 영원히 돈다.
   */
  private async store(
    userId: string,
    recipient: Recipient,
    plan: ReturnType<typeof planOrder>,
  ): Promise<string> {
    try {
      return await this.write(userId, recipient, plan)
    } catch (error: unknown) {
      if (!isOrderNumberCollision(error)) throw error

      return this.write(userId, recipient, plan)
    }
  }

  private write(
    userId: string,
    recipient: Recipient,
    plan: ReturnType<typeof planOrder>,
  ): Promise<string> {
    const now = this.clock.now()
    const checkoutId = randomUUID()

    return this.prisma.$transaction(async (tx) => {
      // 예약이 먼저다. 저장한 뒤에 잡으면 품절일 때 지울 것이 생기고, 그 지우는
      // 일이 실패하는 경우를 또 다뤄야 한다.
      for (const sellerOrder of plan.sellerOrders) {
        for (const item of sellerOrder.items) {
          await this.reservations.reserve(tx, {
            variantId: item.line.variantId,
            quantity: item.line.quantity,
            userId,
            checkoutId,
          })
        }
      }

      const order = await tx.order.create({
        data: {
          orderNumber: orderNumberOf(now, randomBytes(ORDER_NUMBER_SUFFIX_LENGTH)),
          userId,
          checkoutId,
          recipientName: recipient.name,
          recipientPhone: recipient.phone,
          postalCode: recipient.postalCode,
          addressLine1: recipient.addressLine1,
          addressLine2: recipient.addressLine2,
          totalProductAmount: plan.totalProductAmount,
          totalCouponDiscountAmount: plan.totalCouponDiscountAmount,
          totalPointDiscountAmount: plan.totalPointDiscountAmount,
          totalShippingFee: plan.totalShippingFee,
          paidAmount: plan.paidAmount,
          createdAt: now,
          updatedAt: now,
        },
        select: { id: true },
      })

      for (const group of plan.sellerOrders) {
        await this.writeSellerOrder(tx, order.id, group, now)
      }

      return order.id
    })
  }

  /** 한 판매자 몫과 그 항목들, 그리고 상태 이력의 첫 줄. */
  private async writeSellerOrder(
    tx: Tx,
    orderId: string,
    group: PlannedSellerOrder,
    now: Date,
  ): Promise<void> {
    const sellerOrder = await tx.sellerOrder.create({
      data: {
        orderId,
        sellerId: group.sellerId,
        brandName: group.brandName,
        productAmount: group.productAmount,
        couponDiscountAmount: group.couponDiscountAmount,
        pointDiscountAmount: group.pointDiscountAmount,
        shippingPointAmount: group.shippingPointAmount,
        shippingFee: group.shippingFee,
        paidAmount: group.paidAmount,
        createdAt: now,
        updatedAt: now,
      },
      select: { id: true },
    })

    await tx.orderItem.createMany({
      data: group.items.map((item) => ({
        sellerOrderId: sellerOrder.id,
        variantId: item.line.variantId,
        // `OrderItemSnapshot` 은 평범한 객체이고 Prisma 의 JSON 입력 타입과 구조가
        // 같다. 단언 없이 그대로 넘어간다.
        productSnapshot: { ...item.line.snapshot },
        unitPrice: item.line.unitPrice,
        quantity: item.line.quantity,
        productAmount: item.productAmount,
        couponDiscountAmount: item.couponDiscountAmount,
        pointDiscountAmount: item.pointDiscountAmount,
        discountAmount: item.discountAmount,
        createdAt: now,
        updatedAt: now,
      })),
    })

    // 첫 줄의 `fromStatus` 는 `null` 이다 — 이전 상태가 없다. 생성도 이력에
    // 남기는 이유는, 남기지 않으면 「이 주문이 언제 생겼나」의 답이 이력에 없고
    // `createdAt` 에만 있게 되기 때문이다. 두 곳에 있는 사실은 갈라진다.
    await tx.orderStatusHistory.create({
      data: {
        sellerOrderId: sellerOrder.id,
        fromStatus: null,
        toStatus: 'PAYMENT_PENDING',
        actorId: null,
        createdAt: now,
      },
    })
  }

  // ------------------------------------------------------------------- reads

  /** 주문 하나. 구매자 자신과 운영자가 읽는다. */
  async get(principal: RequestPrincipal, orderId: string): Promise<OrderResponse> {
    const row = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { ...ORDER_SELECT, user: { select: accountOwnershipSelect } },
    })

    if (row === null) throw new NotFoundException('주문을 찾을 수 없어요.')

    assertResourceAccess(principal, 'order.read', accountOwnership(row.user))

    return { order: present(row) }
  }

  /** 내 주문 목록. 최신순, 커서 페이지네이션. */
  async list(principal: RequestPrincipal, query: OrderListQuery): Promise<OrderListResponse> {
    const account = await this.account(principal, 'order.read')
    const limit = query.limit ?? ORDER_LIST_DEFAULT_LIMIT
    const rows = await this.prisma.order.findMany({
      where: {
        userId: account.id,
        ...(query.cursor === undefined ? {} : { id: { lt: query.cursor } }),
      },
      // id 가 UUIDv7 이라 시간순이다. `createdAt` 으로 정렬하면 같은 밀리초의 두
      // 주문에서 커서가 한 건을 건너뛰거나 두 번 보여 준다.
      orderBy: { id: 'desc' },
      take: limit + 1,
      select: SUMMARY_SELECT,
    })
    const page = rows.slice(0, limit)

    return {
      orders: page.map((row) => summarise(row)),
      nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
    }
  }

  /**
   * 판매자가 읽는 자기 몫 하나 (F6).
   *
   * 주문 상세를 걸러서 주지 않는 이유는 합계 때문이다 — 주문 단위 금액에는 남의
   * 몫이 섞여 있고, 다시 계산해서 주면 그 숫자는 아무 데도 저장된 적이 없다.
   */
  async sellerOrder(principal: RequestPrincipal, id: string): Promise<SellerOrderResponse> {
    const row = await this.prisma.sellerOrder.findUnique({
      where: { id },
      select: {
        ...SELLER_ORDER_SELECT,
        seller: { select: sellerOwnershipSelect },
        order: {
          select: {
            orderNumber: true,
            createdAt: true,
            recipientName: true,
            recipientPhone: true,
            postalCode: true,
            addressLine1: true,
            addressLine2: true,
          },
        },
      },
    })

    if (row === null) throw new NotFoundException('주문을 찾을 수 없어요.')

    assertResourceAccess(principal, 'order.read', sellerOwnership(row.seller))

    return {
      sellerOrder: presentSellerOrder(row),
      orderNumber: row.order.orderNumber,
      orderedAt: row.order.createdAt.toISOString(),
      recipient: {
        name: row.order.recipientName,
        phone: row.order.recipientPhone,
        postalCode: row.order.postalCode,
        addressLine1: row.order.addressLine1,
        addressLine2: row.order.addressLine2,
      },
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

  /** 배송지에서 복사한다. 가리키지 않는다 (4.6). */
  private async recipientOf(userId: string, addressId: string): Promise<Recipient> {
    const address = await this.prisma.address.findFirst({
      // `userId` 를 조건에 함께 두는 것이 소유권 검사다. 남의 배송지 id 를 보내면
      // 「없다」로 답한다 — 있는지 없는지를 알려 주지 않는 것이 옳다.
      where: { id: addressId, userId },
      select: {
        recipientName: true,
        phone: true,
        postalCode: true,
        addressLine1: true,
        addressLine2: true,
      },
    })

    if (address === null) {
      throw new BadRequestException(
        domainFailure('ORDER_ADDRESS_MISSING', '배송지를 찾을 수 없어요.', {
          field: 'addressId',
        }),
      )
    }

    return {
      name: address.recipientName,
      phone: address.phone,
      postalCode: address.postalCode,
      addressLine1: address.addressLine1,
      addressLine2: address.addressLine2,
    }
  }

  /**
   * 주문할 줄을 한 질의로 읽고, 팔 수 있는지까지 본다 (A5 · F9).
   *
   * 요청한 줄 수와 읽힌 줄 수가 다르면 거절한다. **일부만 주문하고 넘어가지
   * 않는다** — 다른 탭에서 지웠거나 이미 주문한 줄일 텐데, 사람이 보고 있는 화면과
   * 다른 것을 사게 되는 쪽이 훨씬 나쁘다.
   */
  private async orderableLines(
    userId: string,
    itemIds: readonly string[],
  ): Promise<readonly CartLineRow[]> {
    const rows = await this.prisma.cartItem.findMany({
      where: { id: { in: [...itemIds] }, cart: { userId } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        quantity: true,
        variant: {
          select: {
            id: true,
            sku: true,
            price: true,
            isActive: true,
            deletedAt: true,
            sellerId: true,
            maxPurchaseQuantity: true,
            optionValues: { select: { optionValue: { select: { value: true, optionId: true } } } },
            product: {
              select: {
                id: true,
                name: true,
                status: true,
                deletedAt: true,
                maxPurchaseQuantity: true,
                images: {
                  orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
                  take: 1,
                  select: { url: true },
                },
                options: { select: { id: true, sortOrder: true } },
                seller: {
                  select: {
                    id: true,
                    brandName: true,
                    shippingFee: true,
                    freeShippingThreshold: true,
                  },
                },
              },
            },
          },
        },
      },
    })

    if (rows.length !== itemIds.length) {
      throw new BadRequestException(
        domainFailure('ORDER_ITEM_MISSING', '장바구니에서 사라진 상품이 있어요.', {
          field: 'itemIds',
        }),
      )
    }

    for (const row of rows) assertOrderable(row)

    return rows
  }
}

/** 수령인 스냅샷, 저장 직전의 모양. */
interface Recipient {
  readonly name: string
  readonly phone: string
  readonly postalCode: string
  readonly addressLine1: string
  readonly addressLine2: string | null
}

/** 팔 수 있는가, 그리고 이 수량이 허용되는가 (F9). */
function assertOrderable(row: CartLineRow): void {
  const { variant } = row

  if (
    variant.deletedAt !== null ||
    !variant.isActive ||
    variant.product.deletedAt !== null ||
    variant.product.status !== 'ACTIVE'
  ) {
    throw new BadRequestException(
      domainFailure('ORDER_ITEM_UNAVAILABLE', '지금은 주문할 수 없는 상품이에요.'),
    )
  }

  const limit = resolvePurchaseLimit(
    variant.product.maxPurchaseQuantity,
    variant.maxPurchaseQuantity,
  )

  if (limit !== null && row.quantity > limit) {
    throw new BadRequestException(
      domainFailure('ORDER_PURCHASE_LIMIT', `1회 ${String(limit)}개까지 구매할 수 있어요.`, {
        field: 'quantity',
        params: { max: limit },
      }),
    )
  }
}

/** 「블랙 / M」. 상품 자신의 축 순서대로다. */
function optionLabelOf(row: CartLineRow): string {
  const order = new Map(row.variant.product.options.map((option) => [option.id, option.sortOrder]))

  return [...row.variant.optionValues]
    .sort(
      (left, right) =>
        (order.get(left.optionValue.optionId) ?? 0) - (order.get(right.optionValue.optionId) ?? 0),
    )
    .map((entry) => entry.optionValue.value)
    .join(' / ')
}

/** 주문한 때의 상품. 여기서 만들어 저장하면 그 뒤로 아무것도 바꾸지 않는다. */
function snapshotOf(row: CartLineRow): OrderItemSnapshot {
  return {
    productId: row.variant.product.id,
    productName: row.variant.product.name,
    optionLabel: optionLabelOf(row),
    sku: row.variant.sku,
    thumbnailUrl: row.variant.product.images[0]?.url ?? null,
    brandName: row.variant.product.seller.brandName,
  }
}

function toLine(row: CartLineRow): OrderLine {
  return {
    itemId: row.id,
    variantId: row.variant.id,
    sellerId: row.variant.sellerId,
    brandName: row.variant.product.seller.brandName,
    unitPrice: row.variant.price,
    quantity: row.quantity,
    snapshot: snapshotOf(row),
  }
}

/**
 * 이 주문에 관련된 판매자들의 배송 정책 (4.1).
 *
 * 판매자마다 한 번씩만 넣는다 — 같은 정책을 두 번 넣으면 계산 엔진이 그 판매자의
 * 배송비를 두 번 붙일지 한 번 붙일지가 구현 세부에 달리게 된다.
 */
function policiesOf(rows: readonly CartLineRow[]): readonly ShippingPolicy[] {
  const policies = new Map<string, ShippingPolicy>()

  for (const row of rows) {
    const { seller } = row.variant.product

    policies.set(seller.id, {
      sellerId: seller.id,
      fee: seller.shippingFee,
      freeThreshold: seller.freeShippingThreshold,
    })
  }

  return [...policies.values()]
}

/** 주문번호가 겹쳤는가. 다른 유니크 위반은 재시도로 고쳐지지 않는다. */
function isOrderNumberCollision(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false

  const failure = error as { code?: unknown; meta?: { target?: unknown } }

  if (failure.code !== UNIQUE_VIOLATION) return false

  const target = failure.meta?.target

  return typeof target === 'string'
    ? target.includes('orderNumber')
    : Array.isArray(target) && target.includes('orderNumber')
}

const ORDER_ITEM_SELECT = {
  id: true,
  variantId: true,
  productSnapshot: true,
  unitPrice: true,
  quantity: true,
  productAmount: true,
  couponDiscountAmount: true,
  pointDiscountAmount: true,
  discountAmount: true,
} as const

const SELLER_ORDER_SELECT = {
  id: true,
  sellerId: true,
  brandName: true,
  status: true,
  productAmount: true,
  couponDiscountAmount: true,
  pointDiscountAmount: true,
  shippingPointAmount: true,
  shippingFee: true,
  paidAmount: true,
  items: { orderBy: { id: 'asc' }, select: ORDER_ITEM_SELECT },
} as const

const ORDER_SELECT = {
  id: true,
  orderNumber: true,
  createdAt: true,
  recipientName: true,
  recipientPhone: true,
  postalCode: true,
  addressLine1: true,
  addressLine2: true,
  totalProductAmount: true,
  totalCouponDiscountAmount: true,
  totalPointDiscountAmount: true,
  totalShippingFee: true,
  paidAmount: true,
  sellerOrders: { orderBy: { id: 'asc' }, select: SELLER_ORDER_SELECT },
} as const

const SUMMARY_SELECT = {
  id: true,
  orderNumber: true,
  createdAt: true,
  paidAmount: true,
  sellerOrders: {
    orderBy: { id: 'asc' },
    select: { status: true, items: { orderBy: { id: 'asc' }, select: { productSnapshot: true } } },
  },
} as const

/** 저장된 JSONB 를 계약의 모양으로. */
function snapshotFrom(value: unknown): OrderItemSnapshot {
  return value as OrderItemSnapshot
}

interface SellerOrderRow {
  readonly id: string
  readonly sellerId: string
  readonly brandName: string
  readonly status: string
  readonly productAmount: number
  readonly couponDiscountAmount: number
  readonly pointDiscountAmount: number
  readonly shippingPointAmount: number
  readonly shippingFee: number
  readonly paidAmount: number
  readonly items: readonly {
    readonly id: string
    readonly variantId: string
    readonly productSnapshot: unknown
    readonly unitPrice: number
    readonly quantity: number
    readonly productAmount: number
    readonly couponDiscountAmount: number
    readonly pointDiscountAmount: number
    readonly discountAmount: number
  }[]
}

function presentSellerOrder(row: SellerOrderRow): SellerOrder {
  return {
    id: row.id,
    sellerId: row.sellerId,
    brandName: row.brandName,
    status: row.status as OrderStatus,
    items: row.items.map((item) => ({
      id: item.id,
      variantId: item.variantId,
      snapshot: snapshotFrom(item.productSnapshot),
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      productAmount: item.productAmount,
      couponDiscountAmount: item.couponDiscountAmount,
      pointDiscountAmount: item.pointDiscountAmount,
      discountAmount: item.discountAmount,
    })),
    productAmount: row.productAmount,
    couponDiscountAmount: row.couponDiscountAmount,
    pointDiscountAmount: row.pointDiscountAmount,
    shippingPointAmount: row.shippingPointAmount,
    shippingFee: row.shippingFee,
    paidAmount: row.paidAmount,
  }
}

function present(row: {
  readonly id: string
  readonly orderNumber: string
  readonly createdAt: Date
  readonly recipientName: string
  readonly recipientPhone: string
  readonly postalCode: string
  readonly addressLine1: string
  readonly addressLine2: string | null
  readonly totalProductAmount: number
  readonly totalCouponDiscountAmount: number
  readonly totalPointDiscountAmount: number
  readonly totalShippingFee: number
  readonly paidAmount: number
  readonly sellerOrders: readonly SellerOrderRow[]
}): Order {
  return {
    id: row.id,
    orderNumber: row.orderNumber,
    createdAt: row.createdAt.toISOString(),
    recipient: {
      name: row.recipientName,
      phone: row.recipientPhone,
      postalCode: row.postalCode,
      addressLine1: row.addressLine1,
      addressLine2: row.addressLine2,
    },
    sellerOrders: row.sellerOrders.map((entry) => presentSellerOrder(entry)),
    totalProductAmount: row.totalProductAmount,
    totalCouponDiscountAmount: row.totalCouponDiscountAmount,
    totalPointDiscountAmount: row.totalPointDiscountAmount,
    totalShippingFee: row.totalShippingFee,
    paidAmount: row.paidAmount,
  }
}

/**
 * 「울 코트 외 2건」.
 *
 * 목록이 항목을 전부 싣지 않는 이유는 A5 다 — 주문 20건의 항목을 모두 실으면 한
 * 화면이 수백 줄을 내려받는다. 대신 첫 항목의 이름과 개수를 서버가 만든다: 그
 * 문장을 화면이 만들면 앱마다 다른 규칙이 생긴다.
 */
function summarise(row: {
  readonly id: string
  readonly orderNumber: string
  readonly createdAt: Date
  readonly paidAmount: number
  readonly sellerOrders: readonly {
    readonly status: string
    readonly items: readonly { readonly productSnapshot: unknown }[]
  }[]
}): {
  id: string
  orderNumber: string
  createdAt: string
  headline: string
  itemCount: number
  statuses: OrderStatus[]
  paidAmount: number
} {
  const items = row.sellerOrders.flatMap((entry) => entry.items)
  const first = items[0]
  const headline = first === undefined ? '' : snapshotFrom(first.productSnapshot).productName

  return {
    id: row.id,
    orderNumber: row.orderNumber,
    createdAt: row.createdAt.toISOString(),
    headline,
    itemCount: items.length,
    statuses: row.sellerOrders.map((entry) => entry.status as OrderStatus),
    paidAmount: row.paidAmount,
  }
}
