/**
 * `/sellers`, driven the way an administrator drives it.
 *
 * Everything below renders the real screen and then clicks or types. No
 * component is handed a made-up prop bag and no class name is asserted on
 * (QUALITY-GATES Q5): what is checked is that the filter narrows the queue, that
 * paging forward and back neither repeats nor drops an application, that a
 * decision reaches the API once, that a reason cannot be skipped, and that a
 * refusal is shown rather than swallowed.
 *
 * The API is `@shopping/api-mocks`, which keeps real applications — so "it was
 * approved" is answered by asking the API again rather than by trusting the
 * frame the screen drew.
 */

import { adminSellerQueue, adminSellerQueueEmpty, MOCK_REQUEST_ID } from '@shopping/api-mocks'
import {
  httpFailureOn,
  mockPaths,
  networkFailureOn,
  resetAdminSellerStore,
  sessionAdminOperator,
  sessionDemoAdmin,
} from '@shopping/api-mocks'
import type { Seller } from '@shopping/shared'
import { createApiClient, sellerResponseSchema } from '@shopping/shared'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { UserEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import SellersPage from '@/app/sellers/page'
import { SellerReviewDetailWorkspace } from '@/components/sellers/seller-review-detail-workspace'
import { messagesFor } from '@/messages'

import type { MockSession } from './support/auth'
import { renderWithAuth } from './support/auth'
import { testServer } from './setup'

const { sellers: copy, errors, errorNotice } = messagesFor()

/**
 * A second administrator, looking at the same queue from their own browser.
 *
 * The same client the app uses, against the same mock API — which is what lets a
 * spec create the state "somebody decided while you were reading" without
 * reaching into the store.
 */
const otherAdmin = createApiClient({ appId: 'admin', baseUrl: 'http://api.test.invalid' })

/** Every request the app made, newest last. Reset before each test. */
const requests: string[] = []

testServer.server.events.on('request:start', ({ request }) => {
  requests.push(`${request.method} ${request.url}`)
})

beforeEach(() => {
  requests.length = 0
})

function decisionsMade(action: string): readonly string[] {
  return requests.filter((entry) => entry.startsWith('POST') && entry.endsWith(`/${action}`))
}

const firstOfStatus = (status: Seller['status']): Seller => {
  const row = adminSellerQueue.sellers.find((candidate) => candidate.status === status)

  if (row === undefined) throw new Error(`the queue fixture holds no ${status} store`)

  return row
}

/** Renders the queue as `session`, defaulting to the account it is read by. */
async function openQueue(session?: MockSession): Promise<HTMLElement> {
  renderWithAuth(<SellersPage />, session === undefined ? {} : { session })

  return screen.findByRole('table', { name: copy.listLabel })
}

/** Opens the status filter and picks an option by its visible text. */
async function filterBy(user: UserEvent, label: string): Promise<void> {
  await user.click(screen.getByRole('combobox', { name: copy.filterLabel }))
  await user.click(await screen.findByRole('option', { name: label }))
}

/** The row for one application, by the link that names it. */
function rowOf(seller: Seller): HTMLElement {
  const link = screen.getByRole('link', { name: seller.brandName })
  const row = link.closest('tr')

  if (row === null) throw new Error(`no row for ${seller.brandName}`)

  return row
}

/** Clicks a decision on one row and waits for its dialog. */
async function startDecision(
  user: UserEvent,
  seller: Seller,
  action: keyof typeof copy.actions,
): Promise<HTMLElement> {
  await user.click(
    within(rowOf(seller)).getByRole('button', {
      name: `${seller.brandName} ${copy.actions[action]}`,
    }),
  )

  return screen.findByRole('dialog', { name: copy.dialog.titles[action] })
}

/** What the API now holds for one application. */
async function storedStatus(id: string): Promise<Seller['status']> {
  const { seller } = await otherAdmin.request({
    path: `/admin/sellers/${id}`,
    schema: sellerResponseSchema,
  })

  return seller.status
}

describe('the review queue', () => {
  it('shows the newest twenty applications with their status', async () => {
    await openQueue()

    // One header row plus twenty applications.
    expect(screen.getAllByRole('row')).toHaveLength(21)
    expect(screen.getAllByText(copy.statusLabels.PENDING)).toHaveLength(20)
  })

  it('says so when nothing has been applied for', async () => {
    resetAdminSellerStore(adminSellerQueueEmpty)
    renderWithAuth(<SellersPage />)

    expect(await screen.findByText(copy.emptyTitle)).toBeVisible()
  })

  it('announces that it is loading before anything arrives', () => {
    renderWithAuth(<SellersPage />)

    expect(screen.getByText(copy.loadingLabel)).toBeInTheDocument()
  })

  it('shows the failure and a way to retry when the API cannot be reached', async () => {
    testServer.server.use(networkFailureOn('get', mockPaths.adminSellers))
    renderWithAuth(<SellersPage />)

    expect(await screen.findByText(copy.errorTitle)).toBeVisible()
    expect(screen.getByRole('button', { name: copy.retryLabel })).toBeVisible()
  })

  it('recovers when the retry succeeds', async () => {
    const user = userEvent.setup()
    testServer.server.use(networkFailureOn('get', mockPaths.adminSellers))
    renderWithAuth(<SellersPage />)
    await screen.findByText(copy.errorTitle)

    testServer.server.resetHandlers()
    await user.click(screen.getByRole('button', { name: copy.retryLabel }))

    expect(await screen.findByRole('table', { name: copy.listLabel })).toBeVisible()
  })
})

describe('the status filter', () => {
  it('asks the API for one status and redraws the queue', async () => {
    const user = userEvent.setup()
    await openQueue()
    await filterBy(user, copy.statusLabels.ACTIVE)

    await waitFor(() => {
      expect(screen.getAllByText(copy.statusLabels.ACTIVE).length).toBeGreaterThan(0)
    })

    expect(requests.some((entry) => entry.includes('status=ACTIVE'))).toBe(true)
    expect(screen.queryByText(copy.statusLabels.PENDING)).not.toBeInTheDocument()
  })

  it('says the queue is empty *because of the filter*', async () => {
    const user = userEvent.setup()
    resetAdminSellerStore({
      sellers: adminSellerQueue.sellers.filter((row) => row.status === 'PENDING'),
      nextCursor: null,
    })
    await openQueue()
    await filterBy(user, copy.statusLabels.SUSPENDED)

    expect(await screen.findByText(copy.filteredEmptyTitle)).toBeVisible()
  })

  /**
   * A cursor names a position within one ordering *and one filter*. Carrying it
   * across a filter change would ask for "everything after this application"
   * among rows that no longer include it.
   */
  it('goes back to the first page when the filter changes', async () => {
    const user = userEvent.setup()
    await openQueue()
    await user.click(screen.getByRole('button', { name: copy.pagination.next }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: copy.pagination.previous })).toBeEnabled()
    })

    await filterBy(user, copy.statusLabels.ACTIVE)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: copy.pagination.previous })).toBeDisabled()
    })
    expect(requests.at(-1)).not.toContain('cursor=')
  })
})

