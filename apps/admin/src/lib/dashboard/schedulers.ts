import { schedulerKeys } from '@shopping/shared'
import type { SchedulerKey } from '@shopping/shared'
import type { SchedulerHealth, SchedulerStatus } from '@shopping/shared'
import type { BadgeVariant } from '@shopping/ui/components'

/**
 * 배치 열 개에 **이름과 무게**를 붙이는 자리 (TASK-0092 F4).
 *
 * ## 왜 화면이 이름을 갖고 있나
 *
 * 계약이 싣는 것은 `reservation.sweep.lastRunAt` 같은 점 찍힌 문자열이다
 * (`schedulerHealthSchema`). 그것을 그대로 그리면 시스템 상태 섹션은 **개발자만 읽을
 * 수 있는 표**가 되고, 그 표를 매일 보게 되어 있는 사람은 개발자가 아니다.
 *
 * ## 왜 `Record` 인가
 *
 * {@link SchedulerNames} 가 열 개의 열쇠로 **전수**라, 서버에 배치가 하나 늘고 콘솔이
 * 이름을 안 적으면 `pnpm typecheck` 이 먼저 걸린다. `Record<string, string>` 이었으면
 * 그 배치는 점 찍힌 열쇠를 그대로 달고 조용히 화면에 나타난다.
 *
 * 그런데도 {@link schedulerLabel} 은 모르는 열쇠를 받아 낸다. API 와 콘솔은 **따로
 * 배포되는 두 프로세스**라, 새 배치를 실은 서버가 이 화면보다 먼저 뜨는 순간이 실제로
 * 있다. 그때 이름이 없다고 그 줄을 **숨기면** 멈춘 배치가 아무 데도 안 보이게 되고,
 * 그것이 정확히 이 섹션이 막으려던 일이다. 그래서 열쇠라도 그린다 — 못생긴 것이
 * 없는 것보다 낫다.
 *
 * I/O 도 렌더도 없다 (`vitest.config.mjs` 가 이 파일을 분기 100% 로 잡고 있다).
 */

/**
 * 대시보드가 지켜보는 배치들.
 *
 * 열쇠 목록은 **계약에서 온다** (`schedulerKeys`). 거울로 두었더니 서버에 배치가
 * 하나 늘어도 화면은 점 찍힌 열쇠를 날것으로 그리고 아무 검사도 안 빨개졌다 —
 * 계약에 한 벌만 두면 이름표가 전수 `Record` 라 새 배치는 typecheck 에서 걸린다.
 * 서버의 목록이 그 계약을 다 덮는지는 `scheduler-registry-parity.spec.ts` 가 본다.
 */
export const SCHEDULER_KEYS = schedulerKeys

export type { SchedulerKey }

/** 배치 하나당 한국어 이름. 전수라 배치가 늘면 카탈로그가 typecheck 에서 걸린다. */
export type SchedulerNames = Readonly<Record<SchedulerKey, string>>

export function isSchedulerKey(key: string): key is SchedulerKey {
  return (SCHEDULER_KEYS as readonly string[]).includes(key)
}

/** 아는 열쇠면 한국어 이름, 모르는 열쇠면 열쇠 그대로. 머리말이 왜인지를 적고 있다. */
export function schedulerLabel(key: string, names: SchedulerNames): string {
  return isSchedulerKey(key) ? names[key] : key
}

/**
 * 상태 하나의 **색**.
 *
 * `stale` 만 붉다. `never` 를 같이 칠하면 배포 직후마다 빨간 화면을 보게 되고, 그것이
 * 몇 번 반복되면 사람은 그 색을 안 믿는다 — 그 다음에 진짜로 멈춘 배치가 생겨도
 * 아무도 안 본다 (`schedulerHealthSchema` 의 머리말).
 *
 * 색만으로 말하지 않는 것은 화면의 몫이다. 뱃지 안에 상태 이름이 한국어로 들어 있고,
 * 그것이 흑백 인쇄와 색각 이상 모두에서 남는 정보다 (P2).
 */
export const SCHEDULER_VARIANTS: Readonly<Record<SchedulerStatus, BadgeVariant>> = {
  ok: 'success',
  stale: 'danger',
  never: 'neutral',
}

/**
 * 표의 순서. **멈춘 것이 맨 위다.**
 *
 * 등록 순서대로 그리면 아홉 줄이 초록인 표의 여섯째 줄에 붉은 줄 하나가 끼고, 그것은
 * 스크롤해 내려가며 찾아야 하는 이상이다. 이 화면의 목적은 「지금 뭘 해야 하는가」라
 * 사고가 먼저 온다.
 *
 * 같은 상태 안에서는 **받은 순서를 지킨다.** `Array.prototype.sort` 는 안정 정렬이고,
 * 서버가 보내는 순서는 등록 순서(도메인 순)라 그 자체로 뜻이 있다.
 */
const STATUS_RANK: Readonly<Record<SchedulerStatus, number>> = { stale: 0, never: 1, ok: 2 }

export function sortSchedulers(rows: readonly SchedulerHealth[]): readonly SchedulerHealth[] {
  return [...rows].sort((left, right) => STATUS_RANK[left.status] - STATUS_RANK[right.status])
}

/**
 * 섹션 머리의 한 문장 — **표를 읽지 않고도 알아야 하는 것.**
 *
 * 셋을 가르는 이유는 셋이 서로 다른 행동을 부르기 때문이다: `stopped` 는 지금
 * 손봐야 하고, `idle` 은 방금 뜬 프로세스라 몇 분 기다리면 되며, `ok` 는 아무것도 안
 * 해도 된다. 하나로 합쳐 「이상 있음」이라고만 적으면 배포 직후의 정상 상태가 사고와
 * 같은 문장을 받는다.
 */
export type SystemSummary =
  | { readonly kind: 'stopped'; readonly count: number }
  | { readonly kind: 'idle'; readonly count: number }
  | { readonly kind: 'ok' }

export function systemSummary(rows: readonly SchedulerHealth[]): SystemSummary {
  const stopped = rows.filter((row) => row.status === 'stale').length

  if (stopped > 0) return { count: stopped, kind: 'stopped' }

  const idle = rows.filter((row) => row.status === 'never').length

  if (idle > 0) return { count: idle, kind: 'idle' }

  return { kind: 'ok' }
}
