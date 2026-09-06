import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import type {
  ClaimResponse,
  ClaimStatus,
  DismissClaimAppealRequest,
  FileClaimAppealRequest,
} from '@shopping/shared'

import { accessDenied } from '../auth/access-denied.js'
import type { AccountRow, SellerRow } from '../auth/resource-ownership.js'
import { accountOwnershipSelect, sellerOwnershipSelect } from '../auth/resource-ownership.js'
import type { RequestPrincipal } from '../auth/request-principal.js'
import type { Clock } from '../common/clock.js'
import { CLOCK } from '../common/clock.js'
import { domainFailure } from '../common/domain-failure.js'
import { isUniqueViolationOn } from '../common/unique-violation.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { canOverturn } from './admin-claim-rules.js'
import { ClaimService } from './claim.service.js'

/** 이의를 판단하는 데 필요한 만큼의 클레임. */
interface AppealTarget {
  readonly id: string
  readonly status: ClaimStatus
  readonly owner: {
    readonly sellerId: string
    readonly seller: SellerRow
    readonly order: { readonly user: AccountRow }
  }
}

/**
 * 거절에 대한 **구매자의 이의**와 관리자의 답 (TASK-0071 F2).
 *
 * ## 왜 이력이 아니라 표인가
 *
 * TASK 는 「새 표가 필요한지, 클레임 이력으로 충분한지」를 물었고 답은 **표**다.
 * 이유가 셋이다.
 *
 * ① **이의는 전이가 아니다.** 이의를 냈다고 클레임이 움직이지 않는다 — 관리자가 볼
 *    때까지 그 클레임은 거절된 채다. `ClaimStatusHistory` 는 전이의 기록이고 같은
 *    상태로 옮긴 줄은 `ClaimStatusHistory_transition_check` 이 막으므로, **적을
 *    자리가 아예 없다.**
 * ② 상태를 하나 만들어(`APPEALED` 같은) 전이로 표현하면 전이표에 **거절에서 돌아오는
 *    화살표**가 생기고, `ClaimRefund` 의 기본키가 기대는 「한 클레임은 평생 한 번만 그
 *    자리에 선다」가 흔들린다. 강제 처리를 새 클레임으로 만든 것과 **같은 이유**다.
 * ③ 이의는 **자기 수명**을 갖는다 — 접수되고, 검토되고, 인용되거나 기각된다. 이력
 *    한 줄은 그중 첫 줄만 담고 나머지 둘을 담을 칸이 없다.
 *
 * ## 개입 이력은 이 표가 아니라 상태 이력이 갖는다
 *
 * 「누가·왜」는 `ClaimStatusHistory` 가 이미 담는다 — `actor` 가 `ADMIN` 이고
 * `actorId` 가 그 사람이며 `reason` 이 근거다. 이 표가 더하는 것은 **구매자가 먼저
 * 말했다는 사실**이고, 그것은 이력이 담을 수 없는 다른 사실이다.
 */
