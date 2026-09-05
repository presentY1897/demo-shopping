import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { Inject, Injectable, Logger } from '@nestjs/common'
import type { Prisma } from '@prisma/client'

import type { Clock } from '../common/clock.js'
import { CLOCK } from '../common/clock.js'
import type { AppConfig } from '../config/app-config.js'
import { APP_CONFIG } from '../config/app-config.js'
import { OrderService } from '../orders/order.service.js'
import { PrismaService } from '../prisma/prisma.service.js'
import type { StragglerOutcome, StragglerTally } from './payment-straggler.js'
import {
  abandonedBefore,
  capturedBefore,
  counted,
  fixedCount,
  NOTHING_STRANDED,
  STRAGGLER_CANCEL_LIMIT,
  STRAGGLER_CANCEL_REASON,
  STRAGGLER_COMPLETE_LIMIT,
  STRAGGLER_INTERVAL_MS,
  STRAGGLER_LAST_FIXED_KEY,
  STRAGGLER_LAST_RUN_KEY,
  STRAGGLER_LOCK_KEY,
  worthLogging,
} from './payment-straggler.js'
import { PaymentService } from './payment.service.js'

type Tx = Prisma.TransactionClient

/** 한 번 돈 결과. */
export interface StragglerResult extends StragglerTally {
  /** 다른 인스턴스가 고르고 있어 건너뛰었다. */
  readonly skipped: boolean
}

/** 마저 끝낼 주문 하나. 결제 id 는 로그에만 쓰인다. */
interface Stranded {
  readonly paymentId: string
  readonly orderId: string
}

/** 이번 주기가 손볼 것들. 두 방향이 한 트랜잭션 안에서 함께 뽑힌다. */
interface Claimed {
  /** **앞으로** — 매입은 끝났는데 주문이 `PAYMENT_PENDING` 인 건. */
  readonly stranded: readonly Stranded[]
  /** **뒤로** — 매입 없이 남은 승인의 결제 id. */
  readonly abandoned: readonly string[]
}

/**
 * 낙오된 결제를 끝낸다 (TASK-0057 F2 · F6 · D-221).
 *
 * **한 주기가 반대 방향으로 두 번 움직인다.**
 *
 * | | 무엇이 남았나 | 무엇을 하나 | 왜 그쪽인가 |
 * | --- | --- | --- | --- |
 * | **앞으로** | `Payment.PAID` 인데 `SellerOrder.PAYMENT_PENDING` | `markPaid` 재실행 | 돈은 이미 우리 쪽으로 왔고 사람은 물건을 기다린다 |
 * | **뒤로** | 매입 없이 남은 `AUTHORIZED` | 승인 취소 | 예약이 풀려 이 결제로 살 수 있는 것이 없다 |
 *
 * 앞쪽을 취소하는 것은 **사고를 두 번째로 만드는 일**이다 (4.2). 보상이 늘
 * 되감기라는 생각이 이 자리에서 틀리고, 되감을지 마저 끝낼지는 「돈이 어디까지
 * 왔는가」가 정한다 (D-221).
 *
 * **이 잡이 멈추면 아무것도 실패하지 않는다.** 앞쪽에서는 돈을 낸 사람의 주문이
 * 영원히 「결제 대기」로 남고, 뒤쪽에서는 그 사람의 카드 한도가 영영 물린다 —
 * 그런데 어느 요청도 에러를 내지 않는다. 그 침묵을 밖으로 꺼낼 자리가 헬스체크다
 * (`health/payment-straggler.health-indicator.ts`).
 *
 * 구조는 `payment-reconcile.service.ts` 와 같다 — 고르는 동안만 락을 쥐는 것,
 * 한 건이 던져도 나머지가 도는 것, 건너뛴 실행을 적지 않는 것까지 그대로다.
 * **다른 것은 무엇을 찾고 무엇을 하느냐뿐이다.**
 */
