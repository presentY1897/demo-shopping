import type { Payment } from '@shopping/shared'
import { isApiClientError, isDomainErrorCode } from '@shopping/shared'

/**
 * 「승인됐는지 우리가 모른다」를 알아보는 곳 (D-220 · TASK-0057 F5).
 *
 * **그 사실이 화면에 닿는 길이 둘이고, 둘 다 여기 있다.** 승인 응답이 `UNRESOLVED`
 * 로 오거나, 서버가 그 결제를 이유로 새 결제를 거절하거나 — 앞뒤일 뿐 같은 사실이고,
 * 어느 쪽으로 알았든 사람에게 할 말은 하나다: **다시 결제하지 마세요.**
 *
 * **두 화면이 이 파일을 함께 쓴다.** 주문서(`use-payment.ts`)와 결제창에서 돌아온
 * 화면(`toss-return.ts`)이 각자 자기 어휘로 실패를 세지만, 「이것이 그 상태인가」를
 * 정하는 판단만은 한 벌이어야 한다 — 두 벌이면 한쪽이 코드를 오타내도 아무 데도
 * 드러나지 않고, 그 오타의 결과가 하필 「다시 결제해 주세요」다.
 *
 * **합친 것은 여기까지다.** 두 화면의 `offersRetry` 는 합치지 않았는데, 그 둘은
 * 어휘가 달라서다 — 주문서에는 `exceeds_credit`·`toss_unavailable` 이 있고 돌아온
 * 화면에는 `already_settled`·`unsettled`·`invalid_return` 이 있다. 합치려면 두
 * 어휘를 먼저 합쳐야 하고, 그러면 어느 화면에서도 일어날 수 없는 값을 받는 함수가
 * 하나 생긴다. 나뉘어 있어야 할 것과 하나여야 할 것의 경계가 이 파일이다.
 */

/**
 * 이 결제가 「아직 모른다」인가.
 *
 * **`FAILED` 가 아니라고 승인된 것이 아니다.** 부르는 쪽이 이 함수를 지나야 하는
 * 이유가 그것이고, 놓치면 승인되지 않은 결제에 매입을 걸게 된다.
 */
export function awaitsResult(payment: Payment): boolean {
  return payment.status === 'UNRESOLVED'
}

/**
 * 서버가 「앞선 결제의 결과를 확인하는 중」이라며 거절했는가 (409).
 *
 * **상태가 아니라 코드를 본다.** 그 자리의 409 와 「이미 처리된 결제」의 409 는
 * 사람이 할 일이 정반대다 — 앞은 기다리는 것이고 뒤는 다른 길을 찾는 것이라,
 * status 로 가르면 반드시 한쪽을 틀리게 말한다.
 *
 * `isDomainErrorCode` 를 지나는 이유는 이 비교를 **컴파일러에게 시키기** 위해서다.
 * `error.code` 는 그냥 `string` 이라 오타가 그대로 통과하고, 그 오타는 조용하다 —
 * 화면은 아무 일도 없었다는 듯 「잠시 후 다시 결제해 주세요」로 되돌아간다.
 */
export function refusedWhileAwaiting(error: unknown): boolean {
  if (!isApiClientError(error) || error.kind !== 'http') return false

  const { code } = error

  return code !== null && isDomainErrorCode(code) && code === 'PAYMENT_AWAITING_RESULT'
}
