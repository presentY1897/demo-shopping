import type { HttpException } from '@nestjs/common'
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import type {
  Claim,
  ClaimableItem,
  ClaimableResponse,
  ClaimHistoryEntry,
  ClaimItem,
  ClaimListItem,
  ClaimListQuery,
  ClaimListResponse,
  ClaimResponse,
  ClaimStatus,
  ClaimTransitionRequest,
  ClaimTransitionResponse,
  ClaimType,
  CreateClaimRequest,
  OrderItemSnapshot,
  Permission,
} from '@shopping/shared'
import { CLAIM_LIST_DEFAULT_LIMIT, grantedScopes } from '@shopping/shared'

import { assertResourceAccess } from '../auth/access-denied.js'
import type { AccountRow, SellerRow } from '../auth/resource-ownership.js'
import {
  accountOwnership,
  accountOwnershipSelect,
  sellerOwnership,
  sellerOwnershipSelect,
} from '../auth/resource-ownership.js'
import type { RequestPrincipal } from '../auth/request-principal.js'
import type { Clock } from '../common/clock.js'
import { CLOCK } from '../common/clock.js'
import { domainFailure } from '../common/domain-failure.js'
import type { AppConfig } from '../config/app-config.js'
import { APP_CONFIG } from '../config/app-config.js'
import { autoConfirmWindowMsOf } from '../orders/order-confirm.js'
import type { SellerOrderActor } from '../orders/seller-order-transitions.js'
import { PrismaService } from '../prisma/prisma.service.js'
import type { ClaimRefusal } from './claim-rules.js'
import {
  CLAIM_INITIAL,
  claimEligibility,
  claimRouteFor,
  claimTransitionDecision,
  remainingQuantity,
} from './claim-rules.js'

type Tx = Prisma.TransactionClient

/**
 * 잡고 있던 수량을 **돌려주는** 상태.
 *
 * 세는 것이 「신청한 적 있는 수량」이 아니라 **「살아 있는 클레임이 잡고 있는
 * 수량」**이기 때문이다 (`claim-rules.ts` 의 `remainingQuantity`). 검수에서 떨어진
 * 반품이 그 항목을 영영 잠그면 사람이 할 수 있는 일이 없어진다.
 *
 * `Record` 라 상태가 하나 늘면 **컴파일이 막는다.** 안 그러면 새 상태는 「돌려줄지
 * 아무도 정한 적 없는 상태」로 태어나고, 그 결정이 빠졌다는 것은 어느 검사도
 * 알려 주지 않는다 — 증상은 몇 주 뒤 「반품을 거절했는데 다시 신청이 안 되는 항목」
 * 하나다.
 */
const RELEASES_QUANTITY: Readonly<Record<ClaimStatus, boolean>> = {
  CANCEL_REQUESTED: false,
  CANCEL_APPROVED: false,
  /** 거절됐다. 이 항목은 다시 신청할 수 있어야 한다. */
  CANCEL_REJECTED: true,
  RETURN_REQUESTED: false,
  RETURN_APPROVED: false,
  PICKING_UP: false,
  INSPECTING: false,
  RETURN_COMPLETED: false,
  /** 검수 불합격도 거절이다. 물건은 판매자에게 있지만 이 신청은 끝났다. */
  RETURN_REJECTED: true,
  /** 환불까지 끝났다. 이 수량은 영영 이 클레임의 것이다. */
  REFUNDED: false,
}

/** 「누구 것인가」를 답하는 데 필요한 열들. 소유권 매퍼가 읽는 것 그대로다. */
const OWNERSHIP_SELECT = {
  sellerId: true,
  seller: { select: sellerOwnershipSelect },
  order: { select: { user: { select: accountOwnershipSelect } } },
} as const

const CLAIM_SELECT = {
  id: true,
  sellerOrderId: true,
  type: true,
  status: true,
  reason: true,
  fault: true,
  requestedById: true,
  createdAt: true,
  updatedAt: true,
  items: {
    orderBy: { orderItemId: 'asc' },
    select: {
      id: true,
      orderItemId: true,
      quantity: true,
      refundAmount: true,
      orderItem: { select: { variantId: true, productSnapshot: true } },
    },
  },
  statusHistory: {
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      fromStatus: true,
      toStatus: true,
      reason: true,
      actor: true,
      actorId: true,
      createdAt: true,
    },
  },
  sellerOrder: { select: { orderId: true, order: { select: { orderNumber: true } } } },
} as const satisfies Prisma.ClaimRequestSelect

/** 전이를 일으킬 때 함께 적히는 것 — 누가, 왜. */
interface ClaimCommand {
  readonly actor: SellerOrderActor
  /** 사람이 없는 전이(`SYSTEM`)는 `null` 이다. */
  readonly actorId: string | null
  readonly reason: string | null
}

