import type { HttpException } from '@nestjs/common'
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import type {
  OrderStatus,
  SellerOrderAction,
  SellerOrderActionsResponse,
  SellerOrderRequirement,
  SellerOrderTransitionRequest,
  SellerOrderTransitionResponse,
} from '@shopping/shared'

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
import { PrismaService } from '../prisma/prisma.service.js'
import type { OrderConfirmedEvents } from './order-confirmed-events.js'
import { confirmationsOf, ORDER_CONFIRMED_EVENTS } from './order-confirmed-events.js'
import type { SellerOrderEvents, SellerOrderStatusChanged } from './seller-order-events.js'
import { SELLER_ORDER_EVENTS } from './seller-order-events.js'
import type {
  SellerOrderActor,
  TransitionRefusal,
  TransitionRequirement,
} from './seller-order-transitions.js'
import { availableTransitions, ruleFor, transitionDecision } from './seller-order-transitions.js'

type Tx = Prisma.TransactionClient

/**
 * 조건이 모자랄 때 화면이 오류를 붙일 입력의 이름.
 *
 * 레코드인 이유는 `seller-order-transitions.ts` 에 조건이 하나 더 생기면 **여기가
 * 컴파일로 막기** 때문이다. 안 그러면 새 조건은 이름 없는 거절이 되고, 화면은 그것을
 * 「알 수 없는 오류」로 그린다.
 */
const REQUIREMENT_FIELD: Readonly<Record<TransitionRequirement, string>> = {
  tracking: 'trackingNumber',
}

/** 같은 조건을, 화면과 나눠 쓰는 계약의 이름으로. 둘이 갈리면 컴파일이 멈춘다. */
const REQUIREMENT_NAME: Readonly<Record<TransitionRequirement, SellerOrderRequirement>> = {
  tracking: 'tracking',
}

/** 판단에 필요한 것만. 잠근 행에서 읽는다. */
interface LockedSellerOrder {
  readonly id: string
  readonly status: OrderStatus
  readonly trackingNumber: string | null
}

/** 「누구 것인가」를 답하는 데 필요한 열들. 소유권 매퍼가 읽는 것 그대로다. */
const ACCESS_SELECT = {
  id: true,
  sellerId: true,
  status: true,
  trackingNumber: true,
  seller: { select: sellerOwnershipSelect },
  order: { select: { user: { select: accountOwnershipSelect } } },
} as const

/** 전이를 일으킬 때 함께 적히는 것 — 누가, 왜. */
export interface TransitionCommand {
  readonly actor: SellerOrderActor
  /** 사람이 없는 전이(`SYSTEM`)는 `null` 이다. */
  readonly actorId: string | null
  readonly reason?: string | null
}

/**
 * 판매자 몫이 상태를 옮기는 **유일한 문** (TASK-0059 · 설계서 4장).
 *
 * 규칙 자체는 `seller-order-transitions.ts` 가 갖는다. 여기 있는 것은 그 규칙을
 * **데이터베이스에 적용하는 순서**다. 여섯 단계 중 어느 하나라도 자리를 바꾸면
 * 조용히 깨진다.
 *
 * ① **행 잠금이 먼저다.** 「읽고 → 판단하고 → 쓰는」 사이에 남이 끼어들면 같은 전이가
 *    두 번 반영되고, 이력이 두 줄이 되며, 그 두 줄은 사람이 보기 전까지 아무 경보도
 *    울리지 않는다 (F6). `PaymentService.lock()` 이 같은 이유로 한 문장짜리
 *    `SELECT … FOR UPDATE` 다.
 * ② 정의된 전이인가 ③ 이 주체가 지날 수 있는가 ④ 조건이 갖춰졌는가
 * ⑤ 상태 변경과 이력 기록이 **한 트랜잭션**이다. 갈리면 「어디로 갔는지 모르는 주문」이
 *    남고, 그것은 손으로 찾아야 하는 종류다.
 * ⑥ 알림은 **커밋한 뒤에** 나간다. 트랜잭션 안에서 발행하면 롤백된 전이의 알림이
 *    나가고, 그 메일은 되돌릴 수 없다.
 *
 * **`actor` 와 `RequestPrincipal` 은 다른 것이다.** 요청으로 들어온 사람이 그 주문의
 * 판 사람인지 산 사람인지는 **서비스가 확인해서 정한다** — 부르는 쪽이 자기 주체를
 * 주장하게 두면 구매자가 `SYSTEM` 을 주장할 수 있고, 그러면 결제로만 열리는
 * `PAYMENT_PENDING → PAID` 가 HTTP 로 열린다. 그래서 {@link transition} 은 절대
 * `SYSTEM` 을 만들지 않고, `SYSTEM` 은 {@link applyWithin} 을 부르는 서버 코드
 * (`OrderService.markPaid` · 예약 만료 스케줄러)에만 있다.
 */
