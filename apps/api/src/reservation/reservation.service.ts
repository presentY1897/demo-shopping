import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import type { Prisma, ReservationStatus } from '@prisma/client'
import type { StockLedgerEntry } from '@shopping/shared'

import type { Clock } from '../common/clock.js'
import { CLOCK } from '../common/clock.js'
import { domainFailure } from '../common/domain-failure.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { StockService } from '../stock/stock.service.js'
import { availableStock, expiryFrom, RESERVATION_TTL_MS, settlement } from './reservation-rules.js'

/** The transaction handle Prisma hands an interactive transaction. */
type Tx = Prisma.TransactionClient

/** 한 건의 예약 요청. */
export interface ReserveInput {
  readonly variantId: string
  readonly quantity: number
  /** 누가 잡았는가. 예약은 계정에 속한다 — 4.1. */
  readonly userId: string
  /** 어느 주문서 시도인가. 이탈·실패는 이것으로 한꺼번에 푼다 — 4.1. */
  readonly checkoutId: string
  /** 기본값은 {@link RESERVATION_TTL_MS}. 테스트가 15분을 기다리지 않게 열어 둔다. */
  readonly ttlMs?: number
}

/** 잡힌 예약 한 건, 부르는 쪽이 알아야 하는 만큼. */
export interface Reservation {
  readonly id: string
  readonly variantId: string
  readonly quantity: number
  readonly status: ReservationStatus
  readonly expiresAt: Date
}

/** 확정의 결과. `entry` 가 `null` 이면 이미 확정돼 있었다는 뜻이다 (F4). */
export interface ConfirmResult {
  readonly reservation: Reservation
  readonly entry: StockLedgerEntry | null
}

/** 해제의 결과. `restored` 가 0이면 이미 풀려 있었다는 뜻이다. */
export interface ReleaseResult {
  readonly reservation: Reservation
  readonly restored: number
}

/** `reserved` 캐시가 예약 표와 어긋난 variant 하나 (R1 · F7). */
export interface ReservationDiscrepancy {
  readonly variantId: string
  readonly reserved: number
  readonly heldQuantity: number
}

/** 잠금 아래에서 읽은 예약 한 줄. */
interface HeldRow {
  readonly id: string
  readonly variantId: string
  readonly quantity: number
  readonly status: ReservationStatus
  readonly expiresAt: Date
}

/**
 * 재고 예약 (TASK-0048).
 *
 * **오버셀을 구조적으로 막는 자리다** (D-026). 장바구니는 담을 때 확인만 하고
 * 잠그지 않으므로(TASK-0045), 「살 수 있다」가 실제로 보장되는 지점은 여기 하나뿐이다.
 *
 * 잡는 일 전체가 **한 문장**이다.
 *
 * ```sql
 * UPDATE "ProductVariant" SET "reserved" = "reserved" + $q
 *  WHERE "id" = $id AND "stock" - "reserved" >= $q
 * ```
 *
 * 읽고 판단하고 쓰는 대신 조건부 갱신인 이유는, 읽은 값이 쓰는 순간에도 참이라는
 * 보장이 없기 때문이다. 재고 1개에 열 명이 동시에 들어오면 열 명 모두 「1개 남았다」를
 * 읽고 열 명 모두 통과한다. 조건을 `WHERE` 에 두면 판단과 갱신이 같은 문장이 되고,
 * Postgres 가 그 행을 한 번에 하나씩만 갱신하므로 **아홉은 0행 갱신으로 진다**(F2).
 * 잠금을 따로 잡을 필요도 없다 — 갱신 자신이 잠금이다.
 *
 * `reserved` 는 캐시다. 매번 예약 표를 합산하면 상품 조회마다 집계가 붙는다. 어긋날
 * 수 있다는 것이 R1 이고, 그래서 {@link reconcile} 이 있다.
 *
 * **판매 가능 여부는 여기서 보지 않는다.** 내려간 상품인지, 중단된 조합인지는 부르는
 * 쪽이 본다(TASK-0049 4장 ①). 여기서 variant 행만 절반쯤 검사하면 — 상품 상태는 조인
 * 없이 볼 수 없다 — 「예약이 판매 가능 여부를 확인한다」처럼 읽히는데 실제로는 아니다.
 * 절반의 검사는 없는 검사보다 나쁘다.
 */
