import type { ApiCallOptions, CreateReportRequest, ReportResponse } from '@shopping/shared'
import { reportResponseSchema } from '@shopping/shared'

import { getApiClient } from '@/lib/api'

/**
 * 신고 접수 (TASK-0091 F1 · F2).
 *
 * **상점이 부르는 문은 이 하나다.** 목록과 처리는 관리자의 것이고
 * (`GET /reports` · `POST /reports/:id/handle`), 그 둘을 여기 적어 두면 상점 번들에
 * 아무도 부를 수 없는 함수가 두 개 남는다.
 *
 * **응답을 그리지는 않는다.** 답으로 오는 `Report` 는 관리자 목록이 읽는 모양이고
 * (`targetReportCount` · `targetHidden` 은 신고한 사람이 알 일이 아니다), 화면이
 * 이 자리에서 말하는 것은 「접수됐습니다」 한 줄이다. 그래도 **계약 스키마로
 * 파싱한다** — 파싱하지 않으면 서버가 모양을 바꿔도 이 화면만 조용히 통과한다.
 */
export function createReport(
  body: CreateReportRequest,
  options?: ApiCallOptions,
): Promise<ReportResponse> {
  return getApiClient().request({
    path: '/reports',
    method: 'POST',
    body,
    schema: reportResponseSchema,
    ...options,
  })
}
