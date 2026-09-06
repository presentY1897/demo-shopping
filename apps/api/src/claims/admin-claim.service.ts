import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import type {
  AdminClaimListItem,
  AdminClaimListQuery,
  AdminClaimListResponse,
  AdminFailedRefund,
  AdminFailedRefundListResponse,
  AdminOverdueClaimsResponse,
  ClaimResponse,
  ClaimStatus,
  ClaimType,
  CreateAdminClaimRequest,
} from '@shopping/shared'
import {
  ADMIN_CLAIM_LIST_DEFAULT_LIMIT,
  ADMIN_FAILED_REFUND_DEFAULT_LIMIT,
  ADMIN_OVERDUE_DEFAULT_LIMIT,
  ADMIN_OVERDUE_SCAN_LIMIT,
} from '@shopping/shared'

import { grantedScopes } from '@shopping/shared'

import { accessDenied, assertResourceAccess } from '../auth/access-denied.js'
import { accountOwnership, accountOwnershipSelect } from '../auth/resource-ownership.js'
import type { RequestPrincipal } from '../auth/request-principal.js'
import type { Clock } from '../common/clock.js'
import { CLOCK } from '../common/clock.js'
import { domainFailure } from '../common/domain-failure.js'
import type { AppConfig } from '../config/app-config.js'
import { APP_CONFIG } from '../config/app-config.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { adminClaimEligibility, adminOverdueScanBefore, canOverturn } from './admin-claim-rules.js'
import { claimHandlingStage, claimStatusesInStage } from './claim-console.js'
import { claimDueAtOf, isClaimOverdue } from './claim-deadline.js'
import type { Tx } from './claim.service.js'
import { ClaimService } from './claim.service.js'

/** 목록 한 줄이 데이터베이스에서 나오는 모양. */
interface ListRow {
  readonly id: string
  readonly sellerOrderId: string
  readonly orderNumber: string
  readonly sellerId: string
  readonly brandName: string
  readonly buyerId: string
  readonly type: ClaimType
  readonly status: ClaimStatus
  readonly fault: 'CUSTOMER' | 'SELLER'
  readonly createdAt: Date
  readonly itemCount: number
  readonly totalQuantity: number
  readonly appealPending: boolean
  readonly intervention: boolean
}

/** 나가지 못한 환불 한 줄. */
interface FailedRefundRow {
  readonly claimId: string
  readonly sellerOrderId: string
  readonly orderNumber: string
  readonly sellerId: string
  readonly brandName: string
  readonly claimStatus: ClaimStatus
  readonly amount: number
  readonly attempts: number
  readonly lastError: string | null
  readonly lastAttemptAt: Date | null
  readonly waitingSince: Date
}

