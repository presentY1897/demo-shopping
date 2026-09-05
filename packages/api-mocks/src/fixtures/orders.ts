import { orderListResponseSchema, orderResponseSchema } from '@shopping/shared'

import { defineFixture } from '../define'
import { MOCK_ORDER_IDS, MOCK_SELLER_ORDER_IDS } from '../handlers/order-contract'

/**
 * 구매자가 읽는 주문 — 목록과 상세 (TASK-0063 의 화면이 읽는다).
 *
 * **`checkout.ts` 와 같은 사람, 같은 가게, 같은 상품이다.** 주문서에서 주문으로,
 * 주문에서 주문 내역으로 이어지는 것이 한 사람의 하루라서, 픽스처가 갈리면
 * 「주문서에서 본 것이 내역에 그대로 있다」를 확인할 자리가 없어진다.
 *
 * ## 이 픽스처가 들고 있어야 하는 사실 셋
 *
 * 1. **한 주문 안에서 판매자마다 상태가 다르다.** 이것이 D-023 이고, 화면이 그것을
 *    하나로 뭉치면 거짓말이 된다 (F1 · F2). 그래서 `shopperMixedOrder` 의 세 묶음이
 *    배송완료 · 배송중 · 상품준비중이다.
 * 2. **`shipment: null` 은 「배송 정보를 못 읽었다」가 아니다.** 준비중인 묶음이
 *    `null` 을 들고 있고, 그것은 **아직 발송되지 않았다**는 사실이다. 세 묶음 중
 *    하나만 `null` 이라 화면이 둘을 같은 자리에서 다르게 그려야 한다.
 * 3. **주문 항목은 스냅샷이다** (F4). `shopperDeletedProductOrder` 의 상품은 지금
 *    카탈로그에 없는 id 를 가리킨다 — 화면이 상품을 다시 조회해 이름을 채우려 들면
 *    그 줄이 빈칸이 되고, 그러면 안 된다는 것이 그 주문의 용도다.
 * 4. **이력은 묶음마다 다르다** (TASK-0063). 다섯 줄짜리·네 줄짜리·세 줄짜리가
 *    있고, `shopperDeletedProductOrder` 는 **비어 있다.** 타임라인이 이력을 쓰되
 *    없는 칸을 지어내지 않는지는 마지막 것에서만 드러난다.
 *
 * 다섯 건의 주문 시각은 `MOCK_ORDER_NOW` 를 기준으로 기간 필터의 경계 양쪽에
 * 흩어져 있다. 그 이유는 `handlers/order-contract.ts` 에 적혀 있다.
 */

const SELLER_A = '019596d0-1f1c-7c2e-9a0e-5a0000000001'
const SELLER_B = '019596d0-1f1c-7c2e-9a0e-5a0000000002'
/** 세 번째 가게. 「묶음이 셋인 주문」을 만들려고 이 파일에서 처음 등장한다. */
const SELLER_C = '019596d0-1f1c-7c2e-9a0e-5a0000000003'

const ORDER_NUMBERS = {
  mixed: '20260905-4TQ8XKM2',
  confirmed: '20260828-9WXY3N7P',
  canceled: '20260615-2BCDF5GH',
  deleted: '20260302-6JKMN8PQ',
  ancient: '20250410-3RSTV7WX',
} as const

const CREATED_AT = {
  /** 하루 전. 1개월 필터 안. */
  mixed: '2026-09-05T04:02:30.000Z',
  /** 9일 전. 1개월 필터 안. */
  confirmed: '2026-08-28T02:11:00.000Z',
  /** 83일 전. 3개월 필터 안, 1개월 밖. */
  canceled: '2026-06-15T06:40:00.000Z',
  /** 188일 전. 1년 필터 안, 6개월 밖. */
  deleted: '2026-03-02T09:20:00.000Z',
  /** 514일 전. 어떤 기간 필터에도 안 걸리고 「전체」에만 나온다. */
  ancient: '2025-04-10T01:05:00.000Z',
} as const

