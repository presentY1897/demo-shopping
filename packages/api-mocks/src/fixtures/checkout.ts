import { checkoutResponseSchema, orderResponseSchema } from '@shopping/shared'

import { defineFixture } from '../define'

/**
 * 주문서와 그것이 낳는 주문 (TASK-0050 의 화면이 읽는다).
 *
 * **`shopperCart` 에서 왔다.** 같은 두 판매자, 같은 상품명, 같은 단가다 — 장바구니와
 * 주문서는 한 사람이 연달아 보는 두 화면이고, 픽스처가 갈리면 「금액이 장바구니와
 * 일치한다」(F5)를 확인할 자리가 아예 없어진다.
 *
 * **품절 줄은 빠졌다.** 장바구니의 러너 스니커즈가 여기 없는 것은 빠뜨린 것이 아니라
 * 규칙이다 — 주문서는 살 수 있는 줄로만 열린다(`order-lines.ts` 의 `assertOrderable`).
 * 담긴 것과 주문할 것이 같지 않다는 사실을 이 픽스처가 들고 있다.
 *
 * **배송비가 판매자마다 다르다.** 루미에르는 무료 기준 5만원을 넘겨 0원이고,
 * 노드스텝은 기준이 없어 2,500원이 그대로 붙는다. 둘이 같으면 배송비가 주문 단위가
 * 아니라 판매자 단위로 붙는다는 것을 화면 검사가 확인할 수 없다.
 *
 * **할인은 전부 0이다.** 쿠폰·적립금은 M11 이고 주문서에는 자리만 둔다(4.5). 그래도
 * 0을 채우는 이유는 계약이 그 자리를 이미 요구하기 때문이다 — 화면은 「할인 0원」을
 * 그릴 줄 알아야 하고, M11 이 오면 바뀌는 것은 이 숫자뿐이다.
 *
 * **`expiresAt` 은 고정된 시각이다.** 「지금 + 15분」을 계산해 넣으면 타이머가 무엇을
 * 보여 주는지를 값으로 검사할 수 없다. 시각을 못 박고 `vi.setSystemTime` 으로 지금을
 * 옮기는 편이 남은 시간을 원하는 값으로 정확히 고를 수 있다 — F2 의 「3분 이하
 * 강조」가 그렇게 검사되는 기준이다.
 */

const SELLER_A = '019596d0-1f1c-7c2e-9a0e-5a0000000001'
const SELLER_B = '019596d0-1f1c-7c2e-9a0e-5a0000000002'

/** 15분 뒤. 이 주문서는 04:00 에 열린 것으로 친다. */
const EXPIRES_AT = '2026-09-05T04:15:00.000Z'

/**
 * 주문서·주문·항목의 id.
 *
 * 내보내지 않는다 — `registry.spec.ts` 가 픽스처 파일의 **모든 export 는 픽스처**임을
 * 요구한다. 주문서 id 가 필요한 쪽은 `shopperCheckout.checkout.id` 에서 읽으면 되고,
 * 그 편이 「어느 주문서를 여는가」를 상수 이름이 아니라 픽스처로 가리키게 한다.
 */
const CHECKOUT_ID = '019596d0-1f1c-7c2e-9a0e-5e0000000001'
const ORDER_ID = '019596d0-1f1c-7c2e-9a0e-5f0000000001'
const SELLER_ORDER_IDS = {
  lumiere: '019596d0-1f1c-7c2e-9a0e-5f0000000002',
  nodestep: '019596d0-1f1c-7c2e-9a0e-5f0000000003',
} as const
const ORDER_ITEM_IDS = {
  coat: '019596d0-1f1c-7c2e-9a0e-5f0000000004',
  knit: '019596d0-1f1c-7c2e-9a0e-5f0000000005',
  scarf: '019596d0-1f1c-7c2e-9a0e-5f0000000006',
} as const

/**
 * 주문서의 한 줄. 주문의 한 줄과 **`id` 만 다르다**.
 *
 * 그래서 두 벌을 적지 않고 이것을 편다 — 두 벌을 적으면 단가나 수량이 한쪽에서만
 * 바뀌는 날이 오고, 그때 「주문서에서 본 것과 산 것이 다르다」가 픽스처 안에서
 * 표현 가능해진다. 계약이 그것을 막으려고 같은 모양을 쓰는 것이므로 픽스처도 그렇게
 * 둔다 (`checkoutSchema` 의 `sellerOrders` 가 `orderItemSchema.omit({ id })` 다).
 */
