/**
 * 확정 예정일 안내와 확정 뒤의 안내 (TASK-0064 F5 · F8).
 *
 * **이 화면이 말해야 하는 것은 날짜 하나가 아니다.** 데모는 시간을 압축해 실제보다
 * 빨리 확정하는데(`FULFILLMENT_PACE`), 그 설정은 어떤 응답에도 실리지 않는다. 그래서
 * 화면이 날짜만 적으면 데모에서 그 날짜는 **틀린 말**이 된다 — 압축된 시간을 실제라고
 * 오해하게 만드는 것이 이 TASK 가 명시적으로 금지한 것이고, 그것을 막는 것은
 * 예정일 · 규칙 · 「데모는 더 빠를 수 있다」 세 문장이 함께 있는 것이다.
 *
 * 확정된 뒤의 문장은 반대 방향이다. **새 규칙을 만들지 않는다** — 전이표에서
 * `CONFIRMED` 는 이미 종착이라 반품은 애초에 닫혀 있고, 화면이 할 일은 버튼이 사라진
 * 자리에 그 이유를 적는 것뿐이다.
 */

import {
  MOCK_ORDER_IDS,
  MOCK_ORDER_NOW,
  resetCartStore,
  resetOrderStore,
  sessionBuyer,
  shopperConfirmedOrder,
  shopperMixedOrder,
} from '@shopping/api-mocks'
import { DENSITY_LEVELS } from '@shopping/ui'
import { formatDate } from '@shopping/ui/format'
import { screen, within } from '@testing-library/react'
import axe from 'axe-core'
import type { RunOptions } from 'axe-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { OrderDetailScreen } from '@/components/mypage/order-detail-screen'
import { AUTO_CONFIRM_DAYS } from '@/lib/orders/auto-confirm'
import { messagesFor } from '@/messages'

import { renderAccountScreen, resetDensity } from './support/mypage'
import { stubViewport, VIEWPORTS } from './support/viewport'

vi.mock('next/navigation', () => ({ usePathname: () => '/mypage/orders/x' }))

const messages = messagesFor()
const copy = messages.mypage.orderDetail

const LUMIERE = '루미에르'
const NODESTEP = '노드스텝'

/**
 * 픽스처의 배송완료 시각과, 거기서 이레 뒤.
 *
 * 손으로 적는다. 픽스처에서 계산해 오면 이 스펙은 「같은 식을 두 번 돌렸다」가 되고,
 * 실제로 재려는 것 — 화면이 D+7 을 맞게 더하는가 — 을 재지 못한다.
 */
const DELIVERED_AT = '2026-09-06T02:30:00.000Z'
const DUE_AT = '2026-09-13T02:30:00.000Z'

const OPTIONS: RunOptions = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] },
  rules: {
    'color-contrast': { enabled: false },
    'html-has-lang': { enabled: false },
    'document-title': { enabled: false },
    region: { enabled: false },
    'landmark-one-main': { enabled: false },
  },
}

async function openDetail(id: string): Promise<void> {
  renderAccountScreen(<OrderDetailScreen id={id} messages={messages.mypage} />, {
    session: sessionBuyer,
  })
  await screen.findByRole('list', { name: copy.bundlesLabel })
}

function bundleOf(brand: string): HTMLElement {
  const heading = screen.getByRole('heading', { level: 3, name: brand })
  const item = heading.closest('li')

  if (item === null) throw new Error(`${brand} 묶음을 찾지 못했다`)

  return item
}

/** 사람이 읽을 날짜. 화면과 같은 형식기를 쓰되 **시각은 스펙이 정한다.** */
function readableDueDate(): string {
  return formatDate(DUE_AT, { locale: 'ko-KR', style: 'dateTime', timeZone: 'Asia/Seoul' })
}

beforeEach(() => {
  resetDensity()
  stubViewport(VIEWPORTS.desktop)
  resetOrderStore()
  resetCartStore()
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(new Date(MOCK_ORDER_NOW))
})

afterEach(() => {
  vi.useRealTimers()
  localStorage.clear()
  vi.unstubAllGlobals()
  resetOrderStore()
  resetCartStore()
})

