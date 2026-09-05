import { z } from 'zod'

import { priceSchema } from './products.js'

/**
 * 결제의 계약 (TASK-0052).
 *
 * **프로바이더가 둘이어야 추상화가 장식이 아닌 실제 설계가 된다** (D-031). 가상
 * 카드는 우리가 만들고 토스는 남이 만든 것이라, 하나만 두면 그 하나의 모양이 곧
 * 인터페이스가 되어 버린다.
 *
 * 여기 있는 것은 **선을 넘어가는 모양**뿐이다. 프로바이더 포트
 * (`authorize`/`capture`/`cancel`/`refund`)는 서버 안에서만 사는 것이라
 * `apps/api` 에 있다 — 브라우저 번들이 결제사와 대화하는 개념을 들고 다닐 이유가
 * 없다 (4.2).
 */

/**
 * 누가 결제를 처리했나.
 *
 * `VIRTUAL_CARD` 는 우리가 만든 것이고 `TOSS` 는 남이 만든 것이다. 둘을 같은
 * 인터페이스 뒤에 두는 것이 M08 의 전부이고, 그래서 이 열거형은 **구현을 고르는
 * 열쇠**이지 화면이 분기할 이름이 아니다.
 */
export const paymentProviders = ['VIRTUAL_CARD', 'TOSS'] as const

export type PaymentProviderName = (typeof paymentProviders)[number]

export const paymentProviderSchema = z.enum(paymentProviders)

/**
 * 결제가 지나는 상태 (`docs/design/state-machines.md` 3장).
 *
 * **`PAID` 와 `AUTHORIZED` 가 다르다.** 승인은 「카드가 받아 줬다」이고 매입은
 * 「돈이 우리 쪽으로 온다」다 — 그 사이에 취소하면 매입 전 취소라 수수료가 다르고,
 * 그것이 두 상태를 나누는 이유다.
 *
 * **`PARTIAL_CANCELED` 는 끝이 아니다.** 부분 환불은 여러 번 일어나고, 잔액이 0이
 * 되는 순간에만 `CANCELED` 로 간다.
 */
export const paymentStatuses = [
  /** 결제 요청이 만들어졌다. 아직 아무 돈도 움직이지 않았다. */
  'READY',
  'AUTHORIZED',
  'PAID',
  /** 일부가 환불됐다. 남은 금액이 있는 상태다. */
  'PARTIAL_CANCELED',
  'CANCELED',
  /** 승인 거절 · 한도 초과. 끝난 상태다. */
  'FAILED',
  /**
   * **승인됐는지 우리가 모른다** (D-220).
   *
   * 결제사에 요청은 보냈는데 답이 오지 않은 상태다 — 요청이 도착조차 안 했을
   * 수도 있고, 승인까지 끝났는데 응답만 못 받았을 수도 있다. 우리 쪽에서 그
   * 둘은 구별되지 않는다.
   *
   * **`FAILED` 와 다른 이유는 사람이 할 일이 다르기 때문이다.** 거절당한
   * 사람에게 할 말은 「다른 카드로 해 보세요」이고, 이쪽에 할 말은 「확인 중이니
   * 다시 결제하지 마세요」다. 같은 칸에 넣으면 화면은 둘 중 하나를 반드시
   * 틀리게 말한다.
   *
   * 나가는 길은 **대사만 연다.** 사용자의 어떤 조작도 이 상태를 옮기지 못하는데,
   * 옮길 근거가 우리에게 없기 때문이다.
   */
  'UNRESOLVED',
] as const

export type PaymentStatus = (typeof paymentStatuses)[number]

export const paymentStatusSchema = z.enum(paymentStatuses)

/**
 * 결제 이벤트의 종류.
 *
 * **상태 이름과 따로 두는 이유**는 상태가 안 바뀌는 사건이 있기 때문이다 — 같은
 * 웹훅이 두 번 오면 두 번째는 아무 상태도 바꾸지 않지만, **그것이 왔다는 사실은
 * 남아야 한다.** 분쟁이나 불일치 조사에서 유일한 근거가 이 로그다.
 */
export const paymentEventKinds = [
  'REQUESTED',
  'AUTHORIZED',
  'CAPTURED',
  'CANCELED',
  'REFUNDED',
  'FAILED',
  /** 웹훅이 도착했다. 상태를 바꿨는지와 무관하게 남는다. */
  'WEBHOOK',
] as const

export type PaymentEventKind = (typeof paymentEventKinds)[number]

export const paymentEventKindSchema = z.enum(paymentEventKinds)

/** 환불 한 건. 부분 환불이 여러 번 일어나므로 별도 표다. */
export const refundSchema = z.object({
  id: z.uuid(),
  amount: priceSchema,
  reason: z.string(),
  refundedAt: z.iso.datetime(),
})

export type Refund = z.infer<typeof refundSchema>

export const paymentSchema = z.object({
  id: z.uuid(),
  orderId: z.uuid(),
  provider: paymentProviderSchema,
  status: paymentStatusSchema,
  /** 승인된 금액. 주문의 실결제금액과 같아야 한다. */
  authorizedAmount: priceSchema,
  /**
   * 지금까지 취소·환불된 누계.
   *
   * 환불 행을 매번 합산하지 않고 들고 있는 이유는, **넘지 않았는지를 판단하는
   * 자리가 쓰는 자리와 같아야** 하기 때문이다 — 합산해서 판단하고 따로 쓰면 그
   * 사이에 다른 환불이 들어온다 (F6).
   */
  canceledAmount: priceSchema,
  /** 프로바이더가 부르는 이름. 대사와 조회의 열쇠다. */
  paymentKey: z.string().nullable(),
  approvedAt: z.iso.datetime().nullable(),
  refunds: z.array(refundSchema),
})

export type Payment = z.infer<typeof paymentSchema>

export const paymentResponseSchema = z.object({ payment: paymentSchema })

export type PaymentResponse = z.infer<typeof paymentResponseSchema>
