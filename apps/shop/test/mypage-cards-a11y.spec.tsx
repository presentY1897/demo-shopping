/**
 * axe over `/mypage/cards`, in every state it can be in (P2).
 *
 * `mypage-a11y.spec.tsx` already covers the other two account screens; this
 * screen brings three things neither of them has and each is a real chance to
 * get it wrong:
 *
 * - **같은 이름의 버튼이 아홉 개**다. 카드 세 장 × (사용 내역 · 정지 · 삭제) 이고,
 *   구별되는 것은 `aria-label` 에 붙은 브랜드와 번호뿐이다 — 그 장치가 빠지면
 *   버튼 목록을 훑는 사람에게 「정지」가 셋 남는다.
 * - **접었다 펴는 영역**이 있다. `aria-expanded` 와 `aria-controls` 가 짝이 맞아야
 *   하고, 닫혀 있을 때 없는 id 를 가리키면 `aria-valid-attr-value` 다.
 * - **표가 카드 안에서 열린다.** 제목 단계가 `h1 → h2 → h3` 로 이어지는지, 표의
 *   스크롤 영역과 그것을 감싼 `section` 이 같은 이름을 갖지 않는지가 여기서만
 *   확인된다.
 *
 * 규칙 집합은 이 앱의 다른 a11y 검사들의 것을 다시 적는다 — `packages/ui` 의 사본은
 * `stories/` 까지 닿지 않는 `exports` 맵 뒤에 있다(`mypage-a11y.spec.tsx` 가 같은
 * 이유를 적었다).
 */

import { noCards, resetPaymentStore, sessionBuyer, shopperCards } from '@shopping/api-mocks'
import { DENSITY_LEVELS, DENSITY_STORAGE_KEY } from '@shopping/ui'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { UserEvent } from '@testing-library/user-event'
import axe from 'axe-core'
import type { RunOptions } from 'axe-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import CardsPage from '@/app/mypage/cards/page'
import { messagesFor } from '@/messages'

import { renderAccountScreen, resetDensity } from './support/mypage'
import { stubViewport, VIEWPORTS } from './support/viewport'

vi.mock('next/navigation', () => ({ usePathname: () => '/mypage/cards' }))

const messages = messagesFor()
const copy = messages.mypage.cards

const OPTIONS: RunOptions = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] },
  rules: {
    // jsdom paints nothing, so axe cannot decide contrast.
    'color-contrast': { enabled: false },
    // The document shell — lang, title, the `main` landmark — belongs to
    // `app/layout.tsx`, which is not rendered here.
    'html-has-lang': { enabled: false },
    'document-title': { enabled: false },
    region: { enabled: false },
    'landmark-one-main': { enabled: false },
  },
}

async function expectNoViolations(): Promise<void> {
  const results = await axe.run(document.body, OPTIONS)

  expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([])
}

function firstCard(): (typeof shopperCards.cards)[number] {
  const card = shopperCards.cards[0]

  if (card === undefined) throw new Error('shopperCards 가 비어 있다')

  return card
}

const ROOMY = firstCard()

function nameOf(card: (typeof shopperCards.cards)[number]): string {
  return copy.cardLabel.replace('{brand}', card.brand).replace('{number}', card.maskedNumber)
}

async function openWallet(seed: typeof shopperCards = shopperCards): Promise<UserEvent> {
  resetPaymentStore(seed)

  const user = userEvent.setup()

  renderAccountScreen(<CardsPage />, { session: sessionBuyer })
  await screen.findByRole('heading', { level: 1, name: copy.title })

  if (seed.cards.length === 0) await screen.findByText(copy.emptyTitle)
  else await screen.findByRole('list', { name: copy.listLabel })

  return user
}

async function openLedger(user: UserEvent): Promise<void> {
  await user.click(screen.getByRole('button', { name: `${copy.openLedger} ${nameOf(ROOMY)}` }))
  await screen.findByRole('heading', {
    level: 3,
    name: copy.ledger.title.replace('{brand}', ROOMY.brand),
  })
}

beforeEach(() => {
  resetDensity()
  stubViewport(VIEWPORTS.desktop)
})

afterEach(() => {
  localStorage.clear()
  vi.unstubAllGlobals()
})

