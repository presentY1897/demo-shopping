/**
 * `/mypage/orders/[id]` — 주문 상세 (TASK-0063 F1~F7).
 *
 * **이 파일이 확인하는 것 하나로 줄이면**: 한 주문번호 아래에서 판매자마다 상태가
 * 다르고, 화면이 그것을 뭉개지 않는다는 것 (D-023).
 *
 * 그 다음이 구매확정이다 — 서버가 답한 액션 목록에서만 나오고, 확인을 거치며,
 * 되돌릴 수 없다는 것을 사람이 읽을 수 있어야 하고, 두 번 눌러도 오류가 아니다.
 */

import {
  httpFailureOn,
  MOCK_ORDER_IDS,
  MOCK_ORDER_NOW,
  MOCK_SELLER_ORDER_IDS,
  mockPaths,
  resetCartStore,
  resetOrderStore,
  sessionBuyer,
  shopperCanceledOrder,
  shopperDeletedProductOrder,
  shopperMixedOrder,
} from '@shopping/api-mocks'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { UserEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { OrderDetailScreen } from '@/components/mypage/order-detail-screen'
import { AUTO_CONFIRM_DAYS } from '@/lib/orders/auto-confirm'
import { messagesFor } from '@/messages'

import { testServer } from './setup'
import { renderAccountScreen, resetDensity } from './support/mypage'
import { stubViewport, VIEWPORTS } from './support/viewport'

vi.mock('next/navigation', () => ({ usePathname: () => '/mypage/orders/x' }))

const messages = messagesFor()
const copy = messages.mypage.orderDetail

const LUMIERE = '루미에르'
const NODESTEP = '노드스텝'
const MARU = '마루상회'

async function openDetail(id: string = MOCK_ORDER_IDS.mixed): Promise<UserEvent> {
  const user = userEvent.setup()

  renderAccountScreen(<OrderDetailScreen id={id} messages={messages.mypage} />, {
    session: sessionBuyer,
  })
  await screen.findByRole('list', { name: copy.bundlesLabel })

  return user
}

/** 브랜드 이름이 붙은 묶음 하나. 셋이 같은 모양이라 이름으로 가른다. */
function bundleOf(brand: string): HTMLElement {
  const heading = screen.getByRole('heading', { level: 3, name: brand })
  const item = heading.closest('li')

  if (item === null) throw new Error(`${brand} 묶음을 찾지 못했다`)

  return item
}

/**
 * 상태 배지 하나.
 *
 * 같은 글자가 타임라인의 칸 이름으로도 나온다 — 「배송완료」는 지금 상태이기도 하고
 * 사다리의 넷째 칸이기도 하다. 그 둘이 같은 말을 하는 것이 정상이므로, 검사는
 * 배지가 붙이는 `data-status` 로 어느 쪽을 보고 있는지 밝힌다.
 */
function statusBadge(bundle: HTMLElement, status: string): HTMLElement {
  const badge = bundle.querySelector(`[data-status="${status}"]`)

  if (badge === null) throw new Error(`${status} 배지가 없다`)

  return badge as HTMLElement
}

/** 묶음 목록의 **바로 아래** 항목만. 안에 항목 목록과 타임라인이 더 있다. */
function bundleCount(): number {
  const list = screen.getByRole('list', { name: copy.bundlesLabel })

  return [...list.children].filter((child) => child.tagName === 'LI').length
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

describe('판매자별 묶음 (F1 · F2)', () => {
  it('판매자가 셋이면 묶음이 셋이다', async () => {
    await openDetail()

    expect(bundleCount()).toBe(shopperMixedOrder.order.sellerOrders.length)
  })

  it('묶음마다 다른 상태를 그린다', async () => {
    await openDetail()

    // 하나의 주문번호 아래 배송완료 · 배송중 · 상품준비중이 동시에 참이다.
    expect(statusBadge(bundleOf(LUMIERE), 'DELIVERED')).toHaveTextContent(copy.statuses.DELIVERED)
    expect(statusBadge(bundleOf(NODESTEP), 'SHIPPED')).toHaveTextContent(copy.statuses.SHIPPED)
    expect(statusBadge(bundleOf(MARU), 'PREPARING')).toHaveTextContent(copy.statuses.PREPARING)
  })

  it('주문번호가 하나임을 문장으로 말한다 (R1)', async () => {
    await openDetail()

    expect(
      screen.getByText(
        copy.splitNotice.replace('{count}', String(shopperMixedOrder.order.sellerOrders.length)),
      ),
    ).toBeVisible()
  })

  it('판매자가 하나면 그 문장이 나오지 않는다', async () => {
    await openDetail(MOCK_ORDER_IDS.canceled)

    // 나뉘지 않은 것을 두고 「나뉘어 배송됩니다」라고 하면 그 문장이 소음이 된다.
    expect(screen.queryByText(/각각 발송됩니다/u)).not.toBeInTheDocument()
  })
})

describe('배송 (F5)', () => {
  it('발송 전 묶음은 「아직 발송 전」을 접지 않고 보여 준다', async () => {
    await openDetail()

    // `shipment === null` 은 「못 읽었다」가 아니라 「아직 안 보냈다」이고, 그것은
    // 사람이 이 화면에 온 이유일 수 있어 클릭 뒤에 두지 않는다.
    expect(within(bundleOf(MARU)).getByText(copy.tracking.notShippedTitle)).toBeVisible()
    expect(
      within(bundleOf(MARU)).queryByRole('button', {
        name: copy.tracking.open.replace('{brand}', MARU),
      }),
    ).not.toBeInTheDocument()
  })

  it('배송조회를 열면 추적 이력이 나온다', async () => {
    const user = await openDetail()

    const toggle = within(bundleOf(LUMIERE)).getByRole('button', {
      name: copy.tracking.open.replace('{brand}', LUMIERE),
    })

    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).not.toHaveAttribute('aria-controls')

    await user.click(toggle)

    const opened = within(bundleOf(LUMIERE)).getByRole('button', {
      name: copy.tracking.close.replace('{brand}', LUMIERE),
    })

    expect(opened).toHaveAttribute('aria-expanded', 'true')
    expect(document.getElementById(opened.getAttribute('aria-controls') ?? '')).not.toBeNull()
    expect(
      within(bundleOf(LUMIERE)).getByRole('list', { name: copy.tracking.timelineLabel }),
    ).toBeVisible()
    // 가상 배송임을 화면이 직접 말한다 (TASK-0061 R1).
    expect(within(bundleOf(LUMIERE)).getByText(copy.tracking.virtualNotice)).toBeVisible()
  })

  it('묶음마다 자기 운송장을 그린다', async () => {
    const user = await openDetail()

    await user.click(
      within(bundleOf(NODESTEP)).getByRole('button', {
        name: copy.tracking.open.replace('{brand}', NODESTEP),
      }),
    )

    expect(within(bundleOf(NODESTEP)).getByText('DEMO-HD-000000000102')).toBeVisible()
  })
})

describe('상태 타임라인', () => {
  it('사다리 위의 묶음은 다섯 칸을 그린다', async () => {
    await openDetail()

    const timeline = within(bundleOf(NODESTEP)).getByRole('list', { name: copy.timeline.label })

    expect(within(timeline).getAllByRole('listitem')).toHaveLength(5)
    expect(within(timeline).getByText(copy.timeline.stages.SHIPPED)).toBeVisible()
  })

  it('지나온 칸에 이력의 시각을 적는다', async () => {
    await openDetail()

    const timeline = within(bundleOf(LUMIERE)).getByRole('list', { name: copy.timeline.label })
    const times = within(timeline)
      .getAllByRole('listitem')
      .map((item) => item.querySelector('time')?.getAttribute('datetime') ?? null)

    // **이력이 묶음 안으로 들어오기 전에는 둘뿐이었다** — 배송 행이 아는
    // `shippedAt` 과 `deliveredAt`. 나머지 셋은 「시각 정보 없음」이었고, 그때
    // 이 화면의 「타임라인」은 이력이 아니라 사다리였다.
    expect(times).toEqual([
      '2026-09-05T04:03:12.000Z',
      '2026-09-05T05:40:00.000Z',
      '2026-09-05T08:00:00.000Z',
      '2026-09-06T02:30:00.000Z',
      // 구매확정은 아직 오지 않은 칸이다. 예정인 칸에 시각을 붙이지 않는다.
      null,
    ])
  })

  it('아직 오지 않은 칸은 비워 두지 않고 「모른다」고 적는다', async () => {
    await openDetail()

    // 배송중인 묶음의 뒤 두 칸. 빈칸은 「그런 일이 없었다」로 읽힌다.
    expect(within(bundleOf(NODESTEP)).getAllByText(copy.timeline.unknownAt)).toHaveLength(2)
  })

  it('이력이 없는 주문은 사다리를 지우지 않고 시각만 비운다', async () => {
    await openDetail(MOCK_ORDER_IDS.deleted)

    const timeline = screen.getByRole('list', { name: copy.timeline.label })

    // 상태 이력이 쌓이기 전에 지나간 주문. 사다리를 이력으로 **덮어쓰면** 이
    // 주문의 타임라인이 통째로 사라진다 — 칸은 다섯 그대로이고, 모르는 것만
    // 모른다고 적혀야 한다.
    expect(within(timeline).getAllByRole('listitem')).toHaveLength(5)
    expect(within(timeline).getAllByText(copy.timeline.unknownAt)).toHaveLength(5)
  })

  it('취소된 묶음에는 사다리 대신 한 문장을 그린다', async () => {
    await openDetail(MOCK_ORDER_IDS.canceled)

    expect(
      screen.getByText(copy.timeline.offLadder.replace('{status}', copy.statuses.CANCELED)),
    ).toBeVisible()
    expect(screen.queryByRole('list', { name: copy.timeline.label })).not.toBeInTheDocument()
  })
})

describe('구매확정 (F3)', () => {
  it('배송완료 묶음에만 버튼이 있다', async () => {
    await openDetail()

    // 화면이 상태로 분기해 정한 것이 아니라 서버의 가능 액션 목록이 정한 것이다.
    expect(
      await within(bundleOf(LUMIERE)).findByRole('button', {
        name: `${copy.confirm.action} ${LUMIERE}`,
      }),
    ).toBeVisible()
    expect(
      within(bundleOf(NODESTEP)).queryByRole('button', {
        name: `${copy.confirm.action} ${NODESTEP}`,
      }),
    ).not.toBeInTheDocument()
    expect(
      within(bundleOf(MARU)).queryByRole('button', { name: `${copy.confirm.action} ${MARU}` }),
    ).not.toBeInTheDocument()
  })

  it('되돌릴 수 없다는 것과 자동 확정을 확인창이 말한다', async () => {
    const user = await openDetail()

    await user.click(
      await within(bundleOf(LUMIERE)).findByRole('button', {
        name: `${copy.confirm.action} ${LUMIERE}`,
      }),
    )

    const dialog = await screen.findByRole('dialog', { name: copy.confirm.title })

    // 정산과 적립금 지급의 방아쇠이고 되돌릴 수 없다 (`state-machines.md` 1장).
    expect(within(dialog).getByText(copy.confirm.consequences)).toBeVisible()
    expect(within(dialog).getByText(copy.confirm.irreversible)).toBeVisible()
    // 확인창이 말하는 시각은 카드의 안내와 **같은 값**이다 — 서버가 준 예정 시각
    // 하나이고, 둘이 갈리면 사람은 어느 쪽이 맞는지 모른다.
    expect(within(dialog).getByText(/자동으로 확정됩니다/u)).toBeVisible()
    // 실제 서비스의 규칙도 같은 창에서 말한다 (TASK-0064). 확인창이 시각만
    // 말하면 압축된 배포에서 「원래 이렇게 짧은 서비스」로 읽히고, 규칙만 말하면
    // 5분 뒤에 확정된 사람이 화면이 거짓말했다고 읽는다.
    expect(
      within(dialog).getByText(copy.autoConfirm.rule.replace('{days}', String(AUTO_CONFIRM_DAYS))),
    ).toBeVisible()
    // 어느 묶음인지 적는다. 대상을 말하지 않는 확인은 믿고 누르는 확인이다.
    expect(within(dialog).getByText(copy.bundleLabel.replace('{brand}', LUMIERE))).toBeVisible()
  })

  it('취소하면 아무 일도 일어나지 않는다', async () => {
    const user = await openDetail()

    await user.click(
      await within(bundleOf(LUMIERE)).findByRole('button', {
        name: `${copy.confirm.action} ${LUMIERE}`,
      }),
    )
    await user.click(screen.getByRole('button', { name: copy.confirm.cancelLabel }))

    expect(statusBadge(bundleOf(LUMIERE), 'DELIVERED')).toBeVisible()
  })

  it('확정하면 상태가 바뀌고 버튼이 사라진다', async () => {
    const user = await openDetail()

    await user.click(
      await within(bundleOf(LUMIERE)).findByRole('button', {
        name: `${copy.confirm.action} ${LUMIERE}`,
      }),
    )
    await user.click(screen.getByRole('button', { name: copy.confirm.confirmLabel }))

    expect(await screen.findByText(copy.confirm.done.replace('{brand}', LUMIERE))).toBeVisible()
    expect(statusBadge(bundleOf(LUMIERE), 'CONFIRMED')).toBeVisible()
    // 상태가 바뀌면 버튼도 반드시 바뀐다. 전이 응답이 새 액션 목록을 함께 싣는
    // 이유가 이것이고, 두 번 묻는 화면은 그 사이에 낡은 버튼을 그린다.
    expect(
      within(bundleOf(LUMIERE)).queryByRole('button', {
        name: `${copy.confirm.action} ${LUMIERE}`,
      }),
    ).not.toBeInTheDocument()
    // 다른 묶음은 건드리지 않았다.
    expect(statusBadge(bundleOf(NODESTEP), 'SHIPPED')).toBeVisible()
  })

  it('전이가 실패하면 사람에게 말한다 (U6)', async () => {
    testServer.server.use(
      httpFailureOn(
        'post',
        mockPaths.sellerOrderTransitions,
        409,
        'CONFLICT',
        '이미 다른 곳에서 처리됐습니다.',
      ),
    )

    const user = await openDetail()

    await user.click(
      await within(bundleOf(LUMIERE)).findByRole('button', {
        name: `${copy.confirm.action} ${LUMIERE}`,
      }),
    )
    await user.click(screen.getByRole('button', { name: copy.confirm.confirmLabel }))

    expect(await screen.findByText(copy.confirm.failedTitle)).toBeVisible()
  })

  it('가능 액션을 못 읽으면 「없다」고 말하지 않는다', async () => {
    testServer.server.use(
      httpFailureOn(
        'get',
        mockPaths.sellerOrderActions,
        500,
        'INTERNAL_ERROR',
        '서버에서 문제가 생겼습니다.',
      ),
    )

    await openDetail()

    // 「할 수 있는 것이 없다」로 그리면 사람은 구매확정 버튼을 찾다가 포기한다.
    expect((await screen.findAllByText(copy.actionsFailed)).length).toBeGreaterThan(0)
  })
})

describe('재구매 (F7)', () => {
  it('담긴 개수를 말한다', async () => {
    const user = await openDetail()

    await user.click(
      within(bundleOf(LUMIERE)).getByRole('button', {
        name: `${copy.repurchase.action} ${LUMIERE}`,
      }),
    )

    expect(await screen.findByText(copy.repurchase.added.replace('{count}', '2'))).toBeVisible()
  })

  it('담지 못한 줄의 이름을 말한다', async () => {
    // 마루상회의 첼시부츠는 이 목의 장바구니 카탈로그에 없다 — 단종·품절이 화면에
    // 도착하는 모습이 이것이다.
    const user = await openDetail()

    await user.click(
      within(bundleOf(MARU)).getByRole('button', { name: `${copy.repurchase.action} ${MARU}` }),
    )

    expect(
      await screen.findByText(copy.repurchase.none.replace('{names}', '스웨이드 첼시부츠')),
    ).toBeVisible()
  })
})

describe('결제 정보와 스냅샷', () => {
  it('할인 줄이 0이어도 그려진다', async () => {
    await openDetail()

    const payment = screen
      .getByRole('heading', { level: 2, name: copy.payment.title })
      .closest('section')

    if (payment === null) throw new Error('결제 정보 구획을 찾지 못했다')

    // 「쿠폰할인 0원」은 「쿠폰을 안 썼다」이고, 줄이 없으면 사람은 쿠폰을 찾는다.
    expect(within(payment).getByText(copy.payment.couponDiscount)).toBeVisible()
    expect(within(payment).getByText(copy.payment.pointDiscount)).toBeVisible()
  })

  it('결제수단을 지어내지 않고 답이 있는 곳을 가리킨다', async () => {
    await openDetail()

    expect(screen.getByRole('link', { name: copy.payment.methodLink })).toHaveAttribute(
      'href',
      '/mypage/cards',
    )
  })

  it('지금 없는 상품도 스냅샷으로 온전히 그려진다 (F4)', async () => {
    await openDetail(MOCK_ORDER_IDS.deleted)

    const item = shopperDeletedProductOrder.order.sellerOrders[0]?.items[0]

    if (item === undefined) throw new Error('픽스처에 항목이 없다')

    expect(screen.getByText(item.snapshot.productName)).toBeVisible()
    expect(screen.getByText(item.snapshot.optionLabel)).toBeVisible()
  })

  it('배송지는 주문한 때 복사된 값을 그대로 그린다', async () => {
    await openDetail()

    expect(screen.getByText(shopperMixedOrder.order.recipient.name)).toBeVisible()
    expect(screen.getByText(shopperMixedOrder.order.recipient.phone)).toBeVisible()
  })
})

describe('아직 없는 화면으로 가는 자리 (M10 · M13)', () => {
  it('죽은 링크도 비활성 버튼도 두지 않는다', async () => {
    await openDetail()

    const claim = screen.getAllByText(copy.upcoming.claimTitle)[0]

    expect(claim).toBeVisible()
    // 링크가 아니다 — 없는 라우트로 보내면 404 이고, 탭 순회에 목적지 없는 정지가 생긴다.
    expect(screen.queryByRole('link', { name: copy.upcoming.claimTitle })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: copy.upcoming.claimTitle })).not.toBeInTheDocument()
    // 무엇이 언제 열리는지를 말한다.
    expect(screen.getAllByText(copy.upcoming.claimBody)[0]).toBeVisible()
  })

  it('리뷰 자리는 배송완료·구매확정 묶음에만 나온다', async () => {
    await openDetail()

    expect(within(bundleOf(LUMIERE)).getByText(copy.upcoming.reviewTitle)).toBeVisible()
    expect(within(bundleOf(MARU)).queryByText(copy.upcoming.reviewTitle)).not.toBeInTheDocument()
  })

  it('끝난 주문에는 취소·반품 자리가 없다', async () => {
    await openDetail(MOCK_ORDER_IDS.canceled)

    expect(screen.queryByText(copy.upcoming.claimTitle)).not.toBeInTheDocument()
    expect(shopperCanceledOrder.order.sellerOrders[0]?.id).toBe(MOCK_SELLER_ORDER_IDS.canceled)
  })
})
