import { isApiClientError } from '@shopping/shared'

import { refusedWhileAwaiting } from './awaiting-result'
import { TOSS_RETURN_CHECKOUT_PARAM } from './toss'

/**
 * 결제창에서 돌아온 것을 읽는 규칙 (TASK-0055 4.2).
 *
 * **여기에 `fetch` 도 React 도 없다.** 이 TASK 가 재는 것은 「토스가 잘 도는가」가
 * 아니라 「우리가 토스를 잘못 믿지 않는가」이고, 그 판단 — 쿼리를 믿을 수 있는가,
 * 승인이 거절된 것인가 요청이 실패한 것인가 — 이 전부 이 파일에 있으면 분기를
 * 정직하게 다 셀 수 있다 (6.2 Q5 강화). 서버 쪽의 `toss-rules.ts` 가 같은 이유로
 * 같은 모양이다.
 *
 * **쿼리스트링은 사용자가 고칠 수 있는 값이다.** 그래서 여기서 하는 일은 검증이
 * 아니라 **모양 확인**뿐이고, 진짜 검산 — 금액이 주문 금액과 같은가 — 은 서버가
 * DB 를 보고 한다. 화면이 금액을 검산하는 척하면 그 척이 곧 구멍이다.
 */

/** 결제창이 성공 주소에 실어 보내는 것들, 우리가 미리 넣어 둔 주문서 id 와 함께. */
export interface TossSuccessReturn {
  /** 우리가 실어 보낸 주문서 id. 다시 결제하러 돌아갈 곳이다 (F3). */
  readonly checkoutId: string | null
  /** 토스가 `orderId` 라 부르는 것 — 우리 **결제 id** 다 (4.3). */
  readonly paymentId: string
  readonly paymentKey: string
  readonly amount: number
}

/**
 * 성공 주소의 쿼리를 읽는다. 셋 중 하나라도 없으면 `null`.
 *
 * `null` 은 「실패했다」가 아니라 **「결제창에서 온 것이 아니다」**이고, 그 경우는
 * 사람이 주소를 직접 열었거나 북마크한 것이다 — 승인을 시도할 것이 없으므로
 * 화면도 실패가 아니라 「여기서 할 일이 없다」로 끝난다.
 *
 * 금액은 정수만 받는다. `Number()` 를 쓰면 `'1e5'` 도 `'0x64'` 도 숫자가 되고,
 * 그런 값이 서버까지 갈 이유가 없다 — 어차피 거절될 요청을 한 번 더 보내는 것뿐이다.
 */
export function tossSuccessReturn(params: URLSearchParams): TossSuccessReturn | null {
  const paymentId = params.get('orderId')
  const paymentKey = params.get('paymentKey')
  const amount = params.get('amount')

  if (paymentId === null || paymentKey === null || amount === null) return null
  if (paymentId === '' || paymentKey === '') return null
  if (!/^\d+$/u.test(amount)) return null

  return {
    amount: Number.parseInt(amount, 10),
    checkoutId: checkoutIdOf(params),
    paymentId,
    paymentKey,
  }
}

/** 우리가 실어 보낸 주문서 id. 없으면 돌아갈 곳을 모르는 것이다. */
export function checkoutIdOf(params: URLSearchParams): string | null {
  const id = params.get(TOSS_RETURN_CHECKOUT_PARAM)

  return id === null || id === '' ? null : id
}

/**
 * 승인이 끝나지 못한 이유. 나눠 두는 이유는 **다음에 할 일이 다르기** 때문이다 —
 * 하나로 뭉치면 「결제하지 못했어요」가 되고, 그 문장은 어느 경우에도 다음 행동을
 * 알려 주지 못한다.
 *
 * **하나는 「끝나지 못했다」조차 아니다.** `awaiting_result` 는 아직 결말이 정해지지
 * 않은 상태이고, 그래서 아래 목록에서 유일하게 **실패가 아닌 항목**이다 — 화면이
 * 그것을 실패로 그리면 사람은 결제가 안 됐다고 읽고 다시 결제한다.
 */
