import type { CommissionRateListResponse, CommissionRateResponse } from '@shopping/shared'
import type { CommissionSimulationResponse, SetCommissionRateRequest } from '@shopping/shared'
import {
  commissionRateListResponseSchema,
  commissionRateResponseSchema,
  commissionSimulationResponseSchema,
} from '@shopping/shared'

import { getApiClient } from '@/lib/api'

import type { CommissionScopeSelection } from './scopes'
import { commissionSearch } from './scopes'

/**
 * 수수료율에 대해 이 콘솔이 부르는 네 자리, 한 곳에.
 *
 * `lib/coupons/console-api.ts` 와 같은 모양이고 지켜지는 성질도 같다: **경로와
 * 스키마가 한 번씩만 적힌다.** 화면은 응답의 모양을 다시 선언하지 않으므로, 서버가
 * 필드 이름을 바꾸면 그 자리에서 파싱이 깨진다 — 화면이 조용히 `undefined` 를 그리는
 * 대신에 (게이트 C1).
 *
 * ## 라우트는 셋인데 함수가 넷이다
 *
 * `GET /commission-rates` 한 자리가 **두 가지 질문**에 답하기 때문이다: 아무것도
 * 주지 않으면 「지금 열려 있는 요율 전부」, `history=true` 면 「이 범위가 지나온 것
 * 전부」다. 같은 빈칸이 앞에서는 「아무 데나」이고 뒤에서는 「전역」이라
 * (`commissionRateListQueryParamsSchema`), 부르는 쪽이 무엇을 물었는지는 질의가
 * 아니라 **함수 이름**이 말해야 한다.
 */

/** 지금 유효한 요율 전부 — 세 범위가 한 번에 온다. */
export function fetchOpenCommissionRates(
  options: { readonly signal?: AbortSignal } = {},
): Promise<CommissionRateListResponse> {
  return getApiClient().request({
    path: '/commission-rates',
    schema: commissionRateListResponseSchema,
    ...options,
  })
}

/** 한 범위가 지나온 요율 전부, 최신순 (F5). */
export function fetchCommissionHistory(
  scope: CommissionScopeSelection,
  options: { readonly signal?: AbortSignal } = {},
): Promise<CommissionRateListResponse> {
  return getApiClient().request({
    path: `/commission-rates${commissionSearch(scope, { history: 'true' })}`,
    schema: commissionRateListResponseSchema,
    ...options,
  })
}

/**
 * 이 요율로 바꾸면 얼마가 달라지나 (F6).
 *
 * 저장 **전에** 부르는 것이 요점이다. 이 답은 「과거 주문이 이렇게 바뀝니다」가
 * 아니라 「앞으로 이만큼 달라집니다」이고, 그 추정의 근거로 지난 30일의 실제 판매를
 * 쓴다 (`commissionSimulationResponseSchema`).
 */
export function fetchCommissionSimulation(
  scope: CommissionScopeSelection,
  rateBp: number,
  options: { readonly signal?: AbortSignal } = {},
): Promise<CommissionSimulationResponse> {
  return getApiClient().request({
    path: `/commission-rates/simulation${commissionSearch(scope, { rateBp: String(rateBp) })}`,
    schema: commissionSimulationResponseSchema,
    ...options,
  })
}

/**
 * 한 범위의 요율을 바꾼다 (F1 · F2 · F5).
 *
 * `PUT` 인 이유는 **범위마다 요율이 하나**이기 때문이다. 행이 늘어나는 것은 서버가
 * 이력을 남기는 방식일 뿐이라, 부르는 쪽이 정하는 것은 「이 범위는 이제 몇
 * 퍼센트인가」 하나다.
 */
export function setCommissionRate(body: SetCommissionRateRequest): Promise<CommissionRateResponse> {
  return getApiClient().request({
    path: '/commission-rates',
    method: 'PUT',
    body,
    schema: commissionRateResponseSchema,
  })
}
