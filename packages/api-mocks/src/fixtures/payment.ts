import { priceSchema } from '@shopping/shared'
import { z } from 'zod'

import { defineFixture } from '../define'

/**
 * 가상 카드 (TASK-0054 의 결제 화면이 고른다).
 *
 * **`IssuedCard` 는 `@shopping/shared` 에 없다.** 카드는 가상 카드 프로바이더의
 * 사정이고 계약에 오른 적이 없어서, `apps/api/src/payment/virtual-card.service.ts`
 * 가 그 모양을 자기 파일 안에서만 선언하고 있다. 그래서 여기서 같은 모양을 한 벌 더
 * 적는다 — 지어낸 것이 아니라 **서버가 실제로 내보내는 필드 그대로**이고, 계약이
 * `@shopping/shared` 로 옮겨 오면 이 선언이 지워질 자리다.
 *
 * 이 스키마를 내보내지 않는 이유는 `registry.spec.ts` 다 — 픽스처 파일의 모든
 * export 는 픽스처여야 한다. 화면 쪽에도 같은 스키마가 한 벌 있고
 * (`apps/shop/src/lib/payment/payment-api.ts`), 둘이 갈리면 **화면 검사가**
 * `malformed_response` 로 잡는다: 목의 응답을 파싱하는 것이 그 스키마이기 때문이다.
 *
 * **세 장이 서로 다른 대답을 만든다.** 카드가 한 장이면 이 화면이 그려야 하는 것의
 * 대부분이 표현되지 않는다 — 고를 수 있는 카드와 고를 수 없는 카드가 한 화면에
 * 있어야 「보여 주되 비활성」(TASK-0023 4장)이 확인되고, 한도가 모자란 카드가 있어야
 * 거절이 값으로 오는 길(4.3)을 화면이 지난다.
 */

const cardStatusSchema = z.enum(['ACTIVE', 'SUSPENDED', 'DELETED'])

const issuedCardSchema = z.object({
  id: z.uuid(),
  /** 앞 네 자리는 언제나 `9999` 다 — 실제 BIN 과 겹치지 않는다 (TASK-0053 R1). */
  maskedNumber: z.string(),
  brand: z.string(),
  creditLimit: priceSchema,
  /** 원장 합계와 같아야 하는 값. 사용 가능액은 한도에서 이것을 뺀 것이다. */
  usedAmount: priceSchema,
  status: cardStatusSchema,
  expiresAt: z.iso.datetime(),
})

const cardListResponseSchema = z.object({ cards: z.array(issuedCardSchema) })

/** 3년. 실물 카드의 관례를 따른 값이고, 검사가 시간을 옮겨도 만료되지 않는다. */
const EXPIRES_AT = '2029-09-05T00:00:00.000Z'

/**
 * 로그인한 사람의 카드 세 장.
 *
 * `shopperCheckout` 의 결제예정금액은 476,500원이다. 첫 장은 그것을 덮고 둘째 장은
 * 덮지 못한다 — **한도 초과를 재현하는 것이 이 TASK 의 핵심 가치**(2장)이므로, 그
 * 카드는 빠뜨린 것이 아니라 있어야 하는 것이다.
 *
 * `DELETED` 는 없다. 서버의 `list` 가 살아 있는 카드만 내보내므로 화면이 그것을 볼
 * 길이 없고, 볼 수 없는 것을 대역이 보여 주면 화면은 있지도 않은 경우를 그리게 된다.
 */
export const shopperCards = defineFixture(cardListResponseSchema, {
  cards: [
    {
      id: '019596d0-1f1c-7c2e-9a0e-6a0000000001',
      maskedNumber: '9999-****-****-4193',
      brand: '누리카드',
      creditLimit: 1_000_000,
      usedAmount: 300_000,
      status: 'ACTIVE',
      expiresAt: EXPIRES_AT,
    },
    {
      id: '019596d0-1f1c-7c2e-9a0e-6a0000000002',
      maskedNumber: '9999-****-****-7025',
      brand: '한결카드',
      creditLimit: 300_000,
      usedAmount: 250_000,
      status: 'ACTIVE',
      expiresAt: EXPIRES_AT,
    },
    {
      id: '019596d0-1f1c-7c2e-9a0e-6a0000000003',
      maskedNumber: '9999-****-****-8810',
      brand: '새벽카드',
      creditLimit: 500_000,
      usedAmount: 0,
      status: 'SUSPENDED',
      expiresAt: EXPIRES_AT,
    },
  ],
})

/**
 * 카드가 한 장도 없는 사람.
 *
 * 「없음」을 인자가 아니라 픽스처로 두는 이유는 그것이 **서버가 실제로 내보내는
 * 응답**이기 때문이다 — 빈 배열은 오류가 아니라 아직 카드를 받지 않은 계정의 정상적인
 * 대답이고, 화면은 그때 카드를 만들러 갈 곳을 알려 줘야 한다.
 */
export const noCards = defineFixture(cardListResponseSchema, { cards: [] })
