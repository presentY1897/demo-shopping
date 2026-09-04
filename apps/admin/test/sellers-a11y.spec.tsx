/**
 * axe over `/sellers` and `/sellers/[id]`, in every state they can be in.
 *
 * `packages/ui` runs the same engine over every story
 * (`packages/ui/test/story-a11y.spec.tsx`) — but components that are accessible
 * on their own are not a screen that is accessible: the table's row headers, the
 * filter's name, the blocked buttons' descriptions and the dialog's focus trap
 * only exist once they are assembled here. This is the gate for the assembly,
 * and for this TASK it is **the** gate — P2 is the one performance-adjacent
 * check QUALITY-GATES 2장 kept, because it is cheap and has caught regressions
 * (D-217).
 *
 * What it claims is that nothing axe can decide structurally is wrong: names,
 * roles, relationships, duplicate ids, and the label/control wiring the form
 * system generates rather than a person writing it.
 */

import {
  adminSellerQueue,
  adminSellerQueueEmpty,
  httpFailureOn,
  mockPaths,
  networkFailureOn,
  resetAdminSellerStore,
  sessionAdminOperator,
  sessionDemoAdmin,
} from '@shopping/api-mocks'
import type { Seller } from '@shopping/shared'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { UserEvent } from '@testing-library/user-event'
import axe from 'axe-core'
import type { RunOptions } from 'axe-core'
import { describe, expect, it } from 'vitest'

import SellersPage from '@/app/sellers/page'
import { SellerReviewDetailWorkspace } from '@/components/sellers/seller-review-detail-workspace'
import { messagesFor } from '@/messages'

import { renderWithAuth } from './support/auth'
import { testServer } from './setup'

const { sellers: copy, errors, errorNotice } = messagesFor()

/**
 * The rule set, restated rather than imported.
 *
 * `categories-a11y.spec.tsx` and `attributes-a11y.spec.tsx` hold the same list;
 * `packages/ui`'s copy lives behind an `exports` map that does not reach into
 * `stories/`. Keeping the three in step is worth a note in the report; inventing
 * a different bar would not be.
 */
const OPTIONS: RunOptions = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] },
  rules: {
    // jsdom paints nothing, so axe cannot decide contrast. `packages/ui`
    // converts the OKLCH palette and fails below 4.5:1 over more pairs than a
    // screen would exercise.
    'color-contrast': { enabled: false },
    // The document shell — lang, title — belongs to `app/layout.tsx`, which is
    // not rendered here.
    'html-has-lang': { enabled: false },
    'document-title': { enabled: false },
    // Dialogs and toasts render through portals, outside this page's `<main>`.
    region: { enabled: false },
  },
}

async function expectNoViolations(): Promise<void> {
  const results = await axe.run(document.body, OPTIONS)

  expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([])
}

const firstOfStatus = (status: Seller['status']): Seller => {
  const row = adminSellerQueue.sellers.find((candidate) => candidate.status === status)

  if (row === undefined) throw new Error(`the queue fixture holds no ${status} store`)

  return row
}

async function openQueue(): Promise<void> {
  renderWithAuth(<SellersPage />)
  await screen.findByRole('table', { name: copy.listLabel })
}

async function startDecision(
  user: UserEvent,
  seller: Seller,
  action: keyof typeof copy.actions,
): Promise<HTMLElement> {
  await user.click(
    screen.getByRole('button', { name: `${seller.brandName} ${copy.actions[action]}` }),
  )

  return screen.findByRole('dialog', { name: copy.dialog.titles[action] })
}

/**
 * Why this file gets a bigger budget than vitest's five seconds.
 *
 * Every test here runs axe over the whole document, and the document is a
 * twenty-row, seven-column table carrying forty buttons — an accessibility tree
 * an order of magnitude larger than a form. Measured locally: the slowest is
 * **733ms** (the reason field with its error), then 652ms and 643ms; the rest
 * are between 25ms and 600ms.
 *
 * CI runs this suite about **5.6x slower** than a warm local machine — the
 * factor `attributes-page.spec.tsx` measured for the same reason (commit
 * 65ac82e). 733ms × 5.6 ≈ 4.1s, which clears the default only just, and the
 * margin disappears the moment CI is busier than usual.
 *
 * The budget is raised rather than the sweep trimmed: what makes it slow is the
 * thing it exists to check, which is a whole screen rather than a component.
 */
const A11Y_TIMEOUT = { timeout: 20_000 } as const