/** 주문한 때 배송지에서 **복사된** 값. 주소록에서 지워도 주문서는 그대로다. */
const RECIPIENT = {
  name: '김민준',
  phone: '010-2345-6789',
  postalCode: '06236',
  addressLine1: '서울특별시 강남구 테헤란로 152',
  addressLine2: '11층 1103호',
} as const

/* ------------------------------------------------------------------ 항목들 -- */

const COAT_ITEM = {
  id: '019596d0-1f1c-7c2e-9a0e-6b0000000001',
  variantId: '019596d0-1f1c-7c2e-9a0e-5c0000000001',
  snapshot: {
    productId: '019596d0-1f1c-7c2e-9a0e-5d0000000001',
    productName: '울 롱코트',
    optionLabel: '블랙 / M',
    sku: 'LUMICOAT-1',
    thumbnailUrl: null,
    brandName: '루미에르',
  },
  unitPrice: 189_000,
  quantity: 1,
  productAmount: 189_000,
  couponDiscountAmount: 0,
  pointDiscountAmount: 0,
  discountAmount: 0,
}

const KNIT_ITEM = {
  id: '019596d0-1f1c-7c2e-9a0e-6b0000000002',
  variantId: '019596d0-1f1c-7c2e-9a0e-5c0000000002',
  snapshot: {
    productId: '019596d0-1f1c-7c2e-9a0e-5d0000000002',
    productName: '캐시미어 니트',
    optionLabel: '그레이 / L',
    sku: 'LUMIKNIT-2',
    thumbnailUrl: null,
    brandName: '루미에르',
  },
  unitPrice: 118_000,
  quantity: 2,
  productAmount: 236_000,
  couponDiscountAmount: 0,
  pointDiscountAmount: 0,
  discountAmount: 0,
}

/** 옵션이 없는 줄. `optionLabel` 이 빈 문자열이고 `null` 이 아니다 (계약이 그렇다). */
const SCARF_ITEM = {
  id: '019596d0-1f1c-7c2e-9a0e-6b0000000003',
  variantId: '019596d0-1f1c-7c2e-9a0e-5c0000000004',
  snapshot: {
    productId: '019596d0-1f1c-7c2e-9a0e-5d0000000004',
    productName: '울 머플러',
    optionLabel: '',
    sku: 'NODE-SCARF',
    thumbnailUrl: null,
    brandName: '노드스텝',
  },
  unitPrice: 49_000,
  quantity: 1,
  productAmount: 49_000,
  couponDiscountAmount: 0,
  pointDiscountAmount: 0,
  discountAmount: 0,
}

/** 썸네일이 있는 유일한 줄. 이미지가 있는 쪽과 없는 쪽이 한 화면에 있어야 한다. */
const BOOTS_ITEM = {
  id: '019596d0-1f1c-7c2e-9a0e-6b0000000004',
  variantId: '019596d0-1f1c-7c2e-9a0e-5c0000000005',
  snapshot: {
    productId: '019596d0-1f1c-7c2e-9a0e-5d0000000005',
    productName: '스웨이드 첼시부츠',
    optionLabel: '카멜 / 260',
    sku: 'MARU-BOOT-260',
    thumbnailUrl: 'https://cdn.test.invalid/products/maru-boot.webp',
    brandName: '마루상회',
  },
  unitPrice: 148_000,
  quantity: 1,
  productAmount: 148_000,
  couponDiscountAmount: 0,
  pointDiscountAmount: 0,
  discountAmount: 0,
}

/**
 * 지금은 카탈로그에 없는 상품 (F4).
 *
 * `productId` 가 다른 어떤 픽스처에도 없는 id 다. 화면이 상품을 다시 조회해 이름을
 * 채우려 들면 이 줄에서 빈칸이 나온다 — 그러면 안 된다는 것이 이 줄의 용도다.
 */
const RETIRED_ITEM = {
  id: '019596d0-1f1c-7c2e-9a0e-6b0000000005',
  variantId: '019596d0-1f1c-7c2e-9a0e-5c0000000009',
  snapshot: {
    productId: '019596d0-1f1c-7c2e-9a0e-5d0000000009',
    productName: '리넨 셔츠 (단종)',
    optionLabel: '아이보리 / 95',
    sku: 'LUMI-LINEN-95',
    thumbnailUrl: null,
    brandName: '루미에르',
  },
  unitPrice: 79_000,
  quantity: 1,
  productAmount: 79_000,
  couponDiscountAmount: 0,
  pointDiscountAmount: 0,
  discountAmount: 0,
}

