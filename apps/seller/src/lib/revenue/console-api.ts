import type { SellerRevenueQueryParams, SellerRevenueResponse } from '@shopping/shared'
import { sellerRevenueResponseSchema } from '@shopping/shared'

import { getApiClient } from '@/lib/api'

/**
 * 판매자 콘솔이 매출에 대해 부르는 한 자리.
 *
 * `lib/coupons/console-api.ts` 와 같은 모양이고 지켜지는 성질도 같다: **경로와
 * 스키마가 한 번씩만 적힌다.** 화면은 응답의 모양을 다시 선언하지 않으므로, 서버가
 * 필드 이름을 바꾸면 그 자리에서 파싱이 깨진다 — 화면이 조용히 `undefined` 를
 * 그리는 대신에 (게이트 C1).
 */

/**
 * 이 콘솔이 실제로 보낼 수 있는 질의.
 *
 * 계약의 `SellerRevenueQueryParams` 에서 **`sellerId` 를 덜어 내고** 나머지 둘을
 * 필수로 굳힌 모양이다. 계약에 그 칸이 있는 것은 관리자가 남의 매출을 볼 수 있어야
 * 하기 때문인데, 이 화면은 서버가 부르는 사람의 스토어에서 정한 것만 본다 —
 * 자기 id 를 실어 보내는 것은 같은 답을 다른 경로로 얻는 일이고, **그 경로가 열려
 * 있으면 언젠가 다른 id 가 실린다.** 넣을 자리를 없애면 그 실수가 컴파일에서 걸린다.
 *
 * 기간을 둘 다 필수로 둔 것은 화면이 언제나 정해 놓고 묻기 때문이다. 옵셔널로 두면
 * 「비워서 부르는」 갈래가 코드에 남지만 아무도 그렇게 부르지 않는다.
 */
export type SellerRevenueSearch = Required<Pick<SellerRevenueQueryParams, 'from' | 'to'>>

/** `?from=…&to=…`. */
export function revenueSearch(query: SellerRevenueSearch): string {
  return `?${new URLSearchParams({ from: query.from, to: query.to }).toString()}`
}

/** 기간별 매출, 그 앞 기간의 합, 그리고 인기 상품 (F5 · F6). */
export function fetchSellerRevenue(
  query: SellerRevenueSearch,
  options: { readonly signal?: AbortSignal } = {},
): Promise<SellerRevenueResponse> {
  return getApiClient().request({
    path: `/seller-revenue${revenueSearch(query)}`,
    schema: sellerRevenueResponseSchema,
    ...options,
  })
}
