/**
 * `/mypage/addresses` — the address book (TASK-0112 F2~F6b, U1~U6).
 *
 * The rules under test are the API's, not this screen's: the default moves
 * rather than doubling, deleting the default promotes the newest survivor, and
 * a lost race for the default is a 409 the screen has to recover from. The
 * double reproduces all three (`packages/api-mocks/src/handlers/profile.ts`),
 * so what is measured here is whether the screen *shows* what the API did.
 *
 * The postal-code widget arrives as a stub, which is what F6 asks for: it is an
 * external script and no gate in this repository can load one — the mock server
 * refuses unhandled requests and the process counts outbound sockets.
 */

import {
  addressRowsSnapshot,
  failNextDefaultAssignment,
  httpFailureOn,
  mockPaths,
  networkFailureOn,
  neverAnswersOn,
  resetProfileStore,
  sessionBuyer,
} from '@shopping/api-mocks'
import { addressCreateRequestSchema } from '@shopping/shared'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { UserEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import AddressesPage from '@/app/mypage/addresses/page'
import type * as PostcodeModule from '@/lib/profile/postcode'
import type { PostcodeSearch } from '@/lib/profile/postcode'
import { openPostcodeSearch } from '@/lib/profile/postcode'
import { messagesFor } from '@/messages'

import { renderAccountScreen, resetDensity } from './support/mypage'
import { stubViewport, VIEWPORTS } from './support/viewport'
import { testServer } from './setup'

const messages = messagesFor()
const copy = messages.mypage
const book = copy.addresses
const formCopy = book.form

vi.mock('next/navigation', () => ({ usePathname: () => '/mypage/addresses' }))

/**
 * The widget, replaced at the module boundary.
 *
 * `AddressForm` takes the search as a prop and defaults to this export, so the
 * route can be rendered exactly as the app assembles it while each test still
 * says what the widget does. Replacing the module rather than threading a prop
 * through the page is what keeps the page's signature the one Next.js expects.
 *
 * No test ever loads the real script: the mock server refuses unhandled
 * requests and the process counts outbound sockets (TASK-0107 4.8).
 */
vi.mock('@/lib/profile/postcode', async (importOriginal) => ({
  ...(await importOriginal<typeof PostcodeModule>()),
  openPostcodeSearch: vi.fn<PostcodeSearch>(),
}))

beforeEach(() => {
  resetDensity()
  stubViewport(VIEWPORTS.desktop)
})

afterEach(() => {
  localStorage.clear()
  testServer.server.events.removeAllListeners()
})

function countRequests(method: string, endsWith: string): () => number {
  let seen = 0

  testServer.server.events.on('request:start', ({ request }) => {
    if (request.method === method && new URL(request.url).pathname.endsWith(endsWith)) seen += 1
  })

  return () => seen
}

/** Every request body the app sent to `POST /me/addresses`, in order. */
function capturedCreates(): () => readonly unknown[] {
  const bodies: unknown[] = []

  testServer.server.events.on('request:start', ({ request }) => {
    if (request.method !== 'POST' || !request.url.endsWith('/me/addresses')) return

    void request
      .clone()
      .json()
      .then((body: unknown) => bodies.push(body))
  })

  return () => bodies
}

/** A widget that answers with one address, standing in for the real script. */
const stubSearch: PostcodeSearch = ({ onSelect }) => {
  onSelect({ postalCode: '04524', addressLine1: '서울특별시 중구 세종대로 110' })

  return Promise.resolve()
}

/** A widget that cannot be loaded — blocked, dead or too slow (F6b). */
const brokenSearch: PostcodeSearch = () => Promise.reject(new Error('blocked'))

async function openBook(search: PostcodeSearch = stubSearch): Promise<void> {
  vi.mocked(openPostcodeSearch).mockImplementation(search)
  renderAccountScreen(<AddressesPage />, { session: sessionBuyer })

  await screen.findByRole('list', { name: book.listLabel })
}

function cards(): readonly HTMLElement[] {
  return within(screen.getByRole('list', { name: book.listLabel })).getAllByRole('listitem')
}

/** The card wearing the default badge, whichever one that currently is. */
function defaultCard(): HTMLElement {
  const card = cards().find((row) => within(row).queryByText(book.defaultBadge) !== null)

  if (card === undefined) throw new Error('no address is marked as the default')

  return card
}

/**
 * One field of the address form, by its accessible name.
 *
 * By role rather than `getByLabelText`: "우편번호" also appears in the search
 * button and in the widget panel's label, and a text match would find three
 * things. The required marker is `aria-hidden`, so the name is the label alone.
 */
function field(label: string): HTMLElement {
  return screen.getByRole('textbox', { name: label })
}

async function fillAddress(user: UserEvent, recipient: string): Promise<void> {
  await user.type(field(formCopy.labelLabel), '기숙사')
  await user.type(field(formCopy.recipientLabel), recipient)
  await user.type(field(formCopy.phoneLabel), '010-1111-2222')
  await user.type(field(formCopy.addressLine2Label), '302호')
}

describe('the four states of the list (U1 · P5)', () => {
  it('announces the wait', async () => {
    testServer.server.use(neverAnswersOn('get', mockPaths.meAddresses))
    renderAccountScreen(<AddressesPage />, { session: sessionBuyer })

    expect(await screen.findByRole('status', { name: book.loadingLabel })).toBeVisible()
  })

  it('offers the empty state when nothing is saved', async () => {
    resetProfileStore([])
    renderAccountScreen(<AddressesPage />, { session: sessionBuyer })

    expect(await screen.findByText(book.emptyTitle)).toBeVisible()
  })

  it('reports a failed read rather than an empty list', async () => {
    testServer.server.use(networkFailureOn('get', mockPaths.meAddresses))
    renderAccountScreen(<AddressesPage />, { session: sessionBuyer })

    // "저장한 배송지가 없습니다" for a 500 is worse than an error: the reader
    // stops looking.
    expect(await screen.findByText(copy.loadErrorTitle)).toBeVisible()
    expect(screen.queryByText(book.emptyTitle)).toBeNull()
  })

  it('draws one card per address, with the badge on exactly one (F2)', async () => {
    await openBook()

    expect(cards()).toHaveLength(3)
    expect(screen.getAllByText(book.defaultBadge)).toHaveLength(1)
    expect(within(defaultCard()).getByRole('heading')).toHaveTextContent('집')
  })

  it('offers no "기본으로" on the address that already is one', async () => {
    await openBook()

    // Absent rather than disabled: nothing on that row invites a click that
    // would do nothing.
    expect(within(defaultCard()).queryByRole('button', { name: /기본으로/ })).toBeNull()
    expect(screen.getAllByRole('button', { name: /기본으로/ })).toHaveLength(2)
  })
})

describe('making another address the default (F4)', () => {
  it('moves the badge and says so', async () => {
    const user = userEvent.setup()
    await openBook()

    await user.click(screen.getByRole('button', { name: `${book.makeDefault} 회사` }))

    expect(await screen.findByText(book.defaultChangedNotice)).toBeVisible()
    await waitFor(() => {
      expect(within(defaultCard()).getByRole('heading')).toHaveTextContent('회사')
    })
    // The old default lost its badge in the same read — the API cleared it, and
    // splicing one row in would have left two.
    expect(screen.getAllByText(book.defaultBadge)).toHaveLength(1)
  })

  it('shows the 409 a lost race produces, with the list already corrected', async () => {
    const user = userEvent.setup()
    await openBook()
    failNextDefaultAssignment()

    await user.click(screen.getByRole('button', { name: `${book.makeDefault} 회사` }))

    expect(await screen.findByText(copy.errors.CONFLICT)).toBeVisible()
    // Not retried: the intent was "make *this* one the default", so retrying
    // would overwrite the choice that won in a race nobody can see. What the
    // screen owes instead is the truth about where the default is now.
    expect(within(defaultCard()).getByRole('heading')).toHaveTextContent('집')
  })
})

describe('deleting an address (F5)', () => {
  it('sends nothing until the dialog is confirmed', async () => {
    const user = userEvent.setup()
    await openBook()
    const deletes = countRequests('DELETE', '/me/addresses/' + addressRowsSnapshot()[0]!.id)

    await user.click(screen.getByRole('button', { name: `${book.remove} 집` }))
    const dialog = await screen.findByRole('dialog', { name: book.removeTitle })
    await user.click(within(dialog).getByRole('button', { name: book.removeCancel }))

    expect(deletes()).toBe(0)
    expect(cards()).toHaveLength(3)
  })

  it('names the address it is about to delete', async () => {
    const user = userEvent.setup()
    await openBook()

    await user.click(screen.getByRole('button', { name: `${book.remove} 회사` }))
    const dialog = await screen.findByRole('dialog', { name: book.removeTitle })

    expect(within(dialog).getByText(/회사/)).toBeVisible()
  })

  it('promotes the newest survivor when the default goes, and says so', async () => {
    const user = userEvent.setup()
    await openBook()

    await user.click(screen.getByRole('button', { name: `${book.remove} 집` }))
    const dialog = await screen.findByRole('dialog', { name: book.removeTitle })
    await user.click(within(dialog).getByRole('button', { name: book.removeConfirm }))

    await waitFor(() => {
      expect(cards()).toHaveLength(2)
    })
    // `회사` was created after the unnamed one, so the contract's ordering
    // (createdAt desc, id desc) picks it. The screen re-read to find that out.
    expect(within(defaultCard()).getByRole('heading')).toHaveTextContent('회사')
    expect(screen.getByText(new RegExp(book.promotedNotice))).toBeVisible()
  })

  it('says nothing about promotion when a non-default is deleted', async () => {
    const user = userEvent.setup()
    await openBook()

    await user.click(screen.getByRole('button', { name: `${book.remove} 회사` }))
    const dialog = await screen.findByRole('dialog', { name: book.removeTitle })
    await user.click(within(dialog).getByRole('button', { name: book.removeConfirm }))

    expect(await screen.findByText(book.removedNotice)).toBeVisible()
    expect(screen.queryByText(new RegExp(book.promotedNotice))).toBeNull()
  })
})

describe('adding an address (F3)', () => {
  it('sends a body the shared request schema accepts', async () => {
    const user = userEvent.setup()
    const bodies = capturedCreates()
    await openBook(stubSearch)

    await user.click(screen.getByRole('button', { name: book.addLabel }))
    await fillAddress(user, '박지후')
    await user.click(screen.getByRole('button', { name: formCopy.searchLabel }))
    await user.click(screen.getByRole('button', { name: formCopy.save }))

    await waitFor(() => {
      expect(bodies()).toHaveLength(1)
    })
    // Gate C1 read from the request side: what the form validated is what the
    // API parses, because both are the same schema object.
    expect(addressCreateRequestSchema.safeParse(bodies()[0]).success).toBe(true)
    expect(await screen.findByText(book.savedNotice)).toBeVisible()
    expect(cards()).toHaveLength(4)
  })

  it('fills the postal code and road address from the widget, then moves focus (F6)', async () => {
    const user = userEvent.setup()
    await openBook(stubSearch)

    await user.click(screen.getByRole('button', { name: book.addLabel }))
    await user.click(screen.getByRole('button', { name: formCopy.searchLabel }))

    await waitFor(() => {
      expect(field(formCopy.postalCodeLabel)).toHaveValue('04524')
    })
    expect(field(formCopy.addressLine1Label)).toHaveValue('서울특별시 중구 세종대로 110')
    // The unit number is the one thing the widget cannot know.
    expect(field(formCopy.addressLine2Label)).toHaveFocus()
  })

  it('still saves when the widget cannot be loaded (F6b)', async () => {
    const user = userEvent.setup()
    const bodies = capturedCreates()
    await openBook(brokenSearch)

    await user.click(screen.getByRole('button', { name: book.addLabel }))
    await user.click(screen.getByRole('button', { name: formCopy.searchLabel }))

    expect(await screen.findByText(formCopy.manualTitle)).toBeVisible()

    // The three fields were never locked, so there is nothing to unlock — the
    // fallback is the same form with one notice added.
    await fillAddress(user, '박지후')
    await user.type(field(formCopy.postalCodeLabel), '04524')
    await user.type(field(formCopy.addressLine1Label), '서울특별시 중구 세종대로 110')
    await user.click(screen.getByRole('button', { name: formCopy.save }))

    await waitFor(() => {
      expect(bodies()).toHaveLength(1)
    })
    expect(addressCreateRequestSchema.safeParse(bodies()[0]).success).toBe(true)
  })

  it('puts a four-digit postal code under the postal code field (U2)', async () => {
    const user = userEvent.setup()
    await openBook(brokenSearch)

    await user.click(screen.getByRole('button', { name: book.addLabel }))
    await fillAddress(user, '박지후')
    await user.type(field(formCopy.postalCodeLabel), '0452')
    await user.type(field(formCopy.addressLine1Label), '세종대로 110')
    await user.click(screen.getByRole('button', { name: formCopy.save }))

    const postal = field(formCopy.postalCodeLabel)

    expect(await screen.findByText(formCopy.errors.postalCode)).toBeVisible()
    expect(postal).toHaveAttribute('aria-invalid', 'true')
    expect(postal).toHaveAccessibleDescription(new RegExp(formCopy.errors.postalCode))
  })

  it('sends one request for two clicks in the same tick (U3)', async () => {
    const user = userEvent.setup()
    const creates = countRequests('POST', '/me/addresses')
    await openBook(stubSearch)

    await user.click(screen.getByRole('button', { name: book.addLabel }))
    await fillAddress(user, '박지후')
    await user.click(screen.getByRole('button', { name: formCopy.searchLabel }))

    const save = screen.getByRole('button', { name: formCopy.save })
    fireEvent.click(save)
    fireEvent.click(save)

    await screen.findByText(book.savedNotice)
    expect(creates()).toBe(1)
  })

  it('keeps what was typed when the server refuses (U6)', async () => {
    const user = userEvent.setup()
    await openBook(stubSearch)

    await user.click(screen.getByRole('button', { name: book.addLabel }))
    await fillAddress(user, '박지후')
    await user.click(screen.getByRole('button', { name: formCopy.searchLabel }))

    testServer.server.use(
      httpFailureOn('post', mockPaths.meAddresses, 500, 'INTERNAL_ERROR', '서버 오류입니다.'),
    )
    await user.click(screen.getByRole('button', { name: formCopy.save }))

    expect(await screen.findByText(copy.errors.INTERNAL_ERROR)).toBeVisible()
    expect(field(formCopy.recipientLabel)).toHaveValue('박지후')
    expect(field(formCopy.postalCodeLabel)).toHaveValue('04524')
  })

  it('can be completed with the keyboard alone, through the fallback (U5)', async () => {
    const user = userEvent.setup()
    const bodies = capturedCreates()
    await openBook(brokenSearch)

    // Every step from here is a keystroke: no `click`, no pointer.
    screen.getByRole('button', { name: book.addLabel }).focus()
    await user.keyboard('{Enter}')

    const search = await screen.findByRole('button', { name: formCopy.searchLabel })
    search.focus()
    await user.keyboard('{Enter}')
    expect(await screen.findByText(formCopy.manualTitle)).toBeVisible()

    for (const [label, value] of [
      [formCopy.recipientLabel, '박지후'],
      [formCopy.phoneLabel, '010-1111-2222'],
      [formCopy.postalCodeLabel, '04524'],
      [formCopy.addressLine1Label, '서울특별시 중구 세종대로 110'],
    ] as const) {
      field(label).focus()
      await user.keyboard(value)
    }

    screen.getByRole('button', { name: formCopy.save }).focus()
    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(bodies()).toHaveLength(1)
    })
  })

  it('does not offer the default switch for the very first address', async () => {
    const user = userEvent.setup()
    resetProfileStore([])
    vi.mocked(openPostcodeSearch).mockImplementation(stubSearch)
    renderAccountScreen(<AddressesPage />, { session: sessionBuyer })

    await user.click(await screen.findByRole('button', { name: book.addLabel }))

    // The first address becomes the default whatever the request says
    // (TASK-0111 4장), so offering the choice would be offering a lie.
    const toggle = screen.getByRole('switch', { name: new RegExp(formCopy.makeDefaultLabel) })
    expect(toggle).toBeDisabled()
    expect(screen.getByText(formCopy.firstIsDefaultHint)).toBeVisible()
  })
})