/* ------------------------------------------------------------------- 배송 -- */

/**
 * 배송완료까지 간 배송. 네 사건이 **시간순**으로 있다.
 *
 * `location` 과 `description` 이 한국어 문장인 것은 그것이 UI 문구가 아니라 **서버가
 * 만든 기록**이기 때문이다 (`api/shipments.ts`). 지명은 전부 가상이다 — 실제 운송사
 * 터미널 이름을 쓰지 않는다.
 */
const DELIVERED_SHIPMENT = {
  id: '019596d0-1f1c-7c2e-9a0e-6c0000000001',
  sellerOrderId: MOCK_SELLER_ORDER_IDS.mixedDelivered,
  carrierCode: 'GA' as const,
  carrierName: '가온물류',
  trackingNumber: 'DEMO-GA-000000000101',
  status: 'DELIVERED' as const,
  shippedAt: '2026-09-05T08:00:00.000Z',
  deliveredAt: '2026-09-06T02:30:00.000Z',
  events: [
    {
      id: '019596d0-1f1c-7c2e-9a0e-6e0000000001',
      kind: 'PICKED_UP' as const,
      location: '가온 남서울터미널',
      occurredAt: '2026-09-05T08:00:00.000Z',
      description: '보내는 분으로부터 상품을 인수했습니다.',
    },
    {
      id: '019596d0-1f1c-7c2e-9a0e-6e0000000002',
      kind: 'IN_TRANSIT' as const,
      location: '가온 중부허브',
      occurredAt: '2026-09-05T16:20:00.000Z',
      description: '간선 상차했습니다.',
    },
    {
      id: '019596d0-1f1c-7c2e-9a0e-6e0000000003',
      kind: 'OUT_FOR_DELIVERY' as const,
      location: '가온 역삼영업소',
      occurredAt: '2026-09-06T00:40:00.000Z',
      description: '배송원이 상품을 가지고 출발했습니다.',
    },
    {
      id: '019596d0-1f1c-7c2e-9a0e-6e0000000004',
      kind: 'DELIVERED' as const,
      location: '가온 역삼영업소',
      occurredAt: '2026-09-06T02:30:00.000Z',
      description: '배송이 완료되었습니다. (문 앞)',
    },
  ],
}

/** 아직 오는 중인 배송. 사건이 둘뿐이고 `deliveredAt` 이 `null` 이다. */
const IN_TRANSIT_SHIPMENT = {
  id: '019596d0-1f1c-7c2e-9a0e-6c0000000002',
  sellerOrderId: MOCK_SELLER_ORDER_IDS.mixedShipped,
  carrierCode: 'HD' as const,
  carrierName: '한들택배',
  trackingNumber: 'DEMO-HD-000000000102',
  status: 'IN_TRANSIT' as const,
  shippedAt: '2026-09-05T09:10:00.000Z',
  deliveredAt: null,
  events: [
    {
      id: '019596d0-1f1c-7c2e-9a0e-6e0000000005',
      kind: 'PICKED_UP' as const,
      location: '한들 북부터미널',
      occurredAt: '2026-09-05T09:10:00.000Z',
      description: '보내는 분으로부터 상품을 인수했습니다.',
    },
    {
      id: '019596d0-1f1c-7c2e-9a0e-6e0000000006',
      kind: 'IN_TRANSIT' as const,
      location: '한들 중부허브',
      occurredAt: '2026-09-05T21:45:00.000Z',
      description: '간선 상차했습니다.',
    },
  ],
}

/**
 * 지난달의 배송. 같은 네 단계를 지났고 시각만 그때의 것이다.
 *
 * 위의 것을 `map` 으로 밀어 만들지 않고 네 줄을 적는다. 사건 하나하나가 **그때
 * 일어난 일**이라 픽스처가 그것을 계산으로 만들면, 이 파일을 읽는 사람이 어떤
 * 이력을 화면이 그리게 되는지 머릿속에서 실행해 봐야 한다.
 */
