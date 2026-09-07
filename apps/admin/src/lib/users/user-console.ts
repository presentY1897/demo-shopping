import type {
  AdjustPointsResponse,
  AdminUserListQueryParams,
  ApiFailure,
  Role,
} from '@shopping/shared'
import { roles } from '@shopping/shared'

/**
 * 회원 화면의 순수 판단 — **무엇을 묻고, 답과 거절을 어떻게 읽는가** (TASK-0093).
 *
 * `lib/reports/report-console.ts` · `lib/dashboard/dashboard-console.ts` 와 같은
 * 자리에 같은 이유로 있다: 여기 있는 것들은 전부 **틀려도 조용하다.**
 *
 * | 무엇이 틀리면 | 화면은 |
 * | --- | --- |
 * | 필터 → 질의 | 「이 조건에 회원이 없어요」를 멀쩡히 그린다. 검색이 안 되는 것이 아니라 **다른 것을 찾아 준다** |
 * | 적립금의 실제 반영액 | 사람이 **요청한 숫자**를 그린다 — 잔액까지만 빠진 차감을 「-50,000원 적용」이라고 말하는 거짓말이다 (F5) |
 * | 거절 분류 | 운영자의 403 이 「일시적인 문제가 생겼어요」가 되어 몇 번이고 다시 눌린다 (F8) |
 * | 관리자 역할 판정 | 확인 한 걸음 없이 `ADMIN_SUPER` 가 부여된다 (R1) |
 *
 * I/O 도 렌더도 없다 (QUALITY-GATES 순수 로직 — `vitest.config.mjs` 가 이 파일을
 * 분기 100% 로 잡고 있다).
 */

/* --------------------------------------------------------------- 필터 -- */

/**
 * 검색어의 상한.
 *
 * **계약의 값을 옮겨 적은 것이다** — `adminUserListQueryParamsSchema.q` 가
 * `.max(120)` 으로 잡고 있는데 그 수는 `@shopping/shared` 에서 나오지 않는다.
 * 옮겨 적지 않으면 121자를 친 사람이 받는 것은 「검색어가 너무 길어요」가 아니라
 * 400 이고, 그때 화면이 할 수 있는 말은 「입력하신 내용을 다시 확인해 주세요」뿐이다.
 */
export const USER_SEARCH_MAX = 120

/**
 * 목록 필터가 들고 있는 것.
 *
 * `q` 는 **사람이 친 문자열 그대로**다. 빈 문자열이 「안 좁혔다」이고, `null` 을 쓰지
 * 않는 이유는 입력 칸의 값이 언제나 문자열이기 때문이다 — 두 표현을 섞으면 칸을 다
 * 지운 순간이 「전체」인지 「빈 검색어로 검색」인지 화면마다 달라진다.
 *
 * 나머지 셋은 `null` 이 「전체」다.
 */
export interface UserFilters {
  readonly q: string
  readonly role: Role | null
  readonly isDemo: boolean | null
  readonly suspended: boolean | null
}

export const EMPTY_USER_FILTERS: UserFilters = {
  q: '',
  role: null,
  isDemo: null,
  suspended: null,
}

/** 하나라도 좁혔는가. 빈 목록이 「없다」인지 「이 조건에 없다」인지를 가른다. */
export function isNarrowed(filters: UserFilters): boolean {
  return (
    filters.q.trim() !== '' ||
    filters.role !== null ||
    filters.isDemo !== null ||
    filters.suspended !== null
  )
}

/**
 * 필터를 계약의 질의로. 커서와 개수는 부르는 쪽이 얹는다.
 *
 * 값이 없는 축은 **키 자체를 넣지 않는다.** `undefined` 를 실어 보내면
 * `URLSearchParams` 가 `role=undefined` 를 만들고, 서버는 그것을 잘못된 역할로 읽어
 * 400 으로 답한다 (`report-console.ts` 의 같은 규약).
 *
 * 검색어는 **앞뒤 공백을 뗀다.** 계약도 그렇게 읽지만(`z.string().trim()`), 떼지 않고
 * 보내면 공백만 친 사람이 「최소 한 글자」에 걸려 400 을 받는다 — 그 사람이 한 일은
 * 검색을 지운 것이다.
 */
export function queryOf(filters: UserFilters): AdminUserListQueryParams {
  const q = filters.q.trim()

  return {
    ...(q === '' ? {} : { q }),
    ...(filters.role === null ? {} : { role: filters.role }),
    ...(filters.isDemo === null ? {} : { isDemo: filters.isDemo }),
    ...(filters.suspended === null ? {} : { suspended: filters.suspended }),
  }
}

/* --------------------------------------------------------------- 역할 -- */

/**
 * 확인을 한 걸음 더 받아야 하는 역할 (R1).
 *
 * 관리자 역할 셋은 **부여하는 순간 이 콘솔 전체가 열린다.** 나머지 둘과 같은 무게로
 * 다루면 목록에서 잘못 고른 한 번이 곧 최고관리자 한 명이고, 회수는 되지만 그 사이에
 * 일어난 일은 되돌아오지 않는다.
 *
 * 목록으로 적는 것이 판정이다 — `startsWith('ADMIN')` 으로 적으면 `DEMO_ADMIN` 이
 * 조용히 빠지고, 그것도 콘솔에 들어오는 역할이다 (`console-access.ts`).
 */
