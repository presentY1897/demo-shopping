import type { OrderStatus, SellerOrderListItem } from '@shopping/shared'
import {
  sellerOrderListResponseSchema,
  sellerOrderResponseSchema,
  sellerOrderSummaryResponseSchema,
} from '@shopping/shared'

import { defineFixture } from '../define'

/**
 * 판매자 콘솔의 주문 (TASK-0060), 화면이 보는 모양 그대로.
 *
 * **구매자 쪽 `orders.ts` 와 다른 파일인 이유는 응답이 다르기 때문이다.** 저쪽은
 * 「내가 산 주문」이고 여기는 「내 가게에 들어온 몫」이라, 담기는 것도 소유의 축도
 * 다르다 — 서버가 라우트를 나눈 것과 같은 이유다.
 *
 * 줄이 일곱인 것은 **커서를 넘겨 봐야** 하기 때문이다. 한 페이지에 다 들어가는
 * 픽스처로는 「다음 페이지의 첫 줄이 이전 페이지의 마지막 줄과 겹치지 않는다」를 잴 수
 * 없고, 그 겹침이 F7 이 막는 결함이다.
 */

/**
 * 스물다섯 줄.
 *
 * **기본 한 페이지(20)보다 많아야** 「다음」이 실제로 다음 페이지를 가져오는지 잴 수
 * 있다. 한 페이지에 다 들어가는 픽스처로는 커서가 아무것도 하지 않아도 검사가 초록이고,
 * 그 상태에서 놓치는 것이 F7 이 막는 중복·누락이다.
 */
const ROW_COUNT = 25

/** 상태를 골고루 흩어 둔다 — 탭이 실제로 무언가를 거르는지 재려면 그래야 한다. */
const STATUSES: readonly OrderStatus[] = ['PAID', 'PREPARING', 'SHIPPED', 'DELIVERED', 'CANCELED']

/** UUIDv7 처럼 **정렬 가능한** id. 커서가 그 순서 위의 위치라 순서가 곧 계약이다. */
function idAt(index: number): string {
  return `01930000-0000-7000-8000-${index.toString(16).padStart(12, '0')}`
}

function statusAt(index: number): OrderStatus {
  return STATUSES[index % STATUSES.length] ?? 'PAID'
}

function rowAt(index: number): SellerOrderListItem {
  const status = statusAt(index)
  const shipped = status === 'SHIPPED' || status === 'DELIVERED'

  return {
    id: idAt(index + 1),
    orderNumber: `20260906-${String(index + 1).padStart(8, '0')}`,
    // 하루에 하나씩. 기간 필터가 실제로 무언가를 자르려면 날짜가 흩어져 있어야 한다.
    orderedAt: new Date(Date.UTC(2026, 8, index + 1, 1)).toISOString(),
    status,
    headline: `데모 상품 ${String(index + 1)}`,
    itemCount: index % 3 === 0 ? 2 : 1,
    totalQuantity: index % 3 === 0 ? 3 : 1,
    paidAmount: 12_000 + index * 1_000,
    // **가려진 이름이다.** 서버가 가려서 보내므로 목 응답에도 원본이 없다 (F6).
    maskedRecipientName: '홍*동',
    thumbnailUrl: null,
    trackingNumber: shipped ? 'DEMO-GA-000000000001' : null,
  }
}

const ROWS = Array.from({ length: ROW_COUNT }, (_unused, index) => rowAt(index))

/**
 * 목록 — **스물다섯 줄 전부**.
 *
 * 핸들러가 여기서 저장소를 만들고 `limit` 에 맞춰 잘라 낸다. 픽스처가 이미 잘린
 * 페이지면 페이지네이션을 재는 검사가 픽스처의 모양을 재게 된다.
 */
export const sellerOrderPage = defineFixture(sellerOrderListResponseSchema, {
  sellerOrders: ROWS,
  nextCursor: null,
})

