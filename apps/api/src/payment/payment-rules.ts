import type { PaymentStatus } from '@shopping/shared'

/**
 * 결제의 순수 판단 (TASK-0052).
 *
 * 서비스에서 떼어 놓은 이유는 **여기가 틀리면 곧바로 돈이 어긋나고, 어긋나는 두
 * 방식이 모두 조용하기 때문**이다. 정의 밖 전이는 프로바이더가 거절해 줄 때만
 * 드러나고 — 거절해 주지 않으면 우리 장부와 결제사의 장부가 다른 말을 하기
 * 시작한다 — 초과 환불은 프로바이더가 받아 주면 그대로 나간다. 둘 다 빨간
 * 테스트로 나타나지 않는다.
 *
 * 판단은 둘이다. **이 전이가 정의된 것인가**(F2), 그리고 **이 환불이 되는가,
 * 되면 결제가 어디에 앉는가**(F3·F4·F6).
 *
 * 데이터베이스도 시계도 프로바이더도 보지 않는다. 그래서 분기 전부가 단위
 * 테스트에서 닿고, 이 TASK 의 Q5 는 **분기 커버리지 100%** 다 (6.2). 뒤집어
 * 말하면 **닿을 수 없는 방어 분기를 쓰지 않는다** — `packages/shared` 의
 * `hangul.ts` 와 `pricing/allocate.ts` 에서 두 번 물렸고, 그때 남은 것은
 * 영원히 채워지지 않는 커버리지 구멍이었다.
 */

/**
 * 어느 상태에서 어느 상태로 갈 수 있는가 (`docs/design/state-machines.md` 3장).
 *
 * `switch` 가 아니라 **상태 전부를 덮는 레코드**인 이유는, `@shopping/shared` 에
 * 상태를 하나 더 넣고 여기를 안 고치면 **컴파일이 깨져야** 하기 때문이다. 안
 * 그러면 새 상태는 「아무 전이도 정의된 적 없는 상태」로 조용히 태어나고, 거기
 * 도착한 결제는 어디로도 못 간 채 멈춘다. `stock/stock-ledger.ts` 의
 * `stockDirections` 가 같은 장치다.
 *
 * **빈 배열이 곧 종착 상태다** — `CANCELED` 와 `FAILED`. 종착 여부를 따로 적지
 * 않는 이유는 한 사실을 두 벌로 적으면 언젠가 서로 다른 말을 하기 때문이다.
 *
 * `UNRESOLVED` 는 종착이 아니다. 「모른다」에 종착지를 주면 그 결제는 영원히
 * 모르는 채로 남고, 그것을 푸는 것이 TASK-0056 의 대사다 (D-220).
 *
 * 눈여겨 볼 두 줄.
 *
 * - `AUTHORIZED` 에서 나가는 화살표는 `PAID` 하나뿐이다. 승인만 된 건을 무르는
 *   것은 환불이 아니라 **승인 취소**이고, 프로바이더 API 도 수수료도 다르다
 *   (`packages/shared/src/api/payments.ts` 의 `paymentStatuses` 주석). 설계
 *   문서가 그 화살표를 그리지 않았으므로 여기에도 없다.
 * - `PARTIAL_CANCELED → PARTIAL_CANCELED` 는 오타가 아니다. 부분 환불은 여러 번
 *   일어나고(F3), 자기 자신으로 가는 화살표가 없으면 **두 번째 환불이 정의 밖
 *   전이가 된다.**
 */
export const paymentTransitions: Readonly<Record<PaymentStatus, readonly PaymentStatus[]>> = {
  READY: ['AUTHORIZED', 'FAILED', 'UNRESOLVED'],
  // 대사만 여는 두 화살표다 (D-220). 매입으로 바로 가지 않고 `AUTHORIZED` 를
  // 거치는 이유는 「승인된 결제를 매입한다」가 한 곳에만 있게 하기 위해서다.
  UNRESOLVED: ['AUTHORIZED', 'FAILED'],
  AUTHORIZED: ['PAID'],
  PAID: ['PARTIAL_CANCELED', 'CANCELED'],
  PARTIAL_CANCELED: ['PARTIAL_CANCELED', 'CANCELED'],
  CANCELED: [],
  FAILED: [],
}

