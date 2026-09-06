import type { ApiCallOptions, PointLedgerResponse, PointSummaryResponse } from '@shopping/shared'
import { pointLedgerResponseSchema, pointSummaryResponseSchema } from '@shopping/shared'

import { getApiClient } from '@/lib/api'

/**
 * 적립금 화면이 부르는 두 라우트 (TASK-0077).
 *
 * **응답 타입을 다시 적지 않는다** (게이트 C1). 둘 다 `@shopping/shared` 의 zod
 * 스키마로 파싱하므로, 서버가 필드 이름을 바꾸면 화면이 그것을 잘못 그리는 것이 아니라
 * `malformed_response` 로 즉시 실패한다.
 *
 * **쓰기가 없다.** 적립도 사용도 사람이 부르는 것이 아니라 주문이 일으키는 일이라
 * (`point.controller.ts`), 이 파일에 `POST` 가 없는 것이 그 구조가 화면 쪽에서 보이는
 * 자리다.
 */

/**
 * 잔액과 그 주변 — 적립 예정과 만료 예정.
 *
 * 원장과 따로 부르는 이유는 **읽는 빈도가 다르기** 때문이다 (계약). 마이페이지 요약은
 * 이 하나만 필요하고, 원장은 적립금 화면에 들어간 사람만 넘긴다.
 */
export function fetchPointSummary(options?: ApiCallOptions): Promise<PointSummaryResponse> {
  return getApiClient().request({
    path: '/me/points',
    schema: pointSummaryResponseSchema,
    ...options,
  })
}

/**
 * 원장 한 쪽 — 최신순. 커서는 `seq` 다.
 *
 * 최신순이므로 **다음 쪽이 더 오래된 쪽**이다. 그 방향을 화면이 정하지 않는다: 커서가
 * 무엇을 뜻하는지는 서버가 정하고(`seq: { lt: cursor }`), 여기서는 받은 것을 그대로
 * 돌려준다.
 */
export function fetchPointLedger(
  cursor: number | null,
  options?: ApiCallOptions,
): Promise<PointLedgerResponse> {
  const search = new URLSearchParams()

  if (cursor !== null) search.set('cursor', String(cursor))

  return getApiClient().request({
    path:
      search.size === 0
        ? '/me/points/transactions'
        : `/me/points/transactions?${search.toString()}`,
    schema: pointLedgerResponseSchema,
    ...options,
  })
}