describe('paging through a hundred applications', () => {
  it('neither repeats nor drops one over three pages', async () => {
    const user = userEvent.setup()
    await openQueue()

    const seen: string[] = []

    for (let page = 0; page < 3; page += 1) {
      const links = screen.getAllByRole('link')
      seen.push(...links.map((link) => link.textContent ?? ''))

      if (page === 2) break
      await user.click(screen.getByRole('button', { name: copy.pagination.next }))
      await waitFor(() => {
        expect(screen.getAllByRole('link')[0]?.textContent).not.toBe(links[0]?.textContent)
      })
    }

    expect(seen).toHaveLength(60)
    expect(new Set(seen).size).toBe(60)
  })

  it('goes back exactly one page', async () => {
    const user = userEvent.setup()
    await openQueue()
    const first = screen.getAllByRole('link').map((link) => link.textContent)

    await user.click(screen.getByRole('button', { name: copy.pagination.next }))
    await waitFor(() => {
      expect(screen.getAllByRole('link')[0]?.textContent).not.toBe(first[0])
    })
    await user.click(screen.getByRole('button', { name: copy.pagination.previous }))

    await waitFor(() => {
      expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual(first)
    })
  })

  it('offers no way past the last page', async () => {
    const user = userEvent.setup()
    resetAdminSellerStore({
      sellers: adminSellerQueue.sellers.slice(0, 5),
      nextCursor: null,
    })
    await openQueue()

    expect(screen.getByRole('button', { name: copy.pagination.next })).toBeDisabled()
    expect(screen.getByRole('button', { name: copy.pagination.previous })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: copy.pagination.next }))

    expect(screen.getAllByRole('row')).toHaveLength(6)
  })
})