const OLD_DELIVERED_SHIPMENT = {
  id: '019596d0-1f1c-7c2e-9a0e-6c0000000003',
  sellerOrderId: MOCK_SELLER_ORDER_IDS.confirmed,
  carrierCode: 'GA' as const,
  carrierName: '가온물류',
  trackingNumber: 'DEMO-GA-000000000103',
  status: 'DELIVERED' as const,
  shippedAt: '2026-08-28T08:00:00.000Z',
  deliveredAt: '2026-08-30T02:30:00.000Z',
  events: [
    {
      id: '019596d0-1f1c-7c2e-9a0e-6e0000000011',
      kind: 'PICKED_UP' as const,
      location: '가온 남서울터미널',
      occurredAt: '2026-08-28T08:00:00.000Z',
      description: '보내는 분으로부터 상품을 인수했습니다.',
    },
    {
      id: '019596d0-1f1c-7c2e-9a0e-6e0000000012',
      kind: 'IN_TRANSIT' as const,
      location: '가온 중부허브',
      occurredAt: '2026-08-28T16:20:00.000Z',
      description: '간선 상차했습니다.',
    },
    {
      id: '019596d0-1f1c-7c2e-9a0e-6e0000000013',
      kind: 'OUT_FOR_DELIVERY' as const,
      location: '가온 역삼영업소',
      occurredAt: '2026-08-30T00:40:00.000Z',
      description: '배송원이 상품을 가지고 출발했습니다.',
    },
    {
      id: '019596d0-1f1c-7c2e-9a0e-6e0000000014',
      kind: 'DELIVERED' as const,
      location: '가온 역삼영업소',
      occurredAt: '2026-08-30T02:30:00.000Z',
      description: '배송이 완료되었습니다. (문 앞)',
    },
  ],
}

/* ------------------------------------------------------------- 상태 이력 -- */

/**
 * 묶음이 지나온 상태들 (TASK-0063 — 이력이 묶음 안으로 옮겨 온 뒤).
 *
 * **이 값들이 구매자 타임라인의 시각이다.** 이력이 판매자 응답 최상위에만 있던
 * 동안 구매자 화면은 배송 행이 아는 두 시각(`shippedAt`·`deliveredAt`)밖에 쓸 것이
 * 없었고, 나머지 칸은 전부 「시각 정보 없음」이었다. 그래서 여기 실리는 줄 하나하나가
 * 화면에서 한 칸의 시각이 된다.
 *
 * **배송 행의 시각과 어긋나지 않게 적는다.** `SHIPPED` 줄의 시각은 그 묶음
 * `shipment.shippedAt` 과 같고 `DELIVERED` 줄은 `deliveredAt` 과 같다 — 실제
 * 서버가 둘을 한 트랜잭션에서 쓰기 때문이고, 픽스처가 그것을 어기면 화면의
 * 「어느 쪽을 믿나」가 목의 사정으로 결정된다.
 */
function historyId(suffix: string): string {
  return `019596d0-1f1c-7c2e-9a0e-6f000000${suffix}`
}

/** 배송완료까지 간 묶음. 다섯 줄 전부 있다. */
const DELIVERED_HISTORY = [
  {
    id: historyId('0001'),
    fromStatus: null,
    toStatus: 'PAYMENT_PENDING' as const,
    actor: 'SYSTEM' as const,
    reason: null,
    occurredAt: CREATED_AT.mixed,
  },
  {
    id: historyId('0002'),
    fromStatus: 'PAYMENT_PENDING' as const,
    toStatus: 'PAID' as const,
    actor: 'SYSTEM' as const,
    reason: null,
    occurredAt: '2026-09-05T04:03:12.000Z',
  },
  {
    id: historyId('0003'),
    fromStatus: 'PAID' as const,
    toStatus: 'PREPARING' as const,
    actor: 'SELLER' as const,
    reason: null,
    occurredAt: '2026-09-05T05:40:00.000Z',
  },
  {
    id: historyId('0004'),
    fromStatus: 'PREPARING' as const,
    toStatus: 'SHIPPED' as const,
    actor: 'SELLER' as const,
    reason: null,
    // 배송 행의 `shippedAt` 과 같은 시각이다.
    occurredAt: '2026-09-05T08:00:00.000Z',
  },
  {
    id: historyId('0005'),
    fromStatus: 'SHIPPED' as const,
    toStatus: 'DELIVERED' as const,
    // 사람이 없다. 배송 시뮬레이터가 옮긴 것이고, 그 사실이 `actor` 에 남는다.
    actor: 'SYSTEM' as const,
    reason: null,
    occurredAt: '2026-09-06T02:30:00.000Z',
  },
]

