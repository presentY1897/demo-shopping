import { priceSchema } from '@shopping/shared'
import { z } from 'zod'

/**
 * 가상 카드의 계약, 이 패키지 안에서 **한 벌만** (TASK-0053 · 0058).
 *
 * **`IssuedCard` 는 `@shopping/shared` 에 없다.** 카드는 가상 카드 프로바이더의
 * 사정이라 계약에 오른 적이 없고, 서버는 그 모양을
 * `apps/api/src/payment/virtual-card.service.ts` 안에서만 선언한다. 그래서 대역이
 * 같은 모양을 한 벌 적는다 — 지어낸 것이 아니라 **서버가 실제로 내보내는 필드
 * 그대로**이고, 계약이 `@shopping/shared` 로 옮겨 오는 날 통째로 지워질 파일이다.
 *
 * 픽스처(`fixtures/payment.ts`)와 핸들러(`handlers/payment.ts`)가 **둘 다** 이
 * 스키마를 필요로 한다. 픽스처 파일은 픽스처 말고 아무것도 내보낼 수 없으므로
 * (`registry.spec.ts`) 그 안에 두면 핸들러가 자기 사본을 하나 더 갖게 되고, 한
 * 패키지 안의 두 사본은 **아무도 못 보는 채로 갈라진다** — 게이트 C2 가 잡으려는
 * 것이 정확히 그 드리프트다. 그래서 둘 다 여기서 읽는다.
 *
 * 화면 쪽에도 같은 모양이 한 벌 있고(`apps/shop/src/lib/payment/payment-api.ts`),
 * 그쪽과 갈리는 것은 **화면 검사가** `malformed_response` 로 잡는다: 목의 응답을
 * 파싱하는 것이 그 스키마이기 때문이다.
 */

export const cardStatusSchema = z.enum(['ACTIVE', 'SUSPENDED', 'DELETED'])

export const issuedCardSchema = z.object({
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

export type IssuedCard = z.infer<typeof issuedCardSchema>

export const cardListResponseSchema = z.object({ cards: z.array(issuedCardSchema) })

/** 발급·정지·해제가 돌려주는 봉투. 목록과 같은 모양의 카드 한 장이다. */
export const cardResponseSchema = z.object({ card: issuedCardSchema })

/**
 * 원장 한 줄 (TASK-0058 4.1 이 더한 라우트).
 *
 * **`amount` 에 부호가 있다.** 승인은 양수, 취소·환불은 음수다 — 그래서 여기만
 * `priceSchema` 를 쓰지 않는다(그것은 0 이상만 받는다). 절댓값만 보내고 종류로
 * 방향을 추측하게 두면 화면이 두 벌의 진실을 갖게 된다.
 *
 * `orderNumber` 와 `orderId` 는 **결제를 거친 줄만** 갖는다 (4.2). 카드는 결제
 * 말고도 쓸 수 있으므로 `null` 인 줄은 잘못된 줄이 아니라 링크가 없는 줄이다.
 */
export const cardTransactionSchema = z.object({
  id: z.uuid(),
  kind: z.enum(['CHARGE', 'CANCEL', 'REFUND']),
  amount: z.int(),
  /** 이 사건 직후의 `usedAmount`. 대사가 가능한 것은 이 열 때문이다. */
  balanceAfter: priceSchema,
  createdAt: z.iso.datetime(),
  orderNumber: z.string().nullable(),
  orderId: z.uuid().nullable(),
})

export type CardTransaction = z.infer<typeof cardTransactionSchema>

export const cardTransactionsResponseSchema = z.object({
  transactions: z.array(cardTransactionSchema),
})

/**
 * `POST /cards` 의 몸통. `payment.controller.ts` 의 `issueCardSchema` 와 같다.
 *
 * 상한이 있는 이유는 실수 때문이다 — 원 단위 정수라 0을 하나 더 치면 열 배가 되고,
 * 그 카드로는 무엇을 사도 한도 초과가 나지 않아 **재현 장치로서 쓸모가 없어진다.**
 * 하한이 있는 이유는 그 반대다: 1원짜리 카드는 어떤 주문도 통과시키지 못한다.
 */
export const CARD_LIMIT_MIN = 1_000
export const CARD_LIMIT_MAX = 10_000_000

export const issueCardRequestSchema = z.object({
  creditLimit: z.int().min(CARD_LIMIT_MIN).max(CARD_LIMIT_MAX),
})

/**
 * 한 사람이 가질 수 있는 장수 (`virtual-card-rules.ts` 의 `VIRTUAL_CARDS_PER_USER`).
 *
 * 그 상수도 `@shopping/shared` 가 아니라 `apps/api` 에 있어서 여기 다시 적는다.
 * 이 숫자가 화면에 값을 하는 이유는 **막다른 길이 생기기 때문**이다 — 셋을 채운
 * 사람에게 발급을 거절하면서 지울 방법을 주지 않으면 화면이 거기서 끝난다.
 */
export const MOCK_CARDS_PER_USER = 3

/**
 * 대역의 카드가 만료되는 날. 3년은 실물 카드의 관례를 따른 것이다.
 *
 * 발급 시각에서 계산하지 않고 고정한 이유는 씨앗 카드와 방금 발급한 카드가 **같은
 * 값**을 갖게 하기 위해서다 — 검사가 「만료일이 보인다」를 물을 때 두 카드가 서로
 * 다른 문장을 내면 그 검사는 발급 경로를 지나지 않은 채로도 통과한다.
 */
export const MOCK_CARD_EXPIRES_AT = '2029-09-05T00:00:00.000Z'