describe('예정일을 어디서 얻는가', () => {
  const [delivered, shipped] = shopperMixedOrder.order.sellerOrders
  const confirmed = shopperConfirmedOrder.order.sellerOrders.at(0)

  /**
   * **서버가 준 값을 그대로 쓴다.** 화면이 이력에 이레를 더하면 시간을 압축한
   * 배포에서 그 날짜가 틀리고(배송완료 5분 뒤에 확정된다), 화면은 압축 여부를
   * 어떤 응답에서도 읽을 수 없다.
   */
  it('배송완료된 묶음에는 서버가 예정 시각을 준다', () => {
    expect(delivered?.status).toBe('DELIVERED')
    expect(delivered?.autoConfirmAt).toBe(DUE_AT)
  })

  it('기다리고 있지 않은 묶음에는 예정이 없다', () => {
    // 아직 오는 중인 묶음에 예정일이 있으면 일어나지 않은 배송완료를 전제한
    // 날짜이고, 이미 확정된 묶음에 있으면 지나간 예정을 말하는 것이 된다.
    expect(shipped?.autoConfirmAt).toBeNull()
    expect(confirmed?.autoConfirmAt).toBeNull()
  })

  it('규칙은 이레다', () => {
    // 화면이 사람에게 말하는 규칙의 숫자. 서버의 기간과 갈리면 이 검사가 아니라
    // 사람이 먼저 알아채는데, 그때는 이미 「7일이라더니 5일」이 된 뒤다.
    expect(AUTO_CONFIRM_DAYS).toBe(7)
    expect(Date.parse(DUE_AT) - Date.parse(DELIVERED_AT)).toBe(
      AUTO_CONFIRM_DAYS * 24 * 60 * 60 * 1_000,
    )
  })
})

describe('배송완료된 묶음의 안내 (F8)', () => {
  beforeEach(async () => {
    await openDetail(MOCK_ORDER_IDS.mixed)
  })

  it('언제 자동으로 확정되는지 말한다', () => {
    const notice = within(bundleOf(LUMIERE)).getByRole('note', { name: copy.autoConfirm.title })

    expect(notice).toHaveTextContent(readableDueDate())
  })

  it('실제 서비스의 규칙을 그 옆에 함께 말한다', () => {
    // **둘이 함께 있어야 한다.** 시각만 말하면 압축된 배포에서 「원래 이렇게 짧은
    // 서비스」로 읽히고, 규칙만 말하면 5분 뒤에 확정된 사람이 화면이 거짓말했다고
    // 읽는다. 화면은 압축 여부를 모르므로 그 둘의 차이로 말한다.
    const notice = within(bundleOf(LUMIERE)).getByRole('note', { name: copy.autoConfirm.title })

    expect(notice).toHaveTextContent(
      copy.autoConfirm.rule.replace('{days}', String(AUTO_CONFIRM_DAYS)),
    )
  })

  it('아직 배송 중인 묶음에는 예정일을 그리지 않는다', () => {
    expect(
      within(bundleOf(NODESTEP)).queryByRole('note', { name: copy.autoConfirm.title }),
    ).toBeNull()
  })

  it('밀도 3단계에서 모두 읽힌다', async () => {
    for (const level of DENSITY_LEVELS) {
      document.documentElement.setAttribute('data-density', String(level))

      expect(
        within(bundleOf(LUMIERE)).getByRole('note', { name: copy.autoConfirm.title }),
      ).toHaveTextContent(readableDueDate())
    }

    const results = await axe.run(document.body, OPTIONS)

    expect(results.violations.map((violation) => violation.id)).toEqual([])
  })
})

describe('확정된 묶음의 안내 (F5)', () => {
  beforeEach(async () => {
    await openDetail(MOCK_ORDER_IDS.confirmed)
  })

  it('반품이 닫혔다는 것과 그 예외를 말한다', () => {
    const notice = screen.getByRole('note', { name: copy.afterConfirm.title })

    expect(notice).toHaveTextContent(copy.afterConfirm.noReturn)
  })

  it('예정일 안내는 더 이상 나오지 않는다', () => {
    expect(screen.queryByRole('note', { name: copy.autoConfirm.title })).toBeNull()
  })

  it('접근성 위반 없이 그려진다', async () => {
    const results = await axe.run(document.body, OPTIONS)

    expect(results.violations.map((violation) => violation.id)).toEqual([])
  })
})