/** 잠근 행에서 읽는 것. 판단에 필요한 것뿐이다. */
interface LockedClaim {
  readonly id: string
  readonly status: ClaimStatus
}

/** 목록 한 줄이 데이터베이스에서 나오는 모양. */
interface ListRow {
  readonly id: string
  readonly sellerOrderId: string
  readonly orderNumber: string
  readonly type: ClaimType
  readonly status: ClaimStatus
  readonly fault: 'CUSTOMER' | 'SELLER'
  readonly createdAt: Date
  readonly itemCount: number
  readonly totalQuantity: number
}

/**
 * 취소 · 반품 신청과 그 상태 (TASK-0065 · 설계서 4장).
 *
 * 규칙 자체는 `claim-rules.ts` 가 갖는다. 여기 있는 것은 그 규칙을 **데이터베이스에
 * 적용하는 순서**이고, 주문의 상태 전이(`SellerOrderService`)와 같은 모양이다.
 *
 * ## 동시 신청을 무엇으로 막았나 — 조건부 갱신이다 (R1)
 *
 * TASK 문서는 「`OrderItem` 행 잠금 후 잔여 확인」이라고 적었고, 이 저장소에는 같은
 * 문제를 푼 두 가지 선례가 있다.
 *
 * | 선례 | 모양 | 왜 그 모양인가 |
 * | --- | --- | --- |
 * | `PaymentService.lock()` | `SELECT … FOR UPDATE` → 판단 → 쓰기 | 판단이 **그 행 밖**을 본다(프로바이더 응답·상태 머신). 조건을 `WHERE` 에 담을 수 없다 |
 * | `ReservationService.reserve()` | `UPDATE … WHERE "stock" - "reserved" >= $q` | 판단이 **그 행 안**에서 끝난다. 조건을 `WHERE` 에 두면 판단과 갱신이 한 문장이 된다 |
 *
 * 잔여 수량은 뒤쪽이다. 「남았는가」는 `OrderItem` 한 행의 두 컬럼(`quantity` 와
 * `claimedQuantity`)만으로 답이 나오므로, 잠그고 읽고 판단하고 쓰는 네 걸음을 한
 * 문장으로 접을 수 있다.
 *
 * ```sql
 * UPDATE "OrderItem" SET "claimedQuantity" = "claimedQuantity" + $q
 *  WHERE "id" = $id AND "quantity" - "claimedQuantity" >= $q
 * ```
 *
 * **「읽고 → 판단하고 → 쓰는」 사이가 비지 않는 것이 요점이다.** 남은 것이 1개인데
 * 두 요청이 동시에 오면 잠금이 없는 구현에서는 둘 다 「아직 남았다」를 읽고 둘 다
 * 통과한다. 조건을 `WHERE` 에 두면 PostgreSQL 이 그 행을 한 번에 하나씩만 갱신하므로
 * **뒤에 온 쪽은 0행 갱신으로 진다.** 잠금을 따로 잡을 필요도 없다 — 갱신 자신이
 * 잠금이다.
 *
 * 그 대신 `claimedQuantity` 는 **캐시**다. `ProductVariant.reserved` 와 같은 성질이고
 * (매번 `ClaimItem` 을 합산하면 항목마다 집계가 붙는다), 같은 위험을 갖는다 — 어긋날
 * 수 있다.
 *
 * ## 마지막 방어선은 DB 에 있다
 *
 * `OrderItem_claimedQuantity_check`(`0 <= claimedQuantity <= quantity`)이다. 위
 * 문장을 안 지나는 쓰기가 하나 생기는 날 — 배치, 시드, 나중의 관리자 도구 — 초과분은
 * **조용히** 넘치고, 증상은 오류가 아니라 「주문한 것보다 많이 환불된 주문」이다.
 * `Payment_canceledAmount_check` 이 같은 이유로 같은 모양이고, 돈과 수량이 걸린
 * 자리에서 방어선이 하나뿐이면 안 된다.
 *
 * ## 주체는 서버가 정한다
 *
 * 요청이 자기 주체를 주장하게 두면 구매자가 `SELLER` 를 주장해 자기 클레임을
 * 승인한다. 그래서 {@link actorFor} 가 「이 사람은 이 몫의 무엇인가」를 행에서 읽어
 * 정하고, {@link transition} 은 절대 `SYSTEM` 을 만들지 않는다.
 */