const COAT_LINE = {
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

const KNIT_LINE = {
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
  productAmount: 118_000 * 2,
  couponDiscountAmount: 0,
  pointDiscountAmount: 0,
  discountAmount: 0,
}

/**
 * 옵션이 없는 줄. `optionLabel` 이 빈 문자열이고 `null` 이 아니다 (계약이 그렇다).
 *
 * 단가는 장바구니가 「가격이 올랐다」고 알린 뒤의 값 49,000원이다 — 주문서가 무엇으로
 * 계산하는지가 그 안내의 뒷면이다.
 */
const SCARF_LINE = {
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

const LUMIERE_PRODUCT_AMOUNT = 189_000 + 118_000 * 2
const NODESTEP_PRODUCT_AMOUNT = 49_000
/** 노드스텝은 무료 기준이 없다. 루미에르는 5만원을 넘겨 0원이다. */
const NODESTEP_SHIPPING_FEE = 2_500

/** 장바구니에서 고른 세 줄로 연 주문서. */
export const shopperCheckout = defineFixture(checkoutResponseSchema, {
  checkout: {
    id: CHECKOUT_ID,
    expiresAt: EXPIRES_AT,
    sellerOrders: [
      {
        sellerId: SELLER_A,
        brandName: '루미에르',
        items: [COAT_LINE, KNIT_LINE],
        productAmount: LUMIERE_PRODUCT_AMOUNT,
        couponDiscountAmount: 0,
        pointDiscountAmount: 0,
        shippingPointAmount: 0,
        shippingFee: 0,
        paidAmount: LUMIERE_PRODUCT_AMOUNT,
      },
      {
        sellerId: SELLER_B,
        brandName: '노드스텝',
        items: [SCARF_LINE],
        productAmount: NODESTEP_PRODUCT_AMOUNT,
        couponDiscountAmount: 0,
        pointDiscountAmount: 0,
        shippingPointAmount: 0,
        shippingFee: NODESTEP_SHIPPING_FEE,
        paidAmount: NODESTEP_PRODUCT_AMOUNT + NODESTEP_SHIPPING_FEE,
      },
    ],
    totalProductAmount: LUMIERE_PRODUCT_AMOUNT + NODESTEP_PRODUCT_AMOUNT,
    totalCouponDiscountAmount: 0,
    totalPointDiscountAmount: 0,
    totalShippingFee: NODESTEP_SHIPPING_FEE,
    paidAmount: LUMIERE_PRODUCT_AMOUNT + NODESTEP_PRODUCT_AMOUNT + NODESTEP_SHIPPING_FEE,
  },
})

/**
 * 그 주문서로 만들어진 주문 (`POST /orders` 의 답).
 *
 * **판매자 몫이 둘 다 `PAYMENT_PENDING` 이다.** 주문이 생겨도 재고는 한 개도 줄지
 * 않고 예약은 `HELD` 로 남는다(TASK-0049 4.4) — 확정은 결제 승인(M08)의 일이다.
 * 주문서 화면이 이 응답을 받고 하는 일도 「결제로 간다」뿐이다.
 *
 * **수령인은 기본 배송지에서 복사된 값이다.** `fixtures/profile.ts` 의 `addressHome`
 * 과 같은 사람·같은 주소이되 `addressId` 는 남지 않는다 — 주소록에서 그 줄을 지워도
 * 주문서는 그대로여야 하기 때문이다 (TASK-0049 4.6).
 *
 * 주문번호는 `ORDER_NUMBER_PATTERN` 을 따른다. 앞이 한국 시각의 날짜이고 뒤 여덟
 * 자리는 `I`·`L`·`O`·`U` 가 빠진 32글자에서 온다 — 전화로 불러 줄 수 있어야 하는
 * 번호이므로 0/O 를 헷갈릴 자리가 없다.
 */
export const shopperOrder = defineFixture(orderResponseSchema, {
  order: {
    id: ORDER_ID,
    orderNumber: '20260905-7KQ3M2VB',
    createdAt: '2026-09-05T04:02:30.000Z',
    recipient: {
      name: '김민준',
      phone: '010-2345-6789',
      postalCode: '06236',
      addressLine1: '서울특별시 강남구 테헤란로 152',
      addressLine2: '11층 1103호',
    },
    sellerOrders: [
      {
        id: SELLER_ORDER_IDS.lumiere,
        sellerId: SELLER_A,
        brandName: '루미에르',
        status: 'PAYMENT_PENDING',
        shipment: null,
        // 방금 만들어진 주문이라 이력이 **한 줄**이다. 실제 서버가 주문을 저장할
        // 때 `null → PAYMENT_PENDING` 을 함께 적고(주체는 `SYSTEM`), 그 줄이 곧
        // 「언제 접수됐나」다.
        history: [
          {
            id: '019596d0-1f1c-7c2e-9a0e-5e0000000001',
            fromStatus: null,
            toStatus: 'PAYMENT_PENDING',
            actor: 'SYSTEM',
            reason: null,
            occurredAt: '2026-09-05T04:02:30.000Z',
          },
        ],
        items: [
          { id: ORDER_ITEM_IDS.coat, ...COAT_LINE },
          { id: ORDER_ITEM_IDS.knit, ...KNIT_LINE },
        ],
        productAmount: LUMIERE_PRODUCT_AMOUNT,
        couponDiscountAmount: 0,
        pointDiscountAmount: 0,
        shippingPointAmount: 0,
        shippingFee: 0,
        paidAmount: LUMIERE_PRODUCT_AMOUNT,
      },
      {
        id: SELLER_ORDER_IDS.nodestep,
        sellerId: SELLER_B,
        brandName: '노드스텝',
        status: 'PAYMENT_PENDING',
        shipment: null,
        history: [
          {
            id: '019596d0-1f1c-7c2e-9a0e-5e0000000002',
            fromStatus: null,
            toStatus: 'PAYMENT_PENDING',
            actor: 'SYSTEM',
            reason: null,
            occurredAt: '2026-09-05T04:02:30.000Z',
          },
        ],
        items: [{ id: ORDER_ITEM_IDS.scarf, ...SCARF_LINE }],
        productAmount: NODESTEP_PRODUCT_AMOUNT,
        couponDiscountAmount: 0,
        pointDiscountAmount: 0,
        shippingPointAmount: 0,
        shippingFee: NODESTEP_SHIPPING_FEE,
        paidAmount: NODESTEP_PRODUCT_AMOUNT + NODESTEP_SHIPPING_FEE,
      },
    ],
    totalProductAmount: LUMIERE_PRODUCT_AMOUNT + NODESTEP_PRODUCT_AMOUNT,
    totalCouponDiscountAmount: 0,
    totalPointDiscountAmount: 0,
    totalShippingFee: NODESTEP_SHIPPING_FEE,
    paidAmount: LUMIERE_PRODUCT_AMOUNT + NODESTEP_PRODUCT_AMOUNT + NODESTEP_SHIPPING_FEE,
  },
})
