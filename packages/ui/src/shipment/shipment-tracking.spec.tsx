/**
 * 배송 추적 UI (TASK-0061 F4).
 *
 * QUALITY-GATES 가 UI 에 요구하는 것은 커버리지 숫자가 아니라 **상호작용 목록**
 * 이다 — 여기서 해당하는 것은 U1(조건부 렌더), U4(밀도 3단계), U5(키보드).
 * 거기에 이 컴포넌트가 스스로 진 약속 하나가 더 있다: **「지금 여기」는 색으로만
 * 전달되지 않는다.** 그 약속은 눈으로 보이지 않으므로 여기서 잰다.
 */

import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { axeRunOptions } from '../../stories/support/a11y'
import { DENSITY_LEVELS, type DensityLevel } from '../density/density'
import { renderAtDensity, resetDensity } from '../../test/support/ui'
import { ShipmentTracking, type ShipmentTrackingLabels } from './shipment-tracking'
import type { Shipment, TrackingEvent } from './shipment'

const labels: ShipmentTrackingLabels = {
  carrier: '운송사',
  copyTrackingNumber: '운송장 번호 복사',
  currentPosition: '현재 위치',
  deliveredAt: '배송 완료',
  eventKind: {
    PICKED_UP: '집화 완료',
    IN_TRANSIT: '간선 상차',
    OUT_FOR_DELIVERY: '배송 출발',
    DELIVERED: '배송 완료',
  },
  noEventsDescription: '운송사가 상품을 받으면 이력이 쌓입니다.',
  noEventsTitle: '아직 추적 이력이 없습니다',
  notShippedDescription: '판매자가 발송하면 운송장이 발급됩니다.',
  notShippedTitle: '아직 발송되지 않았습니다',
  progressLabel: '배송 진행 단계',
  shippedAt: '발송',
  status: {
    READY: '배송 준비중',
    IN_TRANSIT: '배송중',
    OUT_FOR_DELIVERY: '배송 출발',
    DELIVERED: '배송 완료',
  },
  stepState: { done: '완료', current: '현재 단계', upcoming: '예정' },
  timelineLabel: '배송 추적 이력',
  trackingNumber: '운송장 번호',
  virtualNotice: '가상 배송 정보입니다. 실제 운송사에서 조회되지 않습니다.',
}

const events: readonly TrackingEvent[] = [
  {
    description: '보내는 분에게서 상품을 받았습니다.',
    id: 'e1',
    kind: 'PICKED_UP',
    location: '가상시 새벽구 집화장',
    occurredAt: '2026-09-03T01:10:00.000Z',
  },
  {
    description: '다음 터미널로 이동 중입니다.',
    id: 'e2',
    kind: 'IN_TRANSIT',
    location: '가상시 한밭터미널',
    occurredAt: '2026-09-04T02:40:00.000Z',
  },
  {
    description: '배송기사가 상품을 가지고 출발했습니다.',
    id: 'e3',
    kind: 'OUT_FOR_DELIVERY',
    location: '노을시 물결구 대리점',
    occurredAt: '2026-09-05T00:05:00.000Z',
  },
]

const shipment: Shipment = {
  carrierCode: 'GA',
  carrierName: '가온물류',
  deliveredAt: null,
  events,
  id: 'shp_1',
  sellerOrderId: 'so_1',
  shippedAt: '2026-09-03T01:10:00.000Z',
  status: 'OUT_FOR_DELIVERY',
  trackingNumber: 'DEMO-GA-482910375512',
}

/** 시간대를 고정한다. 넘기지 않으면 실행 환경의 시간대가 결과를 바꾼다. */
const zone = { locale: 'ko-KR', timeZone: 'Asia/Seoul' }

function renderTracking(
  density: DensityLevel = 2,
  overrides: Partial<Shipment> | null = {},
  onCopyTrackingNumber?: (trackingNumber: string) => void,
) {
  return renderAtDensity(
    density,
    <ShipmentTracking
      density={density}
      labels={labels}
      onCopyTrackingNumber={onCopyTrackingNumber}
      shipment={overrides === null ? null : { ...shipment, ...overrides }}
      {...zone}
    />,
  )
}

