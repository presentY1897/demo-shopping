/**
 * 기간·상태 필터와 상태 사다리 — 순수 로직 (QUALITY-GATES Q5).
 *
 * 렌더가 없다. 입력 → 출력이라 **분기 전부에 값으로 닿을 수 있고**, 그것이 이 코드가
 * 컴포넌트가 아니라 함수로 있는 이유다 — 「3개월 경계에서 어느 쪽인가」를 클릭으로
 * 확인하려면 시계를 옮기고 화면을 그린 뒤 목록을 세어야 한다.
 *
 * **시각은 인자다.** `vi.setSystemTime` 을 쓰지 않는 것이 규약이고(6장 「시간:
 * 주입」), 여기서는 그 덕분에 경계 양쪽을 한 줄씩으로 적을 수 있다.
 *
 * 필터가 **거름망이 아니라 질의**가 된 뒤로(TASK-0063 2장) 여기서 재는 것도
 * 바뀌었다 — 「이 주문이 조건에 드는가」가 아니라 「이 조건이 어떤 질의가 되는가」다.
 * 실제로 걸러지는지는 서버가 답할 일이고, `apps/api` 의 통합 검사가 잰다.
 */

import { orderStatuses, type OrderStatus } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import type { OrderStatusFilter } from '@/lib/orders/order-filters'
import {
  DEFAULT_ORDER_FILTER,
  isDefaultFilter,
  orderListQueryOf,
  orderPeriods,
  orderStatusFilters,
  periodStart,
  statusesIn,
} from '@/lib/orders/order-filters'
import { ORDER_STAGES, isOnLadder, orderStages, stageStateAt } from '@/lib/orders/order-stages'

const NOW = new Date('2026-09-06T00:00:00.000Z')

describe('상태 묶음 표', () => {
  it('아홉 개 상태를 정확히 한 번씩 덮는다', () => {
    // 이 단언이 표를 전수·배타로 지킨다. 타입으로는 앞의 절반만 표현되고 —
    // 키가 필터 쪽이라 새 `OrderStatus` 는 컴파일을 깨지 않는다 — 나머지 절반이
    // 여기 있다. 상태가 하나 늘면 이 검사가 빨개진다.
    const covered = orderStatusFilters
      .filter((filter): filter is Exclude<OrderStatusFilter, 'all'> => filter !== 'all')
      .flatMap((filter) => statusesIn(filter))

    expect([...covered].sort()).toEqual([...orderStatuses].sort())
  })

  it('「전체」는 아홉 개를 전부 덮는다', () => {
    expect([...statusesIn('all')].sort()).toEqual([...orderStatuses].sort())
  })
})

describe('기간', () => {
  it('「전체」는 자르지 않는다', () => {
    expect(periodStart('all', NOW)).toBeNull()
  })

  it.each([
    ['1m', '2026-08-06T00:00:00.000Z'],
    ['3m', '2026-06-06T00:00:00.000Z'],
    ['6m', '2026-03-06T00:00:00.000Z'],
    ['1y', '2025-09-06T00:00:00.000Z'],
  ] as const)('%s 은 %s 부터다', (period, expected) => {
    expect(periodStart(period, NOW)?.toISOString()).toBe(expected)
  })

  it('선택지가 다섯이고 기본은 아무것도 좁히지 않는다', () => {
    expect(orderPeriods).toHaveLength(5)
    // **기본이 「전부」인 것이 빈 화면의 뜻을 지킨다.** 「최근 3개월」이 기본이면
    // 사람이 고르지 않은 조건이 결과를 지우고, 오래된 주문만 있는 계정이 「아직
    // 주문한 상품이 없습니다」를 본다 — 틀린 문장이다.
    expect(DEFAULT_ORDER_FILTER.period).toBe('all')
  })
})