@Injectable()
export class ReservationService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly stock: StockService,
  ) {}

  // ------------------------------------------------------------------ writes

  /** 트랜잭션 하나로 한 건을 잡는다. 주문 생성은 자기 트랜잭션에서 {@link reserve} 를 부른다. */
  hold(input: ReserveInput): Promise<Reservation> {
    return this.prisma.$transaction((tx) => this.reserve(tx, input))
  }

  /**
   * 부르는 쪽이 연 트랜잭션 안에서 한 건을 잡는다 (F1 · F2).
   *
   * 여기서 던지면 그 트랜잭션 전체가 되돌아간다 — 주문 생성이 「하나라도 실패하면
   * 전체 롤백」(TASK-0049 4장 ③)을 공짜로 얻는 방식이다. 여러 건을 잡다 세 번째에서
   * 품절이 나면 앞의 둘도 없던 일이 된다.
   */
  async reserve(tx: Tx, input: ReserveInput): Promise<Reservation> {
    const now = this.clock.now()
    const taken = await tx.$executeRaw`
      UPDATE "ProductVariant"
         SET "reserved" = "reserved" + ${input.quantity}, "updatedAt" = ${now}
       WHERE "id" = ${input.variantId}::uuid
         AND "stock" - "reserved" >= ${input.quantity}
    `

    if (taken === 0) await this.explainRefusal(tx, input)

    const row = await tx.stockReservation.create({
      data: {
        variantId: input.variantId,
        userId: input.userId,
        checkoutId: input.checkoutId,
        quantity: input.quantity,
        expiresAt: expiryFrom(now, input.ttlMs),
        // 시각 둘이 **같은 시계**에서 나와야 한다. `createdAt` 을 `DEFAULT now()`
        // 에 맡기면 그것만 데이터베이스의 지금이 되고, 주입된 시계 아래서 한 행의
        // 두 시각이 갈린다 — 아웃박스가 같은 이유로 큐가 영원히 비어 보였다.
        createdAt: now,
        updatedAt: now,
      },
      select: RESERVATION_SELECT,
    })

    return row
  }

  /**
   * 결제가 승인됐다 — 예약을 실제 차감으로 바꾼다 (F3 · F4).
   *
   * **만료를 따지지 않는다.** 아직 `HELD` 라면 `reserved` 가 여전히 이 예약을 세고
   * 있으므로 재고는 이 예약의 것이다. 결제가 이미 승인된 뒤에 「15분이 지났습니다」로
   * 거절하는 것은 아무도 원하지 않는 결과다(4.2 ⑤). 스케줄러가 먼저 풀어 버렸다면
   * 그때는 `RELEASED` 이고, 그것은 거절한다.
   */
  async confirm(
    tx: Tx,
    reservationId: string,
    options: { readonly actorId?: string | null } = {},
  ): Promise<ConfirmResult> {
    const held = await this.lock(tx, reservationId)
    const decision = settlement(held.status, 'CONFIRMED')

    if (decision === 'noop') return { reservation: held, entry: null }

    if (decision === 'refuse') {
      throw new ConflictException(domainFailure('RESERVATION_RELEASED', '예약이 이미 해제됐어요.'))
    }

    // **예약을 먼저 줄이고 재고를 나중에 줄인다** (4.2 ③). 순서를 뒤집으면 재고 1 ·
    // 예약 1 에서 `stock` 이 0이 되는 순간 `reserved(1) > stock(0)` 이 되어
    // `ProductVariant_reserved_check` 가 확정 자체를 거절한다.
    await this.giveBack(tx, held)

    const entry = await this.stock.apply(tx, {
      variantId: held.variantId,
      // `SALE` 이 아니다 (4.2 ②) — 예약을 거친 판매와 그렇지 않은 판매가 원장에서
      // 구분되지 않으면 예약이 새는지 확인할 방법이 사라진다.
      type: 'RESERVE_CONFIRM',
      quantity: -held.quantity,
      refType: 'STOCK_RESERVATION',
      refId: held.id,
      actorId: options.actorId ?? null,
    })

    return { reservation: await this.settle(tx, held, 'CONFIRMED'), entry }
  }

  /** 트랜잭션 하나로 한 건을 확정한다. 결제 승인 웹훅이 부를 모양이다. */
  confirmHold(
    reservationId: string,
    options: { readonly actorId?: string | null } = {},
  ): Promise<ConfirmResult> {
    return this.prisma.$transaction((tx) => this.confirm(tx, reservationId, options))
  }

  /** 트랜잭션 하나로 한 건을 푼다. 만료 스케줄러(TASK-0051)가 부를 모양이다. */
  releaseHold(reservationId: string): Promise<ReleaseResult> {
    return this.prisma.$transaction((tx) => this.release(tx, reservationId))
  }

  /** 결제 실패·이탈·만료 — 잡아 둔 몫을 돌려준다 (F5). */
  async release(tx: Tx, reservationId: string): Promise<ReleaseResult> {
    const held = await this.lock(tx, reservationId)
    const decision = settlement(held.status, 'RELEASED')

    if (decision === 'noop') return { reservation: held, restored: 0 }

    if (decision === 'refuse') {
      throw new ConflictException(
        domainFailure('RESERVATION_CONFIRMED', '이미 확정된 예약은 해제할 수 없어요.'),
      )
    }

    await this.giveBack(tx, held)

    return { reservation: await this.settle(tx, held, 'RELEASED'), restored: held.quantity }
  }

  /**
   * 한 주문서 시도가 잡은 것 전부를 푼다 (4.1).
   *
   * 결제 실패와 이탈이 이 모양이다 — 부르는 쪽은 예약 id 를 하나씩 들고 있지 않고
   * 자기가 발급한 `checkoutId` 하나만 안다. `HELD` 만 고르므로 이미 확정된 것은
   * 건드리지 않는다.
   */
  async releaseCheckout(checkoutId: string): Promise<number> {
    const held = await this.prisma.stockReservation.findMany({
      where: { checkoutId, status: 'HELD' },
      select: { id: true },
      orderBy: { id: 'asc' },
    })
    let restored = 0

    // 건마다 트랜잭션이다. 하나가 그 사이에 확정됐다면 그 한 건만 거절되고 나머지는
    // 풀린다 — 한 덩어리로 묶으면 이미 결제된 한 건 때문에 아홉 건이 잠긴 채로 남는다.
    for (const row of held) {
      const result = await this.releaseHold(row.id).catch((error: unknown) => {
        if (error instanceof ConflictException) return null

        throw error
      })

      restored += result?.restored ?? 0
    }

    return restored
  }

  /**
   * 주문서에 오래 머무는 사람에게 시간을 더 준다.
   *
   * **만료된 것은 늘리지 않는다** (4.2 ⑤). 조건이 한 문장에 들어 있는 것이 그
   * 이유다 — 만료분을 되살리면 스케줄러가 이미 집어 든 행을 두고 경합하게 되고,
   * 사용자는 늘어난 줄 알았는데 다음 순간 풀리는 결과가 된다. 조건부 갱신은
   * 스케줄러의 `WHERE "expiresAt" < now` 와 서로 배타적이라 둘 다 이길 수 없다.
   */
  async extend(reservationId: string, ttlMs: number = RESERVATION_TTL_MS): Promise<Reservation> {
    const now = this.clock.now()
    const rows = await this.prisma.$queryRaw<readonly Reservation[]>`
      UPDATE "StockReservation"
         SET "expiresAt" = ${expiryFrom(now, ttlMs)}, "updatedAt" = ${now}
       WHERE "id" = ${reservationId}::uuid
         AND "status" = 'HELD'
         AND "expiresAt" > ${now}
      RETURNING "id", "variantId", "quantity", "status", "expiresAt"
    `
    const [extended] = rows

    if (extended !== undefined) return extended

    throw await this.explainStaleExtension(reservationId)
  }

  // ------------------------------------------------------------------- reads

  /**
   * `reserved` 캐시가 예약 표와 어긋난 variant 전부 (R1 · F7).
   *
   * 한 문장이다. TASK-0051 의 점검 배치가 이것을 주기로 부르고, 이 TASK 의 F7 은
   * 예약·확정·해제를 100번 돌린 뒤 결과가 비어 있는지로 등식을 잰다.
   *
   * 재는 등식은 **`reserved` = 전체 `HELD` 합계**이지 「유효한 HELD 합계」가 아니다
   * (4.2 ⑤): 만료된 예약도 스케줄러가 풀기 전까지는 `reserved` 가 세고 있고, 그것이
   * 어긋남이 아니라 아직 안 치운 것이다.
   */
  async reconcile(): Promise<readonly ReservationDiscrepancy[]> {
    return this.prisma.$queryRaw<readonly ReservationDiscrepancy[]>`
      SELECT v."id" AS "variantId",
             v."reserved",
             COALESCE(r."held", 0)::int AS "heldQuantity"
        FROM "ProductVariant" v
        LEFT JOIN LATERAL (
          SELECT sum(s."quantity")::int AS "held"
            FROM "StockReservation" s
           WHERE s."variantId" = v."id" AND s."status" = 'HELD'
        ) r ON TRUE
       WHERE v."reserved" <> COALESCE(r."held", 0)
    `
  }

  // ---------------------------------------------------------------- internals

  /**
   * 예약 행의 잠금을 잡고 그 줄을 읽는다.
   *
   * 한 문장인 것이 맞다. `StockService.lockVariant` 가 잠금과 읽기를 둘로 나눈 것은
   * **다른 표**(`max(seq)`)를 함께 읽어야 했기 때문이다 — 같은 문장 안의 부질의는
   * 시작할 때의 스냅샷을 그대로 들고 있어서 잠금을 기다린 보람이 없다. 여기서 읽는
   * 것은 잠근 그 행의 컬럼뿐이고, 잠금이 풀리기를 기다린 `SELECT … FOR UPDATE` 는
   * 그 행만은 다시 읽는다. 그래서 동시에 들어온 두 번째 확정은 첫 번째가 써 넣은
   * `CONFIRMED` 를 본다 (F4).
   */
  private async lock(tx: Tx, reservationId: string): Promise<HeldRow> {
    const rows = await tx.$queryRaw<readonly HeldRow[]>`
      SELECT "id", "variantId", "quantity", "status", "expiresAt"
        FROM "StockReservation"
       WHERE "id" = ${reservationId}::uuid
       FOR UPDATE
    `
    const [row] = rows

    if (row === undefined) throw new NotFoundException('예약을 찾을 수 없어요.')

    return row
  }

  /** 잡아 둔 몫을 `reserved` 에서 뺀다. 확정도 해제도 이것부터 한다. */
  private async giveBack(tx: Tx, held: HeldRow): Promise<void> {
    await tx.$executeRaw`
      UPDATE "ProductVariant"
         SET "reserved" = "reserved" - ${held.quantity}, "updatedAt" = ${this.clock.now()}
       WHERE "id" = ${held.variantId}::uuid
    `
  }

  /** 예약을 끝난 상태로 적는다. */
  private async settle(tx: Tx, held: HeldRow, status: ReservationStatus): Promise<Reservation> {
    return tx.stockReservation.update({
      where: { id: held.id },
      data: { status, settledAt: this.clock.now() },
      select: RESERVATION_SELECT,
    })
  }

  /**
   * 조건부 갱신이 0행을 고쳤다 — 없는 조합인가, 모자란 것인가.
   *
   * 갱신이 진 다음에만 읽는다. 성공하는 길에는 질의가 하나뿐이어야 하고, 「몇 개
   * 남았는지」는 진 쪽만 알면 되는 숫자다.
   */
  private async explainRefusal(tx: Tx, input: ReserveInput): Promise<never> {
    const variant = await tx.productVariant.findUnique({
      where: { id: input.variantId },
      select: { stock: true, reserved: true },
    })

    if (variant === null) throw new NotFoundException('상품 옵션을 찾을 수 없어요.')

    const available = availableStock(variant.stock, variant.reserved)

    throw new ConflictException(
      domainFailure('RESERVATION_SOLD_OUT', `지금은 ${String(available)}개까지 살 수 있어요.`, {
        field: 'quantity',
        params: { available },
      }),
    )
  }

  /** 연장이 0행을 고쳤다 — 없는 예약인가, 끝난 것인가, 만료된 것인가. */
  private async explainStaleExtension(reservationId: string): Promise<Error> {
    const row = await this.prisma.stockReservation.findUnique({
      where: { id: reservationId },
      select: { status: true },
    })

    if (row === null) return new NotFoundException('예약을 찾을 수 없어요.')

    if (row.status === 'CONFIRMED') {
      return new ConflictException(
        domainFailure('RESERVATION_CONFIRMED', '이미 확정된 예약이에요.'),
      )
    }

    if (row.status === 'RELEASED') {
      return new ConflictException(domainFailure('RESERVATION_RELEASED', '예약이 이미 해제됐어요.'))
    }

    return new ConflictException(
      domainFailure('RESERVATION_EXPIRED', '예약 시간이 지났어요. 다시 담아 주세요.'),
    )
  }
}

/** 부르는 쪽에 돌려주는 예약의 모양. */
const RESERVATION_SELECT = {
  id: true,
  variantId: true,
  quantity: true,
  status: true,
  expiresAt: true,
} as const
