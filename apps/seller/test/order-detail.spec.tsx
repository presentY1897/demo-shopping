/**
 * `/orders/[id]` — 주문 상세와 발송 (TASK-0060 6.1).
 *
 * **여기서 재는 것의 절반이 TASK-0061 4.4 가 넘긴 항목이다.** 판매자가 「배송완료
 * 처리」를 누르면 주문과 배송이 **함께** 움직여야 하고, 그것이 아니면 구매자의 추적
 * 화면은 「이동 중」인 채로 주문만 배송완료가 된다. 목이 상태를 갖고 있으므로 그
 * 어긋남을 실제로 관찰할 수 있다.
 */

import {
  failNextShipment,
  sellerOrderHandlers,
  sellerOrderPage,
  sellerOrderSnapshot,
} from '@shopping/api-mocks'
import { render, screen, waitFor, within } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { OrderDetailWorkspace } from '@/components/orders/order-detail-workspace'
import { messagesFor } from '@/messages'

import { testServer } from './setup'

const copy = messagesFor().orderDetail
const vocabulary = messagesFor().orders

beforeEach(() => {
  testServer.server.use(...sellerOrderHandlers)
})

/** 픽스처에서 이 상태의 몫 하나를 고른다. 검사가 상태를 지어내지 않게. */
function idOf(status: string): string {
  const row = sellerOrderPage.sellerOrders.find((entry) => entry.status === status)

  if (row === undefined) throw new Error(`${status} 인 픽스처가 없습니다.`)

  return row.id
}

async function open(status: string): Promise<string> {
  const id = idOf(status)

  render(<OrderDetailWorkspace sellerOrderId={id} />)
  await screen.findByText(copy.subtitle.replace('{orderNumber}', orderNumberOf(id)))

  return id
}

function orderNumberOf(id: string): string {
  return sellerOrderPage.sellerOrders.find((entry) => entry.id === id)?.orderNumber ?? ''
}

/** 대화상자 안의 버튼. 같은 글자의 버튼이 화면에도 있을 수 있다. */
function inDialog(name: string): HTMLElement {
  return within(screen.getByRole('dialog')).getByRole('button', { name })
}

describe('U1 · P5 — 네 상태', () => {
  it('announces the wait before the API has answered', () => {
    render(<OrderDetailWorkspace sellerOrderId={idOf('PREPARING')} />)

    expect(screen.getByRole('status')).toHaveTextContent(copy.loadingLabel)
  })

  it('offers a retry when the read fails', async () => {
    render(<OrderDetailWorkspace sellerOrderId="01930000-0000-7000-8000-00000000dead" />)

    expect(await screen.findByText(copy.errorTitle)).toBeVisible()
    expect(screen.getByRole('button', { name: copy.retry })).toBeVisible()
  })
})

describe('액션 버튼은 서버가 정한다 (F5)', () => {
  it('draws exactly the moves the server answered with', async () => {
    await open('PAID')

    const actions = screen.getByRole('region', { name: copy.actions.legend })

    // 화면이 상태로 만들어 낸 버튼이 아니다 — 목의 전이표가 답한 둘이다.
    expect(
      within(actions).getByRole('button', { name: vocabulary.actionLabels.PREPARING }),
    ).toBeVisible()
    expect(
      within(actions).getByRole('button', { name: vocabulary.actionLabels.CANCELED }),
    ).toBeVisible()
    expect(
      within(actions).queryByRole('button', { name: vocabulary.actionLabels.DELIVERED }),
    ).toBeNull()
  })

  it('changes the buttons when the status changes', async () => {
    await open('PAID')

    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: vocabulary.actionLabels.PREPARING }))
    await user.click(inDialog(copy.actions.confirm))

    // 상태가 바뀌면 버튼도 바뀐다. 한쪽만 새로 읽은 화면은 낡은 짝을 그린다.
    expect(
      await screen.findByRole('button', { name: vocabulary.actionLabels.SHIPPED }),
    ).toBeVisible()
  })

  /**
   * **발송 버튼은 서버가 `enabled: false` 로 줘도 눌린다.**
   *
   * 전이의 문은 운송장을 요구하고 발송 전에는 그것이 없으므로, 서버의 답은 언제나
   * 「조건이 모자라다」다. 그런데 그 조건을 만드는 것이 발송 라우트다 — 답을 그대로
   * 믿고 잠그면 판매자는 영영 발송할 수 없고, 화면은 아무 오류도 내지 않는다.
   */
  it('lets the seller press 발송 even though the transition door says tracking is missing', async () => {
    await open('PREPARING')

    const ship = screen.getByRole('button', { name: vocabulary.actionLabels.SHIPPED })

    expect(ship).not.toHaveAttribute('aria-disabled', 'true')
  })
})