@Injectable()
export class SellerOrderService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(SELLER_ORDER_EVENTS) private readonly events: SellerOrderEvents,
    @Inject(ORDER_CONFIRMED_EVENTS) private readonly confirmations: OrderConfirmedEvents,
  ) {}

  /**
   * 사람이 부르는 전이 (`POST /seller-orders/:id/transitions`).
   *
   * 트랜잭션은 **잠금부터 이력까지**만 감싼다. 소유권 확인은 그 앞이고 알림은 그
   * 뒤다 — 앞의 것은 잠금을 오래 쥐고 있을 이유가 없고, 뒤의 것은 커밋되지 않은
   * 사실을 밖에 알릴 이유가 없다.
   */
  async transition(
    principal: RequestPrincipal,
    sellerOrderId: string,
    input: SellerOrderTransitionRequest,
  ): Promise<SellerOrderTransitionResponse> {
    const actor = this.actorFor(principal, await this.access(sellerOrderId))
    const event = await this.prisma.$transaction((tx) =>
      this.applyWithin(tx, sellerOrderId, input.to, {
        actor,
        actorId: principal.userId,
        reason: input.reason ?? null,
      }),
    )

    await this.publish(event === null ? [] : [event])

    // 커밋 뒤에 다시 읽는다. 답의 `status` 와 버튼은 **지금** 사실이어야 하고,
    // 그 사이에 시뮬레이터가 한 칸 더 움직였을 수도 있다.
    const fresh = await this.access(sellerOrderId)

    return {
      id: fresh.id,
      status: fresh.status,
      changed: event !== null,
      actions: this.actionsOf(fresh, actor),
    }
  }

  /**
   * 지금 이 사람이 할 수 있는 것들 (`GET /seller-orders/:id/actions` · F7).
   *
   * **읽기가 아니라 쓰기 퍼미션을 요구한다** (컨트롤러). 이 답은 「무엇을 누를 수
   * 있나」이고, 누를 수 없는 사람에게 버튼 목록을 주면 그 목록이 거짓말이 된다.
   */
  async actions(
    principal: RequestPrincipal,
    sellerOrderId: string,
  ): Promise<SellerOrderActionsResponse> {
    const row = await this.access(sellerOrderId)

    return { status: row.status, actions: this.actionsOf(row, this.actorFor(principal, row)) }
  }

  /**
   * 부르는 쪽의 트랜잭션 **안에서** 도는 문.
   *
   * `markPaid` 와 예약 만료 스케줄러가 이것을 쓴다. 자기 트랜잭션을 여는 대신 남의
   * 것을 받는 이유는 그 둘이 **이미 트랜잭션 안**이기 때문이다 — PostgreSQL 에는
   * 중첩 트랜잭션이 없으므로, 여기서 새로 열면 결제 확정과 상태 전이가 **다른
   * 트랜잭션**이 되어 「재고는 팔렸는데 주문은 결제 대기」가 가능해진다.
   *
   * 돌려주는 것은 **알릴 거리**이고, 없으면 `null` 이다. 부르는 쪽이 커밋한 뒤에
   * {@link publish} 로 넘긴다.
   *
   * **멱등이다.** 이미 목표 상태면 아무것도 하지 않고 `null` 을 돌려준다 — 이력도
   * 늘지 않는다. 「정의되지 않은 전이」로 거절하면 재시도한 화면이 오류를 보는데,
   * 그 사람이 원한 결과는 **이미 이뤄져 있다**.
   */
  async applyWithin(
    tx: Tx,
    sellerOrderId: string,
    to: OrderStatus,
    command: TransitionCommand,
  ): Promise<SellerOrderStatusChanged | null> {
    const locked = await this.lock(tx, sellerOrderId)

    if (locked.status === to) return null

    const decision = transitionDecision({
      from: locked.status,
      to,
      actor: command.actor,
      hasTracking: locked.trackingNumber !== null,
    })

    if (decision.outcome === 'refused') throw refusal(decision.reason, locked.status, to)

    const now = this.clock.now()

    await tx.sellerOrder.update({
      where: { id: sellerOrderId },
      data: { status: to, updatedAt: now },
    })
    await tx.orderStatusHistory.create({
      data: {
        sellerOrderId,
        fromStatus: locked.status,
        toStatus: to,
        reason: command.reason ?? null,
        actor: command.actor,
        // 사람이 없는 전이는 사람을 지어내지 않는다. 비어 있는 편이 사실이다.
        actorId: command.actor === 'SYSTEM' ? null : command.actorId,
        createdAt: now,
      },
    })

    return { sellerOrderId, from: locked.status, to, actor: command.actor, occurredAt: now }
  }

  /**
   * 옮겨진 사실을 알린다 (⑥ · M13), 그리고 **확정이면 그 뒤를 잇는다** (M11 · M12).
   *
   * **커밋한 뒤에 부른다.** 트랜잭션 안에서 부르면 롤백된 전이의 알림이 나가고, 그
   * 메일은 되돌릴 수 없다. 지금 두 구현 다 아무것도 하지 않으며, 그것이 무엇을
   * 뜻하는지는 각각 `seller-order-events.ts` 와 `order-confirmed-events.ts` 에
   * 적혀 있다.
   *
   * **구매확정의 후속 이벤트가 여기 걸리는 것이 이 메서드의 두 번째 이유다**
   * (TASK-0064 F4). 확정은 수동(구매자)과 자동(D+7 스케줄러) 두 길로 오지만 **둘 다
   * 이 자리를 지난다** — 상태를 옮기는 문이 하나이고, 그 문이 돌려준 사실을 커밋 뒤에
   * 넘기는 곳도 하나이기 때문이다. 부르는 쪽마다 정산 등록을 끼워 넣게 두면 「구매자가
   * 누른 확정에만 적립금이 붙는」 종류의 어긋남이 생기고, 그것은 한쪽 길을 실제로
   * 걸어 본 사람만 발견한다.
   *
   * 중복 발행은 문이 막는다. 이미 `CONFIRMED` 인 몫에 {@link applyWithin} 은
   * `null` 을 주므로 여기 목록에 들어오지 않는다 (F7 · R2).
   */
  async publish(events: readonly SellerOrderStatusChanged[]): Promise<void> {
    if (events.length === 0) return

    await this.events.statusChanged(events)

    const confirmed = confirmationsOf(events)

    if (confirmed.length > 0) await this.confirmations.confirmed(confirmed)
  }

  // ---------------------------------------------------------------- internals

  /**
   * 행의 잠금을 잡고 그 줄을 읽는다.
   *
   * **한 문장이다.** 읽는 것이 잠근 그 행의 컬럼뿐이라, 잠금을 기다린
   * `SELECT … FOR UPDATE` 는 앞사람이 커밋한 값을 다시 읽는다 — 다른 표를 함께
   * 읽었다면 부질의가 시작할 때의 스냅샷을 들고 와, 기다린 보람 없이 **낡은 상태로**
   * 판단하게 된다 (`PaymentService.lock` 이 같은 이유로 같은 모양이다).
   */
  private async lock(tx: Tx, sellerOrderId: string): Promise<LockedSellerOrder> {
    const rows = await tx.$queryRaw<readonly LockedSellerOrder[]>`
      SELECT "id", "status"::text AS "status", "trackingNumber"
        FROM "SellerOrder"
       WHERE "id" = ${sellerOrderId}::uuid
       FOR UPDATE
    `
    const [row] = rows

    if (row === undefined) throw new NotFoundException('주문을 찾을 수 없어요.')

    return row
  }

  /** 소유권 판단에 필요한 만큼 읽는다. 잠그기 전의 읽기다. */
  private async access(sellerOrderId: string) {
    const row = await this.prisma.sellerOrder.findUnique({
      where: { id: sellerOrderId },
      select: ACCESS_SELECT,
    })

    if (row === null) throw new NotFoundException('주문을 찾을 수 없어요.')

    return row
  }

  /**
   * 이 요청을 보낸 사람은 이 몫의 **무엇**인가 (③ 의 앞 절반).
   *
   * 순서가 곧 규칙이다. 판 사람이 먼저인 이유는 자기 가게에서 자기가 산 경우 때문이다
   * — 그때도 발송을 하는 것은 판매자로서이고, 구매확정을 하는 것은 구매자로서다. 두
   * 자격을 다 가진 사람에게 하나를 골라 줘야 하며, 이 몫의 주인은 판 사람이다.
   *
   * 마지막 갈래에 `ADMIN` 이 오는 것은 「나머지 전부」가 아니다 — 바로 아래
   * {@link assertResourceAccess} 가 **전부에 닿는 권한**을 요구하므로, 아무것도 아닌
   * 사람은 여기서 403 으로 끝난다.
   */
  private actorFor(
    principal: RequestPrincipal,
    row: {
      readonly sellerId: string
      readonly seller: SellerRow
      readonly order: { readonly user: AccountRow }
    },
  ): SellerOrderActor {
    if (principal.sellerId !== null && principal.sellerId === row.sellerId) {
      assertResourceAccess(principal, 'order.write', sellerOwnership(row.seller))

      return 'SELLER'
    }

    if (principal.userId === row.order.user.id) {
      assertResourceAccess(principal, 'order.write', accountOwnership(row.order.user))

      return 'BUYER'
    }

    assertResourceAccess(principal, 'order.write', sellerOwnership(row.seller))

    return 'ADMIN'
  }

  /**
   * 이 상태에서 이 주체가 볼 버튼들.
   *
   * `enabled` 를 손으로 계산하지 않고 {@link transitionDecision} 에 묻는 이유는, 두
   * 곳이 조건을 따로 판단하면 **버튼은 켜져 있는데 눌리지 않는** 날이 오기 때문이다.
   */
  private actionsOf(
    row: { readonly status: OrderStatus; readonly trackingNumber: string | null },
    actor: SellerOrderActor,
  ): SellerOrderAction[] {
    return availableTransitions(row.status, actor).map((rule) => ({
      to: rule.to,
      enabled:
        transitionDecision({
          from: row.status,
          to: rule.to,
          actor,
          hasTracking: row.trackingNumber !== null,
        }).outcome === 'allowed',
      blockedBy: rule.requires === undefined ? null : REQUIREMENT_NAME[rule.requires],
    }))
  }
}