describe('deciding from the queue', () => {
  it('approves an application with one request and shows the new status', async () => {
    const user = userEvent.setup()
    const waiting = firstOfStatus('PENDING')
    await openQueue()

    const dialog = await startDecision(user, waiting, 'approve')
    await user.click(within(dialog).getByRole('button', { name: copy.dialog.confirms.approve }))

    expect(await screen.findByText(copy.toast.decided.approve)).toBeVisible()
    expect(decisionsMade('approve')).toHaveLength(1)
    await expect(storedStatus(waiting.id)).resolves.toBe('ACTIVE')
    // The queue was re-read, so the row now carries its new status.
    await waitFor(() => {
      expect(within(rowOf(waiting)).getByText(copy.statusLabels.ACTIVE)).toBeVisible()
    })
  })

  it('refuses to send a rejection with no reason, and says so under the field', async () => {
    const user = userEvent.setup()
    const waiting = firstOfStatus('PENDING')
    await openQueue()

    const dialog = await startDecision(user, waiting, 'reject')
    await user.click(within(dialog).getByRole('button', { name: copy.dialog.confirms.reject }))

    const message = await within(dialog).findByText(copy.dialog.errors.reasonRequired)
    expect(message).toBeVisible()
    expect(decisionsMade('reject')).toHaveLength(0)
    // The message is the field's description, not a line floating above the form.
    expect(
      within(dialog).getByLabelText(copy.dialog.reasonLabel, { exact: false }),
    ).toHaveAccessibleDescription(expect.stringContaining(copy.dialog.errors.reasonRequired))
  })

  it('sends the reason once it is written', async () => {
    const user = userEvent.setup()
    const waiting = firstOfStatus('PENDING')
    await openQueue()

    const dialog = await startDecision(user, waiting, 'reject')
    await user.type(
      within(dialog).getByLabelText(copy.dialog.reasonLabel, { exact: false }),
      '사업자 정보가 확인되지 않습니다.',
    )
    await user.click(within(dialog).getByRole('button', { name: copy.dialog.confirms.reject }))

    expect(await screen.findByText(copy.toast.decided.reject)).toBeVisible()
    await expect(storedStatus(waiting.id)).resolves.toBe('REJECTED')
  })

  it('sends one request however many times the confirm button is pressed', async () => {
    const user = userEvent.setup()
    const waiting = firstOfStatus('PENDING')
    await openQueue()

    const dialog = await startDecision(user, waiting, 'approve')
    const confirm = within(dialog).getByRole('button', { name: copy.dialog.confirms.approve })
    await user.tripleClick(confirm)

    expect(await screen.findByText(copy.toast.decided.approve)).toBeVisible()
    expect(decisionsMade('approve')).toHaveLength(1)
  })

  it('offers only what the status allows', async () => {
    const user = userEvent.setup()
    await openQueue()
    await filterBy(user, copy.statusLabels.REJECTED)

    const rejected = firstOfStatus('REJECTED')
    await screen.findByRole('link', { name: rejected.brandName })

    // 재신청 is the seller's move; an administrator has nothing to do here.
    expect(within(rowOf(rejected)).queryByRole('button')).not.toBeInTheDocument()
  })

  it('shows a server error with the number to quote, and keeps the queue', async () => {
    const user = userEvent.setup()
    const waiting = firstOfStatus('PENDING')
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

    const dialog = await startDecision(user, waiting, 'approve')
    await user.click(within(dialog).getByRole('button', { name: copy.dialog.confirms.approve }))

    expect(await screen.findByText(errorNotice.title)).toBeVisible()
    expect(screen.getByText(MOCK_REQUEST_ID)).toBeVisible()
    expect(screen.getByRole('table', { name: copy.listLabel })).toBeVisible()
    await expect(storedStatus(waiting.id)).resolves.toBe('PENDING')
  })

  it('shows a refusal the operator can act on inside the dialog', async () => {
    const user = userEvent.setup()
    const waiting = firstOfStatus('PENDING')
    await openQueue()

    testServer.server.use(
      httpFailureOn(
        'post',
        mockPaths.adminSellerDecision,
        400,
        'BAD_REQUEST',
        '요청 형식이 올바르지 않습니다.',
        [{ field: 'reason', message: 'reason 값이 올바르지 않습니다.', code: 'INVALID' }],
      ),
    )

    const dialog = await startDecision(user, waiting, 'reject')
    await user.type(
      within(dialog).getByLabelText(copy.dialog.reasonLabel, { exact: false }),
      '사유입니다.',
    )
    await user.click(within(dialog).getByRole('button', { name: copy.dialog.confirms.reject }))

    expect(await within(dialog).findByText(errors.INVALID)).toBeVisible()
  })

  /**
   * The one refusal the screen recovers from rather than reports.
   *
   * Reached the way it is reached in production: somebody else moved the store
   * while this queue was on screen. 정지 is still legal for an `ACTIVE` store,
   * so the request is not refused for being impossible — it is refused for being
   * written against a version that has moved on.
   */
  it('re-reads rather than overwrites when somebody decided first', async () => {
    const user = userEvent.setup()
    const active = firstOfStatus('ACTIVE')
    await openQueue()
    await filterBy(user, copy.statusLabels.ACTIVE)
    await screen.findByRole('link', { name: active.brandName })

    const suspended = await otherAdmin.request({
      path: `/admin/sellers/${active.id}/suspend`,
      method: 'POST',
      body: { version: active.version, reason: '먼저 정지했습니다.' },
      schema: sellerResponseSchema,
    })
    await otherAdmin.request({
      path: `/admin/sellers/${active.id}/reinstate`,
      method: 'POST',
      body: { version: suspended.seller.version },
      schema: sellerResponseSchema,
    })

    const dialog = await startDecision(user, active, 'suspend')
    await user.type(
      within(dialog).getByLabelText(copy.dialog.reasonLabel, { exact: false }),
      '내가 쓴 사유',
    )
    await user.click(within(dialog).getByRole('button', { name: copy.dialog.confirms.suspend }))

    expect(await screen.findByText(copy.toast.conflict)).toBeVisible()
    // Not overwritten: the store is where the other administrator left it.
    await expect(storedStatus(active.id)).resolves.toBe('ACTIVE')
  })
})

