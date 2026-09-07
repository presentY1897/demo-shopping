/**
 * 신고 대역이 답하는 값들.
 *
 * **전부 계약 스키마를 지난다.** `@shopping/api-mocks` 의 `defineFixture` 가 모든
 * 응답에 하는 일과 같은 것이고, 같은 이유로 있다: 검사가 지어낸 모양은 서버가
 * 실제로 보내는 모양이 아닐 수 있고, 그러면 화면은 오지 않는 값을 그리는 코드로
 * 통과한다 (게이트 C2). `targetReportCount` 가 1 이상이라는 것도 여기서 지켜진다 —
 * 신고가 한 건도 없는 신고는 서버가 만들 수 없는 값이다.
 *
 * **`packages/api-mocks` 에 msw 대역이 없다.** `/reports` 라우트들은 그 패키지에
 * 아직 등록되어 있지 않고, 이 TASK 는 `apps/admin` 밖을 고치지 않는다. 그래서 이
 * 화면의 검사는 `lib/reports/console-api` 를 대신 세운다 — 경로와 스키마가 한 곳에
 * 모여 있는 것이 그것을 가능하게 한다 (`support/settlements.ts` 와 같은 사정).
 */

import type { Report, ReportListResponse, ReportResponse } from '@shopping/shared'
import { reportListResponseSchema, reportResponseSchema, reportSchema } from '@shopping/shared'

let serial = 0

/** 신고 한 건. 기본값은 아직 아무도 손대지 않은 리뷰 신고다. */
export function report(overrides: Partial<Report> = {}): Report {
  serial += 1

  return reportSchema.parse({
    id: `019596e0-0031-7000-8000-${String(serial).padStart(12, '0')}`,
    targetType: 'REVIEW',
    targetId: `019596e0-0032-7000-8000-${String(serial).padStart(12, '0')}`,
    reason: 'ABUSE',
    detail: '욕설이 섞여 있습니다.',
    status: 'PENDING',
    targetReportCount: 1,
    targetHidden: false,
    targetExcerpt: '이런 걸 파는 가게가 다 있네요',
    handledNote: null,
    handledAt: null,
    createdAt: '2026-09-06T00:10:00.000Z',
    ...overrides,
  })
}

export function reportList(
  reports: readonly Report[],
  overrides: Partial<ReportListResponse> = {},
): ReportListResponse {
  return reportListResponseSchema.parse({
    reports,
    nextCursor: null,
    // 필터와 무관한 값이라 목록의 길이에서 나오지 않는다. 기본값은 화면에 보이는
    // 대기 건수와 우연히 같게 두고, 다른 값을 재는 검사가 직접 넘긴다.
    pendingCount: reports.filter((row) => row.status === 'PENDING').length,
    ...overrides,
  })
}

export function handled(row: Report): ReportResponse {
  return reportResponseSchema.parse({ report: row })
}