export const tossConfirmFailures = [
  /** 카드사가 받아 주지 않았다. 200 으로 `FAILED` 인 결제가 온 경우다. */
  'declined',
  /**
   * 결제창이 돌려준 금액이 주문 금액과 다르다 (F2).
   *
   * 서버가 **결제사를 부르기 전에** 멈춘 것이라 저쪽에는 아무 승인도 남지 않았다.
   * 사람에게는 「다시 주문해 주세요」가 맞는 말이다 — 그 사이에 주문서가 바뀌었거나,
   * 누군가 주소를 손댔거나 둘 중 하나다.
   */
  'amount_mismatch',
  /**
   * 이미 처리된 결제다 (409 `PAYMENT_TRANSITION_REFUSED`).
   *
   * 성공 주소를 새로고침하거나 뒤로 갔다가 다시 온 것이 정확히 이 경우다. **다시
   * 결제하라고 말하면 안 된다** — 우리는 그 결제가 성공했는지 실패했는지를 이
   * 응답만으로 알 수 없다.
   *
   * **끝났다는 것만은 확실하다.** 예전에는 그렇지 않았다 — 결과를 모르는 결제
   * (`UNRESOLVED`)까지 이 자리로 접혀 와서 「이미 처리된 결제예요」가 끝나지도 않은
   * 결제에 뜨곤 했다. 서버가 그것을 `awaiting_result` 로 갈라 준 뒤로 여기 오는 것은
   * 승인·매입·거절·취소가 끝난 결제뿐이고, 그래서 저 문장이 참이 됐다 (D-220).
   */
  'already_settled',
  /** 요청이 오가지 못했다. 결제가 됐는지 안 됐는지를 **우리도 모른다.** */
  'unreachable',
  /**
   * **승인됐는지 우리가 모른다 — 확인 중이다** (D-220).
   *
   * 결제사에 닿지 못해 결말이 정해지지 않은 것이고, 그 응답은 200 과 함께
   * `UNRESOLVED` 인 결제로 온다. **`unsettled` 와 헷갈리면 안 된다** — 저쪽은
   * 「승인은 됐다」가 확실한 상태라 그 말을 화면에 적을 수 있지만, 여기서 그 말을
   * 적으면 사람은 「결제는 됐구나」로 이해하고 그것이 사실이 아닐 수 있다.
   *
   * 나가는 길은 대사만 연다. 이 화면에서도, 주문서에서도 사람이 할 수 있는 것은
   * 기다리는 것뿐이고, 서버가 그동안 새 결제를 막는다
   * (`PAYMENT_AWAITING_RESULT`). 주문서의 `awaiting_result` 와 같은 사실이라 같은
   * 이름이다.
   */
  'awaiting_result',
  /**
   * 승인은 됐는데 매입을 못 했다.
   *
   * 위의 넷과 결정적으로 다르다 — **저쪽에는 승인이 남아 있다.** 그 사람에게 다시
   * 결제하라고 말하면 두 번 낸다. 우리 장부와 저쪽 장부가 어긋난 상태이고, 그것을
   * 맞추는 것은 화면이 아니라 웹훅과 대사의 몫이다 (TASK-0056 · 0057).
   */
  'unsettled',
  /** 결제창에서 온 주소가 아니다. 승인을 시도할 것이 없다. */
  'invalid_return',
] as const

export type TossConfirmFailure = (typeof tossConfirmFailures)[number]

/**
 * 승인 요청이 던진 것을 사람에게 할 말로 옮긴다.
 *
 * **코드를 보지 상태만 보지 않는다.** 400 은 금액 불일치일 수도 있고 「토스로 시작한
 * 결제가 아니다」일 수도 있는데, 뒤의 것은 사람이 고칠 수 있는 종류가 아니라 우리
 * 버그다 — 그 경우에 「다시 결제해 보세요」를 시키면 같은 실패를 반복시킨다. 그래서
 * 모르는 400 은 「결과를 모른다」쪽으로 보낸다.
 */
export function confirmFailureOf(error: unknown): TossConfirmFailure {
  if (!isApiClientError(error) || error.kind !== 'http') return 'unreachable'
  // 「결과를 확인하는 중」이 먼저다. 이것만 사람에게 **기다리라**고 말하는 갈래라,
  // 뒤의 어느 것으로 접혀도 그 사람은 다시 결제하러 간다.
  if (refusedWhileAwaiting(error)) return 'awaiting_result'
  if (error.code === 'PAYMENT_AMOUNT_MISMATCH') return 'amount_mismatch'
  if (error.code === 'PAYMENT_TRANSITION_REFUSED') return 'already_settled'

  return 'unreachable'
}

/**
 * 사용자가 결제창을 닫은 것을 가리키는 토스의 코드.
 *
 * 이것만 따로 아는 이유는 **사고가 아니기 때문**이다. 마음이 바뀐 사람에게
 * 「결제에 실패했어요」라고 말하면 우리 쪽이 고장 난 것처럼 들리고, 그 사람이 다음에
 * 할 일(주문서로 돌아가기)도 흐려진다.
 */
export const TOSS_CANCEL_CODE = 'PAY_PROCESS_CANCELED'

/** 실패 주소가 말하는 두 가지. 창을 닫은 것과 그 밖. */
export type TossFailureKind = 'canceled' | 'refused'

export function tossFailureKind(code: string | null): TossFailureKind {
  return code === TOSS_CANCEL_CODE ? 'canceled' : 'refused'
}

/**
 * 이 실패 뒤에 주문서로 돌려보내도 되는가.
 *
 * **「다시 결제하기」가 언제나 옳은 말은 아니다.** 이미 처리됐거나 승인만 남은
 * 결제를 두고 다시 결제하라고 하면 한 사람이 같은 물건을 두 번 산다. 주소가 잘못된
 * 경우도 마찬가지다 — 돌아갈 주문서가 애초에 없다.
 *
 * **허용 목록인 것이 여기서 값을 한다.** 결말이 정해지지 않은 결제(`awaiting_result`)
 * 는 이름을 더하는 것만으로 재시도에서 빠졌다 — 거절 목록이었다면 이 함수를 같이
 * 고쳐야 했고, 잊으면 누를수록 409 가 돌아오는 링크가 남는다.
 *
 * 주문서 쪽에도 같은 이름의 함수가 있지만 **어휘가 달라 합치지 않았다.** 그 이유는
 * `awaiting-result.ts` 가 적는다 — 합쳐야 할 것은 「이것이 그 상태인가」이지 「이
 * 화면이 무엇을 권하는가」가 아니다.
 */
export function offersRetry(failure: TossConfirmFailure): boolean {
  return failure === 'declined' || failure === 'amount_mismatch' || failure === 'unreachable'
}
