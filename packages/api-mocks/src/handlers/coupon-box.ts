import type { UserCoupon } from '@shopping/shared'
import {
  claimCouponRequestSchema,
  userCouponListQueryParamsSchema,
  userCouponListResponseSchema,
  userCouponResponseSchema,
} from '@shopping/shared'
import type { RequestHandler } from 'msw'
import { http, HttpResponse } from 'msw'

import { defineFixture } from '../define'
import { mockPaths } from '../paths'
import {
  MOCK_CLAIM_OUTCOMES,
  MOCK_COUPON_BOX_PAGE_SIZE,
  mockClaimedCoupon,
  mockCouponBoxSeeds,
  normalizeMockCouponCode,
  sortUserCoupons,
  userCouponCounts,
} from './coupon-box-contract'
import { answering, MockApiError, readBody } from './refusal'

/**
 * 내 쿠폰함과 코드 등록 (TASK-0077 의 화면이 읽는다).
 *
 * **상태를 갖는다** — 코드를 넣어 받으면 목록이 한 장 늘고, 그 장이 맨 위에 앉으며,
 * 같은 코드를 다시 넣으면 이번에는 「이미 받았어요」다. 얼어붙은 픽스처로는 그중 어느
 * 것도 물어볼 수 없다: F3 이 재는 것이 정확히 「받고 나면 무엇이 달라지는가」이고,
 * 두 번째 시도의 거절은 첫 번째가 실제로 무언가를 남겼을 때만 성립한다.
 *
 * ## 목록은 서버처럼 **거르고 나서** 자른다
 *
 * 다섯 장을 한 줄로 들고 있다가 `status` 로 거른 뒤 {@link MOCK_COUPON_BOX_PAGE_SIZE}
 * 만큼 잘라 낸다. 미리 잘라 둔 쪽을 상태별로 들고 있으면 **탭이 커서와 어떻게
 * 만나는지**를 잴 수 없다 — `handlers/orders.ts` 가 같은 자리에서 같은 판단을 했다.
 *
 * ## `counts` 는 그 거르기를 지나지 않는다
 *
 * 계약이 「`status` 로 좁혀도 달라지지 않는다」고 적었고, 그것을 지키는 자리가 여기다.
 * 걸러서 세면 고른 탭만 0이 아닌 화면이 되고, 그 화면은 자기가 틀렸다는 것을 알 방법이
 * 없다 — 배지의 수와 그 탭의 줄 수가 언제나 같아 보이기 때문이다.
 *
 * 모든 응답이 `defineFixture` 를 지나므로 계약에서 벗어난 페이로드는 그것을 잘못
 * 그리는 화면이 아니라 **여기서** 실패한다 (게이트 C2).
 */

let store: readonly UserCoupon[] = mockCouponBoxSeeds

export const couponBoxHandlers: readonly RequestHandler[] = [
  /**
   * 내 쿠폰함 한 쪽 — 최신순, 상태로 거르고, 커서 페이지네이션.
   *
   * 질의를 **서버와 같은 스키마**로 읽는다. 대역이 자기 규칙으로 파싱하면 화면이 실제
   * API 에는 없는 문법에 기대게 된다.
   */
  http.get(mockPaths.meCoupons, ({ request }) =>
    answering(() => {
      const url = new URL(request.url)
      const query = userCouponListQueryParamsSchema.parse(
        Object.fromEntries(url.searchParams.entries()),
      )
      const limit = query.limit ?? MOCK_COUPON_BOX_PAGE_SIZE
      const matches = sortUserCoupons(store).filter(
        (entry) => query.status === undefined || entry.status === query.status,
      )
      // 커서는 「마지막으로 본 장의 id」다. 서버가 `id: { lt: cursor }` 로 다음 쪽을
      // 뜨므로 목도 그 장 **다음**부터 자른다.
      const start =
        query.cursor === undefined ? 0 : matches.findIndex((entry) => entry.id === query.cursor) + 1
      const page = matches.slice(start, start + limit)

      return HttpResponse.json(
        defineFixture(userCouponListResponseSchema, {
          coupons: [...page],
          counts: userCouponCounts(store),
          nextCursor: start + limit < matches.length ? (page.at(-1)?.id ?? null) : null,
        }),
      )
    }),
  ),

  /**
   * 코드를 넣어 **본인이** 받는다.
   *
   * 입력을 먼저 정규화한다 — 하이픈·공백·소문자를 받아 주는 것이 계약이고
   * (`couponCodeInputSchema`), 목이 그것을 흉내 내지 않으면 화면은 스스로 정규화하는
   * 규칙을 갖게 된다. 정규화해도 모양이 아니면 **없는 코드와 같은 답**이다: 갈라
   * 답하면 코드를 찍어 보는 쪽에 「형식은 맞다」는 힌트가 된다.
   *
   * 이미 쿠폰함에 있는 코드는 표를 보기 전에 걸러진다. 성공으로 받은 장을 두 번째
   * 요청이 다시 만들면 「이미 받았어요」가 대역에서 영원히 재현되지 않는다.
   */
  http.post(mockPaths.couponClaims, ({ request }) =>
    answering(async () => {
      const { code } = await readBody(request, claimCouponRequestSchema)
      const normalized = normalizeMockCouponCode(code)

      if (normalized === null) throw unknownCode()

      if (store.some((entry) => entry.coupon.code === normalized)) {
        throw new MockApiError(409, '이미 받은 쿠폰이에요.', { code: 'COUPON_ALREADY_ISSUED' })
      }

      if (!Object.hasOwn(MOCK_CLAIM_OUTCOMES, normalized)) throw unknownCode()

      // 표에 있는 코드이므로 `undefined` 는 「거절이 없다」와 같은 뜻이다. 둘을
      // 가르는 것은 위의 `hasOwn` 하나이고, 그것이 「모르는 코드」와 「받을 수 있는
      // 코드」를 나눈다.
      const outcome = MOCK_CLAIM_OUTCOMES[normalized] ?? null

      if (outcome !== null) {
        throw new MockApiError(outcome.status, outcome.message, { code: outcome.code })
      }

      const issued = mockClaimedCoupon()

      store = [...store, issued]

      return HttpResponse.json(defineFixture(userCouponResponseSchema, { userCoupon: issued }))
    }),
  ),
]

/** 모르는 코드. 형식이 틀린 것도 여기로 온다 — 계약이 그렇게 정했다. */
function unknownCode(): MockApiError {
  return new MockApiError(400, '쿠폰 코드를 다시 확인해 주세요.', {
    code: 'COUPON_CODE_UNKNOWN',
    field: 'code',
  })
}

/**
 * 이 목의 쿠폰함을 처음 상태로.
 *
 * 빈 쿠폰함으로 시작하려면 빈 배열을 넘긴다 — 그것이 「한 장도 받은 적 없는 사람」이고,
 * 세 탭이 동시에 비는 유일한 상태다.
 */
export function resetCouponBoxStore(seeds: readonly UserCoupon[] = mockCouponBoxSeeds): void {
  store = seeds
}

/** 지금 이 목이 들고 있는 장 전부. 쓰기가 실제로 남았는지를 검사가 확인한다. */
export function couponBoxSnapshot(): readonly UserCoupon[] {
  return store
}
