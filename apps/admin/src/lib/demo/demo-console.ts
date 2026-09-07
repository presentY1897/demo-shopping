import type { AdminDemoAccount, Role } from '@shopping/shared'
import { demoPolicySchema, isRole, roles } from '@shopping/shared'

import { isEndingSoon, remainingOf } from './remaining'

/**
 * 데모 관리 화면의 순수 판단 — **무엇을 묻고, 답을 어떻게 읽는가** (TASK-0096).
 *
 * `lib/dashboard/dashboard-console.ts` · `lib/reports/report-console.ts` 와 같은
 * 자리에 같은 이유로 있다: 여기 있는 것들은 전부 **틀려도 조용하다.**
 *
 * | 무엇이 틀리면 | 화면은 |
 * | --- | --- |
 * | 기간 산술 | 멀쩡한 표를 그린다. 「이틀 아무도 안 눌렀다」가 하루씩 밀린 채로 (4.5) |
 * | 만료 판정 | 곧 사라질 계정을 「아직 여유 있음」으로 그린다 — 강제 만료를 눌러야 할 자리에서 |
 * | 정리 실패의 짝 | **이유 없는 실패**를 그린다. 화면이 말할 것이 없는 상태이고, 그것이 4.3 이 막으려던 것이다 |
 * | 정책 검증 | 서버가 400 으로 거절할 값을 사람에게 「저장했어요」처럼 보이게 한다 |
 * | 역할별 이름 | 이 콘솔이 모르는 역할이 늘었을 때 그 줄을 **숨긴다** — 통계의 합이 조용히 안 맞는다 |
 *
 * I/O 도 렌더도 없다 (QUALITY-GATES 순수 로직 — `vitest.config.mjs` 가 이 파일을
 * 분기 100% 로 잡고 있다).
 */

const DAY_MS = 24 * 60 * 60 * 1_000

/**
 * KST 고정 오프셋 +09:00.
 *
 * `lib/dashboard/dashboard-console.ts` 와 같은 상수를 같은 이유로 쓴다 — 한국
 * 표준시는 서머타임이 없어 고정 오프셋 산술이 IANA 표와 정확히 같은 답을 낸다.
 * 서버가 하루를 자르는 자리도 KST 자정이다 (`kst-days.ts`).
 *
 * **저 파일을 import 하지 않고 옮겨 적었다.** 대시보드의 기간은 그 화면의 판단이고
 * (기본 30일 · 계약의 상한), 이쪽은 다른 문의 다른 기본값을 쓴다. 한쪽을 고치면
 * 다른 쪽이 따라 움직이는 관계가 아니다 — `lib/reports/format.ts` 와
 * `lib/claims/format.ts` 가 같은 시간대를 각자 적어 두는 것과 같은 이유다.
 */
const KST_OFFSET_MS = 9 * 60 * 60 * 1_000

/**
 * 통계 기간의 기본값과 상한.
 *
 * **`apps/api` 의 `admin-demo.service.ts` 를 옮겨 적은 것이다** — 그쪽의
 * `DEFAULT_DAYS` · `MAX_DAYS` 는 `@shopping/shared` 로 나오지 않아 화면이 계약에서
 * 읽을 방법이 없다. 옮겨 적지 않으면 상한을 넘긴 기간이 서버에서 **끝에서부터 잘려**
 * 200 으로 돌아오고, 그때 화면의 날짜 두 칸과 표가 서로 다른 기간을 가리킨다
 * (`rangeOf`). 즉 잘못 그리는 것이 아니라 **아무도 고른 적 없는 기간**을 그린다.
 */
export const DEMO_STATS_DEFAULT_DAYS = 14

export const DEMO_STATS_MAX_DAYS = 90

/** 화면이 들고 있는 기간. 둘 다 `YYYY-MM-DD` 이고 **양쪽 다 포함**이다. */
export interface DemoStatsPeriod {
  readonly from: string
  readonly to: string
}

/** 그 순간의 **KST 달력 날짜**. 자정 직후 서울에서 「어제」가 되지 않게 한다. */
export function kstDay(instant: Date): string {
  return new Date(instant.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10)
}

/** `YYYY-MM-DD` 에서 며칠 뒤(음수면 앞). 달·연 경계는 `Date` 가 안다. */
export function shiftDay(day: string, delta: number): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + delta * DAY_MS).toISOString().slice(0, 10)
}

/** 처음 열었을 때 보이는 기간. 계약이 `from`·`to` 없이 불렸을 때 주는 것과 같은 길이다. */
export function defaultDemoStatsPeriod(now: Date): DemoStatsPeriod {
  const to = kstDay(now)

  return { from: shiftDay(to, -(DEMO_STATS_DEFAULT_DAYS - 1)), to }
}

