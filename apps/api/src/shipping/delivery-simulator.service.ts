import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common'
import type { ShipmentResponse, ShipmentStatus } from '@shopping/shared'

import { assertResourceAccess } from '../auth/access-denied.js'
import { sellerOwnership, sellerOwnershipSelect } from '../auth/resource-ownership.js'
import type { RequestPrincipal } from '../auth/request-principal.js'
import type { Clock } from '../common/clock.js'
import { CLOCK } from '../common/clock.js'
import type { AppConfig } from '../config/app-config.js'
import { APP_CONFIG } from '../config/app-config.js'
import { PrismaService } from '../prisma/prisma.service.js'
import type { DeliveryOutcome, DeliveryTally } from './delivery-simulator.js'
import {
  advanceableBefore,
  advanceableShipmentStatuses,
  advancedCount,
  counted,
  DELIVERY_BATCH_LIMIT,
  DELIVERY_INTERVAL_MS,
  DELIVERY_LAST_ADVANCED_KEY,
  DELIVERY_LAST_RUN_KEY,
  DELIVERY_LOCK_KEY,
  deliveryStepMs,
  dueAt,
  nextTrackingEvent,
  NOTHING_ADVANCED,
  worthLogging,
} from './delivery-simulator.js'
import type { TrackingEventReporter } from './shipment.service.js'
import { ShipmentService } from './shipment.service.js'

/** 한 번 돈 결과. */
export interface DeliveryRunResult extends DeliveryTally {
  /** 다른 인스턴스가 돌고 있어 건너뛰었다. */
  readonly skipped: boolean
}

/** 이번 주기가 밀 배송 하나. 판단에 필요한 만큼이다. */
interface DueShipment {
  readonly id: string
  readonly status: string
  /** 이 배송에 마지막으로 기록된 사건의 시각. 다음 단계의 때를 재는 기준이다. */
  readonly lastEventAt: Date
}

/** 수동 진행이 소유권을 판정하고 배송을 찾는 데 필요한 만큼. */
const ADVANCE_SELECT = {
  sellerId: true,
  seller: { select: sellerOwnershipSelect },
  shipment: { select: { id: true, status: true } },
} as const

/**
 * 배송이 시간에 따라 저절로 진행된다 (TASK-0062).
 *
 * **이 서비스가 하는 일은 「문을 시간에 맞춰 두드리는 것」뿐이다.** 사건 하나가
 * 무엇을 일으키는지 — 이력 한 줄 · 배송 상태 · 배송완료면 주문 전이가 한
 * 트랜잭션 — 는 `ShipmentService.recordTrackingEvent` 가 이미 정해 뒀고(TASK-0061
 * 4.3), 그것은 시뮬레이터의 규칙이 아니라 **배송 도메인의 규칙**이다. 여기서 그
 * 로직을 한 벌 더 쓰면 「사건이 기록되면 주문이 따라 움직인다」가 이 배치를 지나는
 * 사건에만 참인 문장이 된다.
 *
 * 구조는 `reservation/reservation-sweeper.service.ts` ·
 * `payment/payment-reconcile.service.ts` 와 같다 — 어드바이저리 락으로 인스턴스
 * 하나만 돌고, `AppMeta` 에 마지막 실행 시각을 적고, **건너뛴 실행은 적지 않는다.**
 *
 * **이 잡이 멈추면 데모가 배송 중에서 끝난다.** 구매확정도 정산도 반품도 그
 * 뒤에 있으므로 방문자는 이 저장소의 절반을 보지 못하는데, **아무것도 실패하지
 * 않는다** — 주문은 200 을 답하고 화면은 「배송중」이라고 정직하게 말한다. 그
 * 침묵을 밖으로 꺼낼 자리가 헬스체크이고
 * (`health/delivery-simulator.health-indicator.ts`), 옆의 세 잡이 각자 같은 이유로
 * 같은 자리에 있다.
 */
