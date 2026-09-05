import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { Inject, Injectable, Logger } from '@nestjs/common'

import type { Clock } from '../common/clock.js'
import { CLOCK } from '../common/clock.js'
import type { AppConfig } from '../config/app-config.js'
import { APP_CONFIG } from '../config/app-config.js'
import { PrismaService } from '../prisma/prisma.service.js'
import type { ConfirmTally } from './order-confirm.js'
import {
  autoConfirmWindowMsOf,
  CONFIRM_BATCH_LIMIT,
  CONFIRM_INTERVAL_MS,
  CONFIRM_LAST_CONFIRMED_KEY,
  CONFIRM_LAST_RUN_KEY,
  CONFIRM_LOCK_KEY,
  confirmableBefore,
  counted,
  NOTHING_CONFIRMED,
  worthLogging,
} from './order-confirm.js'
import type { SellerOrderStatusChanged } from './seller-order-events.js'
import { SellerOrderService } from './seller-order.service.js'

/** 한 번 돈 결과. */
export interface ConfirmSweepResult extends ConfirmTally {
  /** 다른 인스턴스가 고르고 있어 건너뛰었다. */
  readonly skipped: boolean
}

/** 한 몫을 옮겨 본 결과. 이름은 {@link ConfirmTally} 의 칸 이름과 같다. */
type ConfirmOutcome =
  | { readonly kind: 'confirmed'; readonly event: SellerOrderStatusChanged }
  | { readonly kind: 'noop' }
  | { readonly kind: 'failed' }

/**
 * 배송완료 후 기간이 지난 몫을 자동으로 구매확정한다 (TASK-0064 F2 · F3).
 *
 * ## 「배송완료 시각」을 무엇으로 잡았나 — 상태 이력이다
 *
 * 후보가 둘이었다: **`OrderStatusHistory` 의 `DELIVERED` 줄**과
 * **`Shipment.deliveredAt`**. 이력을 고른 이유는 셋이다.
 *
 * 1. **이력은 반드시 있다.** 상태를 옮기는 길이 `applyWithin` 하나뿐이고
 *    (`docs/design/state-machines.md` 1장), 그 문은 상태 변경과 이력 기록을 **한
 *    트랜잭션**으로 쓴다. 그래서 `DELIVERED` 인 몫에는 예외 없이 그 줄이 있다.
 * 2. **배송 행은 뒤처질 수 있다.** `SHIPPED → DELIVERED` 는 판매자도 할 수 있고,
 *    판매자가 전용 라우트가 아니라 전이 라우트로 찍으면 **배송 표가 안 따라온다**
 *    (설계서 1장 · TASK-0060 4.1). 그때 `Shipment.deliveredAt` 은 `NULL` 이고,
 *    그것을 기준으로 삼은 배치는 그 주문을 **영원히 확정하지 않는다** — 그리고
 *    아무것도 실패하지 않는다. 이 TASK 가 없애려는 바로 그 종류의 침묵이다.
 * 3. **묻는 것이 「상태가 언제 옮겨졌나」이기 때문이다.** D+7 은 「물건이 언제
 *    실렸나」가 아니라 「구매자가 반품을 말할 시간을 얼마나 가졌나」를 재는 기간이고,
 *    그 시작점은 주문이 배송완료로 **선언된** 순간이다. 구매자 화면이 같은 이유로
 *    같은 선택을 했다 (`apps/shop/src/lib/orders/order-stages.ts` — 「배송 행은 뒤에
 *    선다」).
 *
 * 그 대신 이 배치는 **배송 표를 아예 읽지 않는다.** 그것이 TASK-0062(배송
 * 시뮬레이터)와 이 잡을 떼어 놓는다 — 시뮬레이터가 배송 표에 무엇을 적든, 상태를
 * 옮기는 순간 이력이 남고 이 배치는 그것만 본다.
 *
 * ## 구조 — 고르고 · 하나씩 옮기고 · 적는다
 *
 * `payment/payment-reconcile.service.ts` 와 같은 셋으로 나뉘고, 이유는 그쪽과
 * 다르다. 저쪽은 가운데가 **결제사와의 왕복**이라 트랜잭션 밖이어야 했지만, 여기서
 * 가운데가 따로인 이유는 **한 건의 실패를 격리하기 위해서**다 (아래
 * {@link confirmOne}). PostgreSQL 에는 중첩 트랜잭션이 없어 한 문장이 던지면
 * 트랜잭션 전체가 못 쓰게 되므로, 한 트랜잭션 안에서 200건을 옮기면 **한 건의 거절이
 * 나머지 199건을 되돌린다.**
 */