/** 양 끝을 포함한 날 수. 거꾸로 고른 기간에서는 0 이하가 된다. */
export function dayCount(period: DemoStatsPeriod): number {
  return Math.round((Date.parse(period.to) - Date.parse(period.from)) / DAY_MS) + 1
}

/**
 * 이 기간을 그대로 물어도 되는가.
 *
 * **막지 않고 말한다.** 고치는 방법이 그 입력뿐인데 입력을 잠그면 되돌릴 길이 없고,
 * 대신 오류가 그 칸에 붙어 어디를 고쳐야 하는지 말한다 (`period-filters.tsx` 와 같은
 * 규약).
 *
 * `incomplete` 가 먼저인 이유는 그것이 **가장 흔하기** 때문이다. 날짜 칸을 지우거나
 * 고치는 도중에 브라우저는 빈 문자열을 준다(`<input type="date">` 는 반쯤 친 값을
 * 내놓지 않는다). 그것을 그대로 보내면 서버가 `from=` 을 400 으로 답하고, 화면이 할
 * 수 있는 말은 「입력하신 내용을 다시 확인해 주세요」뿐이다 — 어느 칸인지도 말하지
 * 못한다. 뒤집힘 판정도 여기서 먼저 걸러야 한다: 빈 문자열은 어떤 날짜보다도 작아
 * 「거꾸로 골랐다」로 잘못 읽힌다.
 */
export type DemoPeriodProblem = 'incomplete' | 'reversed' | 'tooLong'

export function periodProblem(period: DemoStatsPeriod): DemoPeriodProblem | null {
  if (Number.isNaN(Date.parse(period.from))) return 'incomplete'
  if (Number.isNaN(Date.parse(period.to))) return 'incomplete'
  if (period.to < period.from) return 'reversed'
  if (dayCount(period) > DEMO_STATS_MAX_DAYS) return 'tooLong'

  return null
}

/* ----------------------------------------------------------- 계정 한 줄 -- */

/**
 * 이 계정이 언제까지인가 (F1).
 *
 * `none` 은 만료 시각이 없는 계정이다. 계약이 `expiresAt` 을 nullable 로 싣고
 * (`adminDemoAccountSchema`), 목록의 조건도 `isDemo` 하나이므로 실제로 온다 — 그때
 * 빈칸을 그리면 「못 읽었다」와 구분되지 않는다.
 *
 * `endingSoon` 을 `live` 에서 갈라 두는 이유는 **다음 행동이 다르기** 때문이다.
 * 여섯 시간 남은 계정은 사실이고, 이십 분 남은 계정은 곧 정리 대상이 된다 — 강제
 * 만료를 누를지 말지가 그 차이에서 갈린다 (`remaining.ts` 의 `isEndingSoon` 이 같은
 * 판단을 배너에 먼저 했다).
 */
export type ExpiryStatus = 'none' | 'expired' | 'endingSoon' | 'live'

export function expiryStatus(expiresAt: string | null, now: number): ExpiryStatus {
  if (expiresAt === null) return 'none'

  const left = remainingOf(expiresAt, now)

  if (left.expired) return 'expired'

  return isEndingSoon(left) ? 'endingSoon' : 'live'
}

/**
 * 정리가 실패한 상태인가 — **시각과 이유의 짝으로** (F4 · 4.3).
 *
 * 계약은 둘을 따로 nullable 로 싣지만 데이터베이스가 둘을 묶어 두었다
 * (`User_demo_cleanup_failure_check`: 한쪽이 `NULL` 이면 다른 쪽도 `NULL`). 화면이
 * 그 짝을 다시 확인하는 이유는, 한쪽만 보고 그리면 **이유 없는 실패**가 표에 서기
 * 때문이다 — 운영자가 그 줄에서 할 수 있는 일이 아무것도 없다.
 *
 * 실패는 **표가 아니라 칸**이다. 다음 주기가 성공하면 서버가 두 칸을 함께 비우고,
 * 이 함수는 그때부터 `null` 을 돌려준다 — 「이미 정리된 계정의 옛 실패」가 목록에
 * 남지 않는 것이 그 설계다.
 */
export interface CleanupFailure {
  readonly reason: string
  readonly at: string
}

export function cleanupFailureOf(account: AdminDemoAccount): CleanupFailure | null {
  if (account.cleanupError === null) return null
  if (account.cleanupFailedAt === null) return null

  return { at: account.cleanupFailedAt, reason: account.cleanupError }
}

/* ----------------------------------------------------------- 역할별 통계 -- */

