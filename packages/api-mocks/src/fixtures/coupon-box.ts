import { userCouponListResponseSchema, userCouponResponseSchema } from '@shopping/shared'

import { defineFixture } from '../define'
import {
  MOCK_COUPON_BOX_PAGE_SIZE,
  mockClaimedCoupon,
  mockCouponBoxSeeds,
  sortUserCoupons,
  userCouponCounts,
} from '../handlers/coupon-box-contract'

/**
 * 내 쿠폰함 (TASK-0077 의 화면이 읽는다).
 *
 * **발행자의 목록과 다른 것이다.** 저기서 한 줄은 정책 한 건이고 여기서 한 줄은
 * **발급된 장**이다 — 같은 쿠폰이 만 명에게 나갔으면 저기서는 한 줄, 여기서는 그
 * 사람의 한 장이다.
 *
 * 씨앗과 조립기는 `handlers/coupon-box-contract.ts` 에 있고, 왜 픽스처 밖에 있는지도
 * 거기 적혀 있다. 이 파일이 하는 일은 그 씨앗을 **응답의 모양**으로 한 번 파싱해 두는
 * 것뿐이다 — 그것이 C2 가 재는 것이고, 대역이 실제로 답할 때는 자기 저장소를 잘라
 * 답한다.
 */

/**
 * 첫 쪽 — 최신순 두 장과, **탭에 붙는 세 수**.
 *
 * `counts` 가 `coupons` 보다 큰 것이 정상이다. 수는 상태별 전부이고 목록은 한 쪽이라,
 * 둘이 같아지는 픽스처는 「수가 쪽과 무관하다」는 계약을 확인할 수 없게 만든다.
 */
export const shopperCouponBox = defineFixture(userCouponListResponseSchema, {
  coupons: [...sortUserCoupons(mockCouponBoxSeeds)].slice(0, MOCK_COUPON_BOX_PAGE_SIZE),
  counts: userCouponCounts(mockCouponBoxSeeds),
  nextCursor: sortUserCoupons(mockCouponBoxSeeds)[MOCK_COUPON_BOX_PAGE_SIZE - 1]?.id ?? null,
})

/**
 * 한 장도 받은 적이 없는 사람.
 *
 * **세 수가 전부 0으로 실려 있다.** 빈 쿠폰함이 `counts` 를 생략하면 화면은 「아직
 * 안 왔다」와 「없다」를 구분할 수 없고, 그 구분이 사라지면 탭 배지가 로딩 중에 0을
 * 그리게 된다.
 */
export const emptyCouponBox = defineFixture(userCouponListResponseSchema, {
  coupons: [],
  counts: { ISSUED: 0, USED: 0, EXPIRED: 0 },
  nextCursor: null,
})

/** 코드를 넣어 방금 받은 장. `POST /coupons/claims` 가 돌려주는 모양이다. */
export const claimedCoupon = defineFixture(userCouponResponseSchema, {
  userCoupon: mockClaimedCoupon(),
})
