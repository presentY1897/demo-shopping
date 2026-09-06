import type { Permission, SettlementStatus } from '@shopping/shared'
import type { BadgeVariant } from '@shopping/ui/components'

/**
 * 정산서에 지금 무엇을 할 수 있고, 그것을 누가 할 수 있는가.
 *
 * **이 파일은 거울이고, 그렇게 말해 두는 것이 요점이다.** 원본은
 * `apps/api/src/settlement/settlement-transitions.ts` 의 `settlementTransitions`
 * 이고, 그 표가 그리는 그림은 `docs/design/state-machines.md` 5장이다. 저쪽은
 * `apps/api` 안이라 브라우저가 들여올 수 없다 — `lib/sellers/decisions.ts` 와
 * `lib/claims/claim-console.ts` 가 같은 사정을 같은 방식으로 적어 두었다.
 *
 * **어긋나면 무엇이 나쁜가**도 같다. 최악이 살아 있어 보이는 버튼과 그 답으로 오는
 * 409 (`SETTLEMENT_WRONG_STATUS`) 이고, **틀린 쓰기를 만들 수는 없다** — 옮길 수
 * 있는 출발 상태는 서버가 조건부 갱신의 `WHERE status IN (…)` 으로 다시 판정한다.
 *
 * ## 되돌아가는 화살표가 없다 (F5)
 *
 * 승인은 「금액이 이것으로 굳었다」는 선언이고 지급완료는 「돈이 나갔다」는
 * 선언이다. 「지급완료된 정산서는 수정할 수 없다」는 이 화면의 조건문이 아니라
 * {@link settlementTransitions} 의 **빈 배열**이 만든다 — 그 자리에서 버튼이 하나도
 * 나오지 않는다.
 *
 * ## 「보류에는 사유가 필요하다」는 여기 없다
 *
 * 그 규칙은 계약의 `holdSettlementRequestSchema` 가 정하고 `hold-form.ts` 가 그것을
 * 그대로 쓰며, 화면에서는 **보류만 폼을 연다**는 사실로 나타난다. 세 번째 자리에
 * 다시 적으면 사유가 필요한 판단이 하나 더 생기는 날 한 곳만 고쳐진다.
 *
 * I/O 도 렌더도 없으므로 분기 전부가 단위 스펙에서 닿는다 (QUALITY-GATES 순수 로직 —
 * `vitest.config.mjs` 가 이 파일을 분기 100% 로 잡고 있다).
 */

/** 관리자가 정산서 한 장에 대해 내리는 세 가지 판단. */
export const settlementActions = ['approve', 'hold', 'pay'] as const

export type SettlementAction = (typeof settlementActions)[number]

/**
 * 상태 전이표 — `settlement-transitions.ts` 의 같은 이름과 같은 내용.
 *
 * `Record` 라 계약에 상태가 하나 늘면 여기가 typecheck 에서 걸린다. 안 그러면 새
 * 상태는 「무엇을 할 수 있는지 아무도 정한 적 없는 상태」로 태어나고, 그 화면은
 * 버튼을 하나도 내지 않으면서 아무 검사도 빨갛게 만들지 않는다.
 */
export const settlementTransitions: Readonly<
  Record<SettlementStatus, readonly SettlementStatus[]>
> = {
  PENDING: ['APPROVED', 'HOLD'],
  HOLD: ['APPROVED'],
  APPROVED: ['PAID'],
  PAID: [],
}

/** 각 판단이 정산서를 어디로 옮기는가. */
const ACTION_TARGET: Readonly<Record<SettlementAction, SettlementStatus>> = {
  approve: 'APPROVED',
  hold: 'HOLD',
  pay: 'PAID',
}

/**
 * 어느 퍼미션이 각각을 정하는가 (`settlement.controller.ts`).
 *
 * 승인과 보류가 같은 퍼미션인 것은 **둘이 같은 판단의 두 답**이기 때문이다. 지급이
 * 따로인 것은 되돌릴 수 없는 정도가 다르기 때문이고, 데모 관리자가 F7 에서 막히는
 * 자리가 정확히 이 줄이다 — 운영자에게는 `settlement.approve` 도 `settlement.pay`
 * 도 없다(`role-permissions.ts`).
 */
const ACTION_PERMISSION: Readonly<Record<SettlementAction, Permission>> = {
  approve: 'settlement.approve',
  hold: 'settlement.approve',
  pay: 'settlement.pay',
}

/**
 * 이 상태에서 낼 수 있는 버튼들, 정해진 순서로.
 *
 * 순서가 {@link settlementActions} 에서 오므로 상태마다 버튼의 자리가 흔들리지
 * 않는다 — 대기에서 「승인·보류」이던 것이 보류에서 「보류·승인」이 되면, 같은
 * 자리를 두 번 누르는 사람이 다른 일을 하게 된다.
 */
export function actionsFor(status: SettlementStatus): readonly SettlementAction[] {
  return settlementActions.filter((action) =>
    settlementTransitions[status].includes(ACTION_TARGET[action]),
  )
}

export function permissionFor(action: SettlementAction): Permission {
  return ACTION_PERMISSION[action]
}

/**
 * 더 옮길 곳이 없는가 — 곧 「잠겼다」 (F5).
 *
 * 상태 이름을 적지 않고 전이표의 빈 배열로 판정한다. `status === 'PAID'` 라고 쓰면
 * 표와 조용히 어긋날 수 있는 자리가 하나 늘고, 어긋난 쪽이 이기는 것은 언제나
 * 코드다.
 */
export function isLocked(status: SettlementStatus): boolean {
  return settlementTransitions[status].length === 0
}

/**
 * 일괄 승인이 이 줄을 실제로 옮길 수 있는가 (F6).
 *
 * 고를 수 있는 줄을 미리 좁히는 데 쓴다. **그래도 실패는 온다** — 목록을 읽은 뒤에
 * 남이 같은 정산서를 승인하면 그 줄은 `wrong_status` 로 돌아오고, 화면은 그것을
 * 반드시 말해야 한다. 이 함수는 그 실패를 없애는 것이 아니라 **뻔한 실패를 줄이는**
 * 것뿐이다.
 */
export function canBulkApprove(status: SettlementStatus): boolean {
  return settlementTransitions[status].includes('APPROVED')
}

/**
 * 상태가 그려지는 색.
 *
 * 네 상태가 넷 다 다르다. 목록에서 기다리는 줄이 끝난 줄과 같아 보이면 그 목록은
 * 아무도 훑지 못하기 때문이다 (`lib/sellers/decisions.ts` 의 같은 판단).
 *
 * **보류가 `danger` 인 것이 이 표의 유일한 판단이다.** 대기는 차례가 오면 풀리는
 * 기다림이지만 보류는 사람이 무언가를 확인해 주기 전에는 영영 움직이지 않고, 그
 * 사이 판매자는 돈을 받지 못한다 — 「기다리는 중」과 같은 색으로 두면 회차가 지나도
 * 아무도 그것을 다시 보지 않는다.
 */
export function statusVariant(status: SettlementStatus): BadgeVariant {
  switch (status) {
    case 'PENDING':
      return 'warning'
    case 'HOLD':
      return 'danger'
    case 'APPROVED':
      return 'primary'
    case 'PAID':
      return 'success'
  }
}