/**
 * 관리자의 클레임 개입 (TASK-0071).
 *
 * ## 강제 처리를 **새 클레임**으로 만드는 것이 이 파일의 설계 판단이다
 *
 * 거절된 클레임(`CANCEL_REJECTED` · `RETURN_REJECTED`)은 전이표의 종착이고, 이
 * TASK 는 「거기서 나가는 화살표를 열 것인가」를 정해야 했다. 셋 중 골랐다.
 *
 * | 안 | 왜 아닌가 |
 * | --- | --- |
 * | ⓐ 거절에서 나가는 화살표를 관리자에게 연다 | 거절은 잡고 있던 수량을 **이미 돌려주었다**(`RELEASES_QUANTITY`). 되돌리는 화살표는 그 수량을 **다시 잡는** 연산을 문 안에 요구하고, 그 사이 구매자가 다시 신청했으면 잡을 수 없다. 그리고 `RETURN_REJECTED → RETURN_APPROVED` 는 전이표에 **고리**를 만들어, `ClaimRefund` 의 기본키가 기대는 「돌아오는 화살표가 없다」를 깬다. 마지막으로 `RETURN_REJECTED` 는 두 자리에서 오므로(신청 거절 · 검수 불합격) 역화살표 하나가 그 둘을 구분하지 못해, 검수에서 떨어진 반품에 회수 운송장이 다시 난다 |
 * | ⓒ 별도의 「개입」 표를 만든다 | 환불 · 재고 복원 · 주문 마감이 전부 클레임에 매달려 있다. 표를 하나 더 두면 그 기계를 한 벌 더 만들게 된다 |
 * | **ⓑ 새 신청을 관리자가 대신 낸다** | 저장소는 이미 「거절된 것은 다시 신청할 수 있다」를 규칙으로 갖고 있다(`remainingQuantity`). 뒤집기는 **그 재신청의 주체가 관리자인 경우**이고, 그래서 새 상태도 새 화살표도 없이 기존 기계가 그대로 돈다 |
 *
 * 원본은 거절된 채 남는데 **그것이 사실이다** — 관리자는 판매자가 거절했다는 사실을
 * 없앤 것이 아니라 다른 결론을 낸 것이고, 둘을 잇는 것은
 * `ClaimRequest.overturnsClaimId` 한 줄이다.
 *
 * ## 데모 스코프가 **실제로 무는** 자리
 *
 * `claim.handle` 은 `ADMIN_OPERATOR` 에 `any` 로 있고 `DEMO_ADMIN` 이 그것을 `demo`
 * 로 좁혀 물려받는다(`role-permissions.ts` 의 `narrowToDemo`). **그 값이 표에만 있는
 * 값이 되지 않게 하는 것**이 이 서비스가 하는 일이고, 방법은 라우트를
 * `assertResourceAccess` 로 지나게 하는 것 하나다.
 *
 * 강제 처리는 **두 사람의 것을 함께 바꾼다** — 판매자의 재고·정산과 구매자의 돈.
 * 그래서 스코프를 **양쪽에 모두** 묻는다: 가게 쪽은 `ClaimService.actorFor` 가
 * (`sellerOwnership`), 구매자 쪽은 {@link assertBuyerInScope} 가
 * (`accountOwnership`). 한쪽만 물으면 반대쪽에 구멍이 남고, 그 구멍은 조용하다 —
 * 가게만 보면 **데모 가게에서 산 실계정 구매자의 결제**가 데모 관리자에게 환불되고,
 * 구매자만 보면 **실계정 판매자의 재고**가 데모 관리자의 판단으로 되돌아온다.
 * 어느 쪽도 D-058 이 지키려던 「실계정 보호」가 아니다.
 *
 * **읽기는 좁히지 않는다** (`erd.md` 1장 — 「시드·실계정 데이터는 조회만」).
 * 데모 관리자는 플랫폼 전체를 보되 데모가 만든 것만 바꾼다.
 */