/**
 * 역할별 발급 수를 **순서가 있는 줄들**로 (F7).
 *
 * 계약의 `byRole` 은 `Record<string, number>` 다 — 열쇠는 서버의 역할 이름이고,
 * 객체라 순서를 약속하지 않는다. 그대로 `Object.entries` 로 그리면 두 번의 조회가
 * 같은 데이터를 다른 순서로 그릴 수 있고, 매일 같은 자리를 눈으로 찾는 사람에게
 * 그것은 읽을 수 없는 화면이다.
 *
 * **모르는 열쇠를 숨기지 않는다.** API 와 콘솔은 따로 배포되므로 이 콘솔이 이름을
 * 모르는 역할이 실제로 올 수 있고, 그 줄을 빼면 역할별 합이 조용히 전체와 어긋난다
 * (`lib/dashboard/schedulers.ts` 가 배치 이름에 같은 판단을 먼저 했다). 이름이
 * 없다는 사실은 화면이 문장으로 말한다.
 *
 * **`named` 가 판별자다.** 참이면 `role` 이 계약의 `Role` 이므로 화면이 카탈로그에서
 * 이름을 꺼낼 수 있고, 거짓이면 열쇠를 그대로 그린다. 유니온으로 두면 그 자리에
 * 형변환이 필요 없다 — 형변환을 쓰면 역할 이름표에 없는 열쇠를 넣어도 컴파일이
 * 지나간다.
 */
export type RoleCount =
  | { readonly role: Role; readonly issued: number; readonly named: true }
  | { readonly role: string; readonly issued: number; readonly named: false }

export function roleCounts(byRole: Readonly<Record<string, number>>): readonly RoleCount[] {
  // 한 번만 읽는다. 순서를 정하면서 `byRole[role]` 로 다시 들여다보면 그 자리가
  // `number | undefined` 가 되고(`noUncheckedIndexedAccess`), 닿을 일 없는 기본값
  // 하나를 적게 된다 — 그런 갈래는 검사가 지나갈 수 없는 자리로 남는다.
  const rows = Object.entries(byRole).map(([role, issued]): RoleCount =>
    isRole(role) ? { issued, named: true, role } : { issued, named: false, role },
  )

  return [
    ...roles.flatMap((role) => rows.filter((row) => row.role === role)),
    ...rows.filter((row) => !row.named),
  ]
}

/* --------------------------------------------------------------- 정책 -- */

/**
 * 정책 폼의 세 칸. `Record` 로 잡아 두므로 계약에 칸이 하나 늘면 여기가 typecheck
 * 에서 걸린다 (`demoPolicySchema`).
 */
export const POLICY_FIELDS = ['ttlHours', 'seedOrders', 'virtualCardLimit'] as const

export type PolicyField = (typeof POLICY_FIELDS)[number]

export type PolicyValues = Readonly<Record<PolicyField, string>>

/**
 * 사람이 친 정수.
 *
 * `null` 은 「수로 읽을 수 없다」이고 **0과 다르다** — `Number('')` 가 0이라 빈 칸을
 * 먼저 걸러야 한다. 소수점이 섞인 값도 여기서 걸린다: 수명이 1.5시간이면 서버는
 * 400 으로 답하고, 그 400 은 어느 칸의 문제인지 말하지 못한다.
 */
export function parseInteger(raw: string): number | null {
  const text = raw.trim()

  if (text === '') return null

  const value = Number(text)

  return Number.isInteger(value) ? value : null
}

/**
 * 지금 이 정책을 저장해도 되는가 — **칸마다** (F6).
 *
 * 범위는 여기서 다시 적지 않는다. `demoPolicySchema` 의 칸별 스키마를 그대로 물어
 * 보므로, 계약이 상한을 720시간에서 다른 값으로 옮기면 화면이 저절로 따라간다 —
 * 손으로 옮겨 적으면 그날부터 화면만 옛 범위를 지킨다.
 *
 * 「수가 아니다」와 「범위를 벗어났다」를 가르는 이유는 사람이 할 일이 다르기
 * 때문이다: 앞엣것은 다시 치는 일이고, 뒤엣것은 **얼마까지 되는지 알아야** 고칠 수
 * 있는 일이다.
 */
export type PolicyProblem = 'required' | 'range'

export type PolicyProblems = Readonly<Partial<Record<PolicyField, PolicyProblem>>>

export function policyProblems(values: PolicyValues): PolicyProblems {
  const problems: Partial<Record<PolicyField, PolicyProblem>> = {}

  for (const field of POLICY_FIELDS) {
    const value = parseInteger(values[field])

    if (value === null) {
      problems[field] = 'required'
    } else if (!demoPolicySchema.shape[field].safeParse(value).success) {
      problems[field] = 'range'
    }
  }

  return problems
}
