import type {
  AdminSellerListQueryParams,
  AdminSellerListResponse,
  SellerStatusHistoryResponse,
} from '@shopping/shared'
import { adminSellerListResponseSchema, sellerStatusHistoryResponseSchema } from '@shopping/shared'

import { getApiClient } from '@/lib/api'

/**
 * 이 콘솔이 **스토어**에 대해 두드리는 자리, 한 곳에 (TASK-0094).
 *
 * `lib/users/console-api.ts` 와 같은 모양이고 지켜지는 성질도 같다: **경로와 스키마가
 * 한 번씩만 적힌다.** 화면은 응답의 모양을 다시 선언하지 않으므로, 서버가 필드 이름을
 * 바꾸면 그 자리에서 파싱이 깨진다 — 화면이 조용히 `undefined` 를 그리는 대신에
 * (게이트 C1).
 *
 * ## `sellers` 가 아니라 `stores` 다
 *
 * M04 의 심사 콘솔이 `admin/sellers/:id` 를 이미 쓰고 있어, 같은 자리에 이름을 하나 더
 * 두면 **그 이름이 uuid 로 읽힌다** — 그리고 증상은 404 가 아니라 400 이라 원인이
 * 라우팅이라는 것도 안 보인다 (TASK-0094 4.3 · `admin-console.controller.ts`). 그래서
 * 이 파일은 `lib/sellers/api.ts` 와 **다른 파일**이다: 저쪽은 「이 신청을 승인할까」를
 * 묻고 이쪽은 「어느 스토어를 봐야 하나」를 묻는다.
 *
 * ## 승인·정지·수수료율이 여기 없는 것도 같은 이유다
 *
 * 승인과 정지는 `lib/sellers/api.ts` 의 `decideSellerReview` 이고 개별 수수료율은
 * `lib/commissions/console-api.ts` 다. 이 TASK 가 더하는 것은 **지표와 이력**뿐이다
 * (4.3). 부를 데가 없는 함수를 미리 두면 다음 사람은 그것이 **왜** 안 불리는지를 먼저
 * 알아내야 한다.
 */

/** `?status=ACTIVE&isDemo=false&sort=claimRate&cursor=…`, 아무것도 없으면 빈 문자열. */
export function storeSearch(query: AdminSellerListQueryParams): string {
  const params = new URLSearchParams()

  if (query.status !== undefined) params.set('status', query.status)
  // 참·거짓은 **문자열로** 실린다. 서버가 `'true'` 하나만 참으로 읽으므로
  // (`admin-console.controller.ts` 의 `readQuery`), 여기서 그 문법을 지킨다.
  if (query.isDemo !== undefined) params.set('isDemo', String(query.isDemo))
  if (query.sort !== undefined) params.set('sort', query.sort)
  if (query.limit !== undefined) params.set('limit', String(query.limit))
  if (query.cursor !== undefined) params.set('cursor', query.cursor)

  const search = params.toString()

  return search === '' ? '' : `?${search}`
}

/**
 * 한 페이지. 줄마다 지표가 **함께** 온다 (F1).
 *
 * 스토어마다 매출·클레임·상품 수를 따로 묻지 않는 것이 서버 쪽 설계이고(4.4 · A5),
 * 화면도 그 약속을 지킨다 — 줄을 그리다가 지표를 한 번 더 부르면 스무 줄이 스물한
 * 번이 되고, 그 회귀는 기능 검사를 하나도 빨갛게 만들지 않는다.
 */
export function fetchStores(
  query: AdminSellerListQueryParams,
  options: { readonly signal?: AbortSignal } = {},
): Promise<AdminSellerListResponse> {
  return getApiClient().request({
    path: `/admin/stores${storeSearch(query)}`,
    schema: adminSellerListResponseSchema,
    ...options,
  })
}

/**
 * 제재 이력, 최근이 위 (F6).
 *
 * 목록에 실어 보내지 않는 이유는 이력이 **한 스토어를 열었을 때만** 뜻이 있기
 * 때문이다. 스무 줄마다 이력을 끌고 오면 목록이 답하는 「어느 스토어를 봐야 하나」에는
 * 아무것도 더하지 못한 채 응답만 커진다.
 */
export function fetchStoreHistory(
  sellerId: string,
  options: { readonly signal?: AbortSignal } = {},
): Promise<SellerStatusHistoryResponse> {
  return getApiClient().request({
    path: `/admin/stores/${sellerId}/history`,
    schema: sellerStatusHistoryResponseSchema,
    ...options,
  })
}