@Injectable()
export class AdminClaimService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly claims: ClaimService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  // ------------------------------------------------------------------ writes

  /**
   * 관리자가 대신 신청하고, 그 자리에서 승인한다 (F3 · F4).
   *
   * **한 라우트가 두 요구사항을 덮는다.** 판매자의 거절을 뒤집는 것(`overturnsClaimId`
   * 가 있는 경우)과 구매확정 후 하자 반품(없는 경우)은 **같은 일**이기 때문이다 —
   * 관리자가 사실 판단을 끝내고 신청을 대신 내는 것. 다른 것은 원본을 가리키는가
   * 하나뿐이라, 라우트를 둘로 나누면 잡는 순서와 승인의 주체가 두 벌이 된다.
   *
   * 승인이 **같은 트랜잭션**인 이유는 자동 승인과 같다 — 나눠 두면 「승인되지 않은
   * 채 아무도 안 보는 개입」이 남고, 그것은 승인 대기와 구분되지 않는다.
   *
   * 반품 경로는 여기서 끝나지 않는다. `RETURN_APPROVED` 다음의 수거·검수는 여전히
   * 실제로 일어나야 하는 일이고, 관리자가 그 두 걸음을 밟을 수 있는 것이
   * `claim-rules.ts` 가 `ADMIN` 을 넣어 둔 이유다 — 뒤집힌 판매자가 자기를 뒤집은
   * 반품을 밀어 주기를 기다릴 수는 없다.
   */
  async force(principal: RequestPrincipal, input: CreateAdminClaimRequest): Promise<ClaimResponse> {
    const original =
      input.overturnsClaimId === null
        ? null
        : await this.overturnable(input.overturnsClaimId, input)

    await this.assertBuyerInScope(principal, input.sellerOrderId)

    return this.claims.createWith(principal, input, {
      // 관리자가 대신 내는 신청은 신청이 아니라 **처리**다. `order.write` 를 요구하면
      // 아무도 못 부른다 — `ADMIN_OPERATOR` 에게 그 퍼미션이 애초에 없다.
      permission: 'claim.handle',
      // **`claimEligibility` 를 고치지 않는다.** 확정과 기간에 대해 저 함수가 내리는
      // 답은 구매자에게 옳고, 관리자에게만 다른 답이 필요한 것이다.
      gate: adminClaimEligibility,
      // 개입 자체가 결론이다. 「누가·왜」는 이 승인 이력 줄에 그대로 남는다 (F6).
      approval: () => ({
        mode: 'APPROVE',
        actor: 'ADMIN',
        actorId: principal.userId,
        reason: input.reason,
      }),
      overturnsClaimId: original?.id ?? null,
      requireActor: 'ADMIN',
      // 뒤집힌 거절에 걸린 이의는 **이 개입으로 인용된 것**이다. 개입과 한
      // 트랜잭션이어야 「개입은 섰는데 이의는 검토 대기」가 생기지 않는다.
      alongside:
        original === null ? null : (tx) => this.upholdAppeal(tx, original.id, principal.userId),
    })
  }

  // ------------------------------------------------------------------- reads

  /**
   * 전체 클레임 (F1) — 판매자 · 구매자 · 상태 · 단계 · 유형 · 기간 · 이의.
   *
   * **정렬은 `id DESC` 하나다.** 판매자 콘솔은 「대기 먼저」라 정렬 축이 두 칸이지만
   * (`claim-console.ts`), 이쪽은 작업 큐가 아니라 조회다. 지연을 정렬에 넣지 않는
   * 이유는 그것이 `now` 에 달린 값이라 **데이터가 하나도 안 바뀌어도** 같은 커서가
   * 다음 요청에서 다른 자리를 가리키기 때문이고, 「지금 밀린 것」은
   * {@link overdue} 가 따로 답한다.
   *
   * N+1 이 없다 (A5): 한 문장이고, 항목 집계만 횡단 조인으로 붙는다.
   */
  async list(
    principal: RequestPrincipal,
    query: AdminClaimListQuery,
  ): Promise<AdminClaimListResponse> {
    this.assertPlatformRead(principal)

    const limit = query.limit ?? ADMIN_CLAIM_LIST_DEFAULT_LIMIT
    const stageStatuses = query.stage === undefined ? null : [...claimStatusesInStage(query.stage)]
    const rows = await this.prisma.$queryRaw<ListRow[]>`
      SELECT c."id",
             c."sellerOrderId",
             c."type"::text AS "type",
             c."status"::text AS "status",
             c."fault"::text AS "fault",
             c."createdAt",
             (c."overturnsClaimId" IS NOT NULL) AS "intervention",
             so."sellerId",
             so."brandName",
             o."orderNumber",
             o."userId" AS "buyerId",
             agg."itemCount",
             agg."totalQuantity",
             (ap."claimId" IS NOT NULL) AS "appealPending"
        FROM "ClaimRequest" c
        JOIN "SellerOrder" so ON so."id" = c."sellerOrderId"
        JOIN "Order" o ON o."id" = so."orderId"
        -- 검토 대기 중인 이의만. 이미 결론이 난 이의는 「지금 볼 것」이 아니다.
        LEFT JOIN "ClaimAppeal" ap ON ap."claimId" = c."id" AND ap."reviewedAt" IS NULL
        LEFT JOIN LATERAL (
          SELECT count(*)::int AS "itemCount",
                 COALESCE(sum("quantity"), 0)::int AS "totalQuantity"
            FROM "ClaimItem"
           WHERE "claimId" = c."id"
        ) agg ON true
       WHERE (${query.sellerId ?? null}::uuid IS NULL
              OR so."sellerId" = ${query.sellerId ?? null}::uuid)
         AND (${query.buyerId ?? null}::uuid IS NULL
              OR o."userId" = ${query.buyerId ?? null}::uuid)
         AND (${query.status ?? null}::text[] IS NULL
              OR c."status"::text = ANY (${query.status ?? null}::text[]))
         AND (${stageStatuses}::text[] IS NULL
              OR c."status"::text = ANY (${stageStatuses}::text[]))
         AND (${query.type ?? null}::text IS NULL OR c."type"::text = ${query.type ?? null}::text)
         AND (${query.from ?? null}::timestamptz IS NULL
              OR c."createdAt" >= ${query.from ?? null}::timestamptz)
         AND (${query.to ?? null}::timestamptz IS NULL
              OR c."createdAt" <= ${query.to ?? null}::timestamptz)
         -- 거짓은 필터가 없는 것과 같다. 「이의가 없는 것만」은 아무도 묻지 않는
         -- 질문이고, 두 방향을 다 열면 화면이 세 값(참·거짓·없음)을 다뤄야 한다.
         AND (${query.appealed ?? false}::boolean IS NOT TRUE OR ap."claimId" IS NOT NULL)
         AND (${query.cursor ?? null}::uuid IS NULL OR c."id" < ${query.cursor ?? null}::uuid)
       ORDER BY c."id" DESC
       LIMIT ${limit + 1}::int
    `
    const page = rows.slice(0, limit)

    return {
      claims: page.map((row) => this.toListItem(row)),
      nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
    }
  }

  /**
   * 기한을 넘긴 채 처리를 기다리는 클레임 (F7).
   *
   * **넘치게 읽고 정확히 거른다.** 기한은 영업일로 세므로(`claim-deadline.ts`) SQL 이
   * 그것을 계산할 수 없고, 계산을 질의로 내려보내면 시간대·주말의 정의가 두 벌이 된다
   * — 그때 지연 뱃지와 이 목록이 서로 다른 건을 가리키고 **어느 쪽도 실패하지
   * 않는다.**
   *
   * 그래서 질의는 「가장 짧은 기한조차 지났을 수 있는」 보수적인 컷오프
   * (`adminOverdueScanBefore`)로 좁히고, 판정은 `isClaimOverdue` 가 한다. 놓치는
   * 건은 없다 — 그 부등식이 `admin-claim-rules.ts` 에 적혀 있다.
   *
   * `truncated` 를 함께 답하는 이유는 **200줄을 넘겨 밀린 상태가 목록이 아니라
   * 사고**이기 때문이다. 숨기면 화면은 「20건」만 보고, 실제로 밀린 것이 몇 건인지
   * 아무도 모른 채 지나간다.
   */
  async overdue(principal: RequestPrincipal, limit?: number): Promise<AdminOverdueClaimsResponse> {
    this.assertPlatformRead(principal)

    const page = limit ?? ADMIN_OVERDUE_DEFAULT_LIMIT
    const now = this.clock.now()
    const rows = await this.waitingBefore(adminOverdueScanBefore(now, this.config.fulfillmentPace))
    const overdue = rows.filter((row) =>
      isClaimOverdue(claimDueAtOf(row.createdAt, this.config), now),
    )

    return {
      claims: overdue.slice(0, page).map((row) => this.toListItem(row)),
      scanned: rows.length,
      // 훑기의 상한에 닿았거나, 지연된 것이 한 페이지를 넘는다. 앞은 「더 있을 수
      // 있다」이고 뒤는 「더 있다」인데, 화면이 할 일은 둘 다 같다.
      truncated: rows.length >= ADMIN_OVERDUE_SCAN_LIMIT || overdue.length > page,
    }
  }

  /**
   * 나가지 못한 환불 (TASK-0068 R3 이 넘긴 항목).
   *
   * **`ClaimRefund_refundedAt_lastAttemptAt_idx` 가 받으라고 만들어 둔 조회다** —
   * 「아직 못 돌려준 것을, 오래 시도된 것부터」. 그 인덱스가 없으면 이 목록은 환불
   * 표 전체를 훑는다.
   *
   * 이 자리가 없던 동안 실패한 환불은 「승인됐는데 `REFUNDED` 로 안 간 클레임」으로만
   * 보였고, 그 상태에서 사람이 할 수 있는 일은 로그를 뒤지는 것뿐이었다.
   */
  async failedRefunds(
    principal: RequestPrincipal,
    limit?: number,
  ): Promise<AdminFailedRefundListResponse> {
    this.assertPlatformRead(principal)

    const page = limit ?? ADMIN_FAILED_REFUND_DEFAULT_LIMIT
    const rows = await this.prisma.$queryRaw<FailedRefundRow[]>`
      SELECT r."claimId",
             r."amount",
             r."attempts",
             r."lastError",
             r."lastAttemptAt",
             c."sellerOrderId",
             c."status"::text AS "claimStatus",
             c."updatedAt" AS "waitingSince",
             so."sellerId",
             so."brandName",
             o."orderNumber"
        FROM "ClaimRefund" r
        JOIN "ClaimRequest" c ON c."id" = r."claimId"
        JOIN "SellerOrder" so ON so."id" = c."sellerOrderId"
        JOIN "Order" o ON o."id" = so."orderId"
       WHERE r."refundedAt" IS NULL
       -- 오래 시도된 것부터. 시도 기록이 없는 행은 NULLS LAST 로 맨 뒤에 가는데,
       -- 그것이 인덱스의 기본 순서이고 그 행은 「아직 아무 일도 없었다」이므로
       -- 밀린 건들보다 급하지 않다.
       ORDER BY r."lastAttemptAt" ASC, r."claimId" ASC
       LIMIT ${page + 1}::int
    `

    return {
      refunds: rows.slice(0, page).map((row) => toFailedRefund(row)),
      hasMore: rows.length > page,
    }
  }

  // ---------------------------------------------------------------- internals

  /**
   * **플랫폼 전체를 볼 수 있는 사람인가.**
   *
   * `@RequirePermission('claim.read')` 만으로는 부족하다 — 그 가드가 답하는 것은
   * 「이 퍼미션을 **어떤 스코프로든** 갖고 있는가」이고(`authorizePermission`),
   * `claim.read:own` 은 **모든 구매자와 판매자**가 갖고 있다. 그래서 이 확인이 없으면
   * 구매자 한 사람이 `/admin/claims` 를 불러 **플랫폼 전체의 클레임**을 페이지로 넘길
   * 수 있다. 아래 질의들에 소유자 조건이 하나도 없는 것이 그 사실의 다른 쪽 면이다.
   *
   * 목록에 소유자 조건을 넣어 좁히지 않고 아예 막는 이유는 **이 라우트가 답하는 것이
   * 다르기 때문**이다. 「내가 볼 수 있는 것」은 `GET /claims` 가 이미 스코프로
   * 좁혀 답하고, 여기는 「플랫폼 전체」다 — 좁힌 답을 돌려주면 같은 라우트가 사람마다
   * 다른 것을 뜻하게 되고, 화면은 자기가 무엇을 보고 있는지 알 수 없다.
   *
   * **데모 관리자는 여기를 지난다.** 읽기는 좁혀지지 않기 때문이고(`narrowToDemo` 가
   * `isReadPermission` 을 건너뛴다), 그것이 `erd.md` 1장의 「시드·실계정 데이터는
   * 조회만」이다.
   */
  private assertPlatformRead(principal: RequestPrincipal): void {
    if (!grantedScopes(principal, 'claim.read').includes('any')) {
      throw accessDenied('claim.read', 'out_of_scope')
    }
  }

  /**
   * 이 거절을 뒤집어도 되는가.
   *
   * 두 가지를 본다 — **결론이 난 클레임인가**(`canOverturn`)와 **같은 판매자 몫의
   * 것인가**. 뒤엣것이 없으면 남의 주문의 거절을 근거로 이 주문에 개입이 서고, 그
   * 행은 「무엇을 뒤집었는지 말이 안 되는」 이력이 된다.
   */
  private async overturnable(
    claimId: string,
    input: CreateAdminClaimRequest,
  ): Promise<{ readonly id: string }> {
    const row = await this.prisma.claimRequest.findUnique({
      where: { id: claimId },
      select: { id: true, status: true, sellerOrderId: true },
    })

    if (row === null) throw new NotFoundException('뒤집을 클레임을 찾을 수 없어요.')

    if (row.sellerOrderId !== input.sellerOrderId) {
      throw new ConflictException(
        domainFailure('CLAIM_NOT_CLAIMABLE', '다른 주문의 클레임은 뒤집을 수 없어요.', {
          field: 'overturnsClaimId',
        }),
      )
    }

    if (!canOverturn(row.status)) {
      throw new ConflictException(
        domainFailure('CLAIM_NOT_CLAIMABLE', '아직 결론이 나지 않은 클레임이에요.', {
          field: 'overturnsClaimId',
          params: { status: row.status },
        }),
      )
    }

    return { id: row.id }
  }

  /**
   * 이 개입이 이의를 **인용으로** 닫는다 (F2).
   *
   * `updateMany` 로 「아직 검토 전인 것만」 좁히는 것이 요점이다. 이의가 없으면 0행이
   * 갱신되고 그것이 정상이다 — 이의 없이도 관리자는 개입할 수 있다. 이미 결론이 난
   * 이의를 덮어쓰지 않는 것도 같은 조건이 지킨다.
   *
   * 사유(`reviewNote`)를 적지 않는다. 인용의 근거는 **개입 클레임의 이력**에 있고,
   * 두 곳에 적으면 둘이 다른 말을 하는 날이 온다 — `ClaimAppeal_review_check` 이
   * 기각에만 사유를 요구하는 이유가 그것이다.
   */
  private async upholdAppeal(tx: Tx, claimId: string, reviewedById: string): Promise<void> {
    await tx.claimAppeal.updateMany({
      where: { claimId, reviewedAt: null },
      data: {
        reviewedAt: this.clock.now(),
        reviewedById,
        outcome: 'UPHELD',
        updatedAt: this.clock.now(),
      },
    })
  }

  /**
   * **구매자 쪽 스코프**를 묻는다.
   *
   * 가게 쪽은 `ClaimService.actorFor` 가 이미 묻는다(`sellerOwnership`). 그것만으로
   * 부족한 이유는 강제 처리가 **두 사람의 것을 함께 바꾸기** 때문이다 — 판매자의
   * 재고와 구매자의 돈. 가게만 보면 데모 가게에서 산 **실계정 구매자의 결제**를 데모
   * 관리자가 환불할 수 있고, 그것은 D-058 이 지키려던 「실계정 보호」가 아니다.
   *
   * 새 규칙을 만드는 것이 아니라 **같은 문을 한 번 더 지나는 것**이다 — 매퍼도
   * (`accountOwnership`) 판정도(`assertResourceAccess`) 이미 있는 것이고, 여기서
   * 하는 일은 「이 행위가 누구의 것을 바꾸는가」를 두 소유자로 말하는 것뿐이다.
   * `any` 를 가진 운영자에게는 아무것도 달라지지 않는다.
   */
  private async assertBuyerInScope(
    principal: RequestPrincipal,
    sellerOrderId: string,
  ): Promise<void> {
    const row = await this.prisma.sellerOrder.findUnique({
      where: { id: sellerOrderId },
      select: { order: { select: { user: { select: accountOwnershipSelect } } } },
    })

    if (row === null) throw new NotFoundException('주문을 찾을 수 없어요.')

    assertResourceAccess(principal, 'claim.handle', accountOwnership(row.order.user))
  }

  /**
   * 처리 대기 중이고 컷오프보다 앞서 신청된 클레임을, **오래된 것부터**.
   *
   * 「대기」의 정의를 SQL 에 적지 않는다 — `claimStatusesInStage` 가 전이표에서
   * 만들어 낸 배열을 파라미터로 받는다. 손으로 적으면 상태가 늘 때 한 곳만 고쳐지고,
   * 그때 증상은 「밀렸는데 목록에 없다」이고 아무것도 실패하지 않는다.
   */
  private waitingBefore(before: Date): Promise<ListRow[]> {
    const waiting = [...claimStatusesInStage('WAITING')]

    return this.prisma.$queryRaw<ListRow[]>`
      SELECT c."id",
             c."sellerOrderId",
             c."type"::text AS "type",
             c."status"::text AS "status",
             c."fault"::text AS "fault",
             c."createdAt",
             (c."overturnsClaimId" IS NOT NULL) AS "intervention",
             so."sellerId",
             so."brandName",
             o."orderNumber",
             o."userId" AS "buyerId",
             agg."itemCount",
             agg."totalQuantity",
             (ap."claimId" IS NOT NULL) AS "appealPending"
        FROM "ClaimRequest" c
        JOIN "SellerOrder" so ON so."id" = c."sellerOrderId"
        JOIN "Order" o ON o."id" = so."orderId"
        LEFT JOIN "ClaimAppeal" ap ON ap."claimId" = c."id" AND ap."reviewedAt" IS NULL
        LEFT JOIN LATERAL (
          SELECT count(*)::int AS "itemCount",
                 COALESCE(sum("quantity"), 0)::int AS "totalQuantity"
            FROM "ClaimItem"
           WHERE "claimId" = c."id"
        ) agg ON true
       WHERE c."status"::text = ANY (${waiting}::text[])
         AND c."createdAt" < ${before}::timestamptz
       ORDER BY c."createdAt" ASC, c."id" ASC
       LIMIT ${ADMIN_OVERDUE_SCAN_LIMIT}::int
    `
  }

  /** 행을 계약의 모양으로. **기한과 지연을 계산하는 자리가 여기다** — 응답을 만드는 곳. */
  private toListItem(row: ListRow): AdminClaimListItem {
    const dueAt = claimDueAtOf(row.createdAt, this.config)

    return {
      id: row.id,
      sellerOrderId: row.sellerOrderId,
      orderNumber: row.orderNumber,
      sellerId: row.sellerId,
      brandName: row.brandName,
      buyerId: row.buyerId,
      type: row.type,
      status: row.status,
      stage: claimHandlingStage(row.status),
      fault: row.fault,
      requestedAt: row.createdAt.toISOString(),
      dueAt: dueAt.toISOString(),
      overdue: isClaimOverdue(dueAt, this.clock.now()),
      itemCount: row.itemCount,
      totalQuantity: row.totalQuantity,
      appealPending: row.appealPending,
      intervention: row.intervention,
    }
  }
}

function toFailedRefund(row: FailedRefundRow): AdminFailedRefund {
  return {
    claimId: row.claimId,
    sellerOrderId: row.sellerOrderId,
    orderNumber: row.orderNumber,
    sellerId: row.sellerId,
    brandName: row.brandName,
    claimStatus: row.claimStatus,
    amount: row.amount,
    attempts: row.attempts,
    lastError: row.lastError,
    lastAttemptAt: row.lastAttemptAt?.toISOString() ?? null,
    waitingSince: row.waitingSince.toISOString(),
  }
}