@Injectable()
export class ClaimService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  // ------------------------------------------------------------------ writes

  /**
   * 신청한다 (`POST /claims` · F1 ~ F6).
   *
   * **신청은 전이가 아니라 생성이다.** 그래서 전이표를 지나지 않고, 시작하는 자리는
   * 유형이 정한다 (`CLAIM_INITIAL`). 유형도 요청이 아니라 **주문 상태**가 정한다.
   *
   * 세 걸음의 순서가 규칙이다.
   *
   * ① 소유권과 주체 — 잠금을 잡기 전이다. 남의 주문에 신청하는 요청이 잠금을 기다릴
   *    이유가 없다.
   * ② **판단은 `claimEligibility` 하나가 내린다.** 거절 여섯의 순서가 곧 사람에게
   *    할 말의 순서이고(배송 중인 주문에 「수량이 모자랍니다」라고 답하지 않는다),
   *    그 순서를 여기서 다시 적으면 규칙이 두 벌이 된다.
   * ③ 잡는 것과 신청서를 쓰는 것이 **한 트랜잭션**이다. 갈리면 「수량은 잡혔는데
   *    신청서가 없는 항목」이 남고, 그것은 아무도 신고하지 않는다.
   */
  async create(principal: RequestPrincipal, input: CreateClaimRequest): Promise<ClaimResponse> {
    const order = await this.sellerOrder(input.sellerOrderId)
    const actor = this.actorFor(principal, order, 'order.write')
    const now = this.clock.now()
    const deliveredAt = await this.deliveredAt(order.id)
    const lines = this.linesOf(order.items, input)

    let type: ClaimType | null = null

    for (const line of lines) {
      const decision = claimEligibility({
        orderStatus: order.status,
        deliveredAt,
        now,
        windowMs: this.returnWindowMs(),
        requested: line.quantity,
        remaining: remainingQuantity(line.item.quantity, line.item.claimedQuantity),
      })

      if (decision.outcome === 'refused') throw refusal(decision.reason, decision.remaining)

      type = decision.type
    }

    // 줄이 하나도 없는 요청은 계약이 이미 막는다(`items` 는 `min(1)`). 그래서 이
    // 갈래는 컴파일러를 위한 것이고, 값을 지어내는 대신 그 사실을 말한다.
    if (type === null) throw new BadRequestException('신청할 항목이 없습니다.')

    const initial = CLAIM_INITIAL[type]
    const claimId = await this.prisma.$transaction(async (tx) => {
      // **항목 id 순서로 잡는다.** 두 신청이 같은 두 항목을 반대 순서로 잡으면
      // 데드락이 되고, 그것은 부하가 있는 날에만 나타난다.
      for (const line of [...lines].sort((left, right) =>
        left.item.id < right.item.id ? -1 : 1,
      )) {
        await this.hold(tx, line.item.id, line.quantity, now)
      }

      const created = await tx.claimRequest.create({
        data: {
          sellerOrderId: order.id,
          type,
          status: initial,
          reason: input.reason,
          fault: input.fault,
          requestedById: principal.userId,
          createdAt: now,
          updatedAt: now,
          items: {
            create: lines.map((line) => ({
              orderItemId: line.item.id,
              quantity: line.quantity,
              // 환불액은 이 TASK 가 계산하지 않는다 (TASK-0068). 이 0 은 「0원을
              // 돌려준다」가 아니라 「아직 계산하지 않았다」다.
              createdAt: now,
              updatedAt: now,
            })),
          },
        },
        select: { id: true },
      })

      await tx.claimStatusHistory.create({
        data: {
          claimId: created.id,
          // 생성이라 이전 상태가 없다.
          fromStatus: null,
          toStatus: initial,
          reason: input.reason,
          actor,
          actorId: principal.userId,
          createdAt: now,
        },
      })

      return created.id
    })

    return { claim: await this.load(claimId) }
  }

  /**
   * 다음 상태로 옮긴다 (`POST /claims/:id/transitions` · F7).
   *
   * `SellerOrderService.transition` 이 본보기이고 순서가 같다 — 행 잠금 → 전이 판단
   * → 주체 확인 → 상태 변경과 이력(한 트랜잭션). **멱등**까지 같다.
   *
   * 트랜잭션이 잠금부터 이력까지만을 감싸는 것도 같다. 소유권 확인은 그 앞이고, 답을
   * 만드느라 클레임 전체를 다시 읽는 것은 그 뒤다 — 앞의 것은 잠금을 오래 쥐고 있을
   * 이유가 없고, 뒤의 것은 커밋된 사실을 읽어야 한다.
   */
  async transition(
    principal: RequestPrincipal,
    claimId: string,
    input: ClaimTransitionRequest,
  ): Promise<ClaimTransitionResponse> {
    const access = await this.access(claimId)
    const actor = this.actorFor(principal, access.sellerOrder, 'claim.handle')
    const changed = await this.prisma.$transaction((tx) =>
      this.applyWithin(tx, claimId, input.to, {
        actor,
        actorId: principal.userId,
        reason: input.reason ?? null,
      }),
    )

    return { claim: await this.load(claimId), changed }
  }

  // ------------------------------------------------------------------- reads

  /** 클레임 하나 (`GET /claims/:id`). */
  async get(principal: RequestPrincipal, claimId: string): Promise<ClaimResponse> {
    const access = await this.access(claimId)

    this.actorFor(principal, access.sellerOrder, 'claim.read')

    return { claim: await this.load(claimId) }
  }

  /**
   * 클레임 목록 (`GET /claims`).
   *
   * **보이는 범위는 퍼미션의 스코프가 정한다.** `claim.read` 를 `any` 로 가진 사람은
   * 전부, 나머지는 자기가 산 주문과 자기 가게에 들어온 몫이다 — 서비스가 역할을 다시
   * 판단하지 않는 것이 이 저장소의 규약이고(TASK-0105), 그래서 여기서 읽는 것은
   * `grantedScopes` 하나다.
   *
   * `demo` 스코프는 목록의 축이 아니다. 그것은 「데모 계정이 만든 행」을 뜻하는데,
   * 소유자 조건 없이 그것만으로 좁히면 **다른 방문자의 클레임**이 섞인다. 데모
   * 관리자에게 필요한 화면이 생기면 그때 그 축으로 라우트를 하나 더 만든다.
   *
   * 커서는 `id` 하나다 — UUIDv7 이라 그 자체로 시간순이고, `createdAt` 으로 정렬하면
   * 같은 밀리초의 두 신청에서 커서가 한 건을 건너뛴다.
   */
  async list(principal: RequestPrincipal, query: ClaimListQuery): Promise<ClaimListResponse> {
    const everything = grantedScopes(principal, 'claim.read').includes('any')
    const limit = query.limit ?? CLAIM_LIST_DEFAULT_LIMIT
    const statuses = query.status ?? null
    const rows = await this.prisma.$queryRaw<ListRow[]>`
      SELECT c."id",
             c."sellerOrderId",
             c."type"::text AS "type",
             c."status"::text AS "status",
             c."fault"::text AS "fault",
             c."createdAt",
             o."orderNumber",
             agg."itemCount",
             agg."totalQuantity"
        FROM "ClaimRequest" c
        JOIN "SellerOrder" so ON so."id" = c."sellerOrderId"
        JOIN "Order" o ON o."id" = so."orderId"
        LEFT JOIN LATERAL (
          SELECT count(*)::int AS "itemCount",
                 COALESCE(sum("quantity"), 0)::int AS "totalQuantity"
            FROM "ClaimItem"
           WHERE "claimId" = c."id"
        ) agg ON true
       WHERE (${everything}::boolean
              OR o."userId" = ${principal.userId}::uuid
              OR so."sellerId" = ${principal.sellerId}::uuid)
         AND (${query.sellerOrderId ?? null}::uuid IS NULL
              OR c."sellerOrderId" = ${query.sellerOrderId ?? null}::uuid)
         AND (${statuses}::text[] IS NULL OR c."status"::text = ANY (${statuses}::text[]))
         AND (${query.type ?? null}::text IS NULL OR c."type"::text = ${query.type ?? null}::text)
         AND (${query.cursor ?? null}::uuid IS NULL OR c."id" < ${query.cursor ?? null}::uuid)
       ORDER BY c."id" DESC
       LIMIT ${limit + 1}::int
    `
    const page = rows.slice(0, limit)

    return {
      claims: page.map((row) => toListItem(row)),
      nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
    }
  }

  /**
   * 「이 주문에 지금 무엇을 몇 개까지 신청할 수 있나」
   * (`GET /seller-orders/:id/claimable` · F8).
   *
   * **화면이 상태로 분기하지 않게 하려고 있다.** 「`DELIVERED` 면 반품 버튼」을
   * 화면에 적으면 그 판단이 세 앱에 흩어지고, 반품 기간처럼 배포 설정에 달린 값은
   * 화면이 **틀린 날짜를 자신 있게** 적게 된다 — `/seller-orders/:id/actions` 가
   * 전이에 대해 하는 일과 같다.
   */
  async claimable(principal: RequestPrincipal, sellerOrderId: string): Promise<ClaimableResponse> {
    const order = await this.sellerOrder(sellerOrderId)

    this.actorFor(principal, order, 'claim.read')

    const now = this.clock.now()
    const windowMs = this.returnWindowMs()
    const deliveredAt = await this.deliveredAt(order.id)
    // **수량 갈래를 지나가게 하려고 1·1 을 준다.** 이 답이 말해야 하는 것은 「주문이
    // 무엇을 열어 주는가」이고, 항목별 수량은 아래 `items` 가 말한다. 앞의 넷을 여기서
    // 다시 적으면 거절의 순서가 두 벌이 되고, 언젠가 둘이 다른 말을 한다.
    const verdict = claimEligibility({
      orderStatus: order.status,
      deliveredAt,
      now,
      windowMs,
      requested: 1,
      remaining: 1,
    })

    return {
      sellerOrderId: order.id,
      type: verdict.outcome === 'allowed' ? verdict.type : null,
      refusal: verdict.outcome === 'refused' ? verdict.reason : null,
      // 반품 경로에서만 뜻이 있다. 취소는 물건이 아직 떠나지 않아 기다릴 것이 없다.
      returnWindowEndsAt:
        claimRouteFor(order.status) === 'RETURN' && deliveredAt !== null
          ? new Date(deliveredAt.getTime() + windowMs).toISOString()
          : null,
      items: order.items.map((item) => toClaimableItem(item)),
    }
  }

  // ---------------------------------------------------------------- internals

  /**
   * 이 항목의 남은 수량에서 `quantity` 를 **잡는다.** 한 문장이다 (R1).
   *
   * 0행이면 진 것이다 — 그 사이에 남이 먼저 잡았고, 지금 남은 것으로는 모자란다.
   * 그때 다시 읽어 **지금의 잔여**를 함께 답한다: 이 갈래에 오는 사람은 대개 다른
   * 창에서 방금 하나를 신청한 사람이고, 「신청할 수 없습니다」로 끝나는 화면은
   * 그에게 아무것도 알려 주지 않는다.
   *
   * 다시 읽은 값이 낡지 않는 이유는 잠금의 성질이다. 조건부 `UPDATE` 는 앞사람이
   * 커밋할 때까지 **기다렸다가** 조건을 다시 본다. 그래서 여기 도달했다는 것은
   * 앞사람이 이미 커밋했다는 뜻이고, 뒤이은 `SELECT` 는 그 값을 본다.
   */
  private async hold(tx: Tx, orderItemId: string, quantity: number, now: Date): Promise<void> {
    const taken = await tx.$executeRaw`
      UPDATE "OrderItem"
         SET "claimedQuantity" = "claimedQuantity" + ${quantity}, "updatedAt" = ${now}
       WHERE "id" = ${orderItemId}::uuid
         AND "quantity" - "claimedQuantity" >= ${quantity}
    `

    if (taken > 0) return

    const fresh = await tx.orderItem.findUniqueOrThrow({
      where: { id: orderItemId },
      select: { quantity: true, claimedQuantity: true },
    })

    throw refusal('exceeds_remaining', remainingQuantity(fresh.quantity, fresh.claimedQuantity))
  }

  /** 이 클레임이 잡고 있던 수량을 **돌려준다.** 잡을 때와 같은 순서로 건드린다. */
  private async release(tx: Tx, claimId: string, now: Date): Promise<void> {
    const items = await tx.claimItem.findMany({
      where: { claimId },
      orderBy: { orderItemId: 'asc' },
      select: { orderItemId: true, quantity: true },
    })

    for (const item of items) {
      await tx.$executeRaw`
        UPDATE "OrderItem"
           SET "claimedQuantity" = "claimedQuantity" - ${item.quantity}, "updatedAt" = ${now}
         WHERE "id" = ${item.orderItemId}::uuid
      `
    }
  }

  /**
   * 잠금 아래에서 한 걸음 옮긴다. **옮겼으면 `true`.**
   *
   * **멱등이다.** 이미 목표 상태면 아무것도 하지 않고 `false` 를 돌려준다 — 이력도
   * 늘지 않는다. 「정의되지 않은 전이」로 거절하면 재시도한 화면이 오류를 보는데, 그
   * 사람이 원한 결과는 이미 이뤄져 있다.
   */
  private async applyWithin(
    tx: Tx,
    claimId: string,
    to: ClaimStatus,
    command: ClaimCommand,
  ): Promise<boolean> {
    const locked = await this.lock(tx, claimId)

    if (locked.status === to) return false

    const decision = claimTransitionDecision(locked.status, to, command.actor)

    if (decision.outcome === 'refused') {
      throw transitionRefusal(decision.reason, locked.status, to)
    }

    const now = this.clock.now()

    await tx.claimRequest.update({ where: { id: claimId }, data: { status: to, updatedAt: now } })
    await tx.claimStatusHistory.create({
      data: {
        claimId,
        fromStatus: locked.status,
        toStatus: to,
        reason: command.reason,
        actor: command.actor,
        // 사람이 없는 전이는 사람을 지어내지 않는다. 비어 있는 편이 사실이다.
        actorId: command.actor === 'SYSTEM' ? null : command.actorId,
        createdAt: now,
      },
    })

    if (RELEASES_QUANTITY[to]) await this.release(tx, claimId, now)

    return true
  }

  /**
   * 클레임 행의 잠금을 잡고 그 줄을 읽는다.
   *
   * **한 문장이다.** 읽는 것이 잠근 그 행의 컬럼뿐이라, 잠금을 기다린
   * `SELECT … FOR UPDATE` 는 앞사람이 커밋한 값을 다시 읽는다 — 다른 표를 함께
   * 읽으면 부질의가 시작할 때의 스냅샷을 들고 와 **낡은 상태로** 판단하게 된다
   * (`SellerOrderService.lock` · `PaymentService.lock` 이 같은 이유로 같은 모양이다).
   */
  private async lock(tx: Tx, claimId: string): Promise<LockedClaim> {
    const rows = await tx.$queryRaw<readonly LockedClaim[]>`
      SELECT "id", "status"::text AS "status"
        FROM "ClaimRequest"
       WHERE "id" = ${claimId}::uuid
       FOR UPDATE
    `
    const [row] = rows

    if (row === undefined) throw new NotFoundException('클레임을 찾을 수 없어요.')

    return row
  }

  /**
   * 반품을 받아 주는 기간 (R2).
   *
   * **새 축을 만들지 않는다.** 자동 구매확정(TASK-0064)이 이미 그 축을 세웠고
   * (`FULFILLMENT_PACE` — `demo` 5분 / `realistic` 7일), 반품 기간은 그 값과 **같아야
   * 한다.** 다르면 둘 중 하나가 반드시 이상해진다: 반품 기간이 짧으면 확정을
   * 기다리는 동안 아무것도 못 하는 구간이 생기고, 길면 확정된 주문에 반품을 받아야
   * 하는데 그것은 `CONFIRMED` 가 이미 거절한다(F5).
   *
   * 그래서 값을 새로 정의하지 않고 저쪽 함수를 그대로 부른다. 여기 숫자가 하나
   * 적히는 순간 「데모 모드」가 두 벌이 되고, 그때 증상은 「배송은 6분인데 반품은
   * 7일」이며 아무것도 실패하지 않는다.
   */
  private returnWindowMs(): number {
    return autoConfirmWindowMsOf(this.config)
  }

  /**
   * 이 몫이 **배송완료로 선언된** 순간, 또는 그런 적이 없으면 `null`.
   *
   * **`Shipment.deliveredAt` 이 아니라 상태 이력을 읽는다** (TASK-0064 4.1).
   * `SHIPPED → DELIVERED` 는 판매자도 전이 라우트로 찍을 수 있고, 그때 배송 표는
   * 따라오지 않는다 — 그것을 기준으로 삼으면 그 주문은 **영원히 반품 기간 밖**이
   * 되고 아무것도 실패하지 않는다. 이력은 상태를 옮기는 문이 같은 트랜잭션에서
   * 쓰므로 예외 없이 있다.
   *
   * 첫 줄을 읽는 것도 같은 이유다. 반품 기간이 재는 것은 「구매자가 반품을 말할
   * 시간을 얼마나 가졌나」이고, 그 시작은 처음 도착이 선언된 순간이다.
   */
  private async deliveredAt(sellerOrderId: string): Promise<Date | null> {
    const row = await this.prisma.orderStatusHistory.findFirst({
      where: { sellerOrderId, toStatus: 'DELIVERED' },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    })

    return row?.createdAt ?? null
  }

  /** 신청이 볼 주문 한 몫. 잠그기 전의 읽기다. */
  private async sellerOrder(sellerOrderId: string) {
    const row = await this.prisma.sellerOrder.findUnique({
      where: { id: sellerOrderId },
      select: {
        id: true,
        status: true,
        ...OWNERSHIP_SELECT,
        items: {
          orderBy: { id: 'asc' },
          select: {
            id: true,
            variantId: true,
            quantity: true,
            claimedQuantity: true,
            productSnapshot: true,
          },
        },
      },
    })

    if (row === null) throw new NotFoundException('주문을 찾을 수 없어요.')

    return row
  }

  /** 클레임의 소유권 판단에 필요한 만큼. */
  private async access(claimId: string) {
    const row = await this.prisma.claimRequest.findUnique({
      where: { id: claimId },
      select: { id: true, sellerOrder: { select: OWNERSHIP_SELECT } },
    })

    if (row === null) throw new NotFoundException('클레임을 찾을 수 없어요.')

    return row
  }

  /** 답으로 나갈 모양 그대로 다시 읽는다. 커밋된 사실이어야 한다. */
  private async load(claimId: string): Promise<Claim> {
    const row = await this.prisma.claimRequest.findUniqueOrThrow({
      where: { id: claimId },
      select: CLAIM_SELECT,
    })

    return {
      id: row.id,
      sellerOrderId: row.sellerOrderId,
      orderId: row.sellerOrder.orderId,
      orderNumber: row.sellerOrder.order.orderNumber,
      type: row.type,
      status: row.status,
      reason: row.reason,
      fault: row.fault,
      requestedById: row.requestedById,
      requestedAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      items: row.items.map((item) => toClaimItem(item)),
      history: row.statusHistory.map((entry) => toHistoryEntry(entry)),
    }
  }

  /**
   * 요청한 줄을 이 주문의 항목에 맞춘다.
   *
   * 남의 주문 항목 id 를 섞어 보내는 요청이 여기서 끝난다. 조용히 무시하면 사람이
   * 고른 것과 다른 것이 신청되고, 그것은 화면과 실제가 갈리는 가장 나쁜 모양이다
   * (`ORDER_ITEM_MISSING` 과 같은 판단).
   */
  private linesOf(
    items: readonly OrderItemRow[],
    input: CreateClaimRequest,
  ): readonly { readonly item: OrderItemRow; readonly quantity: number }[] {
    const byId = new Map(items.map((item) => [item.id, item]))

    return input.items.map((line) => {
      const item = byId.get(line.orderItemId)

      if (item === undefined) {
        throw new BadRequestException(
          domainFailure('CLAIM_ITEM_MISSING', '이 주문에 없는 항목이 있어요.', {
            field: 'items',
          }),
        )
      }

      return { item, quantity: line.quantity }
    })
  }

  /**
   * 이 요청을 보낸 사람은 이 몫의 **무엇**인가.
   *
   * `SellerOrderService.actorFor` 와 같은 순서이고, 같은 이유다 — 자기 가게에서 자기가
   * 산 경우에 두 자격을 다 갖는데, 이 몫의 주인은 판 사람이다. 클레임에서 그 순서가
   * 실제로 결과를 바꾼다: 판매자로 읽히면 승인할 수 있고 구매자로 읽히면 못 한다.
   *
   * 마지막 갈래의 `ADMIN` 은 「나머지 전부」가 아니다 — 바로 위 {@link assertResourceAccess}
   * 가 **전부에 닿는 권한**을 요구하므로, 아무것도 아닌 사람은 여기서 403 으로 끝난다.
   *
   * 퍼미션을 인자로 받는 이유는 라우트마다 요구하는 것이 다르기 때문이다 — 신청은
   * 자기 주문에 대한 행위라 `order.write`, 승인·거절은 `claim.handle`, 조회는
   * `claim.read` 다. 구매자가 `claim.handle` 을 갖지 않는 것이 「신청자가 자기
   * 클레임을 승인하지 못한다」의 **첫 번째** 방어선이고, 전이표가 두 번째다.
   */
  private actorFor(
    principal: RequestPrincipal,
    row: {
      readonly sellerId: string
      readonly seller: SellerRow
      readonly order: { readonly user: AccountRow }
    },
    permission: Permission,
  ): SellerOrderActor {
    if (principal.sellerId !== null && principal.sellerId === row.sellerId) {
      assertResourceAccess(principal, permission, sellerOwnership(row.seller))

      return 'SELLER'
    }

    if (principal.userId === row.order.user.id) {
      assertResourceAccess(principal, permission, accountOwnership(row.order.user))

      return 'BUYER'
    }

    assertResourceAccess(principal, permission, sellerOwnership(row.seller))

    return 'ADMIN'
  }
}

