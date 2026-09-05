/**
 * `/mypage/cards` — 가상 카드 관리 (TASK-0058 F1~F7).
 *
 * **이 파일이 재는 것의 중심은 F3 · F4 다.** 2장이 이 화면의 존재 이유를 「환불이 잘
 * 됐는지 잔액으로 확인」이라고 적었고, 그것이 성립하려면 세 가지가 동시에 맞아야
 * 한다 — 원장에 환불 줄이 있고, 그 줄 옆의 잔액이 복구를 보여 주고, 그 잔액이 목록
 * 카드가 말하는 숫자와 **같아야** 한다. 셋 중 하나만 틀려도 확인 동선이 끊긴다.
 *
 * 목이 **상태를 갖는다.** 발급하면 목록이 늘고, 정지하면 배지가 바뀌고, 지우면
 * 사라진다. 얼어붙은 픽스처로는 그중 어느 것도 물어볼 수 없다.
 *
 * 금액을 문자열로 적지 않고 `formatMoney` 로 만드는 이유는, 이 검사가 재려는 것이
 * 「₩700,000 이라고 적혀 있다」가 아니라 **「한도에서 사용액을 뺀 값이 보인다」**이기
 * 때문이다. 통화 표기가 바뀌면 화면과 검사가 같이 움직여야 한다.
 */

