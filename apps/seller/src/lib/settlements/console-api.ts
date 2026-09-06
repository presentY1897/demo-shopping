import type {
  SettlementDetailResponse,
  SettlementListQueryParams,
  SettlementListResponse,
  SettlementOutlookResponse,
} from '@shopping/shared'
import {
  settlementDetailResponseSchema,
  settlementListResponseSchema,
  settlementOutlookResponseSchema,
} from '@shopping/shared'

import { getApiClient } from '@/lib/api'

/**
 * 판매자 콘솔이 정산에 대해 부르는 세 자리, 한 곳에.
 *
 * `lib/coupons/console-api.ts` 와 같은 모양이고 지켜지는 성질도 같다: **경로와
 * 스키마가 한 번씩만 적힌다.** 화면은 응답의 모양을 다시 선언하지 않는다 (게이트 C1).
 *
 * ## 세 라우트가 `sellerId` 를 다르게 다룬다
 *
 * | 라우트 | `sellerId` | 왜 |
 * | --- | --- | --- |
 * | `/seller-settlement-outlook` | **보내지 않는다** | 서버가 부르는 사람의 스토어에서 정한다 |
 * | `/settlements` | **반드시 보낸다** | 없으면 플랫폼 전체 목록 요청이고, 판매자에게는 403 이다 (F1) |
 * | `/settlements/:id` | 경로에 있다 | 스코프가 남의 정산서를 막는다 |
 *
 * 규칙이 하나가 아닌 것이 어색해 보이지만, 실제로 서로 다른 질문 셋이다. 「내
 * 예정액」에는 주어가 필요 없고, 「정산서 목록」은 플랫폼 전체를 뜻할 수 있으며,
 * 「이 정산서」는 이미 하나를 가리키고 있다.
 *
 * ## 승인·보류·지급이 여기 없다
 *
 * 그 셋은 `settlement.approve` · `settlement.pay` 를 요구하고 관리자 콘솔의
 * 것이다(TASK-0081). 부를 데가 없는 함수를 미리 두면 다음 사람은 그것이 **왜** 안
 * 불리는지를 먼저 알아내야 한다.
 */

/** `?sellerId=…&status=PENDING&cursor=…`. */
export function settlementSearch(query: SettlementListQueryParams): string {
  const params = new URLSearchParams()

  // **이 화면에서는 언제나 실린다.** 빠지면 서버는 플랫폼 전체 목록 요청으로 읽고
  // 403 으로 답한다 — 그것이 판매자를 남의 정산서에서 떼어 놓는 장치다 (F1).
  if (query.sellerId !== undefined) params.set('sellerId', query.sellerId)
  // 상태는 **쉼표 하나**로 보낸다. 반복 키(`?status=a&status=b`)는 프레임워크마다
  // 다르게 파싱되고, 이 저장소의 모든 목록이 같은 문법을 쓰는 이유가 그것이다.
  if (query.status !== undefined) params.set('status', query.status.join(','))
  if (query.limit !== undefined) params.set('limit', String(query.limit))
  // **커서는 불투명하다.** 해석하지 않고 서버가 준 것을 그대로 되돌려준다.
  if (query.cursor !== undefined) params.set('cursor', query.cursor)

  const search = params.toString()

  return search === '' ? '' : `?${search}`
}

/**
 * 아직 정산서에 실리지 않은 돈, **두 덩이로** (F4).
 *
 * 질의가 없다. 계약에는 `sellerId` 를 받는 자리가 있지만(관리자용) 이 콘솔은 보내지
 * 않는다 — 서버가 부르는 사람의 스토어에서 정하고, 자기 id 를 실어 보내는 길을
 * 열어 두면 언젠가 다른 id 가 실린다.
 */
export function fetchSettlementOutlook(
  options: { readonly signal?: AbortSignal } = {},
): Promise<SettlementOutlookResponse> {
  return getApiClient().request({
    path: '/seller-settlement-outlook',
    schema: settlementOutlookResponseSchema,
    ...options,
  })
}

/** 한 페이지의 정산서와 **필터 전체의 합계**. 최신순이고 커서는 불투명하다. */
export function fetchSellerSettlements(
  query: SettlementListQueryParams,
  options: { readonly signal?: AbortSignal } = {},
): Promise<SettlementListResponse> {
  return getApiClient().request({
    path: `/settlements${settlementSearch(query)}`,
    schema: settlementListResponseSchema,
    ...options,
  })
}

/**
 * 정산서 한 장과 계산 근거 (F2 · F3).
 *
 * **관리자 콘솔이 부르는 것과 같은 라우트다.** 판매자용 사본을 따로 두면 두 화면이
 * 같은 정산서를 다른 숫자로 그리게 되는 날이 오고, 그때 이의 제기는 「누가 맞나」로
 * 시작한다. 스코프가 남의 정산서를 막으므로 같은 문을 함께 써도 안전하다.
 */
export function fetchSellerSettlement(
  id: string,
  options: { readonly signal?: AbortSignal } = {},
): Promise<SettlementDetailResponse> {
  return getApiClient().request({
    path: `/settlements/${id}`,
    schema: settlementDetailResponseSchema,
    ...options,
  })
}
