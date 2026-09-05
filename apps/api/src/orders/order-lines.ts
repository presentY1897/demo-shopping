import { BadRequestException } from '@nestjs/common'
import type { OrderItemSnapshot, ShippingPolicy } from '@shopping/shared'

import { resolvePurchaseLimit } from '../catalog/variant-rules.js'
import { domainFailure } from '../common/domain-failure.js'
import type { OrderLine } from './order-plan.js'

/**
 * 주문될 줄 하나를 만드는 일 (TASK-0049 · TASK-0050).
 *
 * 주문서와 주문이 **같은 줄을 두 번 만들지 않게** 떼어 놓았다. 장바구니에서 오든
 * (`POST /checkouts`) 이미 잡힌 예약에서 오든(`GET /checkouts/:id`) 결과는 같은
 * `OrderLine` 이어야 한다 — 두 벌이면 주문서가 보여 준 것과 주문이 저장한 것이
 * 갈리고, 그 차이는 결제가 끝난 뒤에 발견된다.
 */

/** 장바구니에서 읽어 온 주문될 줄 하나. */
export interface CartLineRow {
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

/** 팔 수 있는가, 그리고 이 수량이 허용되는가 (F9). */
export function assertOrderable(row: CartLineRow): void {
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

/**
 * 이 주문에 관련된 판매자들의 배송 정책 (4.1).
 *
 * 판매자마다 한 번씩만 넣는다 — 같은 정책을 두 번 넣으면 계산 엔진이 그 판매자의
 * 배송비를 두 번 붙일지 한 번 붙일지가 구현 세부에 달리게 된다.
 */
export function policiesOf(rows: readonly CartLineRow[]): readonly ShippingPolicy[] {
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

export function toLine(row: CartLineRow): OrderLine {
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
 * 한 줄을 읽는 `select` 조각.
 *
 * 장바구니 줄과 예약 줄이 **같은 조각을 쓴다.** 한쪽에만 필드를 더하면 그 화면만
 * 그것을 알게 되고, 주문서와 주문이 다른 것을 보여 준다.
 */
export const VARIANT_LINE_SELECT = {
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
      images: { orderBy: { sortOrder: 'asc' }, take: 1, select: { url: true } },
      options: { select: { id: true, sortOrder: true } },
      seller: {
        select: { id: true, brandName: true, shippingFee: true, freeShippingThreshold: true },
      },
    },
  },
} as const