import {
  httpFailureOn,
  MOCK_CARDS_PER_USER,
  mockPaths,
  noCards,
  resetPaymentStore,
  sessionBuyer,
  shopperCardLedger,
  shopperCards,
} from '@shopping/api-mocks'
import { DENSITY_LEVELS, DENSITY_STORAGE_KEY } from '@shopping/ui'
import { formatMoney } from '@shopping/ui/format'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { UserEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import CardsPage from '@/app/mypage/cards/page'
import { CARD_LIMIT_DEFAULT, CARD_LIMIT_MAX, CARD_LIMIT_MIN } from '@/lib/cards/issue-form-schema'
import { messagesFor } from '@/messages'

import { renderAccountScreen, resetDensity } from './support/mypage'
import { testServer } from './setup'
import { stubViewport, VIEWPORTS } from './support/viewport'

vi.mock('next/navigation', () => ({ usePathname: () => '/mypage/cards' }))

const messages = messagesFor()
const copy = messages.mypage.cards
const issueCopy = copy.issue
const ledgerCopy = copy.ledger

const won = (amount: number): string => formatMoney({ amount, currency: 'KRW' })

/**
 * 씨앗 카드. 브랜드 이름을 여기 적지 않고 픽스처에서 꺼내는 이유는
 * `checkout-payment.spec.tsx` 와 같다 — 이 검사가 재려는 것은 「누리카드가 보인다」가
 * 아니라 **「서버가 준 카드가 보인다」**다.
 */
function seedCard(index: number): (typeof shopperCards.cards)[number] {
  const card = shopperCards.cards[index]

  if (card === undefined) throw new Error(`shopperCards 에 ${String(index)}번 카드가 없다`)

  return card
}

function seedRow(index: number): (typeof shopperCardLedger.transactions)[number] {
  const row = shopperCardLedger.transactions[index]

  if (row === undefined) throw new Error(`shopperCardLedger 에 ${String(index)}번 줄이 없다`)

  return row
}

const ROOMY = seedCard(0)
const TIGHT = seedCard(1)
const SUSPENDED = seedCard(2)

/** 첫 카드의 원장에서 부분 환불을 만든 두 줄, 그리고 주문 없는 줄. */
const NO_ORDER = seedRow(0)
const CHARGED = seedRow(1)
const REFUNDED = seedRow(2)

/** 카드 한 장의 이름 — 제목이자 그 카드 버튼들의 접근성 이름의 꼬리다. */
function nameOf(card: (typeof shopperCards.cards)[number]): string {
  return copy.cardLabel.replace('{brand}', card.brand).replace('{number}', card.maskedNumber)
}

async function openWallet(seed: typeof shopperCards = shopperCards): Promise<UserEvent> {
  resetPaymentStore(seed)

  const user = userEvent.setup()

  renderAccountScreen(<CardsPage />, { session: sessionBuyer })
  await screen.findByRole('heading', { level: 1, name: copy.title })

  // 목록이 도착할 때까지. 빈 씨앗이면 카드 대신 빈 상태가 온다. 안내 문구를
  // 기다리면 안 되는 이유는 그것이 **읽기보다 먼저** 그려지기 때문이다 — 기다림이
  // 아무것도 기다리지 않게 된다.
  if (seed.cards.length === 0) await screen.findByText(copy.emptyTitle)
  else await screen.findByRole('list', { name: copy.listLabel })

  return user
}

/** 이 카드의 `li`. 카드마다 같은 이름의 버튼이 있으므로 그 안에서 찾는다. */
function cardRow(card: (typeof shopperCards.cards)[number]): HTMLElement {
  const heading = screen.getByRole('heading', { level: 2, name: nameOf(card) })
  const row = heading.closest('li')

  if (row === null) throw new Error(`${card.brand} 줄을 찾지 못했습니다.`)

  return row
}

/**
 * 표에서 이 글자가 처음 나오는 줄. 「환불 줄의 잔액」을 물으려면 줄을 먼저 집는다.
 *
 * `getAllByText` 인 이유는 한 줄이 같은 금액을 두 번 들 수 있기 때문이다 — 첫
 * 승인은 금액과 누적 사용이 같다.
 */
function ledgerRow(text: string): HTMLElement {
  const [cell] = screen.getAllByText(text)
  const row = cell?.closest('tr') ?? null

  if (row === null) throw new Error(`${text} 줄을 찾지 못했습니다.`)

  return row
}

/**
 * 카드가 말하는 숫자 한 칸 — `dt` 옆의 `dd`.
 *
 * 금액만으로 찾으면 한도와 사용 가능액이 같은 카드(한 번도 안 쓴 카드)에서 두 칸이
 * 걸린다. 무엇의 값인지로 집는 편이 이 검사가 실제로 묻는 것에 가깝다.
 */
function statOf(row: HTMLElement, label: string): HTMLElement {
  const term = within(row).getByText(label)
  const value = term.nextElementSibling

  if (!(value instanceof HTMLElement)) throw new Error(`${label} 값을 찾지 못했습니다.`)

  return value
}

function countRequests(method: string, endsWith: string): () => number {
  let seen = 0

  testServer.server.events.on('request:start', ({ request }) => {
    if (request.method === method && new URL(request.url).pathname.endsWith(endsWith)) seen += 1
  })

  return () => seen
}

beforeEach(() => {
  resetDensity()
  stubViewport(VIEWPORTS.desktop)
})

afterEach(() => {
  localStorage.clear()
  vi.unstubAllGlobals()
  testServer.server.events.removeAllListeners()
})

describe('카드 목록 (F1 · F2)', () => {
  it('shows the limit, the used amount and the credit that is left', async () => {
    await openWallet()

    const row = cardRow(ROOMY)

    expect(statOf(row, copy.limitLabel)).toHaveTextContent(won(ROOMY.creditLimit))
    expect(statOf(row, copy.usedLabel)).toHaveTextContent(won(ROOMY.usedAmount))
    // 서버가 주지 않는 세 번째 숫자. 화면이 뺀 값이고, 이 화면에 온 사람이 찾는 것이다.
    expect(statOf(row, copy.availableLabel)).toHaveTextContent(
      won(ROOMY.creditLimit - ROOMY.usedAmount),
    )
  })

  it('draws the suspended card rather than hiding it', async () => {
    await openWallet()

    const row = within(cardRow(SUSPENDED))

    expect(row.getByText(copy.statuses.SUSPENDED)).toBeVisible()
    // 정지된 카드에서 할 일은 없어진 것이 아니라 달라졌다 — 비활성 버튼이 아니라
    // 다른 버튼이다.
    expect(row.getByRole('button', { name: `${copy.activate} ${nameOf(SUSPENDED)}` })).toBeVisible()
    expect(row.queryByRole('button', { name: `${copy.suspend} ${nameOf(SUSPENDED)}` })).toBeNull()
  })

  it('shows only the first four digits and the last four (F2)', async () => {
    await openWallet()

    for (const card of [ROOMY, TIGHT, SUSPENDED]) {
      expect(card.maskedNumber).toMatch(/^9999-\*{4}-\*{4}-\d{4}$/u)
      expect(screen.getByRole('heading', { level: 2, name: nameOf(card) })).toBeVisible()
    }

    // 전문은 애초에 오지 않는다 (TASK-0053 6.2). 화면이 자르는 것이 아니므로,
    // 어디에도 열여섯 자리가 남아 있으면 안 된다.
    expect(document.body.textContent).not.toMatch(/\d{4}-\d{4}-\d{4}-\d{4}/u)
  })

  it('offers a place to get one when the account has no cards', async () => {
    await openWallet(noCards)

    expect(screen.getByText(copy.emptyTitle)).toBeVisible()
    expect(screen.getByRole('button', { name: issueCopy.open })).toBeVisible()
  })
})

describe('가상 카드 안내 (F6 · R1)', () => {
  it('says out loud that this is not a real card, above the list', async () => {
    await openWallet()

    const note = screen.getByRole('note')

    expect(within(note).getByText(copy.noticeTitle)).toBeVisible()
    expect(within(note).getByText(copy.noticeBody)).toBeVisible()

    // 목록보다 **먼저** 온다. 이미 믿어 버린 사람에게 도착하는 각주는 R1 을 막지
    // 못한다 — `compareDocumentPosition` 이 그 순서를 그대로 잰다.
    const list = screen.getByRole('list', { name: copy.listLabel })

    expect(note.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('cannot be dismissed or folded away', async () => {
    await openWallet()

    const note = screen.getByRole('note')

    expect(note.closest('details')).toBeNull()
    expect(within(note).queryByRole('button')).toBeNull()
  })
})

describe('사용 내역 (F3)', () => {
  it('opens one card ledger at a time and links each payment to its order', async () => {
    const user = await openWallet()

    await user.click(
      within(cardRow(ROOMY)).getByRole('button', { name: `${copy.openLedger} ${nameOf(ROOMY)}` }),
    )

    expect(
      await screen.findByRole('heading', {
        level: 3,
        name: ledgerCopy.title.replace('{brand}', ROOMY.brand),
      }),
    ).toBeVisible()

    // 승인 줄이 보인다.
    expect(screen.getAllByText(ledgerCopy.kinds.CHARGE).length).toBeGreaterThan(0)

    // 그리고 그 줄의 링크가 **이 주문**을 가리킨다 (4.2).
    //
    // 줄 안에서 찾는다. 같은 주문번호가 표에 두 번 나오기 때문인데, 그것이 정상이다 —
    // 승인과 그 부분 환불은 같은 주문의 두 사건이다. 화면 전체에서 이름으로 찾으면
    // 이 검사는 「어느 줄의 링크인지」를 묻지 못한다.
    const orderNumber = CHARGED.orderNumber ?? ''
    const link = within(ledgerRow(won(CHARGED.amount))).getByRole('link', {
      name: ledgerCopy.orderLink.replace('{number}', orderNumber),
    })

    expect(link).toHaveAttribute('href', `/mypage/orders/${String(CHARGED.orderId)}`)
    expect(link).toHaveTextContent(orderNumber)
  })

  it('leaves a row without an order as a row, not as a broken link (4.2)', async () => {
    const user = await openWallet()

    await user.click(
      within(cardRow(ROOMY)).getByRole('button', { name: `${copy.openLedger} ${nameOf(ROOMY)}` }),
    )
    await screen.findByRole('heading', {
      level: 3,
      name: ledgerCopy.title.replace('{brand}', ROOMY.brand),
    })

    expect(NO_ORDER.orderNumber).toBeNull()

    const row = within(ledgerRow(won(NO_ORDER.amount)))

    expect(row.getByText(ledgerCopy.noOrder)).toBeVisible()
    expect(row.queryByRole('link')).toBeNull()
  })

  it('asks for a ledger only when one is opened', async () => {
    const asked = countRequests('GET', '/transactions')
    const user = await openWallet()

    expect(asked()).toBe(0)

    await user.click(
      within(cardRow(TIGHT)).getByRole('button', { name: `${copy.openLedger} ${nameOf(TIGHT)}` }),
    )
    await screen.findByRole('heading', {
      level: 3,
      name: ledgerCopy.title.replace('{brand}', TIGHT.brand),
    })

    expect(asked()).toBe(1)
  })

  it('closes the ledger again', async () => {
    const user = await openWallet()

    const open = within(cardRow(ROOMY)).getByRole('button', {
      name: `${copy.openLedger} ${nameOf(ROOMY)}`,
    })

    await user.click(open)
    await screen.findByRole('heading', {
      level: 3,
      name: ledgerCopy.title.replace('{brand}', ROOMY.brand),
    })

    await user.click(
      within(cardRow(ROOMY)).getByRole('button', { name: `${copy.closeLedger} ${nameOf(ROOMY)}` }),
    )

    await waitFor(() => {
      expect(
        screen.queryByRole('heading', {
          level: 3,
          name: ledgerCopy.title.replace('{brand}', ROOMY.brand),
        }),
      ).toBeNull()
    })
  })
})

describe('환불이 돌아온 것 (F4)', () => {
  it('shows the refund and the credit it gave back', async () => {
    const user = await openWallet()

    await user.click(
      within(cardRow(ROOMY)).getByRole('button', { name: `${copy.openLedger} ${nameOf(ROOMY)}` }),
    )
    await screen.findByRole('heading', {
      level: 3,
      name: ledgerCopy.title.replace('{brand}', ROOMY.brand),
    })

    // 환불은 음수다. 부호가 방향이고, 그것 없이는 승인과 구별되지 않는다.
    expect(REFUNDED.amount).toBeLessThan(0)

    const refundRow = within(ledgerRow(won(REFUNDED.amount)))

    expect(refundRow.getByText(ledgerCopy.kinds.REFUND)).toBeVisible()

    // **복구가 눈에 보인다**: 승인 직후 550,000 이던 사용 가능액이 환불 뒤 700,000 이
    // 된다. 두 줄을 나란히 물어야 「돌아왔다」가 추론이 아니라 읽기가 된다.
    const beforeRefund = ROOMY.creditLimit - CHARGED.balanceAfter
    const afterRefund = ROOMY.creditLimit - REFUNDED.balanceAfter

    expect(afterRefund).toBeGreaterThan(beforeRefund)
    expect(refundRow.getByText(won(afterRefund))).toBeVisible()
    expect(within(ledgerRow(won(CHARGED.amount))).getByText(won(beforeRefund))).toBeVisible()
  })

  it('ends the ledger on the same number the card itself shows', async () => {
    const user = await openWallet()

    await user.click(
      within(cardRow(ROOMY)).getByRole('button', { name: `${copy.openLedger} ${nameOf(ROOMY)}` }),
    )
    await screen.findByRole('heading', {
      level: 3,
      name: ledgerCopy.title.replace('{brand}', ROOMY.brand),
    })

    // 대사가 되는가 — 목록의 「사용 가능」과 원장 마지막 줄의 그것이 같아야 한다.
    // 이 둘이 갈리면 화면은 두 개의 진실을 동시에 보여 주고 있는 것이다.
    const rows = within(cardRow(ROOMY)).getAllByRole('row')
    const last = rows.at(-1)

    if (last === undefined) throw new Error('원장에 줄이 없다')

    expect(within(last).getByText(won(ROOMY.creditLimit - ROOMY.usedAmount))).toBeVisible()
  })

  it('says so when a card has never been used', async () => {
    const user = await openWallet()

    await user.click(
      within(cardRow(SUSPENDED)).getByRole('button', {
        name: `${copy.openLedger} ${nameOf(SUSPENDED)}`,
      }),
    )

    expect(await screen.findByText(ledgerCopy.emptyTitle)).toBeVisible()
  })
})

describe('정지와 해제 (F5)', () => {
  it('suspends a card and says so', async () => {
    const user = await openWallet()

    await user.click(
      within(cardRow(ROOMY)).getByRole('button', { name: `${copy.suspend} ${nameOf(ROOMY)}` }),
    )

    expect(await screen.findByText(copy.suspendedNotice)).toBeVisible()

    const row = within(cardRow(ROOMY))

    expect(row.getByText(copy.statuses.SUSPENDED)).toBeVisible()
    expect(row.getByRole('button', { name: `${copy.activate} ${nameOf(ROOMY)}` })).toBeVisible()
  })

  it('brings it back', async () => {
    const user = await openWallet()

    await user.click(
      within(cardRow(SUSPENDED)).getByRole('button', {
        name: `${copy.activate} ${nameOf(SUSPENDED)}`,
      }),
    )

    expect(await screen.findByText(copy.activatedNotice)).toBeVisible()
    expect(within(cardRow(SUSPENDED)).getByText(copy.statuses.ACTIVE)).toBeVisible()
  })

  it('re-reads the list rather than trusting the row it just wrote', async () => {
    const listed = countRequests('GET', '/cards')
    const user = await openWallet()

    const before = listed()

    await user.click(
      within(cardRow(ROOMY)).getByRole('button', { name: `${copy.suspend} ${nameOf(ROOMY)}` }),
    )
    await screen.findByText(copy.suspendedNotice)

    // 사용액과 사용 가능액을 움직이는 것은 결제와 환불이지 이 화면이 아니다. 쓰기가
    // 끝난 순간이 그 숫자를 다시 읽기에 가장 좋은 때다 (`use-cards.ts`).
    expect(listed()).toBe(before + 1)
  })
})

describe('삭제', () => {
  it('sends nothing until the dialog is confirmed', async () => {
    const deleted = countRequests('DELETE', ROOMY.id)
    const user = await openWallet()

    await user.click(
      within(cardRow(ROOMY)).getByRole('button', { name: `${copy.remove} ${nameOf(ROOMY)}` }),
    )

    const dialog = await screen.findByRole('dialog', { name: copy.removeTitle })

    // 어느 카드인지가 확인 안에 적혀 있다.
    expect(within(dialog).getByText(nameOf(ROOMY))).toBeVisible()

    await user.click(within(dialog).getByRole('button', { name: copy.removeCancel }))

    expect(deleted()).toBe(0)
    expect(screen.getByRole('heading', { level: 2, name: nameOf(ROOMY) })).toBeVisible()
  })

  it('removes the card once it is confirmed', async () => {
    const user = await openWallet()

    await user.click(
      within(cardRow(ROOMY)).getByRole('button', { name: `${copy.remove} ${nameOf(ROOMY)}` }),
    )

    const dialog = await screen.findByRole('dialog', { name: copy.removeTitle })

    await user.click(within(dialog).getByRole('button', { name: copy.removeConfirm }))

    expect(await screen.findByText(copy.removedNotice)).toBeVisible()
    await waitFor(() => {
      expect(screen.queryByRole('heading', { level: 2, name: nameOf(ROOMY) })).toBeNull()
    })
  })
})

describe('발급', () => {
  it('starts from the limit the demo account already has', async () => {
    const user = await openWallet(noCards)

    await user.click(screen.getByRole('button', { name: issueCopy.open }))

    const limit = await screen.findByLabelText(new RegExp(issueCopy.limitLabel))

    expect(limit).toHaveValue(String(CARD_LIMIT_DEFAULT))
    // 되읽기가 자릿수를 세어 준다 — 0을 하나 더 친 것을 잡는 것이 이 문장이다.
    expect(
      screen.getByText(issueCopy.limitEcho.replace('{amount}', won(CARD_LIMIT_DEFAULT))),
    ).toBeVisible()
  })

  it('says what the bounds are, in money', async () => {
    const user = await openWallet(noCards)

    await user.click(screen.getByRole('button', { name: issueCopy.open }))

    expect(
      await screen.findByText(
        issueCopy.limitHint
          .replace('{min}', won(CARD_LIMIT_MIN))
          .replace('{max}', won(CARD_LIMIT_MAX)),
      ),
    ).toBeVisible()
  })

  it('issues a card with the limit that was typed', async () => {
    const user = await openWallet(noCards)

    await user.click(screen.getByRole('button', { name: issueCopy.open }))

    const limit = await screen.findByLabelText(new RegExp(issueCopy.limitLabel))

    await user.clear(limit)
    await user.type(limit, '500000')
    await user.click(screen.getByRole('button', { name: issueCopy.submit }))

    const list = within(await screen.findByRole('list', { name: copy.listLabel }))
    const items = list.getAllByRole('listitem')

    expect(items).toHaveLength(1)

    const made = items[0]

    if (made === undefined) throw new Error('발급된 카드가 목록에 없다')
    expect(statOf(made, copy.limitLabel)).toHaveTextContent(won(500_000))
    // 갓 만든 카드는 아직 아무것도 쓰지 않았다 — 한도가 곧 사용 가능액이다.
    expect(statOf(made, copy.availableLabel)).toHaveTextContent(won(500_000))

    // 문장이 **어느** 카드가 생겼는지를 말한다. 세 장이 다 같은 접두어로 시작하므로
    // 「발급했습니다」만으로는 목록에서 새 카드를 짚을 수 없다. 번호를 여기 적지 않고
    // 화면에서 읽어 오는 이유는, 이 검사가 재려는 것이 대역의 번호 생성이 아니라
    // **문장과 목록이 같은 카드를 가리키는가**이기 때문이다.
    const number = /9999-\*{4}-\*{4}-\d{4}/u.exec(
      within(made).getByRole('heading', { level: 2 }).textContent ?? '',
    )

    expect(number).not.toBeNull()
    expect(screen.getByText(copy.issuedNotice.replace('{number}', number?.[0] ?? ''))).toBeVisible()
  })

  it('refuses a limit below the floor without asking the server', async () => {
    const posted = countRequests('POST', '/cards')
    const user = await openWallet(noCards)

    await user.click(screen.getByRole('button', { name: issueCopy.open }))

    const limit = await screen.findByLabelText(new RegExp(issueCopy.limitLabel))

    await user.clear(limit)
    await user.type(limit, String(CARD_LIMIT_MIN - 1))
    await user.click(screen.getByRole('button', { name: issueCopy.submit }))

    expect(
      await screen.findByText(
        issueCopy.errors.outOfRange
          .replace('{min}', won(CARD_LIMIT_MIN))
          .replace('{max}', won(CARD_LIMIT_MAX)),
      ),
    ).toBeVisible()
    expect(posted()).toBe(0)
  })

  it('refuses something that is not a number, and keeps what was typed (U6)', async () => {
    const user = await openWallet(noCards)

    await user.click(screen.getByRole('button', { name: issueCopy.open }))

    const limit = await screen.findByLabelText(new RegExp(issueCopy.limitLabel))

    await user.clear(limit)
    await user.type(limit, '십만원')
    await user.click(screen.getByRole('button', { name: issueCopy.submit }))

    expect(await screen.findByText(issueCopy.errors.notANumber)).toBeVisible()
    expect(limit).toHaveValue('십만원')
  })

  it('tells a person who already has three cards what to do instead', async () => {
    const user = await openWallet()

    await user.click(screen.getByRole('button', { name: issueCopy.open }))
    await user.click(await screen.findByRole('button', { name: issueCopy.submit }))

    // 「카드를 더 못 만든다」와 「한도가 잘못됐다」는 사람이 할 일이 정반대라 코드가
    // 다르고(`CARD_COUNT_REACHED`), 이 화면은 그 갈림을 문장으로 지킨다.
    expect(
      await screen.findByText(
        messages.mypage.errors.CARD_COUNT_REACHED.replace('{max}', String(MOCK_CARDS_PER_USER)),
      ),
    ).toBeVisible()
  })
})

describe('F7 아홉 조합', () => {
  /**
   * 밀도 3 × 뷰포트 3. jsdom 은 아무것도 칠하지 않으므로 「깨짐 0건」을 픽셀로 잴 수
   * 없다 — 잴 수 있는 것은 **완전한 화면인가**이다: 제목, 안내, 카드 세 장, 그리고
   * 발급 버튼이 정확히 하나.
   *
   * 카드 안이 컨테이너 쿼리라 아홉 조합이 아홉 개의 디자인이 아니라 하나다. 그것이
   * 사실인지를 확인하는 자리가 여기다.
   */
  it.each(
    DENSITY_LEVELS.flatMap((density) =>
      (['mobile', 'tablet', 'desktop'] as const).map((band) => ({ density, band })),
    ),
  )('draws a complete wallet at density $density on $band', async ({ density, band }) => {
    localStorage.setItem(DENSITY_STORAGE_KEY, String(density))
    document.documentElement.setAttribute('data-density', String(density))
    stubViewport(VIEWPORTS[band])

    await openWallet()

    expect(screen.getByRole('heading', { level: 1, name: copy.title })).toBeVisible()
    expect(screen.getByRole('note')).toBeVisible()
    expect(
      within(screen.getByRole('list', { name: copy.listLabel })).getAllByRole('listitem'),
    ).toHaveLength(shopperCards.cards.length)
    expect(screen.getAllByRole('button', { name: issueCopy.open })).toHaveLength(1)

    for (const card of [ROOMY, TIGHT, SUSPENDED]) {
      const row = cardRow(card)

      expect(statOf(row, copy.availableLabel)).toHaveTextContent(
        won(card.creditLimit - card.usedAmount),
      )
      expect(
        within(row).getByRole('button', { name: `${copy.openLedger} ${nameOf(card)}` }),
      ).toBeVisible()
    }
  })
})

describe('남의 카드', () => {
  it('reports a ledger that is not this account’s as missing (3장 A3)', async () => {
    const user = await openWallet()

    // 목록에 없는 카드의 원장은 404 다 — 「있지만 당신 것이 아니다」라는 대답이
    // 서버에 존재하지 않는다. 그 카드가 무엇을 샀는지가 원장에 그대로 적혀 있다.
    testServer.server.use(
      httpFailureOn('get', mockPaths.cardTransactions, 404, 'NOT_FOUND', '카드를 찾을 수 없어요.'),
    )

    await user.click(
      within(cardRow(ROOMY)).getByRole('button', { name: `${copy.openLedger} ${nameOf(ROOMY)}` }),
    )

    expect(await screen.findByText(ledgerCopy.failedTitle)).toBeVisible()
    expect(screen.getByText(messages.mypage.errors.NOT_FOUND)).toBeVisible()
  })
})