/**
 * 거절 셋을 **서로 다른 답**으로 옮긴다.
 *
 * 하나로 묶지 않는 이유는 부르는 쪽이 할 일이 다르기 때문이다 — 정의되지 않은 전이는
 * 고쳐도 안 되고(다시 읽어야 한다), 권한이 없는 것은 다른 사람이면 되며, **조건이
 * 모자란 것은 그 조건을 채우면 된다.** 마지막만이 화면이 「운송장을 입력해 주세요」로
 * 바꿔 말할 수 있는 거절이라, 그것이 `details` 에 입력 이름을 달고 나간다.
 */
function refusal(reason: TransitionRefusal, from: OrderStatus, to: OrderStatus): HttpException {
  const params = { from, to }

  switch (reason) {
    case 'undefined_transition':
      return new ConflictException(
        domainFailure('ORDER_TRANSITION_UNDEFINED', '지금 상태에서는 할 수 없는 요청이에요.', {
          field: 'to',
          params,
        }),
      )
    case 'actor_forbidden':
      return new ForbiddenException(
        domainFailure('ORDER_TRANSITION_FORBIDDEN', '이 주문을 그렇게 바꿀 수 없어요.', {
          field: 'to',
          params,
        }),
      )
    case 'requirement_unmet': {
      // 조건이 모자랐다는 것은 규칙이 있었고 그 규칙에 `requires` 가 있었다는 뜻이다 —
      // 없으면 이 거절 자체가 나오지 않는다. 컴파일러에게는 그것이 보이지 않으므로
      // 기본값을 주되, 조건이 늘면 `REQUIREMENT_FIELD` 가 컴파일로 막는다.
      const requires: TransitionRequirement = ruleFor(from, to)?.requires ?? 'tracking'

      return new ConflictException(
        domainFailure('ORDER_TRANSITION_REQUIREMENT', '먼저 채워야 할 것이 있어요.', {
          field: REQUIREMENT_FIELD[requires],
          params,
        }),
      )
    }
  }
}