describe('발송 처리 (F3 · F10)', () => {
  async function ship(user: UserEvent): Promise<void> {
    await user.click(screen.getByRole('button', { name: vocabulary.actionLabels.SHIPPED }))
    await user.click(inDialog(copy.ship.confirm))
  }

  it('issues a waybill and moves the share', async () => {
    const id = await open('PREPARING')

    const user = userEvent.setup()

    await ship(user)

    await waitFor(() => {
      expect(sellerOrderSnapshot().find((row) => row.id === id)?.status).toBe('SHIPPED')
    })
    // 「가상 배송 정보입니다」는 선택이 아니다 (TASK-0061 R1).
    expect(await screen.findByText(copy.tracking.virtualNotice)).toBeVisible()
  })

  it('lets the seller choose a carrier', async () => {
    await open('PREPARING')

    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: vocabulary.actionLabels.SHIPPED }))
    await user.click(screen.getByRole('combobox', { name: copy.ship.carrierLabel }))
    await user.click(await screen.findByRole('option', { name: vocabulary.carrierLabels.HD }))
    await user.click(inDialog(copy.ship.confirm))

    expect(await screen.findByText(copy.tracking.virtualNotice)).toBeVisible()
  })

  it('shows the server’s refusal rather than a silent failure (U6)', async () => {
    await open('PREPARING')
    failNextShipment()

    const user = userEvent.setup()

    await ship(user)

    // 대화상자 안에서 답한다 — 화면 어딘가가 아니라 방금 누른 자리 옆에서.
    expect(await within(screen.getByRole('dialog')).findByText(copy.failure.title)).toBeVisible()
  })
})

describe('배송완료 처리 — 두 표가 함께 (4.3)', () => {
  it('moves the shipment as well as the order', async () => {
    const id = await open('SHIPPED')

    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: vocabulary.actionLabels.DELIVERED }))
    await user.click(inDialog(copy.actions.confirm))

    await waitFor(() => {
      expect(sellerOrderSnapshot().find((row) => row.id === id)?.status).toBe('DELIVERED')
    })

    // **여기가 요점이다.** 전이만 찍었다면 추적 이력은 집화 한 줄에 머물고, 구매자의
    // 화면은 「이동 중」인 채로 주문만 배송완료가 된다.
    const timeline = await screen.findByRole('list', { name: copy.tracking.timelineLabel })

    await waitFor(() => {
      expect(within(timeline).getAllByRole('listitem')).toHaveLength(2)
    })
  })

  it('leaves a tracking line that says a person confirmed it', async () => {
    await open('SHIPPED')

    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: vocabulary.actionLabels.DELIVERED }))
    await user.click(inDialog(copy.actions.confirm))

    // 운송사가 보고한 것처럼 적으면 이력이 거짓이 된다.
    expect(await screen.findByText(/판매자가 배송 완료를 확인했어요/u)).toBeVisible()
  })
})

describe('사유가 필요한 이동 (U2)', () => {
  it('refuses to submit 취소 without a reason, and says so on the field', async () => {
    await open('PAID')

    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: vocabulary.actionLabels.CANCELED }))
    await user.click(inDialog(copy.actions.confirm))

    expect(await screen.findByText(copy.actions.reasonRequired)).toBeVisible()
    // 아무 요청도 나가지 않았다 — 상태가 그대로다.
    expect(sellerOrderSnapshot().find((row) => row.status === 'PAID')).toBeDefined()
  })

  it('cancels once a reason is given', async () => {
    const id = await open('PAID')

    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: vocabulary.actionLabels.CANCELED }))
    await user.type(screen.getByLabelText(copy.actions.reasonLabel), '재고 소진')
    await user.click(inDialog(copy.actions.confirm))

    await waitFor(() => {
      expect(sellerOrderSnapshot().find((row) => row.id === id)?.status).toBe('CANCELED')
    })
  })

  it('asks for nothing but a confirmation on a normal step', async () => {
    await open('PAID')

    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: vocabulary.actionLabels.PREPARING }))

    // 정상 진행에 사유 칸을 붙이면 판매자는 발송할 때마다 빈 칸을 본다.
    expect(screen.queryByLabelText(copy.actions.reasonLabel)).toBeNull()
  })
})

describe('상세가 보여 주는 것', () => {
  it('shows the full recipient — the seller writes it on the box (F6)', async () => {
    await open('PREPARING')

    // 목록에서는 가려 나가고 상세에서 전체를 보여 준다는 것이 설계서의 규약이다.
    // 인쇄용 주문서에도 같은 값이 있으므로 수령인 블록으로 좁혀서 본다.
    const recipient = within(screen.getByRole('region', { name: copy.sections.recipient }))

    expect(recipient.getByText('홍길동')).toBeVisible()
    expect(recipient.getByText(/010-0000-0000/u)).toBeVisible()
  })

  it('shows who moved the order, not just when', async () => {
    await open('PREPARING')

    const history = screen.getByRole('table', { name: copy.history.caption })

    // `OrderStatusHistory` 를 읽는 첫 화면이다. 「분쟁에서 유일한 근거」라는 문장은
    // 읽는 자리가 생겨야 참이 된다.
    expect(within(history).getByText(vocabulary.actorLabels.SYSTEM)).toBeVisible()
    expect(within(history).getByText(vocabulary.actorLabels.SELLER)).toBeVisible()
  })

  it('says the order has not shipped rather than showing nothing', async () => {
    await open('PREPARING')

    expect(screen.getByText(copy.tracking.notShippedTitle)).toBeVisible()
  })

  it('carries a printable order sheet that names itself a demo', async () => {
    await open('PREPARING')

    // 종이가 실제 거래 증빙처럼 보이는 것이 이 화면의 유일한 위험이다.
    expect(screen.getByText(copy.print.notice)).toBeInTheDocument()
    expect(
      screen.getByRole('article', {
        name: `${copy.print.documentTitle} ${orderNumberOf(idOf('PREPARING'))}`,
      }),
    ).toBeInTheDocument()
  })
})