describe('what each role may do', () => {
  it('locks 정지 for an operator and says which permission is missing', async () => {
    const user = userEvent.setup()
    const active = firstOfStatus('ACTIVE')
    await openQueue(sessionAdminOperator)
    await filterBy(user, copy.statusLabels.ACTIVE)
    await screen.findByRole('link', { name: active.brandName })

    const button = within(rowOf(active)).getByRole('button', {
      name: `${active.brandName} ${copy.actions.suspend}`,
    })

    // `aria-disabled`, not `disabled`: a control a keyboard user cannot reach is
    // a control they are never told about (TASK-0023 4장).
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).toHaveAccessibleDescription(expect.stringContaining(copy.denials.suspend))
  })

  it('leaves 승인 open to an operator', async () => {
    const waiting = firstOfStatus('PENDING')
    await openQueue(sessionAdminOperator)

    const button = within(rowOf(waiting)).getByRole('button', {
      name: `${waiting.brandName} ${copy.actions.approve}`,
    })

    expect(button).not.toHaveAttribute('aria-disabled')
  })

  /**
   * A demo administrator's `seller.approve` is narrowed to `demo`, and the
   * response carries no `ownerIsDemo` — so the screen says the true thing it can
   * say about the account rather than guessing per row (TASK-0110 4장 · R4).
   */
  it('tells a demo administrator what their scope is', async () => {
    await openQueue(sessionDemoAdmin)

    expect(screen.getByText(copy.demoScopeNotice)).toBeVisible()
  })

  it('says nothing about scope to a full administrator', async () => {
    await openQueue()

    expect(screen.queryByText(copy.demoScopeNotice)).not.toBeInTheDocument()
  })
})

describe('the keyboard alone', () => {
  it('reaches a decision and completes it', async () => {
    const user = userEvent.setup()
    const waiting = firstOfStatus('PENDING')
    await openQueue()

    const approve = within(rowOf(waiting)).getByRole('button', {
      name: `${waiting.brandName} ${copy.actions.approve}`,
    })
    approve.focus()
    await user.keyboard('{Enter}')

    const dialog = await screen.findByRole('dialog', { name: copy.dialog.titles.approve })
    // Radix traps focus inside the dialog and starts it on the close control,
    // so a stray Enter dismisses rather than approves.
    expect(dialog.contains(document.activeElement)).toBe(true)

    const confirm = within(dialog).getByRole('button', { name: copy.dialog.confirms.approve })
    confirm.focus()
    await user.keyboard('{Enter}')

    expect(await screen.findByText(copy.toast.decided.approve)).toBeVisible()
  })
})