/**
 * 이 전이가 정의된 것인가 (F2).
 *
 * 불리언 하나만 돌려주는 이유는 거절 문구를 여기서 만들면 안 되기 때문이다.
 * 부르는 쪽은 자기가 무엇을 하려던 참인지 알고 있고 — 매입인지, 취소인지,
 * 웹훅이 시킨 것인지 — 「READY 에서 PARTIAL_CANCELED 로 갈 수 없습니다」는
 * 그 사람에게 아무 뜻도 아니다.
 */
export function canTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  return paymentTransitions[from].includes(to)
}

/**
 * 환불이 결제를 데려갈 수 있는 상태. 이 둘뿐이다.
 *
 * 잔액이 남으면 `PARTIAL_CANCELED`, 잔액이 정확히 0이 되면 `CANCELED` — 그
 * 경계가 곧 「이 결제가 아직 살아 있는가」다.
 */
const REFUND_LANDINGS = ['PARTIAL_CANCELED', 'CANCELED'] as const satisfies readonly PaymentStatus[]

/** 환불 뒤 결제가 앉는 상태. */
export type RefundLanding = (typeof REFUND_LANDINGS)[number]

/**
 * 환불 판단이 보는 결제. `Payment` 행에서 필요한 세 값만이다.
 *
 * 세 개뿐인 이유는 이것이 판단에 필요한 전부이기 때문이고, 전부인 덕분에
 * Prisma 행이든 API 응답이든 그대로 넘길 수 있다.
 */
export interface RefundablePayment {
  readonly status: PaymentStatus
  /** 승인된 금액. 주문의 실결제금액과 같다. */
  readonly authorizedAmount: number
  /** 지금까지 환불된 누계. 매번 `Refund` 행을 합산하지 않는 이유는 F6 이다. */
  readonly canceledAmount: number
}

/** 환불이 거절되는 세 가지 이유. */
export type RefundRefusal =
  /** 이 상태의 결제는 환불이라는 사건 자체를 받지 않는다. */
  | 'status_forbidden'
  /** 0원 이하이거나 원 단위가 아니다. */
  | 'invalid_amount'
  /** 남은 금액보다 크다 (F4). */
  | 'exceeds_remaining'

/** 환불해도 된다. 담긴 숫자는 그대로 쓰라고 있는 것이다. */
export interface RefundAllowed {
  readonly outcome: 'allowed'
  /** 이 환불 뒤 결제가 앉을 상태. */
  readonly nextStatus: RefundLanding
  /**
   * 이 환불 뒤의 누계 — `Payment.canceledAmount` 에 그대로 쓸 값이다.
   *
   * 부르는 쪽이 다시 더하게 두지 않는 이유가 4.4 다. **넘지 않았는지를 판단한
   * 자리와 쓰는 자리가 같아야** 한다. 판단만 여기서 하고 덧셈은 저쪽에서 하면
   * 그 사이에 다른 환불이 들어올 수 있고, 그 경합이 F6 이다.
   */
  readonly canceledAmount: number
  /** 이 환불을 하고도 남는 금액. 0이면 `nextStatus` 는 `CANCELED` 다. */
  readonly remainingAmount: number
}

/** 환불하면 안 된다. */
export interface RefundRefused {
  readonly outcome: 'refused'
  readonly reason: RefundRefusal
  /**
   * 지금 환불할 수 있는 최대 금액.
   *
   * 거절에 숫자를 붙여 두는 이유는 「환불할 수 없습니다」로 끝나는 화면이
   * 상담원에게 아무 도움이 안 되기 때문이다. 「최대 12,000원까지 환불할 수
   * 있습니다」는 다음 행동을 알려 준다.
   *
   * 상태가 막은 경우에는 0이다. 승인 전이거나 이미 끝난 결제에는 남은 금액을
   * 셀 일이 없고, `authorizedAmount` 를 그대로 돌려주면 **낼 수 없는 돈을 낼 수
   * 있다고 말하는 셈**이 된다.
   */
  readonly refundableAmount: number
}

