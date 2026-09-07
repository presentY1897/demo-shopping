import { Inject, Injectable, Logger } from '@nestjs/common'

import { CatalogConsistencyService } from '../catalog/catalog-consistency.service.js'
import type { Clock } from '../common/clock.js'
import { CLOCK } from '../common/clock.js'
import { FollowConsistencyService } from '../collections/follow-consistency.service.js'
import { VirtualCardService } from '../payment/virtual-card.service.js'
import { PointsService } from '../points/points.service.js'
import { ReservationService } from '../reservation/reservation.service.js'
import { StockService } from '../stock/stock.service.js'

/**
 * 캐시 컬럼 일곱 개를 원본과 대조한다 (TASK-0097 4장).
 *
 * ## 왜 캐시가 있는가
 *
 * 전부 「원본을 미리 세어 둔 값」이다. 목록 한 장이 상품마다 집계를 하면 N+1 이 되고,
 * 그 비용은 데이터가 쌓일수록 커지는데 **화면은 멀쩡히 그려진다.** 그래서 세어 두고,
 * 그 대가로 「원본과 갈릴 수 있다」를 진다.
 *
 * ## 왜 한 배치인가
 *
 * 갈린 것을 발견하는 자리가 도메인마다 흩어져 있으면 **아무도 전부를 보지 않는다.**
 * 각 대사는 이미 자기 모듈에 있었다 — 재고·예약·적립금·가상카드 넷이 그렇다. 여기서
 * 하는 일은 그것들을 **부르는 것**이고, 없던 셋(평점·최저가·팔로워 수)만 새로 만들었다.
 *
 * 다시 구현하지 않는 이유는 그 판정이 도메인의 것이기 때문이다 — 「재고가 맞는가」는
 * 원장을 아는 쪽이 답해야 하고, 여기서 다시 세면 두 답이 갈릴 수 있다.
 *
 * ## 고치지 않는다
 *
 * **검출하고 기록만 한다.** 원인을 모르는 채 값을 고치면 문제가 숨는다 — 다음 주에
 * 같은 자리가 또 어긋나도 배치가 조용히 덮어써 버리고, 그러면 원인을 찾을 기회가
 * 영영 사라진다. 자동 보정은 「고장이 없다」가 아니라 「고장을 못 본다」를 만든다.
 */

/** 대사 한 축의 결과. 이름은 화면과 로그가 함께 쓴다. */
export interface ConsistencyCheck {
  readonly key: ConsistencyKey
  readonly discrepancies: number
  /** 처음 몇 건. 전부 싣지 않는 이유는 만 건이 어긋난 날 응답이 그만큼 커지기 때문이다. */
  readonly samples: readonly unknown[]
}

export const consistencyKeys = [
  'stock',
  'reserved',
  'pointBalance',
  'virtualCard',
  'rating',
  'minPrice',
  'followerCount',
] as const

export type ConsistencyKey = (typeof consistencyKeys)[number]

export interface ConsistencyReport {
  readonly at: string
  readonly total: number
  readonly checks: readonly ConsistencyCheck[]
}

/** 표본으로 남기는 건수. 원인을 짚기에는 몇 건이면 충분하다. */
const SAMPLE_LIMIT = 5

@Injectable()
export class ConsistencyService {
  private readonly logger = new Logger(ConsistencyService.name)

  constructor(
    private readonly stock: StockService,
    private readonly reservations: ReservationService,
    private readonly points: PointsService,
    private readonly cards: VirtualCardService,
    private readonly catalog: CatalogConsistencyService,
    private readonly follows: FollowConsistencyService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * 일곱 축을 한 번에 훑는다.
   *
   * **하나가 터져도 나머지는 답한다.** 대사는 진단이고, 진단 하나가 실패했다고
   * 나머지 여섯의 답을 버리면 사람이 볼 것이 없어진다 — 터진 축은 그 사실이 결과다.
   */
  async check(): Promise<ConsistencyReport> {
    const checks = await Promise.all([
      this.run('stock', () => this.stock.reconcile()),
      this.run('reserved', () => this.reservations.reconcile()),
      this.run('pointBalance', () => this.points.reconcile()),
      this.run('virtualCard', () => this.cards.reconcile()),
      this.run('rating', () => this.catalog.ratings()),
      this.run('minPrice', () => this.catalog.minPrices()),
      this.run('followerCount', () => this.follows.followers()),
    ])
    const total = checks.reduce((sum, check) => sum + check.discrepancies, 0)

    if (total > 0) {
      this.logger.warn(`정합성 불일치 ${String(total)}건 — ${summarise(checks)}`)
    }

    return { at: this.clock.now().toISOString(), total, checks }
  }

  private async run(
    key: ConsistencyKey,
    reconcile: () => Promise<readonly unknown[]>,
  ): Promise<ConsistencyCheck> {
    try {
      const found = await reconcile()

      return { key, discrepancies: found.length, samples: found.slice(0, SAMPLE_LIMIT) }
    } catch (error) {
      this.logger.error(`정합성 점검에 실패했습니다 — ${key}`, error)

      // **못 센 것을 0으로 답하지 않는다.** 0은 「맞다」는 뜻인데 이것은 「모른다」다.
      // -1 로 두는 이유는 그 둘이 화면에서 반드시 달라 보여야 하기 때문이다.
      return { key, discrepancies: -1, samples: [] }
    }
  }
}

function summarise(checks: readonly ConsistencyCheck[]): string {
  return checks
    .filter((check) => check.discrepancies !== 0)
    .map((check) => `${check.key}=${String(check.discrepancies)}`)
    .join(' · ')
}