/** 주문 항목 한 줄이, 신청 판단에 필요한 만큼. */
interface OrderItemRow {
  readonly id: string
  readonly variantId: string
  readonly quantity: number
  readonly claimedQuantity: number
  readonly productSnapshot: unknown
}

/**
 * 주문한 때의 상품.
 *
 * 검사 없이 옮긴다 — 이 열을 쓰는 곳은 주문 생성 하나뿐이고, 그쪽이 계약의 스키마로
 * 만든 객체를 그대로 넣는다 (`OrderService` 의 같은 함수).
 */
function snapshotFrom(value: unknown): OrderItemSnapshot {
  return value as OrderItemSnapshot
}

function toClaimableItem(item: OrderItemRow): ClaimableItem {
  return {
    orderItemId: item.id,
    variantId: item.variantId,
    snapshot: snapshotFrom(item.productSnapshot),
    quantity: item.quantity,
    claimedQuantity: item.claimedQuantity,
    remainingQuantity: remainingQuantity(item.quantity, item.claimedQuantity),
  }
}

function toClaimItem(row: {
  readonly id: string
  readonly orderItemId: string
  readonly quantity: number
  readonly refundAmount: number
  readonly orderItem: { readonly variantId: string; readonly productSnapshot: unknown }
}): ClaimItem {
  return {
    id: row.id,
    orderItemId: row.orderItemId,
    variantId: row.orderItem.variantId,
    snapshot: snapshotFrom(row.orderItem.productSnapshot),
    quantity: row.quantity,
    refundAmount: row.refundAmount,
  }
}

