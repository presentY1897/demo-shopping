import { cartResponseSchema } from '@shopping/shared'

import { defineFixture } from '../define'

/**
 * 장바구니, `apps/api` 가 답하는 대로 (TASK-0045) 그리고 화면이 읽는 대로 (TASK-0046).
 *
 * **두 판매자, 네 줄.** 화면이 그려야 하는 것이 판매자별 묶음이므로 하나로는 아무
 * 것도 증명하지 못하고, 각 그룹의 배송 정책이 **다르다** — 한쪽은 무료 기준이 있고
 * 한쪽은 없다. 둘이 같으면 정책이 그룹에서 온다는 것을 검사가 확인할 수 없다.
 *
 * 한 줄은 **품절**이고 한 줄은 **가격이 올랐다.** 둘 다 지우지 않고 남기는 것이
 * 규약이고(4장), 사람이 할 일이 다르므로 낱말도 다르다 — 하나는 기다리는 것이고
 * 하나는 다시 볼지 정하는 것이다.
 */

const SELLER_A = '019596d0-1f1c-7c2e-9a0e-5a0000000001'
const SELLER_B = '019596d0-1f1c-7c2e-9a0e-5a0000000002'

/**
 * 줄 id.
 *
 * 내보내지 않는다 — `registry.spec.ts` 가 픽스처 파일의 **모든 export 는 픽스처**
 * 임을 요구한다. 검사가 특정 줄을 가리킬 때는 이 픽스처에서 찾아 쓴다: 「품절인
 * 줄」은 상수 이름이 아니라 `notices` 로 알아보는 편이 읽기에도 낫다.
 */
const ITEM_IDS = {
  coat: '019596d0-1f1c-7c2e-9a0e-5b0000000001',
  knit: '019596d0-1f1c-7c2e-9a0e-5b0000000002',
  sneakers: '019596d0-1f1c-7c2e-9a0e-5b0000000003',
  scarf: '019596d0-1f1c-7c2e-9a0e-5b0000000004',
} as const

export const shopperCart = defineFixture(cartResponseSchema, {
  groups: [
    {
      sellerId: SELLER_A,
      brandName: '루미에르',
      productAmount: 189_000 + 118_000 * 2,
      // 5만원 이상 무료. 이 그룹은 이미 넘겼으므로 「더 담으면 무료」가 나오지
      // 않는다 — 그것이 F6 의 「충족 시 사라짐」이다.
      shippingFee: 3_000,
      freeShippingThreshold: 50_000,
      items: [
        {
          id: ITEM_IDS.coat,
          variantId: '019596d0-1f1c-7c2e-9a0e-5c0000000001',
          productId: '019596d0-1f1c-7c2e-9a0e-5d0000000001',
          productName: '울 롱코트',
          optionLabel: '블랙 / M',
          thumbnailUrl: null,
          sku: 'LUMICOAT-1',
          quantity: 1,
          price: 189_000,
          priceAtAdded: 189_000,
          stock: 4,
          maxPurchaseQuantity: 2,
          notices: [],
        },
        {
          id: ITEM_IDS.knit,
          variantId: '019596d0-1f1c-7c2e-9a0e-5c0000000002',
          productId: '019596d0-1f1c-7c2e-9a0e-5d0000000002',
          productName: '캐시미어 니트',
          optionLabel: '그레이 / L',
          thumbnailUrl: null,
          sku: 'LUMIKNIT-2',
          quantity: 2,
          price: 118_000,
          priceAtAdded: 118_000,
          stock: 7,
          maxPurchaseQuantity: null,
          notices: [],
        },
      ],
    },
    {
      sellerId: SELLER_B,
      brandName: '노드스텝',
      productAmount: 96_000 + 49_000,
      // 무료 조건이 없다. `null` 과 `0` 이 다르다는 것을 픽스처가 들고 있다.
      shippingFee: 2_500,
      freeShippingThreshold: null,
      items: [
        {
          id: ITEM_IDS.sneakers,
          variantId: '019596d0-1f1c-7c2e-9a0e-5c0000000003',
          productId: '019596d0-1f1c-7c2e-9a0e-5d0000000003',
          productName: '러너 스니커즈',
          optionLabel: '270',
          thumbnailUrl: null,
          sku: 'NODE-RUN-270',
          quantity: 1,
          price: 96_000,
          priceAtAdded: 96_000,
          stock: 0,
          maxPurchaseQuantity: null,
          notices: ['sold_out'],
        },
        {
          id: ITEM_IDS.scarf,
          variantId: '019596d0-1f1c-7c2e-9a0e-5c0000000004',
          productId: '019596d0-1f1c-7c2e-9a0e-5d0000000004',
          productName: '울 머플러',
          optionLabel: '',
          thumbnailUrl: null,
          sku: 'NODE-SCARF',
          quantity: 1,
          price: 49_000,
          priceAtAdded: 39_000,
          stock: 12,
          maxPurchaseQuantity: null,
          notices: ['price_increased'],
        },
      ],
    },
  ],
  totalProductAmount: 189_000 + 118_000 * 2 + 96_000 + 49_000,
  itemCount: 4,
})

/** 빈 장바구니 (F7). 그룹이 없다 — 「0원짜리 그룹」이 아니다. */
export const emptyCart = defineFixture(cartResponseSchema, {
  groups: [],
  totalProductAmount: 0,
  itemCount: 0,
})
