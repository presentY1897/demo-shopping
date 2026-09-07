import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import type { Prisma, SettlementStatus as DbSettlementStatus } from '@prisma/client'
import type {
  BulkApproveSettlementsResponse,
  Settlement,
  SettlementApprovalFailure,
  SettlementDetailResponse,
  SettlementItem,
  SettlementListQueryParams,
  SettlementListResponse,
} from '@shopping/shared'
import { platformOwnership, SETTLEMENT_LIST_DEFAULT_LIMIT } from '@shopping/shared'

import { assertResourceAccess } from '../auth/access-denied.js'
import type { RequestPrincipal } from '../auth/request-principal.js'
import { sellerOwnership, sellerOwnershipSelect } from '../auth/resource-ownership.js'
import type { Clock } from '../common/clock.js'
import { CLOCK } from '../common/clock.js'
import { domainFailure } from '../common/domain-failure.js'
import { NotificationService } from '../notifications/notification.service.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { sourcesOf } from './settlement-transitions.js'

const SETTLEMENT_SELECT = {
  id: true,
  sellerId: true,
  periodStart: true,
  periodEnd: true,
  status: true,
  salesAmount: true,
  commissionAmount: true,
  sellerCouponAmount: true,
  returnAdjustmentAmount: true,
  payoutAmount: true,
  holdReason: true,
  heldAt: true,
  approvedAt: true,
  paidAt: true,
  createdAt: true,
  seller: { select: { brandName: true } },
} satisfies Prisma.SettlementSelect

type SettlementRow = Prisma.SettlementGetPayload<{ select: typeof SETTLEMENT_SELECT }>

function toSettlement(row: SettlementRow): Settlement {
  return {
    id: row.id,
    sellerId: row.sellerId,
    brandName: row.seller.brandName,
    periodStart: row.periodStart.toISOString(),
    periodEnd: row.periodEnd.toISOString(),
    status: row.status,
    salesAmount: row.salesAmount,
    commissionAmount: row.commissionAmount,
    sellerCouponAmount: row.sellerCouponAmount,
    returnAdjustmentAmount: row.returnAdjustmentAmount,
    payoutAmount: row.payoutAmount,
    holdReason: row.holdReason,
    heldAt: row.heldAt?.toISOString() ?? null,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    paidAt: row.paidAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }
}

const ITEM_SELECT = {
  id: true,
  type: true,
  sellerOrderId: true,
  salesAmount: true,
  commissionAmount: true,
  sellerCouponAmount: true,
  payoutAmount: true,
  createdAt: true,
  sellerOrder: { select: { order: { select: { orderNumber: true } } } },
} satisfies Prisma.SettlementItemSelect

type ItemRow = Prisma.SettlementItemGetPayload<{ select: typeof ITEM_SELECT }>

function toItem(row: ItemRow): SettlementItem {
  return {
    id: row.id,
    type: row.type,
    sellerOrderId: row.sellerOrderId,
    orderNumber: row.sellerOrder.order.orderNumber,
    salesAmount: row.salesAmount,
    commissionAmount: row.commissionAmount,
    sellerCouponAmount: row.sellerCouponAmount,
    payoutAmount: row.payoutAmount,
    createdAt: row.createdAt.toISOString(),
  }
}

/**
 * 관리자의 정산 검토 (TASK-0081).
 *
 * ## 상태를 옮기는 일은 **한 문장**이다
 *
 * 「지금 상태를 읽고 → 옮겨도 되는지 보고 → 쓴다」로 나누면 그 사이에 남이 끼어들
 * 수 있고, 그때 일어나는 일이 **같은 정산서를 두 번 지급**하는 것이다. 판단이 그 행
 * 안에서 끝나므로(TASK-0065 4.1 의 기준) 잠그지 않고 조건부 갱신으로 옮긴다 — 옮길
 * 수 있는 출발 상태의 목록은 전이표가 준다.
 *
 * ## 세 문이 같은 모양인 이유
 *
 * 승인 · 보류 · 지급은 「어느 상태에서 어느 상태로, 무엇을 함께 적으며」만 다르다.
 * 한 함수가 그 셋을 받는 것이 **전이표를 우회하는 길을 하나도 만들지 않는** 방법이다.
 */