/** 아직 오는 중인 묶음. **`DELIVERED` 줄이 없다** — 아직 일어나지 않았다. */
const SHIPPED_HISTORY = [
  {
    id: historyId('0011'),
    fromStatus: null,
    toStatus: 'PAYMENT_PENDING' as const,
    actor: 'SYSTEM' as const,
    reason: null,
    occurredAt: CREATED_AT.mixed,
  },
  {
    id: historyId('0012'),
    fromStatus: 'PAYMENT_PENDING' as const,
    toStatus: 'PAID' as const,
    actor: 'SYSTEM' as const,
    reason: null,
    occurredAt: '2026-09-05T04:03:12.000Z',
  },
  {
    id: historyId('0013'),
    fromStatus: 'PAID' as const,
    toStatus: 'PREPARING' as const,
    actor: 'SELLER' as const,
    reason: null,
    occurredAt: '2026-09-05T06:10:00.000Z',
  },
  {
    id: historyId('0014'),
    fromStatus: 'PREPARING' as const,
    toStatus: 'SHIPPED' as const,
    actor: 'SELLER' as const,
    reason: null,
    occurredAt: '2026-09-05T09:10:00.000Z',
  },
]

/** 아직 안 떠난 묶음. 두 줄뿐이라 사다리의 뒤 세 칸에는 시각이 없다. */
const PREPARING_HISTORY = [
  {
    id: historyId('0021'),
    fromStatus: null,
    toStatus: 'PAYMENT_PENDING' as const,
    actor: 'SYSTEM' as const,
    reason: null,
    occurredAt: CREATED_AT.mixed,
  },
  {
    id: historyId('0022'),
    fromStatus: 'PAYMENT_PENDING' as const,
    toStatus: 'PAID' as const,
    actor: 'SYSTEM' as const,
    reason: null,
    occurredAt: '2026-09-05T04:03:12.000Z',
  },
  {
    id: historyId('0023'),
    fromStatus: 'PAID' as const,
    toStatus: 'PREPARING' as const,
    actor: 'SELLER' as const,
    reason: null,
    occurredAt: '2026-09-05T07:20:00.000Z',
  },
]

/** 구매확정까지 간 묶음. **마지막 줄의 주체가 `BUYER`** 다 — 사람이 눌렀다. */
const CONFIRMED_HISTORY = [
  {
    id: historyId('0031'),
    fromStatus: null,
    toStatus: 'PAYMENT_PENDING' as const,
    actor: 'SYSTEM' as const,
    reason: null,
    occurredAt: CREATED_AT.confirmed,
  },
  {
    id: historyId('0032'),
    fromStatus: 'PAYMENT_PENDING' as const,
    toStatus: 'PAID' as const,
    actor: 'SYSTEM' as const,
    reason: null,
    occurredAt: '2026-08-28T02:11:40.000Z',
  },
  {
    id: historyId('0033'),
    fromStatus: 'PAID' as const,
    toStatus: 'PREPARING' as const,
    actor: 'SELLER' as const,
    reason: null,
    occurredAt: '2026-08-28T04:00:00.000Z',
  },
  {
    id: historyId('0034'),
    fromStatus: 'PREPARING' as const,
    toStatus: 'SHIPPED' as const,
    actor: 'SELLER' as const,
    reason: null,
    occurredAt: '2026-08-28T08:00:00.000Z',
  },
  {
    id: historyId('0035'),
    fromStatus: 'SHIPPED' as const,
    toStatus: 'DELIVERED' as const,
    actor: 'SYSTEM' as const,
    reason: null,
    occurredAt: '2026-08-30T02:30:00.000Z',
  },
  {
    id: historyId('0036'),
    fromStatus: 'DELIVERED' as const,
    toStatus: 'CONFIRMED' as const,
    actor: 'BUYER' as const,
    reason: null,
    occurredAt: '2026-08-31T05:12:00.000Z',
  },
]

