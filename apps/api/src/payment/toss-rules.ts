import type { PaymentProviderName, PaymentStatus } from '@shopping/shared'

/**
 * 토스 연동의 순수 판단 (TASK-0055 6.2 — 금액 대조·승인 경로 분기 100%).
 *
 * **여기에 HTTP 도, Prisma 도 없다.** 이 TASK 가 재는 것은 「토스가 잘 도는가」가
 * 아니라 「우리가 토스를 잘못 믿지 않는가」이고(4.2), 그 판단이 전부 이 파일에
 * 있으면 100%를 정직하게 채울 수 있다 — 입출력이 섞인 파일의 100%는 목표를 위해
 * 갈래를 지우게 만든다.
 */

/**
 * 토스가 말하는 결제 상태.
 *
 * 우리 상태와 이름이 겹치지만 **뜻이 다르다.** 토스의 `DONE` 은 승인과 매입이
 * 이미 끝났다는 뜻이고(카드사 기준으로 매입까지 한 번에 간다), 우리
 * `AUTHORIZED` 는 그 사이가 있다고 보는 이름이다. 그래서 옮기는 자리가 필요하다.
 */
export const tossStatuses = [
  'READY',
  'IN_PROGRESS',
  'WAITING_FOR_DEPOSIT',
  'DONE',
  'CANCELED',
  'PARTIAL_CANCELED',
  'ABORTED',
  'EXPIRED',
] as const

export type TossStatus = (typeof tossStatuses)[number]

/**
 * 토스의 상태를 우리 상태로 옮긴다. 대사(`getStatus`)가 쓴다.
 *
 * `Record` 로 적어 **빠뜨릴 수 없게** 한다. `switch` 로 쓰면 토스가 상태를 하나
 * 더하는 날 기본 갈래가 조용히 삼키고, 그 조용함이 곧 「우리가 아는 상태와 저쪽이
 * 아는 상태가 다르다」가 된다 — 대사가 잡아야 할 바로 그것이다.
 */
const STATUS_MAP: Readonly<Record<TossStatus, PaymentStatus>> = {
  // 아직 결제창을 닫지 않았거나 입금을 기다린다. 우리 쪽은 여전히 `READY` 다.
  READY: 'READY',
  IN_PROGRESS: 'READY',
  WAITING_FOR_DEPOSIT: 'READY',
  DONE: 'PAID',
  CANCELED: 'CANCELED',
  PARTIAL_CANCELED: 'PARTIAL_CANCELED',
  // 승인이 끝내 안 된 것들. 사용자가 창을 닫은 것도 여기 들어온다.
  ABORTED: 'FAILED',
  EXPIRED: 'FAILED',
}

export function paymentStatusFromToss(status: TossStatus): PaymentStatus {
  return STATUS_MAP[status]
}

export type TossConfirmRefusal = 'provider_mismatch' | 'status_forbidden' | 'amount_mismatch'

export type TossConfirmDecision =
  | { readonly outcome: 'confirm' }
  | { readonly outcome: 'refused'; readonly reason: TossConfirmRefusal }

/** 승인 요청을 받아도 되는가. 결제창이 돌려준 값을 **믿기 전에** 보는 것들이다. */
export interface ConfirmCandidate {
  readonly provider: PaymentProviderName
  readonly status: PaymentStatus
  /** 주문이 정한 금액. 결제창이 돌려준 숫자가 아니라 **우리 DB 의 값**이다. */
  readonly authorizedAmount: number
}

/**
 * 결제창이 돌아왔을 때, 승인 API 를 불러도 되는지 정한다 (F2 · 4.2).
 *
 * **금액 대조가 이 함수의 존재 이유다.** 결제창에서 돌아온 `amount` 를 그대로 믿고
 * 승인하면 조작된 금액으로 결제가 끝난다 — 리다이렉트의 쿼리스트링은 사용자가
 * 고칠 수 있는 값이고, 그것을 서버가 검산하지 않는 것이 PG 연동에서 가장 비싼
 * 실수다. 비교 대상은 **DB 의 승인액**이고, 그 값은 주문이 정했다.
 *
 * 셋을 순서대로 본다. 앞의 것이 어긋나면 뒤는 볼 필요가 없고, 그 순서가 곧 답의
 * 우선순위다 — 프로바이더가 다르면 금액을 맞춰 봐야 의미가 없다.
 */
export function confirmDecision(payment: ConfirmCandidate, received: number): TossConfirmDecision {
  if (payment.provider !== 'TOSS') return { outcome: 'refused', reason: 'provider_mismatch' }
  // `READY` 아닌 것은 이미 승인됐거나 실패한 것이다. 같은 리다이렉트가 두 번 열리는
  // 것(뒤로 가기·새로고침)이 정확히 이 경우라, 여기서 막지 않으면 토스에 같은 승인을
  // 두 번 보낸다.
  if (payment.status !== 'READY') return { outcome: 'refused', reason: 'status_forbidden' }
  if (payment.authorizedAmount !== received)
    return { outcome: 'refused', reason: 'amount_mismatch' }

  return { outcome: 'confirm' }
}
