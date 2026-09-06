import {
  adminClaimListResponseSchema,
  adminFailedRefundListResponseSchema,
  adminOverdueClaimsResponseSchema,
  claimResponseSchema,
} from '@shopping/shared'

import { defineFixture } from '../define'
import {
  mockAdminClaimListItemOf,
  mockAdminClaimOf,
  mockAdminClaimSeedOf,
  mockAdminClaimSeeds,
  mockAdminFailedRefunds,
  mockAdminInterventionOf,
  sortAdminClaims,
} from '../handlers/admin-claim-contract'

/**
 * 관리자 콘솔이 받는 네 응답 (TASK-0071), 실제 API 가 답하는 모양 그대로.
 *
 * **값을 여기서 만들지 않는다.** 씨앗과 조립기는 `handlers/admin-claim-contract.ts`
 * 에 있고 대역도 같은 것을 읽는다 — 픽스처와 핸들러가 다른 줄을 만들면 스토리에서
 * 본 화면과 테스트에서 도는 화면이 서로 다른 데이터를 그리게 된다.
 *
 * 네 값 모두 `defineFixture` 를 지나므로 계약과 어긋난 순간 여기서 실패한다 (C2).
 */

/**
 * 첫 페이지 — 열두 건 중 스무 건 한도 안이라 커서가 없다.
 *
 * 커서가 `null` 인 것이 일부러다. 이 목록에서 재야 할 것은 「다음 페이지」가 아니라
 * **필터와 지연 뱃지**이고, 백 건짜리 큐가 필요한 화면은 입점 심사 쪽이다
 * (`admin-sellers.ts` 의 픽스처가 그 이유를 적어 두었다).
 */
export const adminClaimQueue = defineFixture(adminClaimListResponseSchema, {
  claims: sortAdminClaims(mockAdminClaimSeeds.map((seed) => mockAdminClaimListItemOf(seed))),
  nextCursor: null,
})

/**
 * 처리 지연 목록.
 *
 * **`truncated` 가 거짓인 것이 정상이다.** 참인 상태는 목록이 아니라 사고이고(훑기
 * 상한을 넘겨 밀렸다), 그것을 기본값으로 두면 화면은 늘 경고를 띄운다.
 */
export const adminOverdueClaims = defineFixture(adminOverdueClaimsResponseSchema, {
  claims: sortAdminClaims(mockAdminClaimSeeds.map((seed) => mockAdminClaimListItemOf(seed))).filter(
    (claim) => claim.overdue,
  ),
  scanned: mockAdminClaimSeeds.length,
  truncated: false,
})

/** 나가지 못한 환불. 정상 흐름에서는 0건이고, 이 둘은 실패의 두 종류다. */
export const adminFailedRefundQueue = defineFixture(adminFailedRefundListResponseSchema, {
  refunds: [...mockAdminFailedRefunds],
  hasMore: false,
})

/**
 * 강제 처리가 답하는 것 — **방금 만들어진 개입 클레임**.
 *
 * 원본이 아니라 새 행이라는 사실이 이 픽스처의 값이다. 화면이 답의 `id` 를 그대로
 * 상세로 쓰면 원본이 아니라 개입을 열게 되고, 그것이 옳다.
 */
export const adminInterventionClaim = defineFixture(claimResponseSchema, {
  claim: mockAdminInterventionOf(
    mockAdminClaimOf(mockAdminClaimSeedOf(2)),
    '배송 기록이 판매자 설명과 달라 취소를 승인합니다.',
    '019597a0-0007-7000-8000-0000000000a1',
  ),
})
