import type { ClaimHandlingStage, ClaimStatus } from '@shopping/shared'
import { claimHandlingStages, claimStatuses } from '@shopping/shared'

import type { ClaimActionRoute } from '@shopping/shared'
import { claimTransitions } from './claim-rules.js'

/**
 * 판매자 콘솔이 목록을 그리기 전에 서버가 내리는 판단들 (TASK-0070 1장).
 *
 * 데이터베이스도 시계도 보지 않는다. 그래서 분기 전부가 단위 스펙에서 닿고, 이
 * TASK 의 Q5 는 **분기 커버리지 100%** 다 — 뒤집어 말하면 **닿을 수 없는 방어
 * 분기를 쓰지 않는다** (`seller-order-console.ts` 가 같은 이유로 같은 모양이다).
 *
 * ## 이 파일이 답하는 것 — 「처리 대기 우선」과 커서를 어떻게 양립시키는가
 *
 * 커서 페이지네이션은 **안정된 정렬 키**를 요구한다. 이 저장소의 다른 목록은 전부
 * `id`(UUIDv7) 하나를 쓰고, 그것은 행이 태어난 뒤로 절대 바뀌지 않는다. 그런데
 * 「대기 먼저」는 `status` 에서 나오고 **`status` 는 움직인다** — 그것도 하필,
 * 판매자가 이 목록을 보면서 승인을 누를 때 움직인다.
 *
 * 셋을 시도해 볼 수 있었고, 고른 것은 셋째다.
 *
 * | | 무엇이 문제인가 |
 * | --- | --- |
 * | ① 「대기」를 **기본 탭**으로만 두고 정렬은 `id` 하나 | 「전체」 탭에서 대기가 먼저 오지 않는다. 요구사항이 정렬이라고 말한다 |
 * | ② 커서를 **행의 id** 로 두고 순위는 매번 다시 계산 | 그 행의 상태가 그 사이에 바뀌면 커서가 가리키던 **자리도 함께 움직인다.** 재개 지점이 통째로 틀어져 페이지 하나가 사라진다 |
 * | ③ **정렬 키를 두 칸으로 만들고 커서에 둘 다 굳힌다** | 아래 |
 *
 * 정렬은 `(단계, id)` 두 칸이고, 커서는 **그 두 칸을 모두 담은 불투명 문자열**이다.
 * 커서가 가리키는 것은 「마지막으로 본 행」이 아니라 **「정렬 축 위의 위치」**이고,
 * 그것이 `docs/design/pages.md` 의 커서 규약이 처음부터 적어 둔 문장이다.
 *
 * **이 조합이 지키는 것**: 다른 행이 늘거나 줄거나 상태가 바뀌어도 이미 지나온
 * 커서 뒤의 페이지는 그대로다. 끝까지 넘겨도 중복·누락이 0이다.
 *
 * **못 지키는 것**: 페이징 중에 **자기 정렬 키를 바꾼 그 행 하나**는 움직인다.
 * 판매자가 3페이지를 보다가 1페이지에서 승인했던 건이 「진행 중」으로 내려오면
 * 뒤쪽 페이지에서 한 번 더 보일 수 있다. 오프셋이라면 그 한 번의 변경이 **모든
 * 행**을 한 칸씩 미는데, 키셋은 **바뀐 그 행만** 움직인다. 그리고 화면은 액션
 * 뒤에 커서 스택을 리셋하고 첫 페이지부터 다시 읽는다(`useCursorPagination` 의
 * 규약) — 실제로 그 한 행이 두 번 보이는 창은 거기서 닫힌다.
 *
 * ## 「지연」은 정렬 키가 아니다
 *
 * 지연은 **`now` 에 달린 값**이라 요청마다 답이 달라진다. 정렬 키에 넣으면 같은
 * 커서가 다음 요청에서 다른 자리를 가리키고, 그때 중복·누락은 **데이터가 하나도
 * 안 바뀌어도** 생긴다. 그래서 지연은 표시이고, 대신 **단계 안에서 오래된 것이
 * 먼저** 오게 한다 — 기한은 신청 시각의 단조 증가 함수이고 `id`(UUIDv7)는 신청
 * 시각과 같은 순서이므로, **`id ASC` 가 곧 기한 임박 순**이다. 지연된 건은 대기
 * 탭의 맨 위에 정확히 모인다.
 */

/**
 * 이 상태에서 **판매자가 다음 걸음을 밟아야 하는가**.
 *
 * **두 번째 표를 만들지 않는다.** `SELLER_ORDER_ACTION_REQUIRED_STATUSES` 는 상태를
 * 손으로 적었지만, 클레임에는 손으로 적을 필요가 없는 근거가 이미 있다 —
 * **전이표**다. 「판매자가 할 일이 있다」는 정확히 「이 상태를 떠나는 화살표 중
 * `SELLER` 가 지날 수 있는 것이 있다」이고, 그 사실은 `claimTransitions` 에 한 번
 * 적혀 있다.
 *
 * 표를 한 벌 더 두면 상태가 늘 때 한 곳만 고쳐진다. 그때 증상은 「처리할 것이
 * 없는데 3건 대기」이거나 「있는데 0건」이고, **어느 쪽도 실패하지 않는다.**
 *
 * 그래서 지금 나오는 답은 이렇다.
 *
 * | 단계 | 상태 | 왜 |
 * | --- | --- | --- |
 * | `WAITING` | `CANCEL_REQUESTED` · `RETURN_REQUESTED` | 승인하거나 거절해야 한다 |
 * | | `RETURN_APPROVED` · `PICKING_UP` | 수거·입고를 판매자도 민다 (시뮬레이터가 멈춘 데모에서 흐름이 끊기면 안 된다) |
 * | | `INSPECTING` | 검수는 **판매자만** 할 수 있다 |
 * | `IN_PROGRESS` | `CANCEL_APPROVED` · `RETURN_COMPLETED` | 남은 화살표가 `SYSTEM` 뿐이다 — 돈이 나가기를 기다린다 |
 * | `CLOSED` | 거절 둘과 `REFUNDED` | 전이표의 종착 셋 |
 */