@Injectable()
export class ClaimAppealService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly claims: ClaimService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * 구매자가 거절에 이의를 제기한다.
   *
   * **퍼미션이 `order.write` 다** — 신청과 같은 축이기 때문이다. `claim.handle` 은
   * 처리하는 쪽의 것이고, 그것을 요구하면 아무도 이의를 낼 수 없다.
   *
   * 주체가 `BUYER` 여야 하는 것은 그보다 좁은 조건이다. 자기 가게에서 자기가 산
   * 주문이면 `actorFor` 는 **판 사람**으로 읽는데(그쪽이 이 몫의 주인이다), 그
   * 사람이 자기 거절에 이의를 내는 것은 이의가 아니라 번복이다.
   *
   * **거절된 클레임에만** 걸 수 있다. 진행 중인 클레임에 이의를 받으면 관리자가 볼
   * 것이 「아직 아무도 판단하지 않은 신청」이 되고, 그 대기열은 판매자의 대기열과
   * 같은 것을 두 번 세는 목록이 된다. 「결론이 났는가」의 판정은
   * `admin-claim-rules.ts` 의 `canOverturn` 하나가 갖는다 — 뒤집을 수 있는 것과 이의를
   * 걸 수 있는 것은 **같은 집합**이어야 하고, 두 벌로 적으면 「이의는 받았는데 뒤집을
   * 수는 없는」 건이 생긴다.
   */
  async file(
    principal: RequestPrincipal,
    claimId: string,
    input: FileClaimAppealRequest,
  ): Promise<ClaimResponse> {
    const target = await this.target(claimId)
    const actor = this.claims.actorFor(principal, target.owner, 'order.write')

    if (actor !== 'BUYER') throw accessDenied('order.write', 'out_of_scope')

    if (!canOverturn(target.status)) {
      throw new ConflictException(
        domainFailure('CLAIM_NOT_CLAIMABLE', '거절된 클레임에만 이의를 제기할 수 있어요.', {
          field: 'reason',
          params: { status: target.status },
        }),
      )
    }

    const now = this.clock.now()

    try {
      await this.prisma.claimAppeal.create({
        data: {
          claimId,
          filedById: principal.userId,
          reason: input.reason,
          createdAt: now,
          updatedAt: now,
        },
      })
    } catch (error) {
      // **기본키가 `claimId` 인 것이 「한 거절에 이의는 하나」의 전부다.** 먼저 읽어
      // 보고 막지 않는 이유는 두 요청이 동시에 오면 둘 다 「없다」를 읽기 때문이고,
      // 그때 막는 것은 이 제약뿐이다.
      // 열 이름이 아니라 **제약 이름**으로 묻는다. 기본키의 위반은 드라이버가
      // `ClaimAppeal_pkey` 로 알려 주고 거기에는 열 이름이 없다 —
      // `isUniqueViolationOn` 이 두 자리를 보는 이유가 그 어댑터 사정이다.
      if (!isUniqueViolationOn(error, 'ClaimAppeal')) throw error

      // **도메인 코드를 새로 만들지 않는다.** `DomainErrorCode` 는 세 앱의 메시지
      // 카탈로그가 `Record<UserFacingErrorCode, string>` 로 **빠짐없이** 답해야 하는
      // 목록이라(`error-messages.ts`), 코드 하나를 더하면 이 TASK 가 건드리지 않는
      // 두 앱의 문구 파일이 함께 깨진다. 상태에서 파생되는 `CONFLICT` 로 나가고,
      // 문장은 서버가 싣는다.
      throw new ConflictException('이미 이의를 제기했어요.')
    }

    return this.claims.get(principal, claimId)
  }

  /**
   * 관리자가 이의를 **기각**한다 — 판매자의 거절이 유지된다.
   *
   * **인용에 해당하는 라우트는 없다.** 인용은 곧 강제 처리이고(`POST /admin/claims`),
   * 그쪽이 개입 클레임을 만들면서 **같은 트랜잭션에서** 이의를 인용으로 닫는다. 인용
   * 버튼을 따로 두면 「인용됐는데 아무 개입도 없는 이의」가 만들어지고, 그것은
   * 구매자에게 답만 주고 아무것도 해 주지 않은 상태다.
   *
   * 사유가 필수인 것은 그 비대칭 때문이다 — 인용의 근거는 개입 클레임의 이력에
   * 남지만 기각은 남길 곳이 여기밖에 없고, 없으면 구매자는 답을 받지 못한 채 거절만
   * 다시 본다. 계약이 이미 `min(1)` 로 막고, `ClaimAppeal_review_check` 이 표에서 한
   * 번 더 막는다.
   */
  async dismiss(
    principal: RequestPrincipal,
    claimId: string,
    input: DismissClaimAppealRequest,
  ): Promise<ClaimResponse> {
    const target = await this.target(claimId)
    const actor = this.claims.actorFor(principal, target.owner, 'claim.handle')

    // 판매자가 자기에게 걸린 이의를 기각하는 것은 이의 절차 밖이다 — 그 판단을
    // 하라고 관리자를 부른 것이다. `claim.handle:own` 만으로는 부족하고, 여기서
    // 주체를 한 번 더 확인하는 것이 그 문장이다.
    if (actor !== 'ADMIN') throw accessDenied('claim.handle', 'out_of_scope')

    const now = this.clock.now()
    // **아직 검토 전인 것만** 갱신한다. 이미 결론이 난 이의를 덮어쓰면 「인용됐다가
    // 기각된」 이력이 남고, 어느 쪽이 사실인지 아무도 말할 수 없다.
    const changed = await this.prisma.claimAppeal.updateMany({
      where: { claimId, reviewedAt: null },
      data: {
        reviewedAt: now,
        reviewedById: principal.userId,
        outcome: 'DISMISSED',
        reviewNote: input.reason,
        updatedAt: now,
      },
    })

    if (changed.count === 0) {
      // 위와 같은 이유로 코드를 새로 만들지 않는다.
      throw new ConflictException('검토를 기다리는 이의가 없어요.')
    }

    return this.claims.get(principal, claimId)
  }

  /**
   * 이의의 판단에 필요한 만큼의 클레임.
   *
   * 소유권 열들을 함께 읽는 것은 `ClaimService.actorFor` 가 그 행에서 「이 사람은 이
   * 몫의 무엇인가」를 읽기 때문이다 — 그 답이 하나여야 한다는 이유로 저쪽이
   * `public` 이고, 여기서 사본을 만들지 않는다.
   */
  private async target(claimId: string): Promise<AppealTarget> {
    const row = await this.prisma.claimRequest.findUnique({
      where: { id: claimId },
      select: {
        id: true,
        status: true,
        sellerOrder: {
          select: {
            sellerId: true,
            seller: { select: sellerOwnershipSelect },
            order: { select: { user: { select: accountOwnershipSelect } } },
          },
        },
      },
    })

    if (row === null) throw new NotFoundException('클레임을 찾을 수 없어요.')

    return { id: row.id, status: row.status, owner: row.sellerOrder }
  }
}