describe('the card list', () => {
  it('has no violations with three cards', async () => {
    await openWallet()

    await expectNoViolations()
  })

  it('has none when the account has no cards', async () => {
    await openWallet(noCards)

    await expectNoViolations()
  })

  it('has none on a phone, where the card lays itself out narrow', async () => {
    stubViewport(VIEWPORTS.mobile)

    await openWallet()

    await expectNoViolations()
  })

  it.each(DENSITY_LEVELS)('has none at density %s', async (level) => {
    localStorage.setItem(DENSITY_STORAGE_KEY, String(level))
    document.documentElement.setAttribute('data-density', String(level))

    await openWallet()

    await expectNoViolations()
  })
})

describe('the issue form', () => {
  it('has no violations while it is open', async () => {
    const user = await openWallet(noCards)

    await user.click(screen.getByRole('button', { name: copy.issue.open }))
    await screen.findByRole('form', { name: copy.issue.title })

    await expectNoViolations()
  })

  it('has none once a value has been refused', async () => {
    const user = await openWallet(noCards)

    await user.click(screen.getByRole('button', { name: copy.issue.open }))

    const limit = await screen.findByLabelText(new RegExp(copy.issue.limitLabel))

    await user.clear(limit)
    await user.type(limit, '1')
    await user.click(screen.getByRole('button', { name: copy.issue.submit }))

    // 오류가 붙은 칸은 `aria-invalid` 와 `aria-describedby` 를 함께 걸어야 한다.
    // 둘 중 하나만 있는 상태가 이 검사가 잡으려는 것이다.
    await screen.findByText(new RegExp(copy.issue.errors.outOfRange.split('{')[0] ?? ''))

    await expectNoViolations()
  })
})

describe('an open ledger', () => {
  it('has no violations with the table on screen', async () => {
    const user = await openWallet()

    await openLedger(user)

    await expectNoViolations()
  })

  it('names the toggle and the region it controls', async () => {
    const user = await openWallet()

    await openLedger(user)

    const toggle = screen.getByRole('button', { name: `${copy.closeLedger} ${nameOf(ROOMY)}` })

    expect(toggle).toHaveAttribute('aria-expanded', 'true')

    // 가리키는 id 가 실제로 존재해야 한다 — 없는 id 는 `aria-valid-attr-value` 다.
    const controls = toggle.getAttribute('aria-controls') ?? ''

    expect(document.getElementById(controls)).not.toBeNull()
  })

  it('leaves aria-controls off while the ledger is closed', async () => {
    await openWallet()

    const toggle = screen.getByRole('button', { name: `${copy.openLedger} ${nameOf(ROOMY)}` })

    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).not.toHaveAttribute('aria-controls')
  })
})

describe('the cards name their controls apart (P4)', () => {
  it('gives every button on the screen a unique accessible name', async () => {
    await openWallet()

    const names = screen.getAllByRole('button').map((button) => button.textContent)
    const labelled = screen
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label') ?? button.textContent)

    // 눈에 보이는 글자는 겹친다 — 「정지」가 셋이다. 그것이 문제가 아니라, 접근성
    // 이름까지 겹치는 것이 문제다.
    expect(new Set(names).size).toBeLessThan(names.length)
    expect(new Set(labelled).size).toBe(labelled.length)
  })

  it('keeps the visible word at the front of the accessible name (WCAG 2.5.3)', async () => {
    await openWallet()

    const suspend = screen.getByRole('button', { name: `${copy.suspend} ${nameOf(ROOMY)}` })

    // 음성 제어가 「정지」라고 말했을 때 이 버튼이 눌려야 한다. 보이는 글자가 이름의
    // 앞에 오지 않으면 그것이 되지 않는다.
    expect(suspend).toHaveTextContent(copy.suspend)
    expect(suspend.getAttribute('aria-label')?.startsWith(copy.suspend)).toBe(true)
  })
})

describe('the delete confirmation', () => {
  it('has no violations while the dialog is open', async () => {
    const user = await openWallet()

    await user.click(screen.getByRole('button', { name: `${copy.remove} ${nameOf(ROOMY)}` }))

    const dialog = await screen.findByRole('dialog', { name: copy.removeTitle })

    expect(within(dialog).getByText(nameOf(ROOMY))).toBeVisible()

    await expectNoViolations()
  })
})
