import type {
  BulkApproveSettlementsResponse,
  SettlementDetailResponse,
  SettlementListQueryParams,
  SettlementListResponse,
  SettlementResponse,
} from '@shopping/shared'
import {
  bulkApproveSettlementsResponseSchema,
  settlementDetailResponseSchema,
  settlementListResponseSchema,
  settlementResponseSchema,
} from '@shopping/shared'

import { getApiClient } from '@/lib/api'

/**
 * 이 콘솔이 정산에 대해 부르는 여섯 자리, 한 곳에.
 *
 * `lib/commissions/console-api.ts` 와 같은 모양이고 지켜지는 성질도 같다: **경로와
 * 스키마가 한 번씩만 적힌다.** 화면은 응답의 모양을 다시 선언하지 않으므로, 서버가
 * 필드 이름을 바꾸면 그 자리에서 파싱이 깨진다 — 화면이 조용히 `undefined` 를
 * 그리는 대신에 (게이트 C1).
 *
 * **`/settlements/batch` 는 여기 없다.** 배치를 손으로 돌리는 문은 `settlement.run`
 * 을 요구하고 TASK-0080 의 것이며, 이 화면이 하는 일(검토·승인·지급)과 다른
 * 종류의 일이다. 부를 데가 없는 함수를 미리 두면 다음 사람은 그것이 **왜** 안
 * 불리는지를 먼저 알아내야 한다.
 */

/** `?status=PENDING,HOLD&sellerId=…&cursor=…`, 아무것도 없으면 빈 문자열. */
export function settlementSearch(query: SettlementListQueryParams): string {
  const params = new URLSearchParams()

  // 상태는 **쉼표 하나**로 보낸다. 반복 키(`?status=a&status=b`)는 프레임워크마다
  // 다르게 파싱되고, 이 저장소의 모든 목록이 같은 문법을 쓰는 이유가 그것이다
  // (`settlementListQueryParamsSchema` 가 그 문법으로 읽는다).
  if (query.status !== undefined) params.set('status', query.status.join(','))
  if (query.sellerId !== undefined) params.set('sellerId', query.sellerId)
  if (query.periodStart !== undefined) params.set('periodStart', query.periodStart)
  if (query.limit !== undefined) params.set('limit', String(query.limit))
  if (query.cursor !== undefined) params.set('cursor', query.cursor)

  const search = params.toString()

  return search === '' ? '' : `?${search}`
}

/** 한 페이지와 **필터 전체의 합계**. 최신순이고 커서는 `id` 하나다. */
export function fetchSettlements(
  query: SettlementListQueryParams,
  options: { readonly signal?: AbortSignal } = {},
): Promise<SettlementListResponse> {
  return getApiClient().request({
    path: `/settlements${settlementSearch(query)}`,
    schema: settlementListResponseSchema,
    ...options,
  })
}

/** 정산서 한 장과 계산 근거 (F1 · F2). */
export function fetchSettlement(
  id: string,
  options: { readonly signal?: AbortSignal } = {},
): Promise<SettlementDetailResponse> {
  return getApiClient().request({
    path: `/settlements/${id}`,
    schema: settlementDetailResponseSchema,
    ...options,
  })
}

/** 승인한다 (F3). 대기와 보류에서 온다. */
export function approveSettlement(id: string): Promise<SettlementResponse> {
  return getApiClient().request({
    path: `/settlements/${id}/approval`,
    method: 'POST',
    schema: settlementResponseSchema,
  })
}

/** 분쟁·이상 건으로 보류한다 (F4). **사유 없이는 들어올 수 없다.** */
export function holdSettlement(id: string, reason: string): Promise<SettlementResponse> {
  return getApiClient().request({
    path: `/settlements/${id}/hold`,
    method: 'POST',
    body: { reason },
    schema: settlementResponseSchema,
  })
}

/** 지급 완료로 옮긴다 (F5 · F7). **실제 이체는 없다** — 상태만 바뀐다. */
export function paySettlement(id: string): Promise<SettlementResponse> {
  return getApiClient().request({
    path: `/settlements/${id}/payment`,
    method: 'POST',
    schema: settlementResponseSchema,
  })
}

/**
 * 한꺼번에 승인한다 (F6).
 *
 * 답에 **실패 목록이 함께 온다.** 그것을 버리는 호출부를 만들 수 없도록 응답을
 * 그대로 돌려준다 — 「10건 골랐는데 8건이 승인됐다」를 화면이 말하지 못하면 남은
 * 2건은 아무도 다시 보지 않는다.
 */
export function approveSettlements(
  ids: readonly string[],
): Promise<BulkApproveSettlementsResponse> {
  return getApiClient().request({
    path: '/settlements/approvals',
    method: 'POST',
    body: { ids: [...ids] },
    schema: bulkApproveSettlementsResponseSchema,
  })
}
