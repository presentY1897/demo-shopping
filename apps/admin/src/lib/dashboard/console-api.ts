import type {
  DashboardMetricsResponse,
  DashboardPendingResponse,
  DashboardSystemResponse,
} from '@shopping/shared'
import {
  dashboardMetricsResponseSchema,
  dashboardPendingResponseSchema,
  dashboardSystemResponseSchema,
} from '@shopping/shared'

import { getApiClient } from '@/lib/api'

import type { DashboardPeriod } from './dashboard-console'

/**
 * 대시보드가 두드리는 문 셋, 한 곳에.
 *
 * `lib/reports/console-api.ts` 와 같은 모양이고 지켜지는 성질도 같다: **경로와 스키마가
 * 한 번씩만 적힌다.** 화면은 응답의 모양을 다시 선언하지 않으므로, 서버가 필드 이름을
 * 바꾸면 그 자리에서 파싱이 깨진다 — 화면이 조용히 `undefined` 를 그리는 대신에
 * (게이트 C1).
 *
 * **셋이 한 함수가 아닌 것이 설계다** (TASK-0092 4.1). 지표는 기간을 받아 무겁게
 * 집계하고, 처리 대기는 가볍고 자주 바뀌며, 시스템 상태는 데이터베이스가 아니라
 * 프로세스에 묻는다. 합치면 가장 느린 것이 나머지를 붙잡고, 하나가 실패하면 화면이
 * 통째로 빈다.
 */

/** `?from=2026-08-08&to=2026-09-06`. 기간은 언제나 둘 다 실려 나간다. */
export function dashboardSearch(period: DashboardPeriod): string {
  return `?${new URLSearchParams({ from: period.from, to: period.to }).toString()}`
}

/**
 * 지표 · 추이 · 순위 (F1 · F3).
 *
 * 기간을 **비워 보내지 않는다.** 서버에도 기본값이 있지만(최근 30일), 화면은 이미
 * 자기가 고른 기간을 날짜 두 칸에 그려 놓고 있다 — 비워 보내면 그 두 칸과 답이 서로
 * 다른 기간을 가리키게 되고, 그 어긋남은 자정 근처에서만 나타나 재현되지 않는다.
 */
export function fetchDashboardMetrics(
  period: DashboardPeriod,
  options: { readonly signal?: AbortSignal } = {},
): Promise<DashboardMetricsResponse> {
  return getApiClient().request({
    path: `/admin/dashboard/metrics${dashboardSearch(period)}`,
    schema: dashboardMetricsResponseSchema,
    ...options,
  })
}

/**
 * 지금 사람이 해야 할 일 (F2).
 *
 * **기간을 받지 않는다.** 3주 전에 들어온 신청도 아직 안 봤으면 오늘의 할 일이고, 그
 * 판단은 계약의 것이다(`dashboardPendingResponseSchema`). 화면이 여기에 기간을 얹으면
 * 그 기간 밖의 밀린 일이 사라지고, 이 화면이 존재하는 이유가 사라진다.
 */
export function fetchDashboardPending(
  options: { readonly signal?: AbortSignal } = {},
): Promise<DashboardPendingResponse> {
  return getApiClient().request({
    path: '/admin/dashboard/pending',
    schema: dashboardPendingResponseSchema,
    ...options,
  })
}

/**
 * 배치들이 돌고 있는가, 그리고 데모 계정이 몇 개인가 (F4).
 *
 * 공개 `GET /health` 로는 이것을 할 수 없다 — 저쪽은 로드밸런서가 부르는 문이라 의존성
 * 몇 개만 말한다. 같은 사실을 관리자에게만 자세히 답하는 것이 이 문이다
 * (`dashboardSystemResponseSchema`).
 */
export function fetchDashboardSystem(
  options: { readonly signal?: AbortSignal } = {},
): Promise<DashboardSystemResponse> {
  return getApiClient().request({
    path: '/admin/dashboard/system',
    schema: dashboardSystemResponseSchema,
    ...options,
  })
}
