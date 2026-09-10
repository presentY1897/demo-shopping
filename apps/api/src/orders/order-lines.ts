import { BadRequestException } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
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
  readonly updatedAt?: Date
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
      readonly category: { readonly path: string }
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
    productId: row.variant.product.id,
    categoryPath: row.variant.product.category.path,
    snapshot: snapshotOf(row),
  }
}

/**
 * 대표 사진 한 장.
 *
 * 동점일 때의 순서까지 정해 둔다 — `sortOrder` 만으로는 같은 값을 가진 두 사진 중
 * 어느 것이 대표가 될지가 실행마다 달라지고, 그 흔들림은 주문 스냅샷에 굳어 남는다.
 *
 * 아래 조각 밖에 있는 것은 타입 때문이다. `as const` 는 배열까지 `readonly` 로
 * 만들고 Prisma 의 `orderBy` 는 그것을 받지 않으므로, 정렬 목록을 쓰려면 이 자리가
 * `as const` 밖이어야 한다.
 */
const REPRESENTATIVE_IMAGE = {
  orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  take: 1,
  select: { url: true },
} satisfies Prisma.Product$imagesArgs

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
      // 카테고리 범위 쿠폰이 읽는 유일한 값이다 (TASK-0075). `categoryId` 가
      // 아니라 `path` 인 이유는 **조상까지 닿아야** 하기 때문이다 — 「셔츠」 쿠폰이
      // 「반팔 셔츠」에 안 붙으면 발행자는 잎 카테고리를 전부 나열해야 하고,
      // 나중에 추가된 잎은 아무도 다시 나열해 주지 않는다.
      //
      // 줄마다 질의가 하나씩 붙지 않는다. 관계 하나를 더 고르는 것은 줄 수와
      // 무관하게 문장 하나이고, 그 성질을 재는 것이 `orders-performance.spec.ts`
      // 의 「한 줄이든 열 줄이든 같은 수의 문장」이다.
      category: { select: { path: true } },
      images: REPRESENTATIVE_IMAGE,
      options: { select: { id: true, sortOrder: true } },
      seller: {
        select: { id: true, brandName: true, shippingFee: true, freeShippingThreshold: true },
      },
    },
  },
} as const
