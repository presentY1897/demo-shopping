import type {
  ApiCallOptions,
  ClaimableResponse,
  ClaimResponse,
  CreateClaimRequest,
} from '@shopping/shared'
import { claimableResponseSchema, claimResponseSchema } from '@shopping/shared'

import { getApiClient } from '@/lib/api'

/**
 * 취소·반품 신청이 부르는 두 라우트 (TASK-0066).
 *
 * **응답 타입을 다시 적지 않는다** (게이트 C1). 둘 다 `@shopping/shared` 의 zod
 * 스키마로 파싱하므로, 서버가 필드 이름을 바꾸면 화면이 그것을 잘못 그리는 것이
 * 아니라 `malformed_response` 로 즉시 실패한다.
 *
 * **경로에 사용자 id 가 없다.** 주인은 토큰이 정한다 — 남의 주문에 신청할 자리가
 * 애초에 없고, 그 판정은 서버가 행에서 읽어 한다.
 */

/**
 * 「이 몫에 지금 무엇을 몇 개까지 신청할 수 있나」.
 *
 * `/seller-orders/:id/actions` 가 전이에 대해 하는 일을 클레임에 대해 한다 —
 * **화면이 상태로 분기하지 않게 하는 답**이다. 「배송완료면 반품」을 화면에 적으면
 * 그 판단이 세 앱에 흩어지고, 반품 기간처럼 배포 설정에 달린 값은 화면이 **틀린
 * 날짜를 자신 있게** 적게 된다.
 */
export function fetchClaimable(
  sellerOrderId: string,
  options?: ApiCallOptions,
): Promise<ClaimableResponse> {
  return getApiClient().request({
    path: `/seller-orders/${sellerOrderId}/claimable`,
    schema: claimableResponseSchema,
    ...options,
  })
}

/**
 * 신청한다.
 *
 * **유형(`type`)을 보내지 않는다.** 취소인지 반품인지는 주문 상태가 정한다 —
 * 고르게 두면 배송된 물건을 취소로 신청해 재고가 두 번 늘어난다. 답의
 * `claim.status` 가 그 다음을 말한다: `CANCEL_APPROVED` 면 규칙이 그 자리에서
 * 승인한 것이고, `CANCEL_REQUESTED` 면 판매자를 기다린다.
 */
export function createClaim(
  input: CreateClaimRequest,
  options?: ApiCallOptions,
): Promise<ClaimResponse> {
  return getApiClient().request({
    path: '/claims',
    method: 'POST',
    body: input,
    schema: claimResponseSchema,
    ...options,
  })
}
