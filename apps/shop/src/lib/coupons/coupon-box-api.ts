import type {
  ApiCallOptions,
  UserCouponListResponse,
  UserCouponResponse,
  UserCouponStatus,
} from '@shopping/shared'
import { userCouponListResponseSchema, userCouponResponseSchema } from '@shopping/shared'

import { getApiClient } from '@/lib/api'

/**
 * 쿠폰함이 부르는 두 라우트 (TASK-0077).
 *
 * **응답 타입을 다시 적지 않는다** (게이트 C1). 둘 다 `@shopping/shared` 의 zod
 * 스키마로 파싱하므로, 서버가 필드 이름을 바꾸면 화면이 그것을 잘못 그리는 것이 아니라
 * `malformed_response` 로 즉시 실패한다.
 *
 * **경로에 사용자 id 가 없다.** 주인은 토큰이 정한다 — `/me` · `/cart` 와 같은
 * 모양이고, 남의 쿠폰함을 가리킬 자리가 애초에 없다.
 */

/**
 * 내 쿠폰함 한 쪽 — 최신순, 상태로 좁혀서, 커서 페이지네이션.
 *
 * `status` 를 넘기지 않으면 전부다. 그런데도 이 화면은 언제나 넘긴다: 탭이 곧 상태이고,
 * 좁히지 않은 목록에 탭을 그리려면 화면이 받은 것 위에서 다시 걸러야 하기 때문이다 —
 * 그러면 커서가 「전부」의 커서라 탭마다 남은 장이 있는지 말할 수 없다 (주문 내역이
 * 필터를 서버로 옮긴 것과 같은 판단, TASK-0063 4.2).
 *
 * **`counts` 는 그 좁히기와 무관하게 돌아온다** (계약). 그래서 탭 배지를 그리려고 세
 * 번 더 부르지 않는다.
 */
export function fetchUserCoupons(
  status: UserCouponStatus,
  cursor: string | null,
  options?: ApiCallOptions,
): Promise<UserCouponListResponse> {
  const search = new URLSearchParams({ status })

  if (cursor !== null) search.set('cursor', cursor)

  return getApiClient().request({
    path: `/me/coupons?${search.toString()}`,
    schema: userCouponListResponseSchema,
    ...options,
  })
}

/**
 * 상태별 장수만 — 마이페이지 요약의 「쿠폰 n장」 (F7 의 요약).
 *
 * **한 번 묻는다.** `counts` 가 `status` 와 무관하게 세 상태를 모두 싣는 것이 계약이고
 * (`userCouponListResponseSchema`), 그 이유가 정확히 이 자리다 — 탭마다 따로 물으면
 * 화면 하나가 세 번 묻고, 그 셋은 서로 다른 순간의 답이라 합이 맞지 않을 수 있다.
 *
 * `limit=1` 인 것은 **목록이 필요 없기** 때문이다. 0을 보낼 수는 없고(계약의 하한이
 * 1이다), 보내지 않으면 스무 장이 딸려 온다 — 요약이 그리지 않을 스무 장이다.
 */
export function fetchCouponCounts(
  options?: ApiCallOptions,
): Promise<Readonly<Record<UserCouponStatus, number>>> {
  return getApiClient()
    .request({
      path: '/me/coupons?limit=1',
      schema: userCouponListResponseSchema,
      ...options,
    })
    .then(({ counts }) => counts)
}

/**
 * 코드를 넣어 **본인이** 받는다.
 *
 * 친 값을 그대로 보낸다. 하이픈·공백·소문자를 서버가 받아 주는 것이 계약이고
 * (`couponCodeInputSchema` · `normalizeCouponCode`), 화면이 먼저 정규화하면 그 규칙이
 * 두 곳에 살게 된다 — 둘이 갈리는 날 사람은 **화면이 받아 준 값으로** 거절당한다.
 *
 * 거절은 던져진다. 코드마다 사람이 할 일이 다르므로(기다린다·포기한다·쿠폰함을 본다)
 * 부르는 쪽이 `ApiFailure` 로 받아 문장을 고른다.
 */
export function claimCoupon(code: string, options?: ApiCallOptions): Promise<UserCouponResponse> {
  return getApiClient().request({
    path: '/coupons/claims',
    method: 'POST',
    body: { code },
    schema: userCouponResponseSchema,
    ...options,
  })
}