@Injectable()
export class SettlementConsoleService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly notifications: NotificationService,
  ) {}

  /**
   * 정산서 목록과 **필터 전체의 합계**.
   *
   * 스토어를 지정하지 않은 조회는 플랫폼 전체를 보는 일이라 `any` 가 필요하다.
   * 판매자는 자기 스토어를 지정해야 목록을 볼 수 있고, 그것이 남의 정산액을 못 보는
   * 자리다 (`coupon-console.service.ts` 가 같은 모양이다).
   */
  async list(
    principal: RequestPrincipal,
    params: SettlementListQueryParams,
  ): Promise<SettlementListResponse> {
    await this.assertMayRead(principal, params.sellerId)

    const where = this.whereOf(params)
    const limit = params.limit ?? SETTLEMENT_LIST_DEFAULT_LIMIT
    const [rows, totals] = await Promise.all([
      this.prisma.settlement.findMany({
        where,
        // 정렬 축이 `id` 인 것은 그것이 UUIDv7 이라 시간순이기 때문이다. `createdAt`
        // 으로 정렬하면 같은 밀리초에 만들어진 두 정산서에서 커서가 한 건을
        // 건너뛰거나 두 번 보여 준다 (`coupons.ts` 가 같은 이유로 같은 축을 쓴다).
        orderBy: { id: 'desc' },
        take: limit + 1,
        ...(params.cursor === undefined ? {} : { cursor: { id: params.cursor }, skip: 1 }),
        select: SETTLEMENT_SELECT,
      }),
      // **페이지가 아니라 필터의 합이다.** 페이지 합으로 답하면 다음 장을 넘길 때마다
      // 총액이 달라지고, 그 숫자를 보고 지급을 결정하는 사람에게 그것은 답이 아니다.
      this.prisma.settlement.aggregate({ where, _count: true, _sum: { payoutAmount: true } }),
    ])
    const page = rows.slice(0, limit)

    return {
      settlements: page.map(toSettlement),
      nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
      totals: { count: totals._count, payoutAmount: totals._sum.payoutAmount ?? 0 },
    }
  }

  /** 계산 근거를 항목별로 펼친다 (F1 · F2). */
  async detail(principal: RequestPrincipal, id: string): Promise<SettlementDetailResponse> {
    const settlement = await this.load(id)

    await this.assertMayRead(principal, settlement.sellerId)

    const items = await this.prisma.settlementItem.findMany({
      where: { settlementId: id },
      // 판매 줄이 먼저, 그다음 차감. 그 안에서는 만들어진 순서다 — 정산서를 읽는
      // 사람은 「이번에 판 것」을 먼저 보고 「지난번에서 빠진 것」을 나중에 본다.
      orderBy: [{ type: 'asc' }, { createdAt: 'asc' }],
      select: ITEM_SELECT,
    })

    return { settlement: toSettlement(settlement), items: items.map(toItem) }
  }

  /** 승인한다 (F3). 대기와 보류에서 온다. */
  async approve(actorId: string, id: string): Promise<Settlement> {
    const now = this.clock.now()

    return this.move(id, 'APPROVED', { approvedAt: now, approvedById: actorId })
  }

  /**
   * 분쟁·이상 건으로 보류한다 (F4).
   *
   * 사유가 비어 있을 수 없다는 것은 계약이 이미 거절하고
   * (`holdSettlementRequestSchema`), `Settlement_holdReason_check` 가 그 뒤를
   * 받친다 — 공백만 적고 넘어갈 수 있으면 「사유를 입력해야 한다」는 화면의 예의이지
   * 규칙이 아니게 된다.
   */
  async hold(actorId: string, id: string, reason: string): Promise<Settlement> {
    const now = this.clock.now()

    return this.move(id, 'HOLD', { heldAt: now, heldById: actorId, holdReason: reason })
  }

  /**
   * 지급 완료로 옮긴다 (F5). **실제 이체는 없다** — 상태만 바뀐다.
   *
   * 여기서 나가는 화살표가 없는 것이 F5 의 전부다. 「지급완료된 정산서는 수정할 수
   * 없다」는 이 서비스의 조건문이 아니라 전이표의 빈 배열이 만든다.
   */
  async pay(actorId: string, id: string): Promise<Settlement> {
    const now = this.clock.now()

    return this.move(id, 'PAID', { paidAt: now, paidById: actorId })
  }

  /**
   * 한꺼번에 승인한다 (F6).
   *
   * **실패한 것을 조용히 빼지 않는다.** 「10건 골랐는데 8건이 승인됐다」를 화면이
   * 말하지 못하면 남은 2건은 아무도 다시 보지 않고, 그 2건이야말로 사람이 봐야 하는
   * 것들이다.
   *
   * 한 건씩 옮기는 이유는 한 건의 거절이 나머지를 되돌리지 않게 하기 위해서다 —
   * 한 트랜잭션에 넣으면 지급완료된 한 장이 섞였을 때 아홉 장의 승인이 함께 사라진다.
   */
  async bulkApprove(
    actorId: string,
    ids: readonly string[],
  ): Promise<BulkApproveSettlementsResponse> {
    const approved: string[] = []
    const failed: { id: string; reason: SettlementApprovalFailure }[] = []

    for (const id of ids) {
      const reason = await this.tryApprove(actorId, id)

      if (reason === null) approved.push(id)
      else failed.push({ id, reason })
    }

    return { approved, failed }
  }

  /** 한 장을 승인해 보고 **왜 안 됐는지**를 돌려준다. 던지지 않는다. */
  private async tryApprove(actorId: string, id: string): Promise<SettlementApprovalFailure | null> {
    const now = this.clock.now()
    const moved = await this.prisma.settlement.updateMany({
      where: { id, status: { in: [...sourcesOf('APPROVED')] } },
      data: { approvedAt: now, approvedById: actorId, status: 'APPROVED' },
    })

    if (moved.count > 0) return null

    const held = await this.prisma.settlement.findUnique({ where: { id }, select: { id: true } })

    return held === null ? 'not_found' : 'wrong_status'
  }

  /**
   * 상태를 **한 문장으로** 옮긴다.
   *
   * 옮길 수 있는 출발 상태의 목록은 전이표가 준다 — 여기 적으면 표와 조용히
   * 어긋나고, 어긋난 쪽이 이기는 것은 언제나 코드다.
   */
  private async move(
    id: string,
    to: DbSettlementStatus,
    data: Prisma.SettlementUncheckedUpdateManyInput,
  ): Promise<Settlement> {
    const moved = await this.prisma.settlement.updateMany({
      where: { id, status: { in: [...sourcesOf(to)] } },
      data: { ...data, status: to },
    })

    if (moved.count === 0) {
      const settlement = await this.load(id)

      throw new ConflictException(
        domainFailure(
          'SETTLEMENT_WRONG_STATUS',
          `지금 상태(${settlement.status})에서는 할 수 없는 처리예요.`,
        ),
      )
    }

    const settlement = toSettlement(await this.load(id))

    // 판매자에게 알린다 (TASK-0090 F7). **보류는 알리지 않는다** — 그것은 아직
    // 판단이 끝나지 않았다는 뜻이고, 「정산이 멈췄다」를 사유 없이 통보하면 판매자가
    // 할 수 있는 일이 없다. 승인·지급은 끝난 사실이다.
    if (to !== 'HOLD') void this.notifySeller(settlement, to)

    return settlement
  }

  /** 정산서가 승인·지급됐다는 사실 하나. 기다리지 않는다. */
  private async notifySeller(settlement: Settlement, to: DbSettlementStatus): Promise<void> {
    const seller = await this.prisma.seller.findUnique({
      where: { id: settlement.sellerId },
      select: { userId: true },
    })

    if (seller === null) return

    const paid = to === 'PAID'

    await this.notifications.send({
      userId: seller.userId,
      type: 'SELLER_SETTLEMENT',
      title: paid ? '정산금이 지급됐어요' : '정산서가 승인됐어요',
      body: `${settlement.payoutAmount.toLocaleString('ko-KR')}원`,
      link: `/settlements/${settlement.id}`,
    })
  }

  private async load(id: string): Promise<SettlementRow> {
    const settlement = await this.prisma.settlement.findUnique({
      where: { id },
      select: SETTLEMENT_SELECT,
    })

    if (settlement === null) throw new NotFoundException('정산서를 찾을 수 없어요.')

    return settlement
  }

  /**
   * 이 사람이 이 목록을 볼 수 있는가.
   *
   * 스토어를 지정하지 않은 조회는 **플랫폼 전체**를 보는 일이다. `platformOwnership`
   * 은 아무도 소유하지 않으므로 `any` 말고는 어떤 스코프도 닿지 않는다.
   */
  private async assertMayRead(
    principal: RequestPrincipal,
    sellerId: string | undefined,
  ): Promise<void> {
    if (sellerId === undefined) {
      assertResourceAccess(principal, 'settlement.read', platformOwnership)

      return
    }

    const seller = await this.prisma.seller.findUnique({
      where: { id: sellerId },
      select: sellerOwnershipSelect,
    })

    if (seller === null) throw new NotFoundException('판매자를 찾을 수 없어요.')

    assertResourceAccess(principal, 'settlement.read', sellerOwnership(seller))
  }

  private whereOf(params: SettlementListQueryParams): Prisma.SettlementWhereInput {
    const where: Prisma.SettlementWhereInput = {}

    if (params.status !== undefined) where.status = { in: params.status }
    if (params.sellerId !== undefined) where.sellerId = params.sellerId
    if (params.periodStart !== undefined) where.periodStart = new Date(params.periodStart)

    return where
  }
}