@Injectable()
export class OrderConfirmService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(OrderConfirmService.name)
  private timer: NodeJS.Timeout | null = null
  /** 도는 동안 참. 느린 주기가 다음 주기와 겹치지 않게 한다. */
  private running = false

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly transitions: SellerOrderService,
  ) {}

  /**
   * 이 프로세스가 쓰는 자동 확정 기간.
   *
   * 압축 여부의 판단은 `order-confirm.ts` 의 한 함수가 쥔다 — 배송 시뮬레이터
   * (TASK-0062)와 **같은 축**(`FULFILLMENT_PACE`)을 읽어야 하기 때문이고, 그 이유는
   * 그쪽에 적혀 있다. 여기서는 숫자만 본다.
   *
   * 속성으로 열어 둔 것은 검사 때문이기도 하다. 스펙이 「기간이 지나면」을 재려면
   * 시계를 얼마나 밀어야 하는지 알아야 하는데, 그 답을 스펙이 다시 계산하면 축이
   * 바뀐 날 **스펙만 옳고 배치는 틀린** 상태가 초록으로 남는다.
   */
  get windowMs(): number {
    return autoConfirmWindowMsOf(this.config)
  }

  /**
   * 주기를 건다 — **검사에서는 걸지 않는다.**
   *
   * `payment-reconcile.service.ts` 와 같은 이유다. 이 잡이 배경에서 돌면 `AppMeta` 에
   * 실행 시각을 적으므로 「건너뛴 실행은 적지 않는다」를 재는 단언이 배경 실행 하나에
   * 뒤집히고, 「때가 안 됐으면 확정하지 않는다」도 마찬가지다. 잃는 것은 없다:
   * {@link tick} 은 {@link sweep} 을 감싼 `try`/`catch` 이고 스펙은 {@link sweep} 을
   * 직접 부른다.
   */
  onModuleInit(): void {
    if (this.config.nodeEnv === 'test') return

    // `unref` 로 프로세스를 붙잡지 않는다 — 애플리케이션 컨텍스트를 띄우는 CLI
    // 가 끝나지 못하게 되면 안 된다 (스위퍼와 같다).
    this.timer = setInterval(() => void this.tick(), CONFIRM_INTERVAL_MS)
    this.timer.unref()
  }

  onModuleDestroy(): void {
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null
  }

  /**
   * 주기 실행. **던지지 않고 기록한다** — 기다리는 사람이 없다.
   *
   * 한 몫이 던지는 것은 {@link confirmOne} 이 이미 먹었으므로 여기까지 오는 것은
   * 고르기나 기록이 실패한 경우다. 그때도 조용한 것이 위험이라, 대신 헬스체크가
   * 「마지막으로 돈 시각」을 본다.
   */
  private async tick(): Promise<void> {
    if (this.running) return

    this.running = true

    try {
      await this.sweep()
    } catch (error) {
      this.log.error('자동 구매확정에 실패했습니다.', error)
    } finally {
      this.running = false
    }
  }

  /**
   * 한 번 돈다.
   *
   * 알림과 후속 이벤트는 **커밋한 뒤에** 나간다 (TASK-0059 ⑥). 몫마다 트랜잭션이
   * 따로이므로 「커밋한 뒤」가 주기의 끝이고, 그때 한 번에 넘긴다 — 정산·적립을
   * 받는 쪽이 「한 주기의 결과」라는 사실을 잃지 않게 하려는 것이다.
   */
  async sweep(): Promise<ConfirmSweepResult> {
    const now = this.clock.now()
    const claimed = await this.claim(now)

    if (claimed === null) return { ...NOTHING_CONFIRMED, skipped: true }

    let tally = NOTHING_CONFIRMED
    const events: SellerOrderStatusChanged[] = []

    for (const sellerOrderId of claimed) {
      const outcome = await this.confirmOne(sellerOrderId)

      if (outcome.kind === 'confirmed') events.push(outcome.event)
      tally = counted(tally, outcome.kind)
    }

    await this.transitions.publish(events)

    // 기록은 마지막이다. 시각은 **주기가 시작한 때**이므로 오래 걸린 주기에도
    // 「언제까지의 배송완료를 본 것인가」가 흔들리지 않는다.
    await this.record(now, tally)

    if (worthLogging(tally)) {
      this.log.log(
        `배송완료 후 기간이 지난 주문 ${String(tally.confirmed)}건을 자동 확정했습니다 ` +
          `(이미 확정됨 ${String(tally.noop)} · 실패 ${String(tally.failed)}).`,
      )
    }

    return { ...tally, skipped: false }
  }

  /** 마지막으로 돈 시각. 헬스체크가 읽는다. */
  async lastRunAt(): Promise<Date | null> {
    const row = await this.prisma.appMeta.findUnique({
      where: { key: CONFIRM_LAST_RUN_KEY },
      select: { value: true },
    })

    if (row === null) return null

    const parsed = new Date(row.value)

    // 손으로 고친 행이 헬스체크를 끌어내리면 안 된다.
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }

  /** 마지막 주기가 확정한 건수. */
  async lastConfirmed(): Promise<number> {
    const row = await this.prisma.appMeta.findUnique({
      where: { key: CONFIRM_LAST_CONFIRMED_KEY },
      select: { value: true },
    })
    const parsed = Number(row?.value ?? '0')

    return Number.isFinite(parsed) ? parsed : 0
  }

  // ---------------------------------------------------------------- internals

  /**
   * 이번 주기가 확정할 몫들. 락을 못 잡으면 `null`.
   *
   * **조건은 「상태가 `DELIVERED` 이고, `DELIVERED` 로 옮긴 이력이 기간보다
   * 오래됐다」 둘이다.** 앞쪽만 보면 어제 도착한 주문까지 확정하고, 뒤쪽만 보면 이미
   * 반품된 주문을 다시 건드린다.
   *
   * **락은 고르는 동안만 쥔다.** 옮기는 일이 몫마다 자기 트랜잭션이라 락을 그
   * 바깥에 둘 수 없고, 둘 수 있다 해도 두면 안 된다 — 배치가 200건을 옮기는 동안
   * 구매자의 수동 확정이 같은 락을 기다리게 된다.
   *
   * 그래서 이 락이 막는 것은 **겹친 두 인스턴스가 같은 목록을 집는 것**이다. 이력이
   * 두 줄 되는 것은 락이 아니라 문이 막는다 — `applyWithin` 이 행을 잠그고 상태를
   * 다시 보므로 늦게 온 쪽은 아무것도 바꾸지 않고 `noop` 으로 끝난다 (F7). 그 덕분에
   * 락을 짧게 쥐어도 안전한 것이지, 락이 없어도 되는 것은 아니다.
   *
   * 트랜잭션 단위 락인 이유는 스위퍼와 같다: 세션 락은 놓는 것을 잊으면 영원히 남고,
   * 잊는 경우는 예외가 아니라 프로세스가 죽는 경우다.
   */
  private claim(now: Date): Promise<readonly string[] | null> {
    return this.prisma.$transaction(async (tx) => {
      const [lock] = await tx.$queryRaw<readonly { readonly taken: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(${CONFIRM_LOCK_KEY}::bigint) AS "taken"
      `

      if (lock?.taken !== true) return null

      const rows = await tx.sellerOrder.findMany({
        where: {
          status: 'DELIVERED',
          statusHistory: {
            some: {
              toStatus: 'DELIVERED',
              createdAt: { lt: confirmableBefore(now, this.windowMs) },
            },
          },
        },
        // 오래된 것부터. `DELIVERED` 인 동안 이 몫을 건드리는 것은 이 배치뿐이라
        // `updatedAt` 이 곧 배송완료로 옮겨진 시각이고, 판단은 여전히 이력이 한다.
        orderBy: { updatedAt: 'asc' },
        take: CONFIRM_BATCH_LIMIT,
        select: { id: true },
      })

      return rows.map((row) => row.id)
    })
  }

  /**
   * 한 몫을 확정한다. **던지지 않는다.**
   *
   * 하나의 실패가 배치를 멈추면, 옮길 수 없는 몫 하나가 나머지 전부를 **영원히**
   * 막는다 — 목록이 오래된 것부터라서 그 한 건은 다음 주기에도 맨 앞에 있고, 그때도
   * 같은 자리에서 던진다 (`payment-reconcile.service.ts` 의 `resolveOne` 과 같은
   * 이유). 그래서 여기서 먹고 세기만 한다.
   *
   * 실제로 여기 걸리는 것은 **고른 뒤에 상태가 바뀐 몫**이다. 고르기와 옮기기 사이에
   * 판매자가 반품을 완료시키면 `DELIVERED → RETURNED` 가 이미 일어난 뒤이고, 그때
   * 문은 「정의되지 않은 전이」로 거절한다 — 그것이 옳다. 이 배치가 그 주문을 다시
   * 확정으로 끌어오면 반품된 물건이 정산 대상이 된다.
   *
   * 예외가 조용히 사라지지는 않는다. 몫의 id 와 함께 `error` 로 남고, 헬스체크가
   * 보는 「확정 건수」에는 들어가지 않는다.
   */
  private async confirmOne(sellerOrderId: string): Promise<ConfirmOutcome> {
    try {
      const event = await this.prisma.$transaction((tx) =>
        this.transitions.applyWithin(tx, sellerOrderId, 'CONFIRMED', {
          // 사람이 없는 전이다. 관리자 계정을 빌려 쓰면 이력에 「관리자가
          // 확정했다」는 거짓이 남는다 (설계서 1장).
          actor: 'SYSTEM',
          actorId: null,
          reason: '배송완료 후 구매확정 기간이 지나 자동으로 확정되었습니다.',
        }),
      )

      return event === null ? { kind: 'noop' } : { kind: 'confirmed', event }
    } catch (error) {
      this.log.error(`주문 ${sellerOrderId} 을(를) 자동 확정하지 못했습니다.`, error)

      return { kind: 'failed' }
    }
  }

  /**
   * 돈 사실을 남긴다. 헬스체크가 이 두 행을 읽는다.
   *
   * **건너뛴 주기는 여기까지 오지 않는다.** 락을 못 잡은 것을 「돌았다」로 적으면,
   * 실제로는 한 인스턴스도 확정하지 못하는 상태에서 헬스체크가 계속 초록을 답한다.
   */
  private async record(now: Date, tally: ConfirmTally): Promise<void> {
    for (const [key, value] of [
      [CONFIRM_LAST_RUN_KEY, now.toISOString()],
      [CONFIRM_LAST_CONFIRMED_KEY, String(tally.confirmed)],
    ] as const) {
      await this.prisma.appMeta.upsert({
        where: { key },
        create: { key, value },
        update: { value },
      })
    }
  }
}