describe('editing an address', () => {
  it('opens with the stored values and saves the change', async () => {
    const user = userEvent.setup()
    await openBook(stubSearch)

    await user.click(screen.getByRole('button', { name: `${book.edit} 집` }))

    const recipient = field(formCopy.recipientLabel)
    expect(recipient).toHaveValue('김민준')

    await user.clear(recipient)
    await user.type(recipient, '김서연')
    await user.click(screen.getByRole('button', { name: formCopy.save }))

    await waitFor(() => {
      expect(addressRowsSnapshot()[0]?.recipientName).toBe('김서연')
    })
  })

  it('promotes through the dedicated endpoint when the switch is turned on', async () => {
    const user = userEvent.setup()
    const promotions = countRequests('POST', '/default')
    await openBook(stubSearch)

    await user.click(screen.getByRole('button', { name: `${book.edit} 회사` }))
    await user.click(screen.getByRole('switch', { name: new RegExp(formCopy.makeDefaultLabel) }))
    await user.click(screen.getByRole('button', { name: formCopy.save }))

    // `addressUpdateRequestSchema` has no `isDefault`: promotion clears the
    // previous default in one transaction and a second door could not hold it.
    await waitFor(() => {
      expect(promotions()).toBe(1)
    })
    await waitFor(() => {
      expect(within(defaultCard()).getByRole('heading')).toHaveTextContent('회사')
    })
  })
})
