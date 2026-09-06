import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import type {
  CommissionRate,
  CommissionRateListQueryParams,
  CommissionRateListResponse,
  CommissionSimulationQueryParams,
  CommissionSimulationResponse,
  SetCommissionRateRequest,
} from '@shopping/shared'
import { COMMISSION_SIMULATION_DAYS } from '@shopping/shared'

import type { Clock } from '../common/clock.js'
import { CLOCK } from '../common/clock.js'
import { PrismaService } from '../prisma/prisma.service.js'
import type { CommissionRateRow, CommissionSubject } from './commission-rate.js'
import {
  categoryPathIds,
  commissionOf,
  DEFAULT_COMMISSION_RATE_BP,
  resolveCommission,
  sameScope,
  scopeOf,
} from './commission-rate.js'

type Tx = Prisma.TransactionClient

/** 하루를 밀리초로. 시뮬레이션이 돌아볼 기간을 셀 때 쓴다. */
const DAY_MS = 24 * 60 * 60 * 1_000

const RATE_SELECT = {
  id: true,
  sellerId: true,
  categoryId: true,
  rateBp: true,
  validFrom: true,
  validUntil: true,
  createdAt: true,
  createdBy: { select: { id: true, email: true } },
} satisfies Prisma.CommissionRateSelect

type RateRow = Prisma.CommissionRateGetPayload<{ select: typeof RATE_SELECT }>

function toCommissionRate(row: RateRow): CommissionRate {
  return {
    id: row.id,
    sellerId: row.sellerId,
    categoryId: row.categoryId,
    scope: scopeOf(row),
    rateBp: row.rateBp,
    validFrom: row.validFrom.toISOString(),
    validUntil: row.validUntil?.toISOString() ?? null,
    createdBy: { id: row.createdBy.id, email: row.createdBy.email },
    createdAt: row.createdAt.toISOString(),
  }
}

/** 한 줄의 주문 항목이 요율에게 묻는 것 — 누가 파는가, 무엇을 파는가. */
export interface CommissionLine {
  readonly sellerId: string
  /** `/1/5/12/` 꼴의 저장된 경로. */
  readonly categoryPath: string
}

/** 저장된 경로를 요율 규칙이 읽는 모양으로. */
function subjectOf(line: CommissionLine): CommissionSubject {
  return { sellerId: line.sellerId, categoryPath: categoryPathIds(line.categoryPath) }
}

/**
 * 수수료율 (TASK-0079).
 *
 * ## 요율을 바꾸는 것은 행을 고치는 일이 아니다
 *
 * 열린 행(`validUntil` 이 비어 있는 행)을 닫고 새 행을 연다. 그래서 **이력이 따로
 * 만들어야 할 것이 아니라** 이 표를 시간순으로 읽은 결과이고, 「누가 언제 몇 퍼센트로
 * 바꿨나」(F5)가 저장 구조에서 그냥 나온다.
 *
 * ## 이미 판 것에는 소급되지 않는다
 *
 * 주문 시점의 요율이 항목에 박히므로(F4, {@link snapshotFor}) 정산은 이 표를 보지
 * 않는다. 그래서 요율을 올려도 어제 판 것의 수수료는 그대로다 — **계약은 판매
 * 시점에 성립한다.**
 *
 * 미리보기(F6)가 「과거 주문이 이렇게 바뀝니다」가 아니라 「앞으로 이렇게
 * 달라집니다」인 것도 같은 이유다.
 */