function timelineItems(): readonly HTMLElement[] {
  return within(screen.getByRole('list', { name: labels.timelineLabel })).getAllByRole('listitem')
}

afterEach(() => {
  resetDensity()
})

describe('U1 — 그릴 것이 없을 때', () => {
  it('배송이 없는 주문은 「아직 발송되지 않았습니다」를 그린다', () => {
    renderTracking(2, null)

    expect(screen.getByText(labels.notShippedTitle)).toBeVisible()
    // 타임라인도 4단계도 없다. 아직 아무 일도 일어나지 않았으므로 진행을
    // 그리는 것은 없는 사실을 그리는 것이다.
    expect(screen.queryByRole('list', { name: labels.timelineLabel })).toBeNull()
    expect(screen.queryByRole('list', { name: labels.progressLabel })).toBeNull()
  })

  it('발송 전(READY)이라도 운송장이 있으면 4단계는 그린다', () => {
    renderTracking(2, { events: [], status: 'READY' })

    expect(screen.getByText(labels.noEventsTitle)).toBeVisible()
    expect(screen.queryByRole('list', { name: labels.timelineLabel })).toBeNull()

    const steps = within(screen.getByRole('list', { name: labels.progressLabel })).getAllByRole(
      'listitem',
    )

    expect(steps).toHaveLength(4)
    expect(steps[0]!).toHaveAttribute('aria-current', 'step')
  })

  it('이벤트가 있으면 타임라인이 시간순으로 나열된다', () => {
    // 뒤섞어 넘긴다. 순서를 서버에 맡기지 않는 것이 이 컴포넌트의 약속이다.
    renderTracking(2, { events: [events[2]!, events[0]!, events[1]!] })

    const items = timelineItems()

    expect(items).toHaveLength(3)
    for (const [index, kind] of (
      ['PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY'] as const
    ).entries())
      expect(within(items[index]!).getByText(labels.eventKind[kind])).toBeVisible()
  })
})

describe('타임라인의 접근성', () => {
  it('선과 점이 아니라 순서 있는 목록으로 읽힌다', () => {
    renderTracking(2)

    const timeline = screen.getByRole('list', { name: labels.timelineLabel })

    expect(timeline.tagName).toBe('OL')
    expect(within(timeline).getAllByRole('listitem')).toHaveLength(3)
  })

  it('「지금 여기」가 색 말고 다른 것으로도 전달된다', () => {
    renderTracking(2)

    const items = timelineItems()
    const current = items[items.length - 1]!

    // (1) 위치로 — 목록을 훑는 보조기술에 「현재 항목」으로 읽힌다.
    expect(current).toHaveAttribute('aria-current', 'step')
    expect(items.filter((item) => item.getAttribute('aria-current') === 'step')).toHaveLength(1)

    // (2) 글자로 — 색을 못 봐도, 흑백으로 인쇄해도, 낭독으로 들어도 남는다.
    expect(within(current).getByText(labels.currentPosition)).toBeVisible()
    for (const item of items.slice(0, -1)) {
      expect(within(item).queryByText(labels.currentPosition)).toBeNull()
    }

    // (3) 점은 그림이므로 접근성 트리에 없다. 색만으로 말하는 유일한 요소를
    //     낭독 대상에서 빼 두는 것이 (1)·(2)를 필수로 만든다.
    expect(current.querySelector('[aria-hidden="true"]')).not.toBeNull()
  })

  it('4단계 표시도 현재 단계를 자리와 글자로 함께 말한다', () => {
    renderTracking(2)

    const steps = within(screen.getByRole('list', { name: labels.progressLabel })).getAllByRole(
      'listitem',
    )
    const current = steps[2]!

    expect(current).toHaveAttribute('aria-current', 'step')
    expect(within(current).getByText(labels.stepState.current)).toBeInTheDocument()
    expect(within(steps[0]!).getByText(labels.stepState.done)).toBeInTheDocument()
    expect(within(steps[3]!).getByText(labels.stepState.upcoming)).toBeInTheDocument()
  })
})