const ADMIN_ROLES: readonly Role[] = ['ADMIN_OPERATOR', 'ADMIN_SUPER', 'DEMO_ADMIN']

export function isAdminRole(role: Role): boolean {
  return ADMIN_ROLES.includes(role)
}

/**
 * 지금 부여할 수 있는 역할들 — **이미 가진 것은 빼고.**
 *
 * 서버는 이미 가진 역할을 다시 부여해도 같은 집합으로 답한다(`user-roles.ts` 의
 * 머리말). 그래도 목록에서 빼는 이유는 **화면이 거짓말을 하지 않게** 하기 위해서다:
 * 고를 수 있는데 눌러도 아무 일도 안 일어나는 항목은, 눌러 본 사람에게 고장으로 읽힌다.
 */
export function grantableRoles(held: readonly Role[]): readonly Role[] {
  return roles.filter((role) => !held.includes(role))
}

/* ------------------------------------------------------------- 적립금 -- */

/**
 * 사람이 친 조정 금액.
 *
 * `null` 은 「수로 읽을 수 없다」이고 **0과 다르다.** `Number('')` 가 0이라 빈 칸을
 * 먼저 걸러야 하고, 소수점이 섞인 값도 여기서 걸린다 — 금액은 정수(원 단위)다
 * (CLAUDE.md 6장).
 *
 * 0은 **여기서 막지 않는다.** 계약이 0을 거절하고(`adjustPointsRequestSchema`) 그
 * 거절에는 그 나름의 문장이 있다 — 「아무것도 안 하는 조정」과 「수가 아니다」는 사람이
 * 고쳐야 할 것이 서로 다르다.
 */
export function parseAmount(raw: string): number | null {
  const text = raw.trim()

  if (text === '') return null

  const value = Number(text)

  return Number.isInteger(value) ? value : null
}

/**
 * 요청한 금액과 **실제로 움직인 몫**의 관계 (F5).
 *
 * 차감은 잔액까지만 간다(`adjustByAdmin`). 그 사실을 화면이 말하지 않고 사람이 친
 * 숫자를 그대로 그리면 **거짓말**이 된다 — 5만원을 빼려 했고 1만원만 빠졌는데 화면은
 * 「-50,000원 조정했어요」라고 말하고, 그 사람은 다음에 잔액을 보고서야 알게 된다.
 *
 * `none` 이 따로 있는 이유는 다음 행동이 다르기 때문이다. 잔액이 0인 계정에서 차감은
 * **아무 줄도 남기지 않고** 끝나므로(`applied === 0`), 「일부만 반영됐어요」라고 말하면
 * 원장에 있지도 않은 줄을 가리키게 된다.
 */
export type PointsOutcome = 'exact' | 'clipped' | 'none'

export function pointsOutcome(requested: number, answer: AdjustPointsResponse): PointsOutcome {
  if (answer.applied === 0) return 'none'

  return answer.applied === requested ? 'exact' : 'clipped'
}

/* --------------------------------------------------------------- 거절 -- */

/**
 * 쓰기가 거절됐을 때, **이 화면이 따로 할 말이 있는** 두 가지.
 *
 * `forbidden` — 정지도 적립금 조정도 `user.write` 이고, 그것은 최고관리자만 갖는다
 * (`role-permissions.ts`). 화면은 버튼을 미리 막지만(`GuardedButton`) 그것으로
 * 끝내지 않는 이유는, 부팅 갱신이 끝나기 전이나 다른 탭에서 역할이 회수된 뒤에도
 * 버튼이 살아 있을 수 있기 때문이다 — 그때 오는 403 은 **다시 눌러 볼 만한 오류가
 * 아니다.** 카탈로그의 `FORBIDDEN` 은 「권한이 없어요」 한 줄이라 어느 자격이
 * 모자란지를 말하지 못한다 (F8).
 *
 * `stale` — 이미 정지된 회원을 또 정지하거나, 정지가 아닌 회원을 해제하면 서버가
 * 404 로 답한다(`admin-user.service.ts` 의 `updateMany` 가 0건이면 던진다). 다음
 * 행동은 **다시 읽는 것**이지 다시 누르는 것이 아니고, 그 차이를 말할 수 있는 것은
 * 화면뿐이다.
 *
 * `null` 이 「보통의 실패」다. 그때 문장을 고르는 것은 `failureMessage` 이고, 그것이
 * 코드별 문장을 이미 전부 들고 있다 — 여기서 되풀이하면 카탈로그를 지나지 않은
 * 문장이 하나 생긴다.
 */
export const userRefusals = ['forbidden', 'stale'] as const

export type UserRefusal = (typeof userRefusals)[number]

export function refusalOf(failure: ApiFailure): UserRefusal | null {
  if (failure.kind !== 'http') return null
  if (failure.status === 403) return 'forbidden'

  return failure.status === 404 ? 'stale' : null
}