describe('one application in full', () => {
  function openDetail(seller: Seller) {
    renderWithAuth(
      <SellerReviewDetailWorkspace
        errors={errors}
        messages={copy}
        notice={errorNotice}
        sellerId={seller.id}
      />,
    )
  }

  it('shows the application, the status and the last reason', async () => {
    const rejected = firstOfStatus('REJECTED')
    openDetail(rejected)

    expect(await screen.findByText(rejected.brandName)).toBeVisible()
    expect(screen.getByText(rejected.slug)).toBeVisible()
    expect(screen.getByText(rejected.userId)).toBeVisible()
    expect(screen.getByText(copy.statusLabels.REJECTED)).toBeVisible()
    expect(screen.getByText(rejected.statusReason ?? '')).toBeVisible()
  })

  it('says 없음 rather than leaving a nullable column blank', async () => {
    const newest = adminSellerQueue.sellers[0]
    openDetail(newest as Seller)

    await screen.findByText((newest as Seller).brandName)
    // The newest application has never moved, so it has no decision time.
    expect(screen.getAllByText(copy.emptyValue).length).toBeGreaterThan(0)
  })

  it('offers the decisions the status allows, and explains when it allows none', async () => {
    const rejected = firstOfStatus('REJECTED')
    openDetail(rejected)

    expect(await screen.findByText(copy.detail.noActions)).toBeVisible()
  })

  it('decides from here too', async () => {
    const user = userEvent.setup()
    const waiting = firstOfStatus('PENDING')
    openDetail(waiting)
    await screen.findByText(waiting.brandName)

    await user.click(
      screen.getByRole('button', { name: `${waiting.brandName} ${copy.actions.approve}` }),
    )
    const dialog = await screen.findByRole('dialog', { name: copy.dialog.titles.approve })
    await user.click(within(dialog).getByRole('button', { name: copy.dialog.confirms.approve }))

    expect(await screen.findByText(copy.toast.decided.approve)).toBeVisible()
    await waitFor(() => {
      expect(screen.getByText(copy.statusLabels.ACTIVE)).toBeVisible()
    })
  })

  it('offers a way back rather than a retry when the application is gone', async () => {
    const missing = { ...firstOfStatus('PENDING'), id: '019596e0-0001-7000-8000-0000000fffff' }
    openDetail(missing)

    expect(await screen.findByText(copy.detail.notFoundTitle)).toBeVisible()
    expect(screen.queryByRole('button', { name: copy.retryLabel })).not.toBeInTheDocument()
  })

  it('shows a transport failure with a retry', async () => {
    testServer.server.use(networkFailureOn('get', mockPaths.adminSeller))
    openDetail(firstOfStatus('PENDING'))

    expect(await screen.findByText(copy.detail.errorTitle)).toBeVisible()
    expect(screen.getByRole('button', { name: copy.retryLabel })).toBeVisible()
  })

  /**
   * The same two recoveries the queue has, because the decision path is
   * deliberately one shape in both screens (TASK-0110 R6). Asserted here rather
   * than assumed: "it is the same code" is exactly the claim that stops being
   * true first.
   */
  it('re-reads rather than overwrites when somebody decided first', async () => {
    const user = userEvent.setup()
    const active = firstOfStatus('ACTIVE')
    openDetail(active)
    await screen.findByText(active.brandName)

    const suspended = await otherAdmin.request({
      path: `/admin/sellers/${active.id}/suspend`,
      method: 'POST',
      body: { version: active.version, reason: '먼저 정지했습니다.' },
      schema: sellerResponseSchema,
    })
    await otherAdmin.request({
      path: `/admin/sellers/${active.id}/reinstate`,
      method: 'POST',
      body: { version: suspended.seller.version },
      schema: sellerResponseSchema,
    })

    await user.click(
      screen.getByRole('button', { name: `${active.brandName} ${copy.actions.suspend}` }),
    )
    const dialog = await screen.findByRole('dialog', { name: copy.dialog.titles.suspend })
    await user.type(
      within(dialog).getByLabelText(copy.dialog.reasonLabel, { exact: false }),
      '내가 쓴 사유',
    )
    await user.click(within(dialog).getByRole('button', { name: copy.dialog.confirms.suspend }))

    expect(await screen.findByText(copy.toast.conflict)).toBeVisible()
    await expect(storedStatus(active.id)).resolves.toBe('ACTIVE')
  })

  it('shows a server error with the number to quote', async () => {
    const user = userEvent.setup()
    const waiting = firstOfStatus('PENDING')
    openDetail(waiting)
    await screen.findByText(waiting.brandName)

    testServer.server.use(
      httpFailureOn(
        'post',
        mockPaths.adminSellerDecision,
        500,
        'INTERNAL_ERROR',
        '서버 내부 오류가 발생했습니다.',
      ),
    )

    await user.click(
      screen.getByRole('button', { name: `${waiting.brandName} ${copy.actions.approve}` }),
    )
    const dialog = await screen.findByRole('dialog', { name: copy.dialog.titles.approve })
    await user.click(within(dialog).getByRole('button', { name: copy.dialog.confirms.approve }))

    expect(await screen.findByText(errorNotice.title)).toBeVisible()
    expect(screen.getByText(MOCK_REQUEST_ID)).toBeVisible()
    await expect(storedStatus(waiting.id)).resolves.toBe('PENDING')
  })
})
