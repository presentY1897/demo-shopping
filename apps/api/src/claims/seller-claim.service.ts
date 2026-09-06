import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import type {
  Claim,
  ClaimHandlingStage,
  ClaimPhoto,
  ClaimRefundQuote,
  ClaimStatus,
  ClaimType,
  SellerClaimDetailResponse,
  SellerClaimListItem,
  SellerClaimListQuery,
  SellerClaimListResponse,
  SellerClaimReturn,
  SellerClaimSummaryResponse,
} from '@shopping/shared'
import {
  claimHandlingStages,
  claimStatuses,
  SELLER_CLAIM_LIST_DEFAULT_LIMIT,
} from '@shopping/shared'

import { accessDenied } from '../auth/access-denied.js'
import type { RequestPrincipal } from '../auth/request-principal.js'
import type { Clock } from '../common/clock.js'
import { CLOCK } from '../common/clock.js'
import { domainFailure } from '../common/domain-failure.js'
import type { AppConfig } from '../config/app-config.js'
import { APP_CONFIG } from '../config/app-config.js'
import { sellerOrderHeadline } from '../orders/seller-order-console.js'
import { PrismaService } from '../prisma/prisma.service.js'
import type { ObjectStorage } from '../storage/object-storage.js'
import { OBJECT_STORAGE } from '../storage/object-storage.js'
import { claimDueAtOf, isClaimOverdue } from './claim-deadline.js'
import {
  claimActionRouteOf,
  claimHandlingStage,
  claimStageRank,
  claimStatusesInStage,
  claimTransitionNeedsReason,
  decodeSellerClaimCursor,
  encodeSellerClaimCursor,
} from './claim-console.js'
import { claimTransitions } from './claim-rules.js'
import { ClaimService } from './claim.service.js'
import { ClaimRefundService } from './refund.service.js'
import { BadRequestException } from '@nestjs/common'

/** 목록 한 줄이 데이터베이스에서 나오는 모양. */
interface ListRow {
  readonly id: string
  readonly sellerOrderId: string
  readonly orderNumber: string
  readonly type: ClaimType
  readonly status: ClaimStatus
  readonly stageRank: number
  readonly fault: 'CUSTOMER' | 'SELLER'
  readonly requestedAt: Date
  readonly itemCount: number
  readonly totalQuantity: number
  readonly productName: string | null
  readonly thumbnailUrl: string | null
}

/** 상태 하나와 그 건수. `GROUP BY "status"` 가 돌려주는 줄 그대로다. */
interface StatusCount {
  readonly status: ClaimStatus
  readonly count: number
}

/**
 * 판매자 콘솔의 클레임 목록 · 뱃지 · 상세 (TASK-0070 1장).
 *
 * ## `ClaimService` 와 따로 있는 이유 — 읽는 방향이 다르다
 *
 * `GET /claims` 는 **구매자 · 판매자 · 관리자가 같은 모양**을 보는 목록이고, 소유의
 * 축이 퍼미션 스코프다. 여기는 **「내 가게에 들어온 클레임」** 하나이고, 응답에
 * 판매자에게만 뜻이 있는 셋 — 단계 · 기한 · 지연 — 이 붙는다. 「기한 초과」를
 * 구매자 화면에 그리면 판매자를 재촉하는 말이 남의 화면에 뜬다.
 *
 * `SellerOrderListService` 가 `OrderService` 옆에 따로 있는 것과 **같은 나눔**이고,
 * 여기서도 같은 규약을 그대로 쓴다 — 새 규약을 만들지 않는 것이 이 TASK 가 지켜야
 * 할 것이다.
 *
 * ## 「처리 대기 우선」과 커서를 어떻게 양립시키나
 *
 * 정렬은 **`(단계, id)` 두 칸**이고 커서는 그 두 칸을 모두 담은 불투명 문자열이다.
 * 왜 그래야 하는지, 그 조합이 무엇을 지키고 무엇을 못 지키는지는 `claim-console.ts`
 * 의 머리말에 적혀 있다. 여기서 지켜야 할 것은 **그 표가 SQL 에 복사되지 않는
 * 것**이다 — 어느 상태가 어느 단계인지는 `claimHandlingStage` 하나가 답하고, 이
 * 질의는 그 함수가 만든 배열을 파라미터로 받는다. 순위의 숫자도
 * `claimStageRank` 에서 온다.
 *
 * ## 두 번째 정렬 칸이 `id` 오름차순인 것
 *
 * 이 저장소의 다른 목록은 전부 `id DESC`(최신 먼저)다. 여기만 반대인 이유는 이
 * 목록이 **피드가 아니라 작업 큐**이기 때문이다. 그리고 그 방향이 공짜로 기한 순을
 * 준다 — 기한은 신청 시각의 단조 증가 함수이고 `id`(UUIDv7)는 신청 시각과 같은
 * 순서이므로, **`id ASC` 가 곧 기한 임박 순**이다. 덕분에 영업일 계산을 SQL 로
 * 내려보내지 않고도 지연된 건이 대기 탭 맨 위에 모인다.
 *
 * ## N+1 (A5)
 *
 * 목록이 한 문장이다. 항목 개수·수량 합계와 대표 상품은 **횡단 조인(LATERAL)** 으로
 * 붙는다 — `SellerOrderListService` 와 같은 모양이고 같은 이유다.
 */
