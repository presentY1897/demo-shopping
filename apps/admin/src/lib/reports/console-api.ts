import type {
  HandleReportRequest,
  ReportListQueryParams,
  ReportListResponse,
  ReportResponse,
} from '@shopping/shared'
import { reportListResponseSchema, reportResponseSchema } from '@shopping/shared'

import { getApiClient } from '@/lib/api'

/**
 * 이 콘솔이 신고에 대해 부르는 두 자리, 한 곳에.
 *
 * `lib/settlements/console-api.ts` 와 같은 모양이고 지켜지는 성질도 같다: **경로와
 * 스키마가 한 번씩만 적힌다.** 화면은 응답의 모양을 다시 선언하지 않으므로, 서버가
 * 필드 이름을 바꾸면 그 자리에서 파싱이 깨진다 — 화면이 조용히 `undefined` 를
 * 그리는 대신에 (게이트 C1).
 *
 * **`POST /reports` 는 여기 없다.** 신고를 **하는** 문은 `report.write` 를 요구하고
 * 구매자 화면의 것이다. 부를 데가 없는 함수를 미리 두면 다음 사람은 그것이 **왜**
 * 안 불리는지를 먼저 알아내야 한다.
 */

/** `?status=PENDING,HIDDEN&targetType=REVIEW&cursor=…`, 아무것도 없으면 빈 문자열. */
export function reportSearch(query: ReportListQueryParams): string {
  const params = new URLSearchParams()

  // 상태는 **쉼표 하나**로 보낸다. 반복 키(`?status=a&status=b`)는 프레임워크마다
  // 다르게 파싱되고, 이 저장소의 모든 목록이 같은 문법을 쓰는 이유가 그것이다
  // (`reportListQueryParamsSchema` 가 그 문법으로 읽는다).
  if (query.status !== undefined) params.set('status', query.status.join(','))
  if (query.targetType !== undefined) params.set('targetType', query.targetType)
  if (query.limit !== undefined) params.set('limit', String(query.limit))
  if (query.cursor !== undefined) params.set('cursor', query.cursor)

  const search = params.toString()

  return search === '' ? '' : `?${search}`
}

/**
 * 한 페이지와 **처리 대기 건수**. 최신순이고 커서는 `id` 하나다.
 *
 * `pendingCount` 는 **필터와 무관하다**(`reportListResponseSchema`) — 「지금 화면에
 * 몇 개」가 아니라 「할 일이 몇 개」다.
 */
export function fetchReports(
  query: ReportListQueryParams,
  options: { readonly signal?: AbortSignal } = {},
): Promise<ReportListResponse> {
  return getApiClient().request({
    path: `/reports${reportSearch(query)}`,
    schema: reportListResponseSchema,
    ...options,
  })
}

/**
 * 처리한다 — 숨김 · 삭제 · 반려 (F4 · F5 · F6).
 *
 * **사유 없이는 들어올 수 없다**(`handleReportRequestSchema` 의 `min(1)`), 그리고 그
 * 문장은 신고자에게 가는 알림에 그대로 실린다.
 */
export function handleReport(id: string, request: HandleReportRequest): Promise<ReportResponse> {
  return getApiClient().request({
    path: `/reports/${id}/handle`,
    method: 'POST',
    body: request,
    schema: reportResponseSchema,
  })
}