@Injectable()
export class PaymentStragglerService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(PaymentStragglerService.name)
  private timer: NodeJS.Timeout | null = null
  /** 도는 동안 참. 느린 주기가 다음 주기와 겹치지 않게 한다. */
  private running = false

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly payments: PaymentService,
    private readonly orders: OrderService,
  ) {}

  /**
   * 주기를 건다 — **검사에서는 걸지 않는다.**
   *
   * `payment-reconcile.service.ts` 가 같은 이유로 같은 일을 한다. 이 잡이 배경에서
   * 돌면 두 가지가 재현되지 않는 방식으로 깨진다: `AppMeta` 에 실행 시각을 적으므로
   * 「건너뛴 실행은 적지 않는다」를 재는 단언이 배경 실행 하나에 뒤집히고, 결제사
   * 대역이 받은 호출을 세는 단언 — 「정상 결제는 대역이 한 마디도 못 듣는다」 —
   * 도 마찬가지다. 잃는 것은 없다: {@link tick} 은 {@link sweep} 을 감싼
   * `try`/`catch` 이고, 스펙은 {@link sweep} 을 직접 부른다.
   */
  onModuleInit(): void {
    if (this.config.nodeEnv === 'test') return

    // `unref` 로 프로세스를 붙잡지 않는다 — 애플리케이션 컨텍스트를 띄우는 CLI
    // 가 끝나지 못하게 되면 안 된다 (스위퍼·대사와 같다).
    this.timer = setInterval(() => void this.tick(), STRAGGLER_INTERVAL_MS)
    this.timer.unref()
  }

  onModuleDestroy(): void {
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null
  }

  /**
   * 주기 실행. **던지지 않고 기록한다** — 기다리는 사람이 없다.
   *
   * 한 건이 던지는 것은 {@link completeOne} · {@link cancelOne} 이 이미 먹었으므로
   * 여기까지 오는 것은 고르기나 기록이 실패한 경우다. 그때도 조용한 것이 위험이라,
   * 대신 헬스체크가 「마지막으로 돈 시각」을 본다.
   */
  private async tick(): Promise<void> {
    if (this.running) return

    this.running = true

    try {
      await this.sweep()
    } catch (error) {
      this.log.error('낙오 결제 처리에 실패했습니다.', error)
    } finally {
      this.running = false
    }
  }

  /**
   * 한 번 돈다.
   *
   * 고르고 → **앞으로** 마저 끝내고 → **뒤로** 되감고 → 돈 사실을 적는다. 가운데
   * 둘이 트랜잭션 밖인 이유는 {@link claim} 에 적었다.
   *
   * 앞쪽을 먼저 하는 것은 순서에 뜻이 있어서다. 뒤쪽 한 건은 결제사를 기다리므로
   * 최악에 15초씩 쓰는데, 그 뒤에 앞쪽을 두면 **돈을 이미 낸 사람의 주문이 남의
   * 취소를 기다리게 된다.**
   */
  async sweep(): Promise<StragglerResult> {
    const now = this.clock.now()
    const claimed = await this.claim(now)

    if (claimed === null) return { ...NOTHING_STRANDED, skipped: true }

    let tally = NOTHING_STRANDED

    for (const row of claimed.stranded) tally = counted(tally, await this.completeOne(row))
    for (const paymentId of claimed.abandoned) {
      tally = counted(tally, await this.cancelOne(paymentId))
    }

    // 기록은 일이 끝난 뒤다. 시각은 **주기가 시작한 때**이므로 결제사가 느린
    // 날에도 「언제부터의 상태를 확인한 것인가」가 흔들리지 않는다.
    await this.record(now, tally)

    if (worthLogging(tally)) {
      this.log.log(
        `낙오된 결제 ${String(fixedCount(tally))}건을 끝냈습니다 ` +
          `(주문 완료 ${String(tally.completed)} · 승인 취소 ${String(tally.canceled)}, ` +
          `사람이 먼저 마침 ${String(tally.overtaken)} · 실패 ${String(tally.failed)}).`,
      )
    }

    return { ...tally, skipped: false }
  }

  /** 마지막으로 돈 시각. 헬스체크가 읽는다. */
  async lastRunAt(): Promise<Date | null> {
    const row = await this.prisma.appMeta.findUnique({
      where: { key: STRAGGLER_LAST_RUN_KEY },
      select: { value: true },
    })

    if (row === null) return null

    const parsed = new Date(row.value)

    // 손으로 고친 행이 헬스체크를 끌어내리면 안 된다.
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }

  /** 마지막 주기가 고친 건수. */
  async lastFixed(): Promise<number> {
    const row = await this.prisma.appMeta.findUnique({
      where: { key: STRAGGLER_LAST_FIXED_KEY },
      select: { value: true },
    })
    const parsed = Number(row?.value ?? '0')

    return Number.isFinite(parsed) ? parsed : 0
  }

  // ---------------------------------------------------------------- internals

  /**
   * 이번 주기가 손볼 것들. 락을 못 잡으면 `null`.
   *
   * **락은 고르는 동안만 쥔다.** 뒤쪽 한 건을 되감는 일은 **결제사와의 왕복**이라,
   * 그것을 트랜잭션 안에 넣으면 연결 하나가 최악에 몇 분 동안 열린 채 남고 그
   * 몇 분이 Prisma 의 트랜잭션 마감을 넘기면 **이미 끝난 매입까지 예외로 끝난다.**
   * 「프로바이더 호출은 트랜잭션 밖」은 `payment.service.ts` 의 승인 경로가 이미
   * 세운 규칙이고 `payment-reconcile.service.ts` 가 그 이유를 자세히 적어 뒀다.
   *
   * 그래서 이 락이 막는 것은 **겹친 두 인스턴스가 같은 승인에 취소를 두 번
   * 보내는 것**이다. 장부가 어긋나는 것은 락이 아니라 `cancelAuthorization` 이
   * 막는다 — 결제 행을 잠그고 상태를 다시 보므로 늦게 온 쪽은 아무것도 바꾸지
   * 않는다. 앞쪽도 같다: `markPaid` 는 멱등이다. 락을 짧게 쥐어도 안전한 것이지
   * 락이 없어도 되는 것은 아니다.
   *
   * 트랜잭션 단위 락인 이유는 옆의 두 잡과 같다: 세션 락은 놓는 것을 잊으면 영원히
   * 남고, 잊는 경우는 예외가 아니라 프로세스가 죽는 경우다.
   */
  private claim(now: Date): Promise<Claimed | null> {
    return this.prisma.$transaction(async (tx) => {
      const [lock] = await tx.$queryRaw<readonly { readonly taken: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(${STRAGGLER_LOCK_KEY}::bigint) AS "taken"
      `

      if (lock?.taken !== true) return null

      // **앞으로.** 매입은 끝났는데(`PAID`) 그 주문에 아직 `PAYMENT_PENDING` 인
      // 판매자 몫이 남아 있는 건. 유예를 지난 것만 본다 — 정상 결제도 매입과
      // 주문 완료 사이에 잠깐 이 모양이기 때문이다.
      const stranded = await tx.payment.findMany({
        where: {
          status: 'PAID',
          updatedAt: { lt: capturedBefore(now) },
          order: { sellerOrders: { some: { status: 'PAYMENT_PENDING' } } },
        },
        // 오래된 것부터. 가장 오래 기다린 사람의 물건이 먼저 움직인다.
        orderBy: { updatedAt: 'asc' },
        take: STRAGGLER_COMPLETE_LIMIT,
        select: { id: true, orderId: true },
      })

      return {
        stranded: stranded.map((row) => ({ paymentId: row.id, orderId: row.orderId })),
        abandoned: await this.abandonedIds(tx, now),
      }
    })
  }

  /**
   * **뒤로.** 매입 없이 남은 승인의 결제 id.
   *
   * **두 조건이 한 쿼리 안에서 AND 로 묶인다** (R1 · D-221).
   *
   * 1. 승인된 지 오래됐다 (`approvedAt`)
   * 2. **그 주문에 살아 있는(`HELD`) 예약이 없다**
   *
   * 둘째가 핵심이다 — 예약이 살아 있다는 것은 「아직 이 결제로 살 수 있다」는
   * 뜻이라 건드리면 안 되고, 없다는 것은 재고가 이미 남에게 갔다는 뜻이다. 두
   * 조건을 코드에서 순차로 보면 한쪽을 빠뜨린 경로가 생길 수 있고 그 경로가
   * 하는 일은 **정상 결제를 취소하는 것**이라, 갈라질 수 없게 한 문장으로 적는다.
   *
   * Prisma 로 못 적는 이유는 `StockReservation` 이 `Order` 를 외래키로 가리키지
   * 않기 때문이다 — 예약은 주문 표가 생기기 전부터 있었고 둘을 잇는 것은
   * `checkoutId` 값 하나다 (`schema.prisma`).
   *
   * 시각은 ISO 문자열로 넘겨 `::timestamp` 로 못 박는다. 컬럼이
   * `timestamp without time zone` 이라 세션 시간대에 따라 해석이 갈릴 수 있는
   * 자리이고, 여기서 몇 시간이 밀리면 **아직 살아 있는 승인을 취소한다.**
   */
  private async abandonedIds(tx: Tx, now: Date): Promise<readonly string[]> {
    const rows = await tx.$queryRaw<readonly { readonly id: string }[]>`
      SELECT p."id"
        FROM "Payment" p
        JOIN "Order" o ON o."id" = p."orderId"
       WHERE p."status" = 'AUTHORIZED'
         AND p."approvedAt" < ${abandonedBefore(now).toISOString()}::timestamp
         AND NOT EXISTS (
               SELECT 1
                 FROM "StockReservation" r
                WHERE r."checkoutId" = o."checkoutId"
                  AND r."status" = 'HELD'
             )
       ORDER BY p."approvedAt" ASC
       LIMIT ${STRAGGLER_CANCEL_LIMIT}::int
    `

    return rows.map((row) => row.id)
  }

  /**
   * **앞으로** 한 건. 주문을 마저 끝낸다. **던지지 않는다.**
   *
   * `markPaid` 는 멱등이라 이미 끝난 주문에 다시 불러도 안전하다 (4.2) — 그것이
   * 이 방향의 보상이 「되감기」가 아니라 「마저 끝내기」일 수 있는 이유다.
   * 결제는 손대지 않는다: 이미 `PAID` 이고 그것이 사실이다.
   *
   * 하나의 실패가 배치를 멈추면 물어볼 수 없는 한 건이 나머지 전부를 **영원히**
   * 막는다 — 목록이 오래된 것부터라서 그 한 건은 다음 주기에도 맨 앞에 있고,
   * 그때도 같은 자리에서 던진다.
   */
  private async completeOne(row: Stranded): Promise<StragglerOutcome> {
    try {
      await this.orders.markPaid(row.orderId)

      return 'completed'
    } catch (error) {
      this.log.error(`결제 ${row.paymentId} 의 주문 ${row.orderId} 를 완료하지 못했습니다.`, error)

      return 'failed'
    }
  }

  /**
   * **뒤로** 한 건. 승인을 취소한다. **던지지 않는다.**
   *
   * `cancelAuthorization` 은 그 사이에 매입이 끝났으면 조용히 아무것도 하지
   * 않는다 — 사람이 돌아와 결제를 마친 경우이고, **되감을 이유가 사라진 것이라
   * 좋은 결과다.** 그래서 결과를 상태로 되읽어 `overtaken` 과 `canceled` 를
   * 가른다: 둘을 같은 칸에 세면 「배치가 몇 건을 놓아줬나」라는 숫자에 사람이 한
   * 일이 섞여 들어온다.
   */
  private async cancelOne(paymentId: string): Promise<StragglerOutcome> {
    try {
      await this.payments.cancelAuthorization(paymentId, STRAGGLER_CANCEL_REASON)

      const row = await this.prisma.payment.findUnique({
        where: { id: paymentId },
        select: { status: true },
      })

      return row?.status === 'CANCELED' ? 'canceled' : 'overtaken'
    } catch (error) {
      this.log.error(`결제 ${paymentId} 의 승인을 취소하지 못했습니다.`, error)

      return 'failed'
    }
  }

  /**
   * 돈 사실을 남긴다. 헬스체크가 이 두 행을 읽는다.
   *
   * **건너뛴 주기는 여기까지 오지 않는다.** 락을 못 잡은 것을 「돌았다」로 적으면,
   * 실제로는 한 인스턴스도 일하지 못하는 상태에서 헬스체크가 계속 초록을 답한다 —
   * 스위퍼와 대사가 같은 이유로 같게 한다.
   */
  private async record(now: Date, tally: StragglerTally): Promise<void> {
    for (const [key, value] of [
      [STRAGGLER_LAST_RUN_KEY, now.toISOString()],
      [STRAGGLER_LAST_FIXED_KEY, String(fixedCount(tally))],
    ] as const) {
      await this.prisma.appMeta.upsert({
        where: { key },
        create: { key, value },
        update: { value },
      })
    }
  }
}