function toHistoryEntry(row: {
  readonly id: string
  readonly fromStatus: ClaimStatus | null
  readonly toStatus: ClaimStatus
  readonly reason: string | null
  readonly actor: SellerOrderActor
  readonly actorId: string | null
  readonly createdAt: Date
}): ClaimHistoryEntry {
  return {
    id: row.id,
    fromStatus: row.fromStatus,
    toStatus: row.toStatus,
    reason: row.reason,
    actor: row.actor,
    actorId: row.actorId,
    occurredAt: row.createdAt.toISOString(),
  }
}

function toListItem(row: ListRow): ClaimListItem {
  return {
    id: row.id,
    sellerOrderId: row.sellerOrderId,
    orderNumber: row.orderNumber,
    type: row.type,
    status: row.status,
    fault: row.fault,
    requestedAt: row.createdAt.toISOString(),
    itemCount: row.itemCount,
    totalQuantity: row.totalQuantity,
  }
}

/**
 * 신청 거절 여섯을 **서로 다른 답**으로 옮긴다.
 *
 * 하나로 묶지 않는 이유는 부르는 쪽이 할 일이 다르기 때문이다 — 배송 중이면
 * 기다리면 되고, 확정했으면 관리자를 찾아야 하며, 수량이 모자라면 **숫자를 고치면
 * 된다.** 마지막만이 화면이 「N개까지 신청할 수 있어요」로 바꿔 말할 수 있는
 * 거절이라, 그것이 `params.remaining` 을 달고 나간다.
 *
 * `Record` 가 아니라 `switch` 인 것은 상태 코드가 갈래마다 다르기 때문이다 — 표로
 * 적으면 코드·문장·필드 세 벌을 나란히 두게 되고, 그것은 표가 아니라 세 개의 표다.
 * 갈래가 하나 늘면 `ClaimRefusal` 이 완전하지 않아 컴파일이 멈춘다.
 */