/**
 * 취소된 묶음. **사유가 있는 유일한 이력이다.**
 *
 * `reason` 이 `null` 이 아닌 줄이 한 벌은 있어야 한다 — 취소·반품에는 사유가 붙고
 * 정상 진행에는 붙지 않는다는 것이 계약이고, 전부 `null` 인 픽스처만 있으면 그
 * 필드를 쓰는 코드가 한 번도 안 그려진 채 머지된다.
 */
const CANCELED_HISTORY = [
  {
    id: historyId('0041'),
    fromStatus: null,
    toStatus: 'PAYMENT_PENDING' as const,
    actor: 'SYSTEM' as const,
    reason: null,
    occurredAt: CREATED_AT.canceled,
  },
  {
    id: historyId('0042'),
    fromStatus: 'PAYMENT_PENDING' as const,
    toStatus: 'PAID' as const,
    actor: 'SYSTEM' as const,
    reason: null,
    occurredAt: '2026-06-15T06:41:05.000Z',
  },
  {
    id: historyId('0043'),
    fromStatus: 'PAID' as const,
    toStatus: 'CANCELED' as const,
    actor: 'SELLER' as const,
    reason: '재고가 모자라 판매자가 취소했습니다.',
    occurredAt: '2026-06-15T23:30:00.000Z',
  },
]

/* ------------------------------------------------------------------- 주문 -- */

/**
 * 이 저장소의 구조가 사용자에게 드러나는 주문 (F1 · F2).
 *
 * 묶음 셋의 상태가 전부 다르다 — 배송완료(구매확정이 열린다) · 배송중(추적만) ·
 * 상품준비중(`shipment` 가 `null`). 한 주문번호 아래에서 이 셋이 동시에 참인 것이
 * 마켓플레이스이고, 화면이 그것을 하나로 뭉치면 거짓말을 하게 된다.
 */
export const shopperMixedOrder = defineFixture(orderResponseSchema, {
  order: {
    id: MOCK_ORDER_IDS.mixed,
    orderNumber: ORDER_NUMBERS.mixed,
    createdAt: CREATED_AT.mixed,
    recipient: RECIPIENT,
    sellerOrders: [
      {
        id: MOCK_SELLER_ORDER_IDS.mixedDelivered,
        sellerId: SELLER_A,
        brandName: '루미에르',
        status: 'DELIVERED',
        items: [COAT_ITEM, KNIT_ITEM],
        productAmount: 425_000,
        couponDiscountAmount: 0,
        pointDiscountAmount: 0,
        shippingPointAmount: 0,
        shippingFee: 0,
        paidAmount: 425_000,
        shipment: DELIVERED_SHIPMENT,
        history: DELIVERED_HISTORY,
      },
      {
        id: MOCK_SELLER_ORDER_IDS.mixedShipped,
        sellerId: SELLER_B,
        brandName: '노드스텝',
        status: 'SHIPPED',
        items: [SCARF_ITEM],
        productAmount: 49_000,
        couponDiscountAmount: 0,
        pointDiscountAmount: 0,
        shippingPointAmount: 0,
        shippingFee: 2_500,
        paidAmount: 51_500,
        shipment: IN_TRANSIT_SHIPMENT,
        history: SHIPPED_HISTORY,
      },
      {
        id: MOCK_SELLER_ORDER_IDS.mixedPreparing,
        sellerId: SELLER_C,
        brandName: '마루상회',
        status: 'PREPARING',
        items: [BOOTS_ITEM],
        productAmount: 148_000,
        couponDiscountAmount: 0,
        pointDiscountAmount: 0,
        shippingPointAmount: 0,
        shippingFee: 3_000,
        paidAmount: 151_000,
        // 아직 보내지 않았다. 「못 읽었다」가 아니다.
        shipment: null,
        history: PREPARING_HISTORY,
      },
    ],
    totalProductAmount: 622_000,
    totalCouponDiscountAmount: 0,
    totalPointDiscountAmount: 0,
    totalShippingFee: 5_500,
    paidAmount: 627_500,
  },
})