export type RefundDecision = RefundAllowed | RefundRefused

/**
 * 이 상태의 결제가 환불이라는 사건을 받는가.
 *
 * 표에서 읽는다. 두 착지점이 **둘 다** 가능해야 한다고 물어보는 이유는, 하나만
 * 가능한 상태가 표에 생기면 그것이 「부분 환불은 되는데 마지막 환불은 안 되는」
 * 결제 — 즉 **잔액이 영원히 남는 결제** — 이기 때문이다. 그런 상태는 있으면 안
 * 되고, 실수로 생기면 환불을 아예 막는 쪽이 안전하다.
 */
function acceptsRefund(status: PaymentStatus): boolean {
  return REFUND_LANDINGS.every((landing) => canTransition(status, landing))
}

/**
 * 이 환불 요청 하나에 대한 답 (F3·F4·F6).
 *
 * 순서가 있고, 그 순서가 곧 「무엇을 먼저 말해 줄 것인가」다.
 *
 * 1. **상태**. 상태가 막으면 금액이 무엇이든 답이 같다. 승인도 안 된 결제에
 *    「금액이 너무 큽니다」라고 답하면 부르는 쪽은 금액을 고쳐 다시 시도한다.
 * 2. **금액의 모양**. 0원 이하는 환불이 아니고, 원 단위가 아닌 값은 더 나쁘다 —
 *    누계가 소수가 되는 순간 「잔액이 정확히 0」이 영원히 성립하지 않아 결제가
 *    `CANCELED` 에 닿지 못한다. 금액을 정수로 다루는 규칙(CLAUDE.md 6장)이
 *    여기서는 상태 머신이 멈추지 않게 하는 장치다.
 * 3. **한도**. 남은 금액을 넘는 환불은 승인액보다 많은 돈을 내보내는 일이다.
 *
 * 던지지 않고 값으로 답하는 것은 4.3 과 같은 이유다. 한도 초과는 프로그램의
 * 오류가 아니라 **정상적인 대답**이고, 부르는 쪽은 트랜잭션 안에서 그 대답으로
 * 무엇을 할지 정해야 한다.
 *
 * 이 판단이 마지막 방어선은 아니다. `Payment_canceledAmount_check` 가 같은
 * 규칙을 데이터베이스에 적어 두고 있고(4.4), 동시에 들어온 두 환불이 각자
 * 「아직 여유가 있다」를 읽는 경합에서 지는 쪽을 최종적으로 거절하는 것은 그
 * 제약이다.
 */
export function refundDecision(payment: RefundablePayment, amount: number): RefundDecision {
  if (!acceptsRefund(payment.status)) {
    return { outcome: 'refused', reason: 'status_forbidden', refundableAmount: 0 }
  }

  const refundable = payment.authorizedAmount - payment.canceledAmount

  if (!Number.isInteger(amount) || amount <= 0) {
    return { outcome: 'refused', reason: 'invalid_amount', refundableAmount: refundable }
  }

  if (amount > refundable) {
    return { outcome: 'refused', reason: 'exceeds_remaining', refundableAmount: refundable }
  }

  const remainingAmount = refundable - amount

  return {
    outcome: 'allowed',
    // 잔액이 0이 되는 순간에만 결제가 끝난다. 1원이라도 남아 있으면 아직
    // 환불받을 것이 있는 결제이고, 그것을 `CANCELED` 로 적으면 그 1원은
    // 아무도 다시 찾아가지 못한다.
    nextStatus: remainingAmount === 0 ? 'CANCELED' : 'PARTIAL_CANCELED',
    canceledAmount: payment.canceledAmount + amount,
    remainingAmount,
  }
}