describe('the review queue has no accessibility violations', A11Y_TIMEOUT, () => {
  it('while the applications are loading', async () => {
    renderWithAuth(<SellersPage />)

    await expectNoViolations()
  })

  it('when the applications have arrived', async () => {
    await openQueue()

    await expectNoViolations()
  })

  it('when nothing has been applied for', async () => {
    resetAdminSellerStore(adminSellerQueueEmpty)
    renderWithAuth(<SellersPage />)
    await screen.findByText(copy.emptyTitle)

    await expectNoViolations()
  })

  it('when the API refused', async () => {
    testServer.server.use(networkFailureOn('get', mockPaths.adminSellers))
    renderWithAuth(<SellersPage />)
    await screen.findByText(copy.errorTitle)

    await expectNoViolations()
  })

  it('with the status filter open', async () => {
    const user = userEvent.setup()
    await openQueue()
    await user.click(screen.getByRole('combobox', { name: copy.filterLabel }))
    await screen.findByRole('option', { name: copy.statusLabels.PENDING })

    await expectNoViolations()
  })

  /**
   * The blocked control is the reason this screen has an a11y gate at all: it is
   * `aria-disabled` with its reason in a visually hidden sibling, and getting
   * that wiring wrong produces a button that looks explained and announces
   * nothing.
   */
  it('with 정지 blocked for an operator', async () => {
    const user = userEvent.setup()
    renderWithAuth(<SellersPage />, { session: sessionAdminOperator })
    await screen.findByRole('table', { name: copy.listLabel })
    await user.click(screen.getByRole('combobox', { name: copy.filterLabel }))
    await user.click(await screen.findByRole('option', { name: copy.statusLabels.ACTIVE }))
    await screen.findByRole('link', { name: firstOfStatus('ACTIVE').brandName })

    await expectNoViolations()
  })

  it('with the demo scope notice up', async () => {
    renderWithAuth(<SellersPage />, { session: sessionDemoAdmin })
    await screen.findByText(copy.demoScopeNotice)

    await expectNoViolations()
  })

  it('with the confirmation dialog open', async () => {
    const user = userEvent.setup()
    await openQueue()
    await startDecision(user, firstOfStatus('PENDING'), 'approve')

    await expectNoViolations()
  })

  it('with the reason field showing', async () => {
    const user = userEvent.setup()
    await openQueue()
    await startDecision(user, firstOfStatus('PENDING'), 'reject')

    await expectNoViolations()
  })

  it('with the reason field carrying its error', async () => {
    const user = userEvent.setup()
    await openQueue()
    const dialog = await startDecision(user, firstOfStatus('PENDING'), 'reject')
    await user.click(within(dialog).getByRole('button', { name: copy.dialog.confirms.reject }))
    await within(dialog).findByText(copy.dialog.errors.reasonRequired)

    await expectNoViolations()
  })

  it('with a dead network reported inside the dialog', async () => {
    const user = userEvent.setup()
    await openQueue()

    testServer.server.use(networkFailureOn('post', mockPaths.adminSellerDecision))
    const dialog = await startDecision(user, firstOfStatus('PENDING'), 'approve')
    await user.click(within(dialog).getByRole('button', { name: copy.dialog.confirms.approve }))
    await within(dialog).findByText(copy.failures.network)

    await expectNoViolations()
  })

  it('with the success toast up', async () => {
    const user = userEvent.setup()
    await openQueue()
    const dialog = await startDecision(user, firstOfStatus('PENDING'), 'approve')
    await user.click(within(dialog).getByRole('button', { name: copy.dialog.confirms.approve }))
    await screen.findByText(copy.toast.decided.approve)

    await expectNoViolations()
  })

  it('with the request-id notice up', async () => {
    const user = userEvent.setup()
    await openQueue()

    testServer.server.use(
      httpFailureOn(
        'post',
        mockPaths.adminSellerDecision,
        500,
        'INTERNAL_ERROR',
        '서버 내부 오류가 발생했습니다.',
      ),
    )
    const dialog = await startDecision(user, firstOfStatus('PENDING'), 'approve')
    await user.click(within(dialog).getByRole('button', { name: copy.dialog.confirms.approve }))
    await screen.findByText(errorNotice.title)

    await expectNoViolations()
  })
})

describe('one application has no accessibility violations', A11Y_TIMEOUT, () => {
  function openDetail(seller: Seller): void {
    renderWithAuth(
      <SellerReviewDetailWorkspace
        errors={errors}
        messages={copy}
        notice={errorNotice}
        sellerId={seller.id}
      />,
    )
  }

  it('with the application on screen', async () => {
    const rejected = firstOfStatus('REJECTED')
    openDetail(rejected)
    await screen.findByText(rejected.brandName)

    await expectNoViolations()
  })

  it('with a logo and the decisions the status allows', async () => {
    const active = firstOfStatus('ACTIVE')
    openDetail(active)
    await screen.findByText(active.brandName)

    await expectNoViolations()
  })

  it('when the application is gone', async () => {
    openDetail({ ...firstOfStatus('PENDING'), id: '019596e0-0001-7000-8000-0000000fffff' })
    await screen.findByText(copy.detail.notFoundTitle)

    await expectNoViolations()
  })
})