describe('U4 — 밀도 3단계', () => {
  it('세 단계 모두 운송장 번호와 타임라인을 잃지 않는다', () => {
    for (const density of DENSITY_LEVELS) {
      const view = renderTracking(density)

      expect(screen.getByText(shipment.trackingNumber)).toBeVisible()
      expect(timelineItems()).toHaveLength(3)
      expect(screen.getByText(labels.virtualNotice)).toBeVisible()
      view.unmount()
    }
  })

  it('이벤트 설명은 표준부터 나온다', () => {
    const minimal = renderTracking(1)

    expect(screen.queryByText(events[0]!.description)).toBeNull()
    minimal.unmount()

    for (const density of [2, 3] as const) {
      const view = renderTracking(density)

      expect(screen.getByText(events[0]!.description)).toBeVisible()
      view.unmount()
    }
  })

  it('운송사 코드와 발송 시각은 맥시멀에서만 나온다', () => {
    const standard = renderTracking(2)

    expect(screen.queryByText(shipment.carrierCode)).toBeNull()
    expect(screen.queryByText(labels.shippedAt)).toBeNull()
    standard.unmount()

    renderTracking(3)
    expect(screen.getByText(shipment.carrierCode)).toBeVisible()
    expect(screen.getByText(labels.shippedAt)).toBeVisible()
  })

  it('미니멀은 단계 이름을 현재 것만 눈에 보이게 남긴다', () => {
    renderTracking(1)

    const steps = within(screen.getByRole('list', { name: labels.progressLabel })).getAllByRole(
      'listitem',
    )

    // 지운 것이 아니라 가린 것이다 — 낭독에는 그대로 남아 있다.
    expect(within(steps[2]!).getByText(labels.status.OUT_FOR_DELIVERY)).toBeInTheDocument()
    expect(within(steps[0]!).getByText(labels.status.READY)).toBeInTheDocument()
  })
})

describe('판매자와 구매자를 가르는 props', () => {
  it('복사 손잡이가 없으면 버튼도 없다 — 구매자 화면', () => {
    renderTracking(2)

    expect(screen.queryByRole('button', { name: labels.copyTrackingNumber })).toBeNull()
  })

  it('U5 — 복사 버튼은 키보드만으로 눌린다 (판매자 콘솔)', async () => {
    const onCopy = vi.fn()
    const user = userEvent.setup()

    renderTracking(2, {}, onCopy)

    await user.tab()
    expect(screen.getByRole('button', { name: labels.copyTrackingNumber })).toHaveFocus()

    await user.keyboard('{Enter}')
    expect(onCopy).toHaveBeenCalledWith(shipment.trackingNumber)
  })
})

describe('axe — 밀도 3단계', () => {
  // jsdom 에는 레이아웃도 그려진 화면도 없어 `color-contrast` 가 판정을 내지
  // 못한다. `test/story-a11y.spec.tsx` 와 같은 이유로 그 규칙만 뺀다 — 대비는
  // `test/color-tokens.spec.ts` 가 팔레트에서 직접 잰다.
  const options: typeof axeRunOptions = {
    ...axeRunOptions,
    rules: { ...axeRunOptions.rules, 'color-contrast': { enabled: false } },
  }

  for (const density of DENSITY_LEVELS) {
    it(`밀도 ${String(density)} 에서 위반이 없다`, async () => {
      renderTracking(density, {}, () => undefined)

      const results = await axe.run(document.body, options)

      expect(results.violations.map((violation) => violation.id)).toEqual([])
    })

    it(`밀도 ${String(density)} — 발송 전에도 위반이 없다`, async () => {
      renderTracking(density, { events: [], status: 'READY' })

      const results = await axe.run(document.body, options)

      expect(results.violations.map((violation) => violation.id)).toEqual([])
    })
  }

  it('배송이 없는 주문도 위반이 없다', async () => {
    renderTracking(2, null)

    const results = await axe.run(document.body, options)

    expect(results.violations.map((violation) => violation.id)).toEqual([])
  })
})