function refusal(reason: ClaimRefusal, remaining: number): HttpException {
  switch (reason) {
    case 'in_transit':
      return new ConflictException(
        domainFailure('CLAIM_IN_TRANSIT', '배송 중에는 취소도 반품도 할 수 없어요.'),
      )
    case 'confirmed':
      return new ConflictException(
        domainFailure('CLAIM_ORDER_CONFIRMED', '구매확정한 주문은 고객센터로 문의해 주세요.'),
      )
    case 'window_closed':
      return new ConflictException(
        domainFailure('CLAIM_WINDOW_CLOSED', '반품할 수 있는 기간이 지났어요.'),
      )
    case 'not_claimable':
      return new ConflictException(
        domainFailure('CLAIM_NOT_CLAIMABLE', '지금 상태에서는 신청할 수 없어요.'),
      )
    case 'exceeds_remaining':
      return new ConflictException(
        domainFailure('CLAIM_EXCEEDS_REMAINING', '신청할 수 있는 수량을 넘었어요.', {
          field: 'items',
          params: { remaining },
        }),
      )
    case 'invalid_quantity':
      return new BadRequestException(
        domainFailure('CLAIM_INVALID_QUANTITY', '수량은 1개 이상이어야 해요.', {
          field: 'items',
        }),
      )
  }
}

/**
 * 전이 거절 둘.
 *
 * 나누는 이유는 주문 쪽과 같다 — 정의되지 않은 전이는 고쳐도 안 되고(다시 읽어야
 * 한다), 주체가 막힌 것은 **다른 사람이면 된다.** 뒤쪽이 실제로 막는 것 하나가
 * 「신청자가 자기 클레임을 승인하는 것」이다.
 */
function transitionRefusal(
  reason: 'undefined_transition' | 'actor_forbidden',
  from: ClaimStatus,
  to: ClaimStatus,
): HttpException {
  const params = { from, to }

  if (reason === 'undefined_transition') {
    return new ConflictException(
      domainFailure('CLAIM_TRANSITION_UNDEFINED', '지금 상태에서는 할 수 없는 요청이에요.', {
        field: 'to',
        params,
      }),
    )
  }

  return new ForbiddenException(
    domainFailure('CLAIM_TRANSITION_FORBIDDEN', '이 클레임을 그렇게 바꿀 수 없어요.', {
      field: 'to',
      params,
    }),
  )
}
