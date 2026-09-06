import { Controller, Get, Param, Query } from '@nestjs/common'
import type {
  SellerClaimDetailResponse,
  SellerClaimListResponse,
  SellerClaimSummaryResponse,
} from '@shopping/shared'
import { sellerClaimListQueryParamsSchema } from '@shopping/shared'

import { Principal } from '../auth/principal.decorator.js'
import { RequirePermission } from '../auth/require-permission.decorator.js'
import type { RequestPrincipal } from '../auth/request-principal.js'
import { parseInput } from '../common/parse-input.js'
import { SellerClaimService } from './seller-claim.service.js'

/**
 * 판매자 콘솔이 읽는 세 라우트 (TASK-0070).
 *
 * **`/claims` 를 대체하지 않는다.** 신청·전이·조회는 여전히 `ClaimController` 이고,
 * 수거·검수는 `ReturnController` 다. 여기 있는 것은 **판매자 콘솔이 그리는 데 필요한
 * 읽기** 셋뿐이라 쓰기가 하나도 없다 — 쓰기를 여기로 옮기면 같은 전이에 문이 둘이
 * 생기고, 그때 「어느 쪽이 진짜 규칙인가」에 답할 수 있는 사람이 없다.
 *
 * `/seller-orders` 가 `/orders` 옆에 있는 것과 같은 나눔이고 이유도 같다 — 소유의
 * 축과 응답의 모양이 다르다.
 *
 * ## 세 라우트가 **한 컨트롤러**에 있는 이유
 *
 * `summary` 가 `:id` 보다 **먼저 선언돼야** 한다. 라우터는 먼저 등록된 것을 쓰므로
 * 뒤에 두면 `summary` 가 id 로 읽히고, 그 id 는 uuid 가 아니라 조회가 500 으로
 * 끝난다. 컨트롤러를 나누면 그 순서를 정하는 것이 모듈 스캔 순서가 되고, 그것은 이
 * 파일을 읽어서는 알 수 없다 (`OrderController` 가 같은 함정에 같은 주석을 달아 두었다).
 *
 * ## 퍼미션이 `claim.read` 인 것
 *
 * 셋 다 읽기다. **「무엇을 누를 수 있나」까지 읽기로 답하는 것**이
 * `/seller-orders/:id/actions`(`order.write`)와 다른 점인데, 그쪽은 액션 목록만
 * 답하는 라우트라 「볼 수 있는가」와 「누를 수 있는가」가 갈리면 목록 자체가
 * 거짓말이 된다. 여기 `actions` 는 **상세의 한 필드**이고, 이 상세를 읽는 사람은
 * 이미 이 가게의 주인이다(`ownStore` + `actorFor`) — 즉 읽을 수 있으면 누를 수 있다.
 */
@Controller({ version: '1' })
export class SellerClaimController {
  constructor(private readonly claims: SellerClaimService) {}

  /** 판매자 콘솔의 클레임 목록 — 유형·상태·단계 탭, **처리 대기 우선**, 커서. */
  @Get('seller-claims')
  @RequirePermission('claim.read')
  list(
    @Principal() principal: RequestPrincipal,
    @Query() query: unknown,
  ): Promise<SellerClaimListResponse> {
    return this.claims.list(principal, parseInput(sellerClaimListQueryParamsSchema, query))
  }

  /**
   * 상태별·단계별 건수 — 뱃지와 탭이 읽는다.
   *
   * **`seller-claims/:id` 보다 위에 있어야 한다.** 위 클래스 주석 참조.
   */
  @Get('seller-claims/summary')
  @RequirePermission('claim.read')
  summary(@Principal() principal: RequestPrincipal): Promise<SellerClaimSummaryResponse> {
    return this.claims.summary(principal)
  }

  /** 판매자가 처리하는 클레임 하나. 남의 가게 것이면 403 이다. */
  @Get('seller-claims/:id')
  @RequirePermission('claim.read')
  detail(
    @Principal() principal: RequestPrincipal,
    @Param('id') id: string,
  ): Promise<SellerClaimDetailResponse> {
    return this.claims.detail(principal, id)
  }
}
