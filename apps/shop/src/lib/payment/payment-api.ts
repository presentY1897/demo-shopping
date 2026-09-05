import type { Payment } from '@shopping/shared'
import { paymentResponseSchema, priceSchema } from '@shopping/shared'
import { z } from 'zod'

import { getApiClient } from '@/lib/api'

/**
 * 결제와 카드를 부르는 자리 (TASK-0054 의 라우트).
 *
 * **승인과 매입이 두 번의 요청인 것은 가상 카드의 사정이 아니라 계약이다** (D-031).
 * 가상 카드는 그 사이에 아무 일도 하지 않지만 토스에는 은행이 있고, 화면이
 * 프로바이더에 따라 다른 순서를 밟으면 추상화가 아무 일도 하지 않는 것이 된다.
 * 그래서 여기에는 프로바이더 이름이 딱 한 번, 시작할 때만 나온다.
 *
 * **`IssuedCard` 는 아직 `@shopping/shared` 에 없다.** 카드는 가상 카드
 * 프로바이더의 사정이라 계약에 오른 적이 없고, 서버는 그 모양을
 * `apps/api/src/payment/virtual-card.service.ts` 안에서만 선언하고 있다. 그래서
 * 여기서 같은 모양을 한 벌 적는다 — 지어낸 것이 아니라 **서버가 실제로 내보내는
 * 필드 그대로**이고, 계약이 `@shopping/shared` 로 옮겨 오는 날 지워질 선언이다.
 * 그때까지 이 스키마가 하는 일은 두 가지다: 응답을 파싱해 계약에서 벗어난 몸통을
 * 화면이 아니라 여기서 실패시키고, 대역(`@shopping/api-mocks`)이 같은 모양을
 * 내보내는지를 검사가 지나갈 때마다 확인한다.
 */

/**
 * 카드가 지날 수 있는 세 상태 (`virtual-card-rules.ts`).
 *
 * **되살릴 수 있는가로 가른 이름이다** (TASK-0054 4.1). `SUSPENDED` 는 정지지 삭제가
 * 아니고, 그래서 화면도 그 카드를 지우지 않고 비활성으로 남긴다.
 */
export const cardStatuses = ['ACTIVE', 'SUSPENDED', 'DELETED'] as const

export type CardStatus = (typeof cardStatuses)[number]

export const issuedCardSchema = z.object({
  id: z.uuid(),
  /** 앞 네 자리는 언제나 `9999` 다 — 실제 BIN 과 겹치지 않는다 (TASK-0053 R1). */
  maskedNumber: z.string(),
  brand: z.string(),
  creditLimit: priceSchema,
  /** 원장 합계와 같아야 하는 값. 사용 가능액은 한도에서 이것을 뺀 것이다. */
  usedAmount: priceSchema,
  status: z.enum(cardStatuses),
  expiresAt: z.iso.datetime(),
})

export type IssuedCard = z.infer<typeof issuedCardSchema>

export const cardListResponseSchema = z.object({ cards: z.array(issuedCardSchema) })

export type CardListResponse = z.infer<typeof cardListResponseSchema>

/** 내 카드들. 경로에 사용자 id 가 없다 — 주인은 토큰이 정한다. */
export function fetchCards(
  options: { readonly signal?: AbortSignal } = {},
): Promise<CardListResponse> {
  return getApiClient().request({ path: '/cards', schema: cardListResponseSchema, ...options })
}

/**
 * 결제를 연다. `READY` 인 결제가 하나 생긴다.
 *
 * **금액을 보내지 않는다.** 승인액은 주문이 정하고, 보내게 두면 그 숫자가 주문과
 * 다를 수 있으며 그때 어느 쪽이 맞는지를 정해야 한다 — 정할 수 없는 질문이다.
 *
 * 이름에 `Card` 가 붙은 것은 TASK-0055 4.6 과 같은 이유다. 두 번째 프로바이더가
 * 붙는 순간 「결제를 연다」는 이름은 **어느 결제인지 말하지 않는 이름**이 되고,
 * 카드 id 를 받는 시그니처가 그 거짓을 드러낸다.
 */
export async function startCardPayment(orderId: string, cardId: string): Promise<Payment> {
  const { payment } = await getApiClient().request({
    path: '/payments',
    method: 'POST',
    body: { orderId, provider: 'VIRTUAL_CARD', cardId },
    schema: paymentResponseSchema,
  })

  return payment
}

/**
 * 토스로 결제를 연다 (TASK-0055).
 *
 * **`cardId` 를 보내지 않는다.** 어느 카드로 낼지는 결제창 안에서 정해지는 일이고,
 * 그 결과가 우리에게 오는 것은 승인 뒤의 `paymentKey` 뿐이다 — 그 자리를 서버는
 * `methodRef` 라 부른다 (4.6).
 *
 * 돌아온 결제의 **`id` 가 결제창의 `orderId`** 이고 **`authorizedAmount` 가 결제창에
 * 넣을 금액**이다. 둘 다 서버가 정한 값을 그대로 쓴다 — 화면이 들고 있던 숫자를
 * 쓰면 승인 단계의 대조(F2)가 우리 화면의 실수까지 잡아내는 장치가 된다.
 */
export async function startTossPayment(orderId: string): Promise<Payment> {
  const { payment } = await getApiClient().request({
    path: '/payments',
    method: 'POST',
    body: { orderId, provider: 'TOSS' },
    schema: paymentResponseSchema,
  })

  return payment
}

/**
 * 결제창에서 돌아온 뒤의 승인 (TASK-0055 F1 · F2).
 *
 * **`authorize` 와 다른 라우트인 이유**는 이 단계에만 대조할 것이 있기 때문이다.
 * 서버는 받은 `amount` 를 DB 의 승인액과 맞춰 본 **뒤에야** 토스를 부른다 —
 * 어긋나면 400 이고, 그때 저쪽에는 아무 승인도 남지 않는다.
 *
 * 거절은 여기서도 값이다. 카드사가 받아 주지 않은 것은 200 과 함께 `FAILED` 인
 * 결제로 오고, 예외로 오는 것은 **우리가 승인을 요청조차 못 한 경우**다.
 */
export async function confirmTossPayment(
  paymentId: string,
  paymentKey: string,
  amount: number,
): Promise<Payment> {
  const { payment } = await getApiClient().request({
    path: `/payments/${paymentId}/toss/confirm`,
    method: 'POST',
    body: { paymentKey, amount },
    schema: paymentResponseSchema,
  })

  return payment
}

/**
 * 승인.
 *
 * **거절이 오류가 아니다** (TASK-0052 4.3). 한도가 모자라 승인되지 않은 것은
 * 정상적인 대답이므로 200 과 함께 `FAILED` 인 결제가 온다 — 부르는 쪽은 던져진
 * 예외가 아니라 **상태**를 보고 다음을 정한다.
 */
export async function authorizePayment(paymentId: string): Promise<Payment> {
  const { payment } = await getApiClient().request({
    path: `/payments/${paymentId}/authorize`,
    method: 'POST',
    schema: paymentResponseSchema,
  })

  return payment
}

/** 매입 확정. 여기가 끝나야 주문이 `PAID` 로 가고 예약이 확정된다 (4.2). */
export async function capturePayment(paymentId: string): Promise<Payment> {
  const { payment } = await getApiClient().request({
    path: `/payments/${paymentId}/capture`,
    method: 'POST',
    schema: paymentResponseSchema,
  })

  return payment
}