@Injectable()
export class CommissionService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * 지금 유효한 요율들, 또는 **한 범위의** 이력 (F5).
   *
   * 이력은 언제나 한 범위에 대한 것이다. 표 전체를 시간순으로 늘어놓은 화면은 읽을 수
   * 없는 목록이고, 「누가 언제 무엇을 바꿨나」에 답하려는 사람은 이미 어느 요율을
   * 보고 있는지 알고 있다.
   *
   * 범위를 하나도 주지 않은 이력 요청은 **전역 요율의 이력**이다 — 전역은 「스토어도
   * 카테고리도 아닌 자리」라, 그것을 가리키는 방법이 빈칸 말고는 없다.
   */
  async list(params: CommissionRateListQueryParams): Promise<CommissionRateListResponse> {
    const rows = await this.prisma.commissionRate.findMany({
      where: this.listWhere(params),
      // 이력은 최근 것이 위다. 열린 행은 그 범위에서 언제나 첫 줄이 된다.
      orderBy: [{ validFrom: 'desc' }, { createdAt: 'desc' }],
      select: RATE_SELECT,
    })

    return { rates: rows.map(toCommissionRate), fallbackRateBp: DEFAULT_COMMISSION_RATE_BP }
  }

  /**
   * 한 범위의 요율을 바꾼다 (F7 은 이 문 앞의 퍼미션이 지킨다).
   *
   * ## 잠금을 쓰는 이유
   *
   * 판단이 **그 행 안에서 끝나지 않는다** (TASK-0065 4.1 의 기준). 「이 범위에 열린
   * 행이 있으면 닫고 없으면 그냥 넣는다」는 없는 행에 대한 판단을 포함하고, 조건부
   * 갱신은 없는 행을 잠글 수 없다. 잠그지 않으면 두 관리자가 동시에 바꿀 때 둘 다
   * 「열린 행이 없다」를 읽고 둘 다 넣는다.
   *
   * 마지막 방어선은 `CommissionRate_open_*_key` 세 인덱스다 — 잠금을 안 거는 코드가
   * 하나 생기는 날 「지금 요율」이 두 개가 되는 것을 DB 가 막는다.
   *
   * ## 같은 값으로 바꾸는 것은 바꾸는 것이 아니다
   *
   * 이력이 똑같은 줄로 채워지면 **정말 바뀐 날을 찾을 수 없게 된다**. 열려 있는 행과
   * 요율이 같으면 아무것도 하지 않고 그 행을 그대로 돌려준다.
   */
  async set(actorId: string, request: SetCommissionRateRequest): Promise<CommissionRate> {
    await this.assertScopeExists(request)
    const now = this.clock.now()

    return this.prisma.$transaction(async (tx) => {
      await this.lockScope(tx, request)

      const open = await tx.commissionRate.findFirst({
        where: { sellerId: request.sellerId, categoryId: request.categoryId, validUntil: null },
        select: RATE_SELECT,
      })

      if (open !== null) {
        if (open.rateBp === request.rateBp) return toCommissionRate(open)

        // **한 순간 안에서의 재수정은 이력이 아니다.** 열린 행이 바로 이 순간에
        // 열렸다면 그 행은 어느 시점에도 적용된 적이 없고, 닫아서 남기면 길이가 0인
        // 기간이 이력에 낀다 — `CommissionRate_period_check` 가 그런 행을 거절하는
        // 것도 같은 이유다. 고쳐 쓴다.
        if (open.validFrom.getTime() === now.getTime()) {
          const amended = await tx.commissionRate.update({
            where: { id: open.id },
            data: { rateBp: request.rateBp, createdById: actorId },
            select: RATE_SELECT,
          })

          return toCommissionRate(amended)
        }

        await tx.commissionRate.update({ where: { id: open.id }, data: { validUntil: now } })
      }

      const created = await tx.commissionRate.create({
        data: {
          sellerId: request.sellerId,
          categoryId: request.categoryId,
          rateBp: request.rateBp,
          validFrom: now,
          validUntil: null,
          createdById: actorId,
        },
        select: RATE_SELECT,
      })

      return toCommissionRate(created)
    })
  }

  /**
   * **주문 시점의 요율을 결정할 준비를 한다** (F4).
   *
   * 돌려주는 것은 표가 아니라 **함수**다. 표로 돌려주면 「이 줄이 표에 없으면?」이라는
   * 답할 수 없는 갈래가 부르는 쪽에 생기고, 그 갈래가 조용히 `NULL` 을 적으면 그
   * 항목은 「이 칸이 생기기 전 주문」으로 읽혀 전역 기본율로 정산된다 — 거짓말이
   * 데이터에 남는다. 함수는 어떤 줄을 받아도 답을 갖는다.
   *
   * 계산을 트랜잭션 밖에서 준비하는 이유는 주문 생성이 분기 커버리지 100% 를
   * 요구받기 때문이다 (TASK-0049 6.2) — 저쪽에는 판단이 남지 않는다.
   *
   * 읽어 오는 요율을 **이 주문에 관계된 것으로 좁힌다.** 표 전체를 읽어도 답은 같지만,
   * 스토어가 늘어날수록 주문 한 건이 읽는 양이 함께 늘어난다.
   */
  async snapshotFor(
    tx: Tx,
    lines: readonly CommissionLine[],
  ): Promise<(line: CommissionLine) => number> {
    const rates = await this.openRatesFor(tx, lines.map(subjectOf))

    return (line) => resolveCommission(subjectOf(line), rates).rateBp
  }

  /**
   * 이 요율로 바꾸면 얼마가 달라지나 (F6).
   *
   * ## 무엇을 세는가
   *
   * 지난 {@link COMMISSION_SIMULATION_DAYS} 일 동안 팔린 항목 중 **바뀔 요율이 실제로
   * 적용될 것들**만 센다. 판매자 개별율이 이미 이기고 있는 항목은 카테고리 요율을
   * 바꿔도 아무 영향을 받지 않고, 더 깊은 카테고리에 따로 걸린 요율이 있는 항목도
   * 마찬가지다 — 그것들을 합에 넣으면 **미리보기가 영향을 부풀린다.**
   *
   * 판정은 요율 결정 규칙을 그대로 다시 돌려서 한다. 「어느 항목이 영향을 받나」를
   * 여기서 따로 적으면 그 규칙이 두 벌이 되고, 두 벌은 갈라진다.
   *
   * ## 취소된 몫은 빼고 센다
   *
   * 추정의 근거가 「지난 30일에 실제로 팔린 것」이라, 결제에 실패했거나 취소된 몫은
   * 판매가 아니다.
   */
  async simulate(params: CommissionSimulationQueryParams): Promise<CommissionSimulationResponse> {
    const target: CommissionRateRow = {
      sellerId: params.sellerId ?? null,
      categoryId: params.categoryId ?? null,
      rateBp: params.rateBp,
    }
    const since = new Date(this.clock.now().getTime() - COMMISSION_SIMULATION_DAYS * DAY_MS)
    const sold = await this.soldSince(since, target)
    const current = await this.openRatesFor(this.prisma, sold)
    // 바뀐 뒤의 세상 — 같은 자리의 행을 새 것으로 갈아 끼운다.
    const proposed = [target, ...current.filter((rate) => !sameScope(rate, target))]

    let salesAmount = 0
    let currentAmount = 0
    let proposedAmount = 0
    const sellerOrders = new Set<string>()

    for (const item of sold) {
      // 바뀐 뒤에 **이 행이 이기는** 항목만 영향을 받는다.
      if (resolveCommission(item, proposed).matched !== target) continue

      salesAmount += item.productAmount
      currentAmount += commissionOf(item.productAmount, resolveCommission(item, current).rateBp)
      proposedAmount += commissionOf(item.productAmount, params.rateBp)
      sellerOrders.add(item.sellerOrderId)
    }

    return { salesAmount, currentAmount, proposedAmount, sellerOrderCount: sellerOrders.size }
  }

  /** 요율이 걸릴 대상이 실재하는가. 없는 스토어의 요율은 아무 일도 하지 않는다. */
  private async assertScopeExists(request: SetCommissionRateRequest): Promise<void> {
    if (request.sellerId !== null) {
      const seller = await this.prisma.seller.findUnique({
        where: { id: request.sellerId },
        select: { id: true },
      })

      if (seller === null) throw new NotFoundException('판매자를 찾을 수 없어요.')
    }

    if (request.categoryId !== null) {
      const category = await this.prisma.category.findUnique({
        where: { id: request.categoryId },
        select: { id: true },
      })

      if (category === null) throw new NotFoundException('카테고리를 찾을 수 없어요.')
    }
  }

  /**
   * 이 범위를 이 트랜잭션이 끝날 때까지 혼자 만진다.
   *
   * 자문 잠금(advisory lock)은 **행이 아니라 이름을 잠근다.** 여기서 필요한 것이
   * 정확히 그것이다 — 잠글 행이 아직 없을 수도 있기 때문이다.
   */
  private async lockScope(tx: Tx, scope: CommissionRateRow): Promise<void> {
    const key = `commission:${scope.sellerId ?? ''}:${scope.categoryId ?? ''}`

    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`
  }

  /**
   * 목록·이력이 범위를 좁히는 조건.
   *
   * 두 물음이 **다른 모양**이라 한 함수가 갈린다. 목록은 「지금 열려 있는 것 전부」에
   * 범위를 선택적으로 걸고, 이력은 「이 범위의 지나온 것 전부」다 — 뒤엣것에서
   * 빈칸은 「아무 데나」가 아니라 **전역**을 가리킨다.
   */
  private listWhere(params: CommissionRateListQueryParams): Prisma.CommissionRateWhereInput {
    if (params.history === true) {
      return { sellerId: params.sellerId ?? null, categoryId: params.categoryId ?? null }
    }

    const where: Prisma.CommissionRateWhereInput = { validUntil: null }

    if (params.sellerId !== undefined) where.sellerId = params.sellerId
    if (params.categoryId !== undefined) where.categoryId = params.categoryId

    return where
  }

  /** 이 항목들에 닿을 수 있는 열린 요율 전부 — 스토어·경로 위의 카테고리·전역. */
  private async openRatesFor(
    tx: Tx | PrismaService,
    subjects: readonly CommissionSubject[],
  ): Promise<readonly CommissionRateRow[]> {
    const sellerIds = [...new Set(subjects.map((subject) => subject.sellerId))]
    const categoryIds = [...new Set(subjects.flatMap((subject) => subject.categoryPath))]

    return tx.commissionRate.findMany({
      where: {
        validUntil: null,
        OR: [
          { sellerId: { in: sellerIds } },
          { categoryId: { in: categoryIds } },
          { sellerId: null, categoryId: null },
        ],
      },
      select: { sellerId: true, categoryId: true, rateBp: true },
    })
  }

  /**
   * 지난 기간에 팔린 항목들 — 판매자, 카테고리 경로, 금액.
   *
   * 범위를 SQL 에서 미리 좁히는 이유는 **읽어 오는 양** 때문이다. 한 스토어의 요율을
   * 바꾸는데 플랫폼 전체의 30일치를 메모리에 올릴 이유가 없다. 좁힌 뒤의 판정은
   * 그대로 요율 결정 규칙이 한다.
   */
  private async soldSince(since: Date, target: CommissionRateRow): Promise<readonly SoldItem[]> {
    const rows = await this.prisma.$queryRaw<SoldRow[]>`
      SELECT so."id"::text            AS "sellerOrderId",
             so."sellerId"::text      AS "sellerId",
             c."path"                 AS "categoryPath",
             oi."productAmount"       AS "productAmount"
        FROM "OrderItem" oi
        JOIN "SellerOrder" so    ON so."id" = oi."sellerOrderId"
        JOIN "ProductVariant" pv ON pv."id" = oi."variantId"
        JOIN "Product" p         ON p."id" = pv."productId"
        JOIN "Category" c        ON c."id" = p."categoryId"
       WHERE so."createdAt" >= ${since}
         AND so."status" NOT IN ('PAYMENT_PENDING', 'PAYMENT_FAILED', 'CANCELED')
         AND (${target.sellerId}::uuid IS NULL OR so."sellerId" = ${target.sellerId}::uuid)
         AND (${target.categoryId}::int IS NULL OR c."path" LIKE '%/' || ${target.categoryId}::text || '/%')`

    return rows.map((row) => ({
      sellerOrderId: row.sellerOrderId,
      sellerId: row.sellerId,
      categoryPath: categoryPathIds(row.categoryPath),
      productAmount: row.productAmount,
    }))
  }
}

/** 시뮬레이션이 SQL 에서 받아 오는 한 줄. */
interface SoldRow {
  readonly sellerOrderId: string
  readonly sellerId: string
  readonly categoryPath: string
  readonly productAmount: number
}

/** 요율 결정에 넣을 수 있는 모양으로 옮긴 한 줄. */
interface SoldItem extends CommissionSubject {
  readonly sellerOrderId: string
  readonly productAmount: number
}
