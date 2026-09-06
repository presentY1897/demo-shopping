import type { ApiFailure, ClaimRefusal } from '@shopping/shared'

/**
 * 「왜 신청할 수 없나」를 화면의 문장 하나로 옮기는 자리 (TASK-0066).
 *
 * **거절이 두 길로 온다.** 버튼을 누르기 전에는 `GET /seller-orders/:id/claimable`
 * 의 `refusal` 필드로 오고, 누른 뒤에는 `POST /claims` 의 오류 코드로 온다. 같은
 * 여섯 가지인데 모양이 달라, 화면이 그 둘을 따로 다루면 **같은 상황에 두 문장**이
 * 생긴다 — 그 둘이 언젠가 다른 말을 하고, 어느 쪽이 맞는지는 아무도 모른다.
 *
 * 그래서 여기서 코드를 이유로 되돌리고, 문장은 이유 하나로 고른다.
 *
 * **여섯을 하나로 묶지 않는 이유**는 사람이 할 일이 다르기 때문이다 (계약의
 * `claimRefusals` 주석). 「취소할 수 없습니다」로 끝나면 배송 중이라 기다리면 되는
 * 사람과, 수량만 고치면 되는 사람과, 고객센터를 찾아야 하는 사람이 **모두 아무것도
 * 못 하게** 된다.
 */

/**
 * 이유마다 서버가 쓰는 코드.
 *
 * `Record<ClaimRefusal, …>` 이라 계약에 이유가 하나 늘면 **컴파일이 막는다.** 코드
 * 쪽을 키로 잡았다면 새 이유는 「아무 코드와도 짝지어지지 않은 이유」로 조용히
 * 태어나고, 그때 화면은 서버 문장을 그대로 흘린다.
 */
const CODE_OF: Readonly<Record<ClaimRefusal, string>> = {
  in_transit: 'CLAIM_IN_TRANSIT',
  confirmed: 'CLAIM_ORDER_CONFIRMED',
  window_closed: 'CLAIM_WINDOW_CLOSED',
  not_claimable: 'CLAIM_NOT_CLAIMABLE',
  exceeds_remaining: 'CLAIM_EXCEEDS_REMAINING',
  invalid_quantity: 'CLAIM_INVALID_QUANTITY',
}

export interface ClaimRefusalDetail {
  readonly reason: ClaimRefusal
  /**
   * 지금 남은 수량. **`exceeds_remaining` 만 싣는다.**
   *
   * 이 갈래에 오는 사람은 대개 다른 창에서 방금 하나를 신청한 사람이고, 숫자를
   * 함께 말하지 않으면 몇 개로 고쳐야 하는지 알 방법이 없다.
   */
  readonly remaining: number | null
}

/** 실패 하나를 여섯 중 하나로. 클레임의 거절이 아니면 `null` 이다. */
export function refusalOfFailure(failure: ApiFailure): ClaimRefusalDetail | null {
  if (failure.kind !== 'http') return null

  const entry = Object.entries(CODE_OF).find(([, code]) => code === failure.code)

  if (entry === undefined) return null

  return { reason: entry[0] as ClaimRefusal, remaining: remainingIn(failure.details) }
}

/**
 * 문장 하나 — 숫자가 필요한 것에는 숫자를 채워서.
 *
 * `{remaining}` 이 없는 문장에 값을 넣으면 그대로 돌아온다. 그래서 부르는 쪽이
 * 「이 이유에 숫자가 있던가」를 기억할 필요가 없고, 그 기억이 틀리는 날 화면에
 * `{remaining}` 이라는 글자가 뜨는 일도 없다.
 */
export function refusalSentence(
  detail: ClaimRefusalDetail,
  sentences: Readonly<Record<ClaimRefusal, string>>,
): string {
  return sentences[detail.reason].replace('{remaining}', String(detail.remaining ?? 0))
}

/**
 * 오류 상세에서 `params.remaining` 을 꺼낸다.
 *
 * 계약이 `details` 를 `unknown[]` 으로 두는 이유는 엔드포인트가 코드를 하나씩
 * 채택하기 때문이고(TASK-0117), 그래서 읽는 쪽이 모양을 확인한다. 없으면 `null`
 * 이지 0 이 아니다 — 0 은 「하나도 못 신청한다」는 사실이고, 모르는 것과 다르다.
 */
function remainingIn(details: readonly unknown[]): number | null {
  for (const detail of details) {
    if (typeof detail !== 'object' || detail === null || !('params' in detail)) continue

    const { params } = detail as { readonly params?: unknown }

    if (typeof params !== 'object' || params === null || !('remaining' in params)) continue

    const { remaining } = params as { readonly remaining?: unknown }

    if (typeof remaining === 'number') return remaining
  }

  return null
}
