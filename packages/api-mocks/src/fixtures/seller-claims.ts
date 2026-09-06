import {
  sellerClaimDetailResponseSchema,
  sellerClaimListResponseSchema,
  sellerClaimSummaryResponseSchema,
} from '@shopping/shared'

import { defineFixture } from '../define'
import {
  mockSellerClaimRowOf,
  mockSellerClaimSeedAt,
  mockSellerClaimSeeds,
  sellerClaimDetailOf,
  sellerClaimListItemOf,
  sellerClaimSummaryOf,
  sortSellerClaims,
} from '../handlers/seller-claim-contract'

/**
 * 판매자 콘솔의 클레임 (TASK-0070), 화면이 보는 모양 그대로.
 *
 * **구매자 쪽 `claims.ts` 와 다른 파일인 이유는 답이 다르기 때문이다.** 저쪽은
 * 「내가 지금 무엇을 신청할 수 있나」이고 여기는 「내 가게에 들어온 것 중 내가 뭘
 * 해야 하나」라, 실리는 것도(단계 · 기한 · 지연) 소유의 축도 다르다 — 서버가
 * `SellerClaimController` 를 `ClaimController` 옆에 따로 세운 것과 같은 이유다.
 *
 * 열 줄인 것은 **커서를 넘겨 봐야** 하기 때문이 아니다(기본 한 페이지가 20이라 열
 * 줄은 한 번에 들어간다). 열이 필요한 이유는 **단계 셋을 전부 채우면서 id 순서와
 * 단계를 어긋나게 두려면** 그만큼이 있어야 하기 때문이고, 페이지네이션은 검사가
 * `limit` 을 좁혀서 잰다 — 그러면 「한 페이지에 다 들어가는 픽스처」로도 중복·누락을
 * 실제로 걸을 수 있다.
 *
 * 줄의 원본은 `handlers/seller-claim-contract.ts` 의 씨앗이고, 이 파일은 그것을
 * **응답의 모양으로 굳힌다.** 핸들러도 같은 씨앗에서 저장소를 세우므로, 여기 적힌
 * 첫 페이지와 라우트가 답하는 첫 페이지가 갈릴 자리가 없다.
 */

/**
 * 목록 — **열 줄 전부**, 서버와 같은 순서로.
 *
 * 기본 한 페이지가 20이므로 이것이 곧 `GET /seller-claims` 의 첫 페이지이고,
 * `nextCursor` 가 `null` 인 것이 「마지막 페이지」다. 순서는 `(단계 순위, id)` 이지
 * 씨앗을 적은 순서가 아니다 — 픽스처가 정렬되지 않은 채 있으면 「대기가 먼저
 * 온다」를 재는 검사가 픽스처의 모양이 아니라 핸들러의 정렬만 재게 된다.
 */
export const sellerClaimPage = defineFixture(sellerClaimListResponseSchema, {
  claims: [...sortSellerClaims(mockSellerClaimSeeds.map(sellerClaimListItemOf))],
  nextCursor: null,
})

/**
 * 뱃지와 탭이 읽는 숫자.
 *
 * **줄에서 센다.** 손으로 적으면 줄 하나를 옮길 때마다 두 곳을 맞춰야 하고, 어긋나면
 * 화면이 「탭에는 5건인데 목록에는 4줄」을 보여 준다 — 목의 결함인데 화면의 결함처럼
 * 보인다. 이것은 **처음의 숫자**이고, 전이 뒤의 숫자는 라우트가 저장소에서 다시
 * 센다.
 */
export const sellerClaimSummary = defineFixture(sellerClaimSummaryResponseSchema, {
  summary: sellerClaimSummaryOf(sellerClaimPage.claims),
})

/**
 * 상세 하나 — **판매자가 지금 손대야 하는 것**.
 *
 * 반품 신청(`RETURN_REQUESTED`)을 고른 이유는 그것이 이 화면에서 가장 많은 것을 함께
 * 그리는 자리이기 때문이다: 승인과 거절 둘이 열려 있고(거절에는 사유가 필수다),
 * 반품 부속이 붙어 있으며, 아직 기한을 넘긴 건이라 지연 강조도 켜져 있다. 이미 끝난
 * 클레임을 기본 픽스처로 두면 버튼이 늘 비어 있다.
 */
export const sellerClaimDetail = defineFixture(
  sellerClaimDetailResponseSchema,
  sellerClaimDetailOf(mockSellerClaimRowOf(mockSellerClaimSeedAt(3))),
)