describe('질의로 옮기기', () => {
  it('기본 조건은 아무 파라미터도 보내지 않는다', () => {
    // 상태가 「전체」면 파라미터가 아예 없다. 아홉 상태를 나열해 보내면 뜻은
    // 같지만 같은 화면이 두 가지 주소를 갖게 된다. 기간도 같아서, 기본 조건의
    // 질의는 **빈 것**이다 — 좁히는 것은 사람이 고를 때만 일어난다.
    expect(orderListQueryOf(DEFAULT_ORDER_FILTER, NOW)).toEqual({})
  })

  it('석 달을 고르면 그 시작을 보낸다', () => {
    expect(orderListQueryOf({ period: '3m', status: 'all' }, NOW)).toEqual({
      from: '2026-06-06T00:00:00.000Z',
    })
  })

  it('상태 탭 하나가 상태 여럿이 된다', () => {
    // 탭의 정의는 화면이 갖고 서버는 `OrderStatus` 목록만 받는다. 「결제 대기」가
    // 둘인 것을 서버가 알 필요가 없다.
    expect(orderListQueryOf({ period: 'all', status: 'pending' }, NOW)).toEqual({
      status: ['PAYMENT_PENDING', 'PAYMENT_FAILED'],
    })
    expect(orderListQueryOf({ period: 'all', status: 'closed' }, NOW)).toEqual({
      status: ['CANCELED', 'RETURNED'],
    })
  })

  it('기간과 상태를 함께 보낸다', () => {
    expect(orderListQueryOf({ period: '1m', status: 'shipping' }, NOW)).toEqual({
      from: '2026-08-06T00:00:00.000Z',
      status: ['SHIPPED'],
    })
  })

  it('끝(`to`)은 보내지 않는다', () => {
    // 선택지가 전부 「최근 n개월」이라 끝이 언제나 지금이고, 「지금」을 적으면
    // 새로고침마다 다른 질의가 된다.
    expect(orderListQueryOf({ period: '6m', status: 'delivered' }, NOW).to).toBeUndefined()
  })
})

describe('isDefaultFilter', () => {
  it('기본값에서만 참이다', () => {
    expect(isDefaultFilter(DEFAULT_ORDER_FILTER)).toBe(true)
    expect(isDefaultFilter({ period: '3m', status: 'all' })).toBe(false)
    expect(isDefaultFilter({ period: 'all', status: 'shipping' })).toBe(false)
  })
})

/* ------------------------------------------------------------- 상태 사다리 -- */

type SellerOrderInput = Parameters<typeof orderStages>[0]
type SellerOrderShipment = SellerOrderInput['shipment']
type History = SellerOrderInput['history']

function bundle(
  status: OrderStatus,
  shipment: SellerOrderShipment = null,
  history: History = [],
): SellerOrderInput {
  return {
    id: '019596d0-1f1c-7c2e-9a0e-6d0000000001',
    sellerId: '019596d0-1f1c-7c2e-9a0e-5a0000000001',
    brandName: '루미에르',
    status,
    items: [],
    productAmount: 0,
    couponDiscountAmount: 0,
    pointDiscountAmount: 0,
    shippingPointAmount: 0,
    shippingFee: 0,
    paidAmount: 0,
    shipment,
    history,
  }
}

const SHIPMENT = {
  id: '019596d0-1f1c-7c2e-9a0e-6c0000000001',
  sellerOrderId: '019596d0-1f1c-7c2e-9a0e-6d0000000001',
  carrierCode: 'GA' as const,
  carrierName: '가온물류',
  trackingNumber: 'DEMO-GA-000000000101',
  status: 'DELIVERED' as const,
  shippedAt: '2026-09-05T08:00:00.000Z',
  deliveredAt: '2026-09-06T02:30:00.000Z',
  events: [],
}

/** 이력 한 줄. 사다리가 읽는 것은 `toStatus` 와 `occurredAt` 둘뿐이다. */
function entry(toStatus: OrderStatus, occurredAt: string, index = 0): History[number] {
  return {
    id: `019596d0-1f1c-7c2e-9a0e-6f000000000${String(index)}`,
    fromStatus: null,
    toStatus,
    actor: 'SYSTEM',
    reason: null,
    occurredAt,
  }
}

const FULL_HISTORY: History = [
  entry('PAYMENT_PENDING', '2026-09-05T04:02:30.000Z', 1),
  entry('PAID', '2026-09-05T04:03:12.000Z', 2),
  entry('PREPARING', '2026-09-05T05:40:00.000Z', 3),
  entry('SHIPPED', '2026-09-05T08:00:00.000Z', 4),
  entry('DELIVERED', '2026-09-06T02:30:00.000Z', 5),
  entry('CONFIRMED', '2026-09-06T09:00:00.000Z', 6),
]