@Injectable()
export class SellerClaimService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly claims: ClaimService,
    private readonly refunds: ClaimRefundService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  /**
   * 한 페이지 (F1 · F7).
   *
   * 필터는 전부 선택이고, 없는 것은 SQL 안에서 `IS NULL` 갈래로 사라진다 —
   * 조건을 문자열로 이어 붙이지 않는 것은 그렇게 만든 질의가 파라미터 자리를 잃기
   * 때문이다.
   */
  async list(
    principal: RequestPrincipal,
    query: SellerClaimListQuery,
  ): Promise<SellerClaimListResponse> {
    const sellerId = this.ownStore(principal)
    const limit = query.limit ?? SELLER_CLAIM_LIST_DEFAULT_LIMIT
    const cursor = this.cursorOf(query.cursor)
    // 「어느 상태가 어느 단계인가」는 **여기서 한 번만** 만들어지고, SQL 은 그 답을
    // 배열로 받는다. `CASE WHEN status IN (…)` 을 손으로 적으면 표가 두 벌이 된다.
    const waiting = [...claimStatusesInStage('WAITING')]
    const inProgress = [...claimStatusesInStage('IN_PROGRESS')]
    const stageStatuses = query.stage === undefined ? null : [...claimStatusesInStage(query.stage)]
    const statuses = query.status ?? null
    const type = query.type ?? null

    // 한 줄 더 읽어 「다음이 있는가」를 답한다. 세어 보는 것보다 싸고, 세는 순간
    // 그 수는 이미 낡는다.
    const rows = await this.prisma.$queryRaw<ListRow[]>`
      SELECT c."id",
             c."sellerOrderId",
             c."type"::text AS "type",
             c."status"::text AS "status",
             c."fault"::text AS "fault",
             c."createdAt" AS "requestedAt",
             stage."rank" AS "stageRank",
             o."orderNumber",
             agg."itemCount",
             agg."totalQuantity",
             lead."productName",
             lead."thumbnailUrl"
        FROM "ClaimRequest" c
        JOIN "SellerOrder" so ON so."id" = c."sellerOrderId"
        JOIN "Order" o ON o."id" = so."orderId"
        CROSS JOIN LATERAL (
          SELECT CASE
                   WHEN c."status"::text = ANY (${waiting}::text[])
                     THEN ${claimStageRank('WAITING')}::int
                   WHEN c."status"::text = ANY (${inProgress}::text[])
                     THEN ${claimStageRank('IN_PROGRESS')}::int
                   ELSE ${claimStageRank('CLOSED')}::int
                 END AS "rank"
        ) stage
        LEFT JOIN LATERAL (
          SELECT count(*)::int AS "itemCount",
                 COALESCE(sum("quantity"), 0)::int AS "totalQuantity"
            FROM "ClaimItem"
           WHERE "claimId" = c."id"
        ) agg ON true
        LEFT JOIN LATERAL (
          SELECT oi."productSnapshot"->>'productName' AS "productName",
                 oi."productSnapshot"->>'thumbnailUrl' AS "thumbnailUrl"
            FROM "ClaimItem" ci
            JOIN "OrderItem" oi ON oi."id" = ci."orderItemId"
           WHERE ci."claimId" = c."id"
           ORDER BY ci."orderItemId"
           LIMIT 1
        ) lead ON true
       WHERE so."sellerId" = ${sellerId}::uuid
         AND (${stageStatuses}::text[] IS NULL
              OR c."status"::text = ANY (${stageStatuses}::text[]))
         AND (${statuses}::text[] IS NULL OR c."status"::text = ANY (${statuses}::text[]))
         AND (${type}::text IS NULL OR c."type"::text = ${type}::text)
         AND (${cursor?.stageRank ?? null}::int IS NULL
              OR (stage."rank", c."id")
                 > (${cursor?.stageRank ?? null}::int, ${cursor?.id ?? null}::uuid))
       ORDER BY stage."rank" ASC, c."id" ASC
       LIMIT ${limit + 1}::int
    `
    const page = rows.slice(0, limit)
    const last = page.at(-1)

    return {
      claims: page.map((row) => this.toListItem(row)),
      nextCursor:
        rows.length > limit && last !== undefined
          ? encodeSellerClaimCursor({ stageRank: last.stageRank, id: last.id })
          : null,
    }
  }

  /**
   * 상태별 · 단계별 건수와 그 위의 뱃지 (2장).
   *
   * **필터를 받지 않는다.** 뱃지가 답하는 것은 「내 가게에 처리할 것이 몇 건인가」이지
   * 「지금 보고 있는 목록에 몇 건인가」가 아니다 — 필터를 받으면 탭을 옮길 때마다
   * 뱃지가 흔들리고, 그것은 사이드바에 그릴 수 없는 숫자가 된다.
   */
  async summary(principal: RequestPrincipal): Promise<SellerClaimSummaryResponse> {
    const sellerId = this.ownStore(principal)
    const rows = await this.prisma.$queryRaw<StatusCount[]>`
      SELECT c."status"::text AS "status", count(*)::int AS "count"
        FROM "ClaimRequest" c
        JOIN "SellerOrder" so ON so."id" = c."sellerOrderId"
       WHERE so."sellerId" = ${sellerId}::uuid
       GROUP BY c."status"
    `
    // **0건인 상태도 0을 갖는다.** 안 채우면 「0건」 탭이 숫자를 잃고, 화면은 「아직
    // 못 읽었다」와 「0건이다」를 구분할 수 없게 된다 (`sellerOrderSummaryOf` 와 같은
    // 판단). 열거형에서 만들어 내는 것이 저쪽과 다른 점인데, 저쪽이 표를 손으로 적은
    // 이유(상태가 늘면 컴파일이 깨져야 한다)를 여기서는 **단계 매핑**이 이미 지킨다.
    const counts = Object.fromEntries(claimStatuses.map((status) => [status, 0])) as Record<
      ClaimStatus,
      number
    >
    const stages = Object.fromEntries(claimHandlingStages.map((stage) => [stage, 0])) as Record<
      ClaimHandlingStage,
      number
    >

    for (const row of rows) {
      counts[row.status] += row.count
      stages[claimHandlingStage(row.status)] += row.count
    }

    return { summary: { counts, stages, waiting: stages.WAITING } }
  }

  /**
   * 클레임 하나, 판매자가 처리하는 데 필요한 전부 (F2 · F3 · F5 · F7).
   *
   * **한 응답이다.** 화면은 대상 항목·사진·환불 예정액·기한·버튼을 언제나 함께
   * 그리므로, 넷으로 나눠 부르면 네 응답이 서로 다른 순간을 본다 — 그때 판매자는
   * 「1,000원」을 읽으면서 「2,000원」을 승인한다.
   */
  async detail(principal: RequestPrincipal, claimId: string): Promise<SellerClaimDetailResponse> {
    const sellerId = this.ownStore(principal)

    // **남의 클레임이면 여기서 끝난다** (F6). 아래 `ClaimService.get` 도 같은 판정을
    // 하지만(그쪽이 소유권의 단일 출처다) 이 문은 그보다 좁다 — 콘솔 라우트는 「내
    // 가게의 것」만 답하고, 관리자에게 필요한 화면은 TASK-0071 의 다른 라우트다.
    if ((await this.ownerOf(claimId)) !== sellerId) {
      throw accessDenied('claim.read', 'out_of_scope')
    }

    const { claim } = await this.claims.get(principal, claimId)
    const requestedAt = new Date(claim.requestedAt)
    const dueAt = claimDueAtOf(requestedAt, this.config)

    return {
      claim: {
        claim,
        stage: claimHandlingStage(claim.status),
        dueAt: dueAt.toISOString(),
        overdue: isClaimOverdue(dueAt, this.clock.now()),
        // **실제 환불과 같은 함수를 지난다** (R2). 미리보기 전용 계산은 없다.
        ...(await this.moneyOf(claim)),
        actions: this.actionsFor(claim.status),
        return: claim.type === 'RETURN' ? await this.returnOf(claimId) : null,
      },
    }
  }

  // ---------------------------------------------------------------- internals

  /**
   * 지금 이 판매자가 밟을 수 있는 걸음.
   *
   * **새 규칙이 아니다.** 「누가 어디로」는 `claimTransitions` 가 이미 답하고 있고,
   * 여기서 하는 일은 그 답에서 `SELLER` 가 지날 수 있는 화살표만 골라 두 가지를
   * 덧붙이는 것뿐이다 — 어느 문으로 가는가와, 사유가 필수인가.
   *
   * **화면이 상태로 분기하지 않게 하려고 서버가 답한다.** 「`INSPECTING` 이면 검수
   * 라우트」를 화면에 적으면 그 판단이 흩어지고, 틀리는 날 만들어지는 것은
   * **「반품완료인데 아무 일도 일어나지 않은 반품」**이다 — 아무 오류도 나지 않는다
   * (`return.controller.ts` 가 그 위험을 적어 두었다).
   */
  private actionsFor(status: ClaimStatus) {
    return claimTransitions[status]
      .filter((rule) => rule.actors.includes('SELLER'))
      .map((rule) => ({
        to: rule.to,
        route: claimActionRouteOf(status, rule.to),
        requiresReason: claimTransitionNeedsReason(rule.to),
      }))
  }

  /**
   * 이 클레임의 돈 — **아직 안 나갔으면 예정액, 나갔으면 나간 액수.**
   *
   * ## 왜 갈라지는가
   *
   * 예정액은 「지금 환불하면 얼마인가」이고, 그 물음은 **이미 환불된 클레임에
   * 대해서는 0** 이다 — 원장이 세는 남은 수량이 없기 때문이다. 갈래를 두지 않으면
   * 끝난 클레임의 상세가 「환불 예정액 0원」을 보여 주고, 판매자는 그 화면에서
   * 실제로 얼마가 나갔는지 알 방법이 없다.
   *
   * ## 그래도 계산은 한 벌이다
   *
   * 나간 액수를 여기서 다시 세지 않는다. `ClaimRefund` 에 적힌 세 숫자는 환불이
   * 실행될 때 `claimRefundBreakdown` 이 만든 것 그대로이고, 줄별 금액은
   * `ClaimItem.refundAmount` 에 그때 적혔다 (`ClaimRefundService.writeLines`).
   * 즉 두 갈래 모두 **같은 함수가 만든 값**이고, 다른 것은 언제 만들어졌는가뿐이다.
   */
  private async moneyOf(
    claim: Claim,
  ): Promise<{ readonly quote: ClaimRefundQuote; readonly refunded: boolean }> {
    const settled = await this.refunds.recordOf(claim.id)

    if (settled !== null && settled.refundedAt !== null) {
      return {
        quote: {
          lines: claim.items.map((item) => ({
            orderItemId: item.orderItemId,
            units: item.quantity,
            amount: item.refundAmount,
          })),
          itemsAmount: settled.itemsAmount,
          shippingAmount: settled.shippingAmount,
          total: settled.amount,
        },
        refunded: true,
      }
    }

    const breakdown = await this.refunds.quote(claim.id)

    return {
      quote: {
        lines: breakdown.lines.map((line) => ({
          orderItemId: line.orderItemId,
          units: line.units,
          amount: line.amount,
        })),
        itemsAmount: breakdown.itemsAmount,
        shippingAmount: breakdown.shippingAmount,
        total: breakdown.total,
      },
      refunded: false,
    }
  }

  /**
   * 반품의 부속 — 사유 · 굳은 금액 둘 · 사진 · 운송장.
   *
   * **금액을 다시 계산하지 않는다.** 신청 시점에 `returnCostShare` 가 정해
   * `ReturnDetail` 에 굳혀 둔 값이고, 판매자가 그 뒤에 배송비 정책을 바꿔도 움직이지
   * 않아야 한다 (`ReturnDetail_bearer_amount_check` 가 두 열이 어긋난 행을 막는다).
   */
  private async returnOf(claimId: string): Promise<SellerClaimReturn | null> {
    const detail = await this.prisma.returnDetail.findUnique({
      where: { claimId },
      select: {
        reason: true,
        returnShippingDeduction: true,
        originalShippingRefund: true,
        photos: { orderBy: { position: 'asc' }, select: { key: true } },
        shipments: { select: { direction: true, trackingNumber: true } },
      },
    })

    // 부속 없는 반품은 신청이 만들지 않는다(한 트랜잭션이다). 그래도 갈래를 두는
    // 것은 타입이 `null` 을 허용하기 때문이고, 지어내면 사유가 조용히 바뀐다.
    if (detail === null) return null

    return {
      reason: detail.reason,
      returnShippingDeduction: detail.returnShippingDeduction,
      originalShippingRefund: detail.originalShippingRefund,
      photos: detail.photos.map((photo) => this.photoOf(photo.key)),
      pickupTrackingNumber:
        detail.shipments.find((row) => row.direction === 'PICKUP')?.trackingNumber ?? null,
      sendBackTrackingNumber:
        detail.shipments.find((row) => row.direction === 'SEND_BACK')?.trackingNumber ?? null,
    }
  }

  /**
   * 열쇠 하나를 화면이 그릴 수 있는 모양으로.
   *
   * **저장소가 설정되지 않았으면 `url` 이 `null` 이다.** `ObjectStorage.publicUrl` 은
   * 그 상태에서 503 을 던지는데(`UnconfiguredObjectStorage`), 그것을 그대로 흘리면
   * **R2 를 아직 붙이지 않은 배포에서 클레임 상세 전체가 열리지 않는다** — 사진을
   * 못 보는 것과 클레임을 처리하지 못하는 것은 다른 일이다. 설정 여부를 예외로 묻지
   * 않고 값으로 묻는 것은 그 갈래를 분명히 하기 위해서다 (TASK-0011 4.5 가 「설정되지
   * 않음」을 지원되는 상태로 두었다).
   *
   * **남의 사진이 여기 올 수 없다**는 판정은 이 함수가 아니라 그 앞에 있다 —
   * {@link detail} 의 소유 확인과 `ClaimService.actorFor` 다. 열쇠 자체도 소유자를
   * 말하지만(`returnPhotoKeyPattern` 의 가운데 칸이 신청한 사람이다) 그것은 신청서에
   * 붙일 때 쓰는 판정이고(`returnPhotoDecision`), 읽을 때의 판정은 클레임의 것이다.
   */
  private photoOf(key: string): ClaimPhoto {
    return { key, url: this.config.storage === null ? null : this.storage.publicUrl(key) }
  }

  /** 이 클레임이 **어느 가게의** 것인가. 없으면 404 다. */
  private async ownerOf(claimId: string): Promise<string> {
    const row = await this.prisma.claimRequest.findUnique({
      where: { id: claimId },
      select: { sellerOrder: { select: { sellerId: true } } },
    })

    if (row === null) throw new NotFoundException('클레임을 찾을 수 없어요.')

    return row.sellerOrder.sellerId
  }

  /**
   * 커서를 정렬 축 위의 위치로. **모양이 아니면 400** 이다.
   *
   * 조용히 첫 페이지로 되돌리지 않는 이유는 그때 화면이 「1페이지를 무한히 반복」하고
   * 그 증상이 아무 오류도 내지 않기 때문이다.
   */
  private cursorOf(value: string | undefined) {
    if (value === undefined) return null

    const cursor = decodeSellerClaimCursor(value)

    if (cursor === null) {
      throw new BadRequestException(
        domainFailure('INVALID', '목록을 이어서 불러올 수 없어요.', { field: 'cursor' }),
      )
    }

    return cursor
  }

  /**
   * 부르는 사람의 스토어, 아니면 403.
   *
   * `out_of_scope` 이지 `missing_permission` 이 아니다 — 퍼미션은 있는데 **그것을 걸
   * 스토어가 없는** 상태이고, 콘솔 라우트를 부른 운영자가 정확히 거기 있다
   * (`SellerOrderListService.ownStore` 와 같은 판단이다). 「전체 판매자의 클레임」이
   * 필요하면 그것은 관리자 화면이고 다른 라우트다 (TASK-0071).
   */
  private ownStore(principal: RequestPrincipal): string {
    if (principal.sellerId === null) throw accessDenied('claim.read', 'out_of_scope')

    return principal.sellerId
  }

  /** 행을 계약의 모양으로. **기한과 지연을 계산하는 자리가 여기다** — 응답을 만드는 곳. */
  private toListItem(row: ListRow): SellerClaimListItem {
    const dueAt = claimDueAtOf(row.requestedAt, this.config)

    return {
      id: row.id,
      sellerOrderId: row.sellerOrderId,
      orderNumber: row.orderNumber,
      type: row.type,
      status: row.status,
      stage: claimHandlingStage(row.status),
      fault: row.fault,
      requestedAt: row.requestedAt.toISOString(),
      dueAt: dueAt.toISOString(),
      overdue: isClaimOverdue(dueAt, this.clock.now()),
      itemCount: row.itemCount,
      totalQuantity: row.totalQuantity,
      // 「외 2건」은 붙이지 않는다 — 개수는 `itemCount` 로 따로 나가고 문장은 화면이
      // 만든다. 주문 목록과 **같은 함수**를 쓰는 이유는 두 목록의 제목이 같은 규칙을
      // 따라야 하기 때문이다.
      headline: sellerOrderHeadline(row.productName === null ? [] : [row.productName]),
      thumbnailUrl: row.thumbnailUrl,
    }
  }
}