/**
 * 이미 구매확정된 주문.
 *
 * **할인이 0이 아닌 유일한 픽스처다.** 결제 정보가 「수단·금액·할인 내역」을 보여
 * 줘야 하는데(2장), 전부 0인 주문만 있으면 할인 줄이 한 번도 안 그려진 채 머지된다.
 * 쿠폰 10,000원과 적립금 3,000원이 항목에 안분돼 있고, 배송비를 낸 적립금 2,500원은
 * **항목에 안분되지 않는 몫**이라 따로 있다 (TASK-0047).
 */
export const shopperConfirmedOrder = defineFixture(orderResponseSchema, {
  order: {
    id: MOCK_ORDER_IDS.confirmed,
    orderNumber: ORDER_NUMBERS.confirmed,
    createdAt: CREATED_AT.confirmed,
    recipient: RECIPIENT,
    sellerOrders: [
      {
        id: MOCK_SELLER_ORDER_IDS.confirmed,
        sellerId: SELLER_A,
        brandName: '루미에르',
        status: 'CONFIRMED',
        items: [
          {
            ...COAT_ITEM,
            id: '019596d0-1f1c-7c2e-9a0e-6b0000000006',
            couponDiscountAmount: 10_000,
            pointDiscountAmount: 3_000,
            discountAmount: 13_000,
          },
        ],
        productAmount: 189_000,
        couponDiscountAmount: 10_000,
        pointDiscountAmount: 3_000,
        shippingPointAmount: 2_500,
        shippingFee: 2_500,
        paidAmount: 176_000,
        shipment: OLD_DELIVERED_SHIPMENT,
        history: CONFIRMED_HISTORY,
      },
    ],
    totalProductAmount: 189_000,
    totalCouponDiscountAmount: 10_000,
    totalPointDiscountAmount: 3_000,
    totalShippingFee: 2_500,
    paidAmount: 176_000,
  },
})

/**
 * 취소된 주문. 종착 상태라 아무 액션도 열리지 않는다.
 *
 * 배송이 `null` 인 이유는 발송된 적이 없기 때문이고, 그것은 준비중인 묶음의 `null`
 * 과 **같은 뜻이 아니다** — 화면이 상태를 함께 읽어야 그 둘이 갈린다.
 */
export const shopperCanceledOrder = defineFixture(orderResponseSchema, {
  order: {
    id: MOCK_ORDER_IDS.canceled,
    orderNumber: ORDER_NUMBERS.canceled,
    createdAt: CREATED_AT.canceled,
    recipient: RECIPIENT,
    sellerOrders: [
      {
        id: MOCK_SELLER_ORDER_IDS.canceled,
        sellerId: SELLER_B,
        brandName: '노드스텝',
        status: 'CANCELED',
        items: [{ ...SCARF_ITEM, id: '019596d0-1f1c-7c2e-9a0e-6b0000000007' }],
        productAmount: 49_000,
        couponDiscountAmount: 0,
        pointDiscountAmount: 0,
        shippingPointAmount: 0,
        shippingFee: 2_500,
        paidAmount: 51_500,
        shipment: null,
        history: CANCELED_HISTORY,
      },
    ],
    totalProductAmount: 49_000,
    totalCouponDiscountAmount: 0,
    totalPointDiscountAmount: 0,
    totalShippingFee: 2_500,
    paidAmount: 51_500,
  },
})

