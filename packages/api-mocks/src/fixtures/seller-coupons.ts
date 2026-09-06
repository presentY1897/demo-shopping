import { couponListResponseSchema, couponResponseSchema } from '@shopping/shared'

import { defineFixture } from '../define'
import {
  mockSellerCouponSeedAt,
  mockSellerCouponSeeds,
  sellerCouponEntryOf,
  sellerCouponTotals,
  sortSellerCoupons,
} from '../handlers/seller-coupon-contract'

/**
 * 판매자 콘솔의 쿠폰 (TASK-0074), 화면이 보는 모양 그대로.
 *
 * 줄의 원본은 `handlers/seller-coupon-contract.ts` 의 씨앗이고, 이 파일은 그것을
 * **응답의 모양으로 굳힌다.** 핸들러도 같은 씨앗에서 저장소를 세우므로, 여기 적힌
 * 첫 페이지와 라우트가 답하는 첫 페이지가 갈릴 자리가 없다 — 갈리면 화면 검사는
 * 통과하는데 실 서버 앞에서 첫 화면이 다른 것을 보여 준다.
 *
 * **구매자 쪽 `checkout-coupons.ts` 와 다른 파일인 이유는 답이 다르기 때문이다.**
 * 저쪽은 「이 주문서에 쓰면 얼마」이고 여기는 「내가 낸 쿠폰이 지금 어떤 상태이고
 * 얼마를 깎았나」다 — 실리는 것도(상태 · 사용 장수 · 부담 누계) 소유의 축도 다르다.
 */

/**
 * 목록 — **여섯 줄 전부**, 서버와 같은 순서로.
 *
 * 기본 한 페이지가 20이므로 이것이 곧 `GET /coupons?sellerId=…` 의 첫 페이지이고,
 * `nextCursor` 가 `null` 인 것이 「마지막 페이지」다. 순서는 **최신순**이지 씨앗을
 * 적은 순서가 아니다 — 픽스처가 정렬되지 않은 채 있으면 순서를 재는 검사가 픽스처의
 * 모양이 아니라 핸들러의 정렬만 재게 된다.
 */
export const sellerCouponPage = defineFixture(couponListResponseSchema, {
  coupons: [...sortSellerCoupons(mockSellerCouponSeeds.map(sellerCouponEntryOf))],
  // 누계는 페이지의 합이 아니라 이 스토어 전부의 합이다. 여기서는 씨앗이 전부라
  // 같은 수가 되지만, 그 이유가 「한 페이지에 다 들어가서」임을 적어 둔다.
  totals: sellerCouponTotals(mockSellerCouponSeeds.map(sellerCouponEntryOf)),
  nextCursor: null,
})

/**
 * 발행이 답하는 모양 — **정책 하나뿐**이다.
 *
 * 목록의 줄(`CouponListEntry`)이 아니다. 갓 발행된 쿠폰에는 아직 상태도 통계도 볼
 * 것이 없고, 계약이 `POST /coupons` 에 `CouponResponse` 를 준 것이 그 뜻이다 —
 * 화면이 발행 뒤에 목록을 다시 읽는 이유가 여기 있다.
 */
export const sellerCouponCreated = defineFixture(couponResponseSchema, {
  coupon: mockSellerCouponSeedAt(0).coupon,
})