describe('상태 사다리', () => {
  it('다섯 칸이다', () => {
    expect(ORDER_STAGES).toEqual(['PAID', 'PREPARING', 'SHIPPED', 'DELIVERED', 'CONFIRMED'])
  })

  it.each(['PAYMENT_PENDING', 'PAYMENT_FAILED', 'CANCELED', 'RETURNED'] as const)(
    '%s 는 사다리 밖이라 null 이다',
    (status) => {
      // 취소된 주문에 회색 사다리를 남겨 두면 화면이 아직 그리로 갈 것처럼 말한다.
      expect(isOnLadder(status)).toBe(false)
      expect(orderStages(bundle(status, null, FULL_HISTORY))).toBeNull()
    },
  )

  it('지난 칸·현재 칸·남은 칸을 가른다', () => {
    const steps = orderStages(bundle('SHIPPED', SHIPMENT, FULL_HISTORY))

    expect(steps?.map((step) => step.state)).toEqual([
      'done',
      'done',
      'current',
      'upcoming',
      'upcoming',
    ])
  })

  it('이력이 있으면 다섯 칸에 시각이 붙는다', () => {
    // 이력이 묶음 안으로 들어오기 전에는 여기서 아는 시각이 둘뿐이었다 —
    // `shippedAt` 과 `deliveredAt`. 나머지 셋은 「시각 정보 없음」이었다.
    const steps = orderStages(bundle('CONFIRMED', SHIPMENT, FULL_HISTORY))

    expect(steps?.map((step) => step.at)).toEqual([
      '2026-09-05T04:03:12.000Z',
      '2026-09-05T05:40:00.000Z',
      '2026-09-05T08:00:00.000Z',
      '2026-09-06T02:30:00.000Z',
      '2026-09-06T09:00:00.000Z',
    ])
  })

  it('접수 시각(`PAYMENT_PENDING`)은 어느 칸에도 놓지 않는다', () => {
    // 「결제완료 · (접수 시각)」이 가장 하기 쉬운 거짓말이다. 사다리에 없는 상태로
    // 옮긴 줄은 이력에 있어도 칸의 시각이 되지 않는다.
    const steps = orderStages(
      bundle('PAID', null, [entry('PAYMENT_PENDING', '2026-09-05T04:02:30.000Z', 1)]),
    )

    expect(steps?.every((step) => step.at === null)).toBe(true)
  })

  it('이력이 비어 있으면 다섯 칸이 전부 시각 없이 남는다', () => {
    // 상태 이력이 쌓이기 전의 주문. **사다리를 이력으로 덮어쓰면** 이 주문의 화면이
    // 통째로 사라진다 — 칸은 그대로이고 모르는 것만 모른다고 적혀야 한다.
    const steps = orderStages(bundle('CONFIRMED', null, []))

    expect(steps).toHaveLength(5)
    expect(steps?.every((step) => step.at === null)).toBe(true)
  })

  it('이력이 그 칸을 모르면 배송 행이 아는 시각을 쓴다', () => {
    const steps = orderStages(bundle('DELIVERED', SHIPMENT, []))

    expect(steps?.[2]?.at).toBe(SHIPMENT.shippedAt)
    expect(steps?.[3]?.at).toBe(SHIPMENT.deliveredAt)
    // 배송 행이 모르는 두 칸은 그대로 모른다.
    expect(steps?.[0]?.at).toBeNull()
    expect(steps?.[1]?.at).toBeNull()
  })

  it('이력이 배송 행보다 앞선다', () => {
    // 실제 서버는 둘을 한 트랜잭션에서 쓰므로 같은 값이지만, 갈리면 답해야 하는
    // 것은 「상태가 언제 옮겨졌나」다.
    const steps = orderStages(
      bundle('SHIPPED', SHIPMENT, [entry('SHIPPED', '2026-09-05T07:59:00.000Z', 1)]),
    )

    expect(steps?.[2]?.at).toBe('2026-09-05T07:59:00.000Z')
  })

  it('아직 오지 않은 칸에는 시각을 싣지 않는다', () => {
    // 사건이 순서를 뒤집어 도착해 배송완료 시각이 있는데 상태가 `SHIPPED` 인 경우.
    // 「예정」 칸에 지난 시각이 붙으면 화면이 스스로와 모순된다.
    const steps = orderStages(bundle('SHIPPED', SHIPMENT, FULL_HISTORY))

    expect(steps?.[3]?.at).toBeNull()
    expect(steps?.[4]?.at).toBeNull()
  })

  it('발송 전이면 뒤 세 칸이 시각 없이 남는다', () => {
    const steps = orderStages(
      bundle('PREPARING', null, [
        entry('PAID', '2026-09-05T04:03:12.000Z', 1),
        entry('PREPARING', '2026-09-05T05:40:00.000Z', 2),
      ]),
    )

    expect(steps?.map((step) => step.at)).toEqual([
      '2026-09-05T04:03:12.000Z',
      '2026-09-05T05:40:00.000Z',
      null,
      null,
      null,
    ])
  })

  it.each([
    [0, 2, 'done'],
    [2, 2, 'current'],
    [3, 2, 'upcoming'],
  ] as const)('stageStateAt(%i, %i) = %s', (index, current, expected) => {
    expect(stageStateAt(index, current)).toBe(expected)
  })
})