export function claimHandlingStage(status: ClaimStatus): ClaimHandlingStage {
  const rules = claimTransitions[status]

  if (rules.length === 0) return 'CLOSED'

  return rules.some((rule) => rule.actors.includes('SELLER')) ? 'WAITING' : 'IN_PROGRESS'
}

/** 정렬 축 위의 자리. 작을수록 먼저 온다. */
export function claimStageRank(stage: ClaimHandlingStage): number {
  return claimHandlingStages.indexOf(stage)
}

/** 이 단계에 속하는 상태 전부. 목록의 SQL 이 `= ANY (…)` 로 쓴다. */
export function claimStatusesInStage(stage: ClaimHandlingStage): readonly ClaimStatus[] {
  return claimStatuses.filter((status) => claimHandlingStage(status) === stage)
}

/**
 * 이 걸음을 **어느 문으로** 밟는가 (`claimActionRoutes`).
 *
 * `POST /claims/:id/transitions` 로 전부 밀면 상태는 옮겨지지만 **옮겨지기만
 * 한다** — 회수 운송장은 나지 않고 검수 결과는 적히지 않으며, 합격했는데 환불이
 * 시작되지 않는다 (`return.controller.ts`). 즉 「반품완료인데 아무 일도 일어나지
 * 않은 반품」이 만들어지고 아무 오류도 나지 않는다.
 *
 * **`to` 만 보고 정할 수 없다.** `RETURN_REJECTED` 는 두 곳에서 나온다 — 신청을
 * 거절하는 것(`RETURN_REQUESTED` 에서, 전이 라우트)과 검수에서 떨어뜨리는
 * 것(`INSPECTING` 에서, 검수 라우트)이다. 둘은 같은 상태로 가지만 **다른 일**이고,
 * 뒤엣것을 전이 라우트로 밀면 반송장이 나지 않는다.
 */
export function claimActionRouteOf(from: ClaimStatus, to: ClaimStatus): ClaimActionRoute {
  if (from === 'RETURN_APPROVED' && to === 'PICKING_UP') return 'pickup'
  if (from === 'INSPECTING') return 'inspection'

  return 'transition'
}

/**
 * 이 걸음에 **사유가 필수인가** (TASK-0070 5장).
 *
 * 거절 둘뿐이다. 승인·수거·입고에 사유를 요구하면 정상 흐름마다 빈 칸을 채우게
 * 되고, 그러면 그 칸은 곧 「.」 으로 채워진다 — 그때 거절 사유도 함께 무의미해진다.
 *
 * **검수 불합격도 거절이다.** `INSPECTING → RETURN_REJECTED` 가 여기 걸리는 것이
 * 그 뜻이고, 그 경로에서 사유를 싣는 칸은 `inspectReturnRequestSchema.note` 다
 * (`ReturnService.inspect` 가 그 값을 전이의 사유로 넘긴다 — 두 칸이 아니라 한
 * 사실이어야 이력에 남는 문장이 하나다).
 */
export function claimTransitionNeedsReason(to: ClaimStatus): boolean {
  return to === 'CANCEL_REJECTED' || to === 'RETURN_REJECTED'
}

/** 커서가 가리키는 **정렬 축 위의 위치**. 행이 아니다. */
export interface SellerClaimCursor {
  readonly stageRank: number
  readonly id: string
}

/** 커서 문자열의 모양 — `<순위>.<uuid>` 를 base64url 로. */
const CURSOR_PATTERN =
  /^(?<rank>\d)\.(?<id>[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/

/**
 * 위치를 커서로.
 *
 * base64url 로 감싸는 것은 **클라이언트가 해석하지 못하게** 하기 위해서다. 날것으로
 * 내보내면 「순위를 0으로 바꿔 보는」 요청이 생기고, 그것을 막을 검사가 하나 더
 * 필요해진다 — 감싸도 위조는 가능하지만(서명이 아니다) 그 요청이 할 수 있는 최악은
 * 자기 목록을 이상한 자리에서 여는 것뿐이다. 남의 것은 `sellerId` 조건이 막는다.
 */
export function encodeSellerClaimCursor(cursor: SellerClaimCursor): string {
  return Buffer.from(`${String(cursor.stageRank)}.${cursor.id}`, 'utf8').toString('base64url')
}

/**
 * 커서를 위치로. **모양이 아니면 `null`** 이고, 부르는 쪽이 400 으로 돌려보낸다.
 *
 * 조용히 첫 페이지로 되돌리지 않는다 — 그러면 커서가 깨진 화면이 「1페이지를
 * 무한히 반복」하고, 그 증상은 아무 오류도 내지 않는다.
 */
export function decodeSellerClaimCursor(value: string): SellerClaimCursor | null {
  const decoded = Buffer.from(value, 'base64url').toString('utf8')
  const groups = CURSOR_PATTERN.exec(decoded)?.groups

  if (groups === undefined) return null

  const stageRank = Number(groups.rank)

  // 순위는 단계의 개수만큼만 있다. 범위를 벗어난 값은 정렬 축 위의 자리가 아니다.
  if (stageRank >= claimHandlingStages.length) return null

  return { stageRank, id: String(groups.id) }
}
