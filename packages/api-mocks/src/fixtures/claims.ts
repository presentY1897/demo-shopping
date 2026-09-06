import { claimableResponseSchema } from '@shopping/shared'

import { defineFixture } from '../define'
import {
  MOCK_CLAIM_RETURN_WINDOW_CLOSED_AT,
  MOCK_CLAIM_SELLER_ORDER_IDS,
} from '../handlers/claim-contract'

/**
 * 클레임 대역이 저장소를 세울 때 읽는 씨앗 (TASK-0066).
 *
 * **주문 대역에 없는 두 상태만 여기 있다.** 나머지 다섯 몫은 `handlers/orders.ts` 의
 * 저장소에서 그대로 읽는다 — 같은 묶음을 픽스처에 한 벌 더 적으면 주문 상세가
 * 그리는 항목과 신청 화면이 그리는 항목이 갈리고, 그 어긋남은 목의 사정인데 화면의
 * 결함처럼 보인다.
 *
 * 두 몫이 필요한 이유는 상태에 있다. `PAID` 인 묶음은 주문 픽스처에 없는데
 * **자동 승인이 그 상태에서만 일어나고**(TASK-0066 4장), 「배송완료지만 기간이
 * 지났다」는 `DELIVERED` 와 같은 상태라 시각으로만 갈린다.
 *
 * 값이 `claimableResponseSchema` 를 지나는 것은 이것이 곧 **처음 물었을 때의 답**
 * 이기 때문이다. 항목만 든 자체 모양을 세우면 계약에 없는 스키마가 한 벌 생기고,
 * 그 답이 정말 계약을 지나는지는 아무도 재지 않게 된다 (게이트 C2).
 *
 * 가게와 상품은 `fixtures/orders.ts` 의 것을 그대로 쓴다. 브랜드를 새로 지으면 한
 * 사람의 주문 이력에 처음 보는 가게가 끼어든다.
 */

/**
 * 결제완료 몫이 들고 있는 세 줄 — **수량 1 · 2 · 3**.
 *
 * 「항목 셋 중 하나, 그 수량 중 일부」가 이 도메인의 정상 흐름이다 (D-027). 수량이
 * 전부 1이면 부분 취소를 잴 자리가 없어진다 — 한 줄을 통째로 거는 것과 그 줄의 두
 * 개 중 하나만 거는 것이 화면에서 같은 조작이 되어 버린다.
 */
export const shopperPaidClaimable = defineFixture(claimableResponseSchema, {
  sellerOrderId: MOCK_CLAIM_SELLER_ORDER_IDS.paid,
  type: 'CANCEL',
  refusal: null,
  // 취소에는 기간이 없다. 물건이 아직 떠나지 않아 기다릴 것이 없다.
  returnWindowEndsAt: null,
  items: [
    {
      orderItemId: '019596d0-1f1c-7c2e-9a0e-6b0000000011',
      variantId: '019596d0-1f1c-7c2e-9a0e-5c0000000001',
      snapshot: {
        productId: '019596d0-1f1c-7c2e-9a0e-5d0000000001',
        productName: '울 롱코트',
        optionLabel: '블랙 / M',
        sku: 'LUMICOAT-1',
        thumbnailUrl: null,
        brandName: '루미에르',
      },
      quantity: 1,
      claimedQuantity: 0,
      remainingQuantity: 1,
    },
    {
      orderItemId: '019596d0-1f1c-7c2e-9a0e-6b0000000012',
      variantId: '019596d0-1f1c-7c2e-9a0e-5c0000000002',
      snapshot: {
        productId: '019596d0-1f1c-7c2e-9a0e-5d0000000002',
        productName: '캐시미어 니트',
        optionLabel: '그레이 / L',
        sku: 'LUMIKNIT-2',
        thumbnailUrl: null,
        brandName: '루미에르',
      },
      quantity: 2,
      claimedQuantity: 0,
      remainingQuantity: 2,
    },
    {
      /**
       * 같은 상품의 다른 옵션. 줄이 다르면 **잔여도 따로** 센다는 것이 여기서만
       * 드러난다 — 상품 단위로 세는 화면은 위의 두 개와 이 세 개를 합쳐 버린다.
       */
      orderItemId: '019596d0-1f1c-7c2e-9a0e-6b0000000013',
      variantId: '019596d0-1f1c-7c2e-9a0e-5c0000000003',
      snapshot: {
        productId: '019596d0-1f1c-7c2e-9a0e-5d0000000002',
        productName: '캐시미어 니트',
        optionLabel: '네이비 / M',
        sku: 'LUMIKNIT-3',
        thumbnailUrl: null,
        brandName: '루미에르',
      },
      quantity: 3,
      claimedQuantity: 0,
      remainingQuantity: 3,
    },
  ],
})

/**
 * 기간이 지난 배송완료 몫. 줄은 하나뿐이다.
 *
 * **거절이 항목의 문제가 아니라는 것**이 이 픽스처가 말하는 전부라, 줄을 늘려도
 * 답이 달라지지 않는다. 대신 `items` 가 비어 있지는 않다 — 화면은 신청할 수 없는
 * 주문에서도 「무엇이 있었는지」를 그린다.
 */
export const shopperWindowClosedClaimable = defineFixture(claimableResponseSchema, {
  sellerOrderId: MOCK_CLAIM_SELLER_ORDER_IDS.windowClosed,
  type: null,
  refusal: 'window_closed',
  returnWindowEndsAt: MOCK_CLAIM_RETURN_WINDOW_CLOSED_AT,
  items: [
    {
      orderItemId: '019596d0-1f1c-7c2e-9a0e-6b0000000014',
      variantId: '019596d0-1f1c-7c2e-9a0e-5c0000000005',
      snapshot: {
        productId: '019596d0-1f1c-7c2e-9a0e-5d0000000005',
        productName: '스웨이드 첼시부츠',
        optionLabel: '카멜 / 260',
        sku: 'MARU-BOOT-260',
        thumbnailUrl: 'https://cdn.test.invalid/products/maru-boot.webp',
        brandName: '마루상회',
      },
      quantity: 1,
      claimedQuantity: 0,
      remainingQuantity: 1,
    },
  ],
})