@Injectable()
export class DeliverySimulatorService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(DeliverySimulatorService.name)
  private timer: NodeJS.Timeout | null = null
  /** 도는 동안 참. 느린 주기가 다음 주기와 겹치지 않게 한다. */
  private running = false

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly shipments: ShipmentService,
  ) {}

  /**
   * 주기를 건다 — **검사에서는 걸지 않는다.**
   *
   * `payment-reconcile.service.ts` 가 같은 이유로 같은 일을 한다. 이 잡이 배경에서
   * 돌면 두 가지가 재현되지 않는 방식으로 깨진다: `AppMeta` 에 실행 시각을 적으므로
   * 「건너뛴 실행은 적지 않는다」를 재는 단언이 배경 실행 하나에 뒤집히고, 「아직
   * 때가 안 된 배송은 건드리지 않는다」를 재는 단언도 마찬가지다. 잃는 것은
   * 없다 — {@link tick} 은 {@link advanceDue} 를 감싼 `try`/`catch` 이고, 스펙은
   * {@link advanceDue} 를 직접 부른다.
   */
  onModuleInit(): void {
    if (this.config.nodeEnv === 'test') return

    // `unref` 로 프로세스를 붙잡지 않는다 — 애플리케이션 컨텍스트를 띄우는 CLI
    // 가 끝나지 못하게 되면 안 된다 (스위퍼와 같다).
    this.timer = setInterval(() => void this.tick(), DELIVERY_INTERVAL_MS)
    this.timer.unref()
  }

  onModuleDestroy(): void {
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null
  }

  /**
   * 주기 실행. **던지지 않고 기록한다** — 기다리는 사람이 없다.
   *
   * 한 건이 던지는 것은 {@link advanceOne} 이 이미 먹었으므로 여기까지 오는 것은
   * 고르기나 기록이 실패한 경우다. 그때도 조용한 것이 위험이라, 대신 헬스체크가
   * 「마지막으로 돈 시각」을 본다.
   */
  private async tick(): Promise<void> {
    if (this.running) return

    this.running = true

    try {
      await this.advanceDue()
    } catch (error) {
      this.log.error('배송 진행에 실패했습니다.', error)
    } finally {
      this.running = false
    }
  }

  /**
   * 한 번 돈다 — 때가 된 배송을 **각각 한 단계씩** 민다.
   *
   * 한 주기에 한 배송이 두 단계를 오르지 않는 것은 고르기가 한 번이기 때문이고,
   * 그것이 의도다. 배치가 몇 주기 쉬었다 돌아온 날 밀린 단계를 한 번에 몰아
   * 올리면 이력에 같은 밀리초의 줄이 셋 쌓이고, 그때 추적 화면은 「무슨 일이
   * 있었나」 대신 「배치가 언제 재시작했나」를 보여 준다. 밀린 것은 다음 주기가
   * 가져가고, 사건 시각이 **때가 된 시각**이라 그 줄들은 결국 제 간격으로 남는다
   * ({@link dueAt}).
   */
  async advanceDue(): Promise<DeliveryRunResult> {
    const now = this.clock.now()
    const stepMs = deliveryStepMs(this.config.fulfillmentPace)
    const claimed = await this.claim(now, stepMs)

    if (claimed === null) return { ...NOTHING_ADVANCED, skipped: true }

    let tally = NOTHING_ADVANCED

    for (const due of claimed) tally = counted(tally, await this.advanceOne(due, stepMs))

    // 기록은 미는 일이 끝난 뒤다. 시각은 **주기가 시작한 때**이므로 느린 주기에도
    // 「언제부터의 상태를 본 것인가」가 흔들리지 않는다.
    await this.record(now, tally)

    if (worthLogging(tally)) {
      this.log.log(
        `배송 ${String(advancedCount(tally))}건을 다음 단계로 옮겼습니다 ` +
          `(배송완료 ${String(tally.delivered)} · 실패 ${String(tally.failed)}).`,
      )
    }

    return { ...tally, skipped: false }
  }

  /**
   * 수동 진행 — 시연할 때 2분도 기다리기 어렵다 (TASK-0062 4장).
   *
   * ## 이력이 거짓이 되지 않게 하는 두 가지
   *
   * ① **사건의 종류를 요청이 고르지 않는다.** 다음 단계는 지금 상태의 함수이고
   *    (`nextTrackingEvent`), 그 함수는 배치가 쓰는 것과 **같은 것**이다. 종류를
   *    본문으로 받는 순간 이 라우트는 TASK-0061 이 열지 않기로 한 「사람이 임의의
   *    배송 사실을 주장하는」 문이 된다 — `markDelivered` 가 본문을 받지 않는 것과
   *    같은 이유다.
   *
   * ② **출처와 주체가 사람이다.** 배치가 적는 줄은 `CARRIER` 가 알려 온 사실이고
   *    전이 주체가 `SYSTEM` 인데, 사람이 누른 것을 그 모양으로 적으면 이력의
   *    `SYSTEM` 이 거짓이 된다. 그래서 여기서는 `SELLER` 출처로 적는다 — 추적 줄의
   *    문장은 「판매자가 …을 확인했어요」이고 지점은 지명이 아니라
   *    `SELLER_REPORTED_LOCATION`(「판매자 직접 확인」)이며, 주문 이력에는 누른
   *    사람의 `actorId` 가 함께 남는다. `shipment-rules.ts` 의 문장 표가 출처별로
   *    **네 칸 전부** 적혀 있는 것이 바로 이 호출자를 위해서였다.
   *
   * 즉 이 라우트가 남기는 것은 「시연용으로 시계를 당겼다」가 아니라 **「판매자가
   * 이 단계를 직접 확인했다」**이고, 그것은 실제로 일어난 일이다. 관리자가 부르면
   * 주체가 `ADMIN` 이 되는 것도 같은 성질이다 (`markDelivered` 와 같은 판정).
   *
   * **멱등이다.** 이미 배송완료인 배송에는 아무것도 적지 않고 그대로 돌려준다 —
   * 저쪽과 같은 이유이고, 여기서 두 번은 「운송사가 두 번 알려 왔다」가 아니라
   * **버튼을 두 번 누른 것**이다.
   */
  async advance(principal: RequestPrincipal, sellerOrderId: string): Promise<ShipmentResponse> {
    const row = await this.prisma.sellerOrder.findUnique({
      where: { id: sellerOrderId },
      select: ADVANCE_SELECT,
    })

    if (row === null) throw new NotFoundException('주문을 찾을 수 없어요.')

    // 발송·배송완료와 같은 문이다. 남의 주문에는 「지금 상태에서는 할 수 없다」가
    // 아니라 「당신 것이 아니다」로 답한다.
    assertResourceAccess(principal, 'order.write', sellerOwnership(row.seller))

    if (row.shipment === null) throw new NotFoundException('배송 정보를 찾을 수 없어요.')

    // 여기서는 좁히지 않는다. Prisma 가 이 열을 이미 열거형으로 주므로 `as` 를
    // 붙이면 **계약과 스키마가 갈라진 날 그 사실을 가리는** 단언이 된다. 아래
    // {@link advanceOne} 이 좁히는 것은 그쪽 값이 raw SQL 에서 온 문자열이라서다.
    const kind = nextTrackingEvent(row.shipment.status)

    // 사다리의 끝이다. 조회로 답하는 것은 「지금 이 배송이 어떤가」의 답을 만드는
    // 자리가 하나뿐이어야 하기 때문이고, 그 자리가 소유권도 다시 본다.
    if (kind === null) return await this.shipments.get(principal, sellerOrderId)

    const reporter: TrackingEventReporter = {
      source: 'SELLER',
      command: {
        actor: principal.sellerId === row.sellerId ? 'SELLER' : 'ADMIN',
        actorId: principal.userId,
      },
    }

    // `occurredAt` 을 넘기지 않는다 — 사람이 누른 것은 **지금**이고, 배치가 때가 된
    // 시각을 적는 것과 여기서 갈린다. 그 덕분에 다음 자동 단계는 이 순간부터 온전히
    // 한 단계 뒤가 된다 (`advanceableBefore` 주석).
    return await this.shipments.recordTrackingEvent({
      shipmentId: row.shipment.id,
      kind,
      reporter,
    })
  }

  /** 마지막으로 돈 시각. 헬스체크가 읽는다. */
  async lastRunAt(): Promise<Date | null> {
    const row = await this.prisma.appMeta.findUnique({
      where: { key: DELIVERY_LAST_RUN_KEY },
      select: { value: true },
    })

    if (row === null) return null

    const parsed = new Date(row.value)

    // 손으로 고친 행이 헬스체크를 끌어내리면 안 된다.
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }

  /** 마지막 주기가 민 건수. */
  async lastAdvanced(): Promise<number> {
    const row = await this.prisma.appMeta.findUnique({
      where: { key: DELIVERY_LAST_ADVANCED_KEY },
      select: { value: true },
    })
    const parsed = Number(row?.value ?? '0')

    return Number.isFinite(parsed) ? parsed : 0
  }

  // ---------------------------------------------------------------- internals

  /**
   * 이번 주기가 밀 배송들. 락을 못 잡으면 `null`.
   *
   * **락을 고르는 동안만 쥔다.** 스위퍼는 푸는 일까지 락 안에서 끝내지만, 여기서
   * 한 건을 미는 것은 배송 행과 주문 행을 잠그는 **별도 트랜잭션**이다
   * (`recordTrackingEvent`). 그것을 이 트랜잭션 안에 넣을 수는 없다 —
   * PostgreSQL 에 중첩 트랜잭션이 없어 안쪽이 다른 커넥션에서 열리고, 그 커넥션은
   * 바깥이 쥔 잠금을 영원히 기다린다. 대사 배치가 같은 자리에서 같은 모양이다.
   *
   * 그래서 이 락이 막는 것은 **두 인스턴스가 같은 목록을 집어 같은 사건을 두 번
   * 적는 것**이다. 적히더라도 상태는 사다리를 지키지만
   * (`furthestShipmentStatus`), 추적 화면에는 같은 줄이 둘 남고 그것은 「운송사가
   * 두 번 알려 왔다」로 읽힌다 — 없는 사실이다.
   *
   * 트랜잭션 단위 락인 이유는 옆의 세 잡과 같다: 세션 락은 놓는 것을 잊으면 영원히
   * 남고, 잊는 경우는 예외가 아니라 프로세스가 죽는 경우다.
   *
   * 조건이 셋이다.
   *
   * ① **주문이 `SHIPPED` 다.** 전이 라우트로 주문만 `DELIVERED` 가 된 몫
   *    (`state-machines.md` 1장이 판매자에게 열어 둔 길)을 계속 밀면 이력에
   *    「배송완료 뒤의 이동 중」이 남는다.
   * ② **배송에 다음 단계가 있다.** 목록은 순수 모듈이 표에서 만든다 — 여기에
   *    「`DELIVERED` 가 아닌 것」이라고 따로 적으면 표와 조건이 두 벌이 된다.
   * ③ **마지막 사건이 한 단계 간격보다 오래됐다.** 기준은 배송의 발송 시각도 이
   *    배치의 실행 시각도 아니다 ({@link advanceableBefore}).
   */
  private claim(now: Date, stepMs: number): Promise<readonly DueShipment[] | null> {
    return this.prisma.$transaction(async (tx) => {
      const [lock] = await tx.$queryRaw<readonly { readonly taken: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(${DELIVERY_LOCK_KEY}::bigint) AS "taken"
      `

      if (lock?.taken !== true) return null

      // 마지막 사건의 시각은 이력에서만 나온다. `LATERAL` 인 것은 그 값을
      // `WHERE` 와 `ORDER BY` 가 함께 쓰기 때문이고, 서브쿼리를 두 번 적으면
      // 둘이 갈라질 자리가 생긴다. `(shipmentId, occurredAt)` 인덱스가 이 집계를
      // 받는다.
      return await tx.$queryRaw<readonly DueShipment[]>`
        SELECT s."id", s."status"::text AS "status", e."lastEventAt"
          FROM "Shipment" s
          JOIN "SellerOrder" o ON o."id" = s."sellerOrderId"
          JOIN LATERAL (
            SELECT max(t."occurredAt") AS "lastEventAt"
              FROM "ShipmentTrackingEvent" t
             WHERE t."shipmentId" = s."id"
          ) e ON true
         WHERE o."status" = 'SHIPPED'::"SellerOrderStatus"
           AND s."status"::text = ANY(${[...advanceableShipmentStatuses]}::text[])
           AND e."lastEventAt" <= ${advanceableBefore(now, stepMs)}
         -- 오래 멈춰 있던 배송이 먼저다. 상한에 걸려 밀린 건이 다음 주기에도 맨
         -- 뒤에 서면 그 한 건만 영영 못 움직인다.
         ORDER BY e."lastEventAt" ASC
         LIMIT ${DELIVERY_BATCH_LIMIT}
      `
    })
  }

  /**
   * 한 건을 민다. **던지지 않는다.**
   *
   * 하나의 실패가 배치를 멈추면, 밀 수 없는 배송 하나가 나머지 전부를 **영원히**
   * 막는다 — 목록이 오래된 것부터라서 그 한 건은 다음 주기에도 맨 앞에 있고,
   * 그때도 같은 자리에서 던진다. 그래서 여기서 먹고 세기만 한다.
   *
   * 예외가 조용히 사라지지는 않는다. 배송 id 와 함께 `error` 로 남고, 헬스체크가
   * 보는 「민 건수」에는 들어가지 않으므로 계속 던지는 한 건은 「밀린 것이 안
   * 줄어든다」로 드러난다.
   */
  private async advanceOne(due: DueShipment, stepMs: number): Promise<DeliveryOutcome> {
    try {
      const kind = nextTrackingEvent(due.status as ShipmentStatus)

      if (kind === null) {
        // 질의가 `advanceableShipmentStatuses` 로 좁히므로 여기 오는 길은 없다.
        // 그래도 조용히 넘기지 않는 것은, 오는 날이 있다면 그것은 표와 질의가
        // 갈라졌다는 뜻이고 그 사실이 「밀린 것이 안 줄어든다」로 드러나야 하기
        // 때문이다.
        throw new Error(`상태 ${due.status} 의 다음 단계가 없습니다.`)
      }

      await this.shipments.recordTrackingEvent({
        shipmentId: due.id,
        kind,
        occurredAt: dueAt(due.lastEventAt, stepMs),
      })

      return kind === 'DELIVERED' ? 'delivered' : 'advanced'
    } catch (error) {
      this.log.error(`배송 ${due.id} 를 다음 단계로 옮기지 못했습니다.`, error)

      return 'failed'
    }
  }

  /**
   * 돈 사실을 남긴다. 헬스체크가 이 두 행을 읽는다.
   *
   * **건너뛴 주기는 여기까지 오지 않는다.** 락을 못 잡은 것을 「돌았다」로 적으면,
   * 실제로는 한 인스턴스도 배송을 밀지 못하는 상태에서 헬스체크가 계속 초록을
   * 답한다 — 옆의 세 잡이 같은 이유로 같게 한다.
   */
  private async record(now: Date, tally: DeliveryTally): Promise<void> {
    for (const [key, value] of [
      [DELIVERY_LAST_RUN_KEY, now.toISOString()],
      [DELIVERY_LAST_ADVANCED_KEY, String(advancedCount(tally))],
    ] as const) {
      await this.prisma.appMeta.upsert({
        where: { key },
        create: { key, value },
        update: { value },
      })
    }
  }
}
