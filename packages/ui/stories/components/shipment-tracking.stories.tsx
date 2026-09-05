/**
 * `ShipmentTracking` — 배송 추적 (TASK-0061).
 *
 * 구매자 화면(TASK-0063)과 판매자 콘솔(TASK-0060)이 같은 한 벌을 쓴다. 두 곳의
 * 다른 필요는 props 로 갈린다 — 판매자에게는 `onCopyTrackingNumber` 가, 구매자
 * 에게는 타임라인이 중요하다.
 *
 * **눈에는 선과 점, 스크린 리더에는 순서 있는 목록이다.** 점과 선을 그리는 요소는
 * 전부 `aria-hidden` 이고, 「지금 여기」는 색이 아니라 `aria-current="step"` ·
 * 눈에 보이는 「현재 위치」 배지 · 점의 크기 차이 셋으로 전달된다 (WCAG 1.4.1).
 * 툴바의 Density 를 세 단계로 옮겨 보면 무엇이 늘고 주는지가 보인다.
 */

import type { Meta, StoryObj } from '@storybook/react-vite'

import {
  ShipmentProgress,
  ShipmentTracking,
  TrackingTimeline,
  type Shipment,
  type ShipmentTrackingLabels,
  type TrackingEvent,
} from '../../src/components'
import { DENSITY_LEVELS } from '../../src/density'
import { Stack } from '../support/layout'

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

/** 가상 지명·가상 운송사. 실제 상표는 쓰지 않는다 (TASK-0061 F7). */
const events: readonly TrackingEvent[] = [
  {
    description: '보내는 분에게서 상품을 받았습니다.',
    id: 'e1',
    kind: 'PICKED_UP',
    location: '가온시 새벽구 집화장',
    occurredAt: '2026-09-03T01:10:00.000Z',
  },
  {
    description: '다음 터미널로 이동하고 있습니다.',
    id: 'e2',
    kind: 'IN_TRANSIT',
    location: '한밭 허브터미널',
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

const meta = {
  title: 'Components/ShipmentTracking',
  component: ShipmentTracking,
  tags: ['autodocs'],
  args: { density: 2, labels, locale: 'ko-KR', shipment, timeZone: 'Asia/Seoul' },
  argTypes: { density: { control: 'inline-radio', options: [...DENSITY_LEVELS] } },
} satisfies Meta<typeof ShipmentTracking>

export default meta

type Story = StoryObj<typeof meta>

/** 구매자 화면. 복사 손잡이가 없으므로 버튼도 그려지지 않는다. */
export const Default: Story = {}

/**
 * 판매자 콘솔. 운송장 번호를 상담·조회에 그대로 옮겨야 하므로 복사 버튼이 붙는다.
 * 클립보드 접근은 앱의 몫이라 컴포넌트는 「눌렸다」만 알린다.
 */
export const SellerConsole: Story = {
  args: {
    density: 2,
    onCopyTrackingNumber: () => undefined,
  },
}

/**
 * 세 단계를 나란히.
 *
 * 미니멀은 단계 이름을 현재 것만 남기고(가릴 뿐 지우지 않는다) 이벤트 설명을
 * 접는다. 맥시멀은 운송사 코드와 발송 시각까지 꺼낸다 — 운영이 쓰는 값이다.
 */
export const Densities: Story = {
  render: (args) => (
    <Stack>
      {DENSITY_LEVELS.map((density) => (
        <ShipmentTracking {...args} density={density} key={density} />
      ))}
    </Stack>
  ),
}

/** 배송 완료. 4단계가 전부 채워지고 「현재 위치」는 마지막 이벤트에 붙는다. */
export const Delivered: Story = {
  args: {
    shipment: {
      ...shipment,
      deliveredAt: '2026-09-05T08:30:00.000Z',
      events: [
        ...events,
        {
          description: '고객님께 상품이 전달되었습니다.',
          id: 'e4',
          kind: 'DELIVERED',
          location: '노을시 물결구 (문 앞)',
          occurredAt: '2026-09-05T08:30:00.000Z',
        },
      ],
      status: 'DELIVERED',
    },
  },
}

/**
 * `READY` — 집화는 됐는데 이력이 아직 안 붙은 순간.
 *
 * 서버 계약상 운송장은 발송 처리와 함께 나오고 그때 첫 이벤트가 남으므로 실제로는
 * 드물다. 그래도 그린다 — 「목록이 비었다」를 처리하지 않은 화면은 그 드문 순간에
 * 아무것도 없는 자리를 보여 준다.
 */
export const ReadyWithoutEvents: Story = {
  args: {
    shipment: { ...shipment, deliveredAt: null, events: [], status: 'READY' },
  },
}

/**
 * 배송이 **없는** 주문.
 *
 * 「데이터가 없다」가 아니라 「보낸 적이 없다」이므로, 호출하는 쪽이 컴포넌트를
 * 감추게 두지 않고 `null` 을 받아 직접 그린다.
 */
export const NotShipped: Story = {
  args: { shipment: null },
}

/**
 * 조각 둘을 따로 쓸 수도 있다 — 주문 목록의 한 줄에는 4단계만, 상세의 아래쪽에는
 * 타임라인만 필요할 때가 있다.
 */
export const Pieces: Story = {
  render: (args) => (
    <Stack>
      <ShipmentProgress density={args.density} labels={labels} status="IN_TRANSIT" />
      <TrackingTimeline
        density={args.density}
        events={events}
        labels={labels}
        locale="ko-KR"
        timeZone="Asia/Seoul"
      />
    </Stack>
  ),
}
