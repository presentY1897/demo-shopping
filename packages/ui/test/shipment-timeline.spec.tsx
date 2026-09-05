/**
 * 배송 타임라인이 **실제로 무엇으로 컴파일되는가** (TASK-0061).
 *
 * jsdom 에는 스타일시트도 레이아웃도 없다. 그래서 `shipment-tracking.spec.tsx`
 * 가 낭독되는 내용을 재는 동안, 눈에 보이는 쪽은 아무도 보지 않는다 — 오타 하나로
 * `border-border-strong` 이 `border-strong` 이 되면 점의 테두리가 사라지는데
 * 렌더 테스트는 전부 초록이다. 이 파일은 `container-query.spec.tsx` ·
 * `table-layout.spec.tsx` 와 같은 방식으로 그 구멍을 막는다: **렌더된 DOM 에서
 * 클래스를 읽어 진짜 Tailwind 로 컴파일한 뒤** 선언을 본다.
 */

import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { DENSITY_LEVELS, type DensityLevel } from '../src/density/density'
import { ShipmentTracking, type Shipment, type ShipmentTrackingLabels } from '../src/components'
import { classNamesIn, compileClasses, declarationFor, type CompiledRule } from './support/tailwind'
import { renderAtDensity, resetDensity } from './support/ui'

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
  notShippedDescription: '판매자가 발송하면 운송장 번호가 발급됩니다.',
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
  virtualNotice: '가상 배송 정보입니다. 실제 운송사에서는 조회되지 않습니다.',
}

const shipment: Shipment = {
  carrierCode: 'GA',
  carrierName: '가온물류',
  deliveredAt: null,
  events: [
    {
      description: '보내는 분에게서 상품을 받았습니다.',
      id: 'e1',
      kind: 'PICKED_UP',
      location: '가온시 새벽구 집화장',
      occurredAt: '2026-09-03T01:10:00.000Z',
    },
    {
      description: '배송기사가 상품을 가지고 출발했습니다.',
      id: 'e2',
      kind: 'OUT_FOR_DELIVERY',
      location: '노을시 물결구 대리점',
      occurredAt: '2026-09-05T00:05:00.000Z',
    },
  ],
  id: 'shp_1',
  sellerOrderId: 'so_1',
  shippedAt: '2026-09-03T01:10:00.000Z',
  status: 'OUT_FOR_DELIVERY',
  trackingNumber: 'DEMO-GA-482910375512',
}

function renderTracking(density: DensityLevel) {
  return renderAtDensity(
    density,
    <ShipmentTracking
      density={density}
      labels={labels}
      locale="ko-KR"
      onCopyTrackingNumber={() => undefined}
      shipment={shipment}
      timeZone="Asia/Seoul"
    />,
  )
}

afterEach(() => {
  resetDensity()
})

/**
 * 이 클래스가 CSS 를 한 줄이라도 만들었는가.
 *
 * `rulesForClass` 를 쓰지 않는 이유: 그쪽은 「이 클래스만 스타일하는 규칙」을
 * 고르느라 `.aria-disabled\:opacity-50[aria-disabled='true']` 처럼 **속성
 * 선택자가 붙는 변형**을 놓친다. 여기서 묻는 것은 훨씬 약한 질문 — 존재하는가 —
 * 이므로 선택자에 이름이 나타나기만 하면 된다. `size-4` 가 `size-40` 에 걸리지
 * 않도록 뒤쪽 경계만 본다.
 */
function isAlive(rules: readonly CompiledRule[], className: string): boolean {
  const pattern = new RegExp(`\\.${className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`)

  return rules.some((rule) => pattern.test(rule.selector.replace(/\\/g, '')))
}

describe('쓰인 클래스가 전부 살아 있다', () => {
  it.each([...DENSITY_LEVELS])('밀도 %i 에서 아무것도 하지 않는 클래스가 없다', async (density) => {
    const { container } = renderTracking(density)
    const classNames = classNamesIn(container.firstElementChild ?? container)
    const rules = await compileClasses(classNames)

    // 이 프리셋이 만들지 않는 유틸리티는 **CSS 를 한 줄도 내지 않는다.** 문자열
    // 비교로는 보이지 않고, 화면에서는 그저 스타일이 빠진 채로 보인다.
    const dead = classNames.filter((name) => !isAlive(rules, name))

    expect(dead).toEqual([])
  })
})

describe('「지금 여기」의 점은 색만 다른 것이 아니다', () => {
  it('현재 항목의 점이 나머지보다 크다 — 흑백으로 인쇄해도 남는 차이', async () => {
    const { container } = renderTracking(2)

    // 4단계 표시에도 점이 있으므로 타임라인 안으로 한정한다.
    const timeline = screen.getByRole('list', { name: labels.timelineLabel })
    const markers = [
      ...timeline.querySelectorAll('li[data-current] [aria-hidden="true"] > span:first-child'),
    ]
    const others = [
      ...timeline.querySelectorAll(
        'li:not([data-current]) [aria-hidden="true"] > span:first-child',
      ),
    ]

    const rules = await compileClasses([...classNamesIn(container.firstElementChild ?? container)])

    function widthOf(element: Element): string | undefined {
      for (const name of element.classList) {
        const width = declarationFor(rules, name, 'width')
        if (width !== undefined) return width
      }
      return undefined
    }

    const currentWidth = widthOf(markers[0] ?? container)
    const otherWidths = others.map(widthOf).filter((width) => width !== undefined)

    expect(currentWidth).toBeDefined()
    expect(otherWidths.length).toBeGreaterThan(0)
    for (const width of otherWidths) expect(width).not.toBe(currentWidth)
  })
})

describe('밀도가 실제로 무언가를 바꾼다', () => {
  it('세 단계의 클래스 집합이 서로 다르다', () => {
    const seen = DENSITY_LEVELS.map((density) => {
      const view = render(
        <ShipmentTracking
          density={density}
          labels={labels}
          locale="ko-KR"
          shipment={shipment}
          timeZone="Asia/Seoul"
        />,
      )
      const classNames = [...classNamesIn(view.container.firstElementChild ?? view.container)]
        .sort()
        .join(' ')

      view.unmount()
      return classNames
    })

    expect(new Set(seen).size).toBe(DENSITY_LEVELS.length)
  })
})
