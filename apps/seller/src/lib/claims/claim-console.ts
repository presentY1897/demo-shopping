import type { ClaimAction, ClaimHandlingStage, ClaimStatus } from '@shopping/shared'

/**
 * 클레임 화면의 순수 판단 — 탭이 무엇을 뜻하고, 버튼이 어느 문을 두드리는가.
 *
 * `order-console.ts` 와 같은 자리에 같은 이유로 있다: 여기 있는 것들은 **틀려도
 * 조용하다.** 탭의 단계가 어긋나면 판매자가 「처리 대기」에서 자기 클레임을 못 찾고,
 * 액션의 문이 어긋나면 **회수 운송장이 나지 않은 회수**나 **검수 결과가 적히지 않은
 * 검수**가 만들어진다 — 어느 쪽도 오류를 내지 않는다.
 *
 * I/O 도 렌더도 없으므로 분기 전부가 단위 스펙에서 닿는다.
 */

/**
 * 단계 탭 (설계서 · `claimHandlingStages`).
 *
 * **상태 탭이 아니다.** 상태는 열이라 360px 에서 가로로 넘치고, 무엇보다 판매자가
 * 묻는 것은 「이것이 `PICKING_UP` 인가」가 아니라 「내가 지금 뭘 해야 하나」다. 상태로
 * 좁히고 싶은 사람에게는 필터 바의 상태 축이 따로 있다.
 *
 * `null` 은 「전체」다 — 서버에 `stage` 를 보내지 않는다는 뜻이고, 그때도 **대기가
 * 먼저 온다**(서버의 정렬이 (단계, id) 이므로).
 */
export const SELLER_CLAIM_TABS = ['all', 'waiting', 'inProgress', 'closed'] as const

export type SellerClaimTab = (typeof SELLER_CLAIM_TABS)[number]

const TAB_STAGES: Readonly<Record<SellerClaimTab, ClaimHandlingStage | null>> = {
  all: null,
  waiting: 'WAITING',
  inProgress: 'IN_PROGRESS',
  closed: 'CLOSED',
}

/** 이 탭이 서버에 보낼 단계, 또는 「전체」를 뜻하는 `null`. */
export function stageOf(tab: SellerClaimTab): ClaimHandlingStage | null {
  return TAB_STAGES[tab]
}

/**
 * 이 탭의 건수 — 단계별 건수에서.
 *
 * 「전체」는 세 단계의 합이다. 상태별 건수(`counts`)를 더하지 않는 이유는 그쪽이
 * **상태의 축**이라 탭과 단위가 다르기 때문이다 — 두 축을 섞어 더하면 같은 건이 두 번
 * 세어지는 날이 온다.
 */
export function tabCountOf(
  tab: SellerClaimTab,
  stages: Readonly<Record<ClaimHandlingStage, number>>,
): number {
  const stage = stageOf(tab)

  if (stage === null) {
    return Object.values(stages).reduce((total, count) => total + count, 0)
  }

  return stages[stage]
}

/**
 * 사유를 어느 칸으로 받는가. 받지 않으면 `null`.
 *
 * **두 칸인 것이 계약이다.** 전이의 사유는 `ClaimTransitionRequest.reason` 이고 검수
 * 불합격의 사유는 `InspectReturnRequest.note` 다 — 같은 「거절 사유」이지만 다른 문에
 * 실리고, 화면이 그 둘을 한 칸으로 접으면 어느 쪽인가는 제출 직전에 다시 판단해야
 * 한다. 그 판단을 여기 한 번만 두고, 오류도 **이 칸에** 붙인다 (U2).
 *
 * 필요 여부 자체는 **서버가 답한다**(`action.requiresReason`). 화면이 상태로
 * 되짚으면 그 표가 두 벌이 되고, 서버는 400 `CLAIM_REASON_REQUIRED` 로 막는데 화면은
 * 아무것도 묻지 않는 날이 온다.
 */
export function reasonFieldOf(action: ClaimAction): 'reason' | 'note' | null {
  if (!action.requiresReason) return null

  return action.route === 'inspection' ? 'note' : 'reason'
}

/**
 * 액션 하나를 **어느 문으로, 무엇을 실어** 보내는가.
 *
 * 판별 유니온인 것이 요점이다. 세 문이 받는 몸통이 전부 다르고(전이는 `to` 와 사유,
 * 수거는 아무것도, 검수는 합격 여부와 메모), 하나의 넓은 객체로 넘기면 「수거에 사유를
 * 실어 보내는」 호출이 컴파일을 통과한다. 그리고 그 호출은 **성공한다** — 서버가 그
 * 필드를 무시하므로, 판매자가 적은 사유는 아무 데도 남지 않는다.
 *
 * `passed` 를 `to` 에서 뽑는 것도 같은 축이다. 검수의 답은 둘뿐이고
 * (`INSPECTING` 을 떠나는 화살표가 둘이다), 화면이 그것을 따로 들고 있으면 「합격
 * 버튼을 눌렀는데 `passed: false`」가 표현 가능해진다.
 */
export type ClaimActionCommand =
  | { readonly route: 'transition'; readonly to: ClaimStatus; readonly reason: string | null }
  | { readonly route: 'pickup' }
  | { readonly route: 'inspection'; readonly passed: boolean; readonly note: string | null }

/** 검수의 합격 여부. 「반품완료로」가 합격이고 나머지는 불합격이다. */
export function inspectionPassed(to: ClaimStatus): boolean {
  return to === 'RETURN_COMPLETED'
}

/**
 * 서버가 준 걸음 하나를, 실제로 보낼 명령으로.
 *
 * 사유는 **비었으면 싣지 않는다** (`null`). 빈 문자열을 보내면 스키마가 그것을
 * 「길이 0인 사유」로 읽고, 그 행은 사유가 없는 것도 있는 것도 아닌 채로 남는다.
 */
export function commandFor(
  action: ClaimAction,
  input: { readonly reason?: string } = {},
): ClaimActionCommand {
  const written = (input.reason ?? '').trim()
  const reason = written === '' ? null : written

  switch (action.route) {
    case 'pickup':
      return { route: 'pickup' }
    case 'inspection':
      return { route: 'inspection', passed: inspectionPassed(action.to), note: reason }
    case 'transition':
      return { route: 'transition', to: action.to, reason }
  }
}