/**
 * 뱃지와 탭이 읽는 숫자.
 *
 * **줄에서 센다.** 손으로 적으면 줄을 하나 더할 때마다 두 곳을 맞춰야 하고, 어긋나면
 * 화면이 「탭에는 5건인데 목록에는 4줄」을 보여 준다 — 그것은 목의 결함인데 화면의
 * 결함처럼 보인다.
 */
export const sellerOrderSummary = defineFixture(sellerOrderSummaryResponseSchema, {
  summary: {
    counts: ROWS.reduce(
      (counts, row) => ({ ...counts, [row.status]: (counts[row.status] ?? 0) + 1 }),
      {
        PAYMENT_PENDING: 0,
        PAYMENT_FAILED: 0,
        PAID: 0,
        PREPARING: 0,
        SHIPPED: 0,
        DELIVERED: 0,
        CONFIRMED: 0,
        CANCELED: 0,
        RETURNED: 0,
      } as Record<OrderStatus, number>,
    ),
    newOrders: ROWS.filter((row) => row.status === 'PAID').length,
    actionRequired: ROWS.filter((row) => row.status === 'PAID' || row.status === 'PREPARING')
      .length,
  },
})

/**
 * 상세 하나 — 발송 전이라 `shipment` 가 `null` 이다.
 *
 * 발송 전을 기본으로 두는 이유는 그것이 판매자가 **무언가 해야 하는** 상태이기
 * 때문이다. 이미 끝난 주문을 기본 픽스처로 두면 화면의 버튼이 늘 비어 있다.
 */
export const sellerOrderDetail = defineFixture(sellerOrderResponseSchema, {
  sellerOrder: {
    id: idAt(3),
    sellerId: '01930000-0000-7000-8000-00000000ffff',
    brandName: '가상브랜드',
    status: 'PREPARING',
    items: [
      {
        id: '01930000-0000-7000-8000-00000000aa01',
        variantId: '01930000-0000-7000-8000-00000000bb01',
        snapshot: {
          productId: '01930000-0000-7000-8000-00000000cc01',
          productName: '데모 상품 3',
          optionLabel: '블랙 / M',
          sku: 'DEMO-0001',
          thumbnailUrl: null,
          brandName: '가상브랜드',
        },
        unitPrice: 12_000,
        quantity: 1,
        productAmount: 12_000,
        couponDiscountAmount: 0,
        pointDiscountAmount: 0,
        discountAmount: 0,
      },
    ],
    productAmount: 12_000,
    couponDiscountAmount: 0,
    pointDiscountAmount: 0,
    shippingPointAmount: 0,
    shippingFee: 3_000,
    paidAmount: 15_000,
    shipment: null,
    // 아직 발송 전이라 확정 예정도 없다 (TASK-0064).
    autoConfirmAt: null,
    // **묶음 안이다.** 이력은 묶음에 붙는 사실이고 상세에만 실린다 —
    // `shipment` 가 바로 위에 있는 것과 같은 이유이며, 그래서 구매자 상세도
    // 같은 이력을 읽는다 (TASK-0063).
    history: [
      {
        id: '01930000-0000-7000-8000-00000000dd01',
        fromStatus: null,
        toStatus: 'PAYMENT_PENDING',
        actor: 'SYSTEM',
        reason: null,
        occurredAt: '2026-09-03T01:00:00.000Z',
      },
      {
        id: '01930000-0000-7000-8000-00000000dd02',
        fromStatus: 'PAID',
        toStatus: 'PREPARING',
        actor: 'SELLER',
        reason: null,
        occurredAt: '2026-09-03T02:00:00.000Z',
      },
    ],
  },
  orderNumber: '20260906-00000003',
  orderedAt: '2026-09-03T01:00:00.000Z',
  recipient: {
    name: '홍길동',
    phone: '010-0000-0000',
    postalCode: '06234',
    addressLine1: '서울시 강남구',
    addressLine2: null,
  },
})