/** 지금은 없는 상품이 들어 있는 주문 (F4). 스냅샷만으로 온전히 그려져야 한다. */
export const shopperDeletedProductOrder = defineFixture(orderResponseSchema, {
  order: {
    id: MOCK_ORDER_IDS.deleted,
    orderNumber: ORDER_NUMBERS.deleted,
    createdAt: CREATED_AT.deleted,
    recipient: RECIPIENT,
    sellerOrders: [
      {
        id: MOCK_SELLER_ORDER_IDS.deleted,
        sellerId: SELLER_A,
        brandName: '루미에르',
        status: 'CONFIRMED',
        items: [RETIRED_ITEM],
        productAmount: 79_000,
        couponDiscountAmount: 0,
        pointDiscountAmount: 0,
        shippingPointAmount: 0,
        shippingFee: 2_500,
        paidAmount: 81_500,
        shipment: null,
        /**
         * **이력이 비어 있다.** 상태 이력이 쌓이기 전에 지나간 주문이고, 계약은
         * 그것을 빈 배열로 표현한다.
         *
         * 픽스처에 이런 것이 하나 있어야 「이력에 없는 단계에는 시각이 없다」가
         * 화면에서 실제로 그려진다 — 다섯 칸이 그대로 있고 시각만 전부 「시각
         * 정보 없음」인 모습이다. 이력을 사다리 위에 덮어쓰는 구현은 이 주문에서
         * 정확히 깨진다.
         */
        history: [],
      },
    ],
    totalProductAmount: 79_000,
    totalCouponDiscountAmount: 0,
    totalPointDiscountAmount: 0,
    totalShippingFee: 2_500,
    paidAmount: 81_500,
  },
})

/**
 * 목록 첫 페이지 — 최신순 셋, `nextCursor` 가 있다.
 *
 * **커서가 마지막 줄의 id 다.** 서버가 `id: { lt: cursor }` 로 다음 장을 뜨므로
 * (`order.service.ts`), 이 값은 규약대로 화면이 해석하지 않는 불투명한 문자열이면서
 * 실제 서버가 내보내는 것과 같은 모양이다.
 *
 * 첫 줄의 `statuses` 가 셋인 것을 눈여겨볼 것. 「판매자별 상태를 하나로 뭉치지
 * 않는다」는 목록에서도 참이어야 한다.
 */
export const shopperOrderPage = defineFixture(orderListResponseSchema, {
  orders: [
    {
      id: MOCK_ORDER_IDS.mixed,
      orderNumber: ORDER_NUMBERS.mixed,
      createdAt: CREATED_AT.mixed,
      headline: '울 롱코트 외 3건',
      itemCount: 4,
      statuses: ['DELIVERED', 'SHIPPED', 'PREPARING'],
      paidAmount: 627_500,
    },
    {
      id: MOCK_ORDER_IDS.confirmed,
      orderNumber: ORDER_NUMBERS.confirmed,
      createdAt: CREATED_AT.confirmed,
      headline: '울 롱코트',
      itemCount: 1,
      statuses: ['CONFIRMED'],
      paidAmount: 176_000,
    },
    {
      id: MOCK_ORDER_IDS.canceled,
      orderNumber: ORDER_NUMBERS.canceled,
      createdAt: CREATED_AT.canceled,
      headline: '울 머플러',
      itemCount: 1,
      statuses: ['CANCELED'],
      paidAmount: 51_500,
    },
  ],
  nextCursor: MOCK_ORDER_IDS.canceled,
})

/** 마지막 페이지. `nextCursor` 가 `null` 이라 「더 보기」가 사라진다. */
export const shopperOrderPageTwo = defineFixture(orderListResponseSchema, {
  orders: [
    {
      id: MOCK_ORDER_IDS.deleted,
      orderNumber: ORDER_NUMBERS.deleted,
      createdAt: CREATED_AT.deleted,
      headline: '리넨 셔츠 (단종)',
      itemCount: 1,
      statuses: ['CONFIRMED'],
      paidAmount: 81_500,
    },
    {
      id: MOCK_ORDER_IDS.ancient,
      orderNumber: ORDER_NUMBERS.ancient,
      createdAt: CREATED_AT.ancient,
      headline: '캐시미어 니트 외 1건',
      itemCount: 2,
      statuses: ['CONFIRMED'],
      paidAmount: 254_000,
    },
  ],
  nextCursor: null,
})

/** 주문한 적이 없는 계정. 빈 상태를 그리는 화면이 읽는다 (P5). */
export const noOrders = defineFixture(orderListResponseSchema, {
  orders: [],
  nextCursor: null,
})
