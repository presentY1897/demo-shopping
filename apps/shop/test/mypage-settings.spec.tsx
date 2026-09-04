/**
 * `/mypage/settings` — the four things an account holder can change, and the
 * one they cannot undo (TASK-0112 F1 · F7 · F9 · F10, U1~U6).
 *
 * Every assertion goes through a click or a keystroke and then reads what the
 * screen shows or what the mock API now holds. Nothing checks a class name; the
 * `preferenceSnapshot()` calls are checking that a request was *made and
 * accepted*, which a rendered switch alone cannot tell us — an optimistic
 * toggle looks identical to a saved one.
 */

import {
  httpFailureOn,
  mockPaths,
  networkFailureOn,
  neverAnswersOn,
  preferenceSnapshot,
  sessionBuyer,
} from '@shopping/api-mocks'
import { DEFAULT_USER_PREFERENCE } from '@shopping/shared'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import SettingsPage from '@/app/mypage/settings/page'
import { messagesFor } from '@/messages'

import { renderAccountScreen, resetDensity } from './support/mypage'
import { stubViewport, VIEWPORTS } from './support/viewport'
import { testServer } from './setup'

const messages = messagesFor()
const copy = messages.mypage
const profileCopy = copy.settings.profile
const withdrawalCopy = copy.settings.withdrawal

vi.mock('next/navigation', () => ({ usePathname: () => '/mypage/settings' }))

beforeEach(() => {
  resetDensity()
  stubViewport(VIEWPORTS.desktop)
})

afterEach(() => {
  localStorage.clear()
  // The request counters below subscribe to the shared server; a listener left
  // behind would keep counting into a closure the next test cannot see.
  testServer.server.events.removeAllListeners()
})

/** Counts the requests a test causes, by method and path suffix. */
function countRequests(method: string, endsWith: string): () => number {
  let seen = 0

  testServer.server.events.on('request:start', ({ request }) => {
    if (request.method === method && new URL(request.url).pathname.endsWith(endsWith)) seen += 1
  })

  return () => seen
}

/** A switch's accessible name carries its description too, so match the label. */
function switchNamed(label: string): HTMLElement {
  return screen.getByRole('switch', { name: new RegExp(label) })
}

/** Renders the route signed in and waits for the one read it makes. */
async function openSettings(): Promise<void> {
  renderAccountScreen(<SettingsPage />, { session: sessionBuyer })

  await screen.findByRole('form', { name: profileCopy.legend })
}

function nameBox(): HTMLElement {
  return screen.getByLabelText(new RegExp(profileCopy.nameLabel))
}

describe('the four states of the read (U1 · P5)', () => {
  it('announces the wait while the account is still being read', async () => {
    // Held open rather than raced: the session renewal resolves first, so
    // without this the profile would usually have arrived before the assertion.
    testServer.server.use(neverAnswersOn('get', mockPaths.me))
    renderAccountScreen(<SettingsPage />, { session: sessionBuyer })

    expect(await screen.findByRole('status', { name: copy.loadingLabel })).toBeVisible()
  })

  it('invites a signed-out visitor to sign in rather than redirecting', async () => {
    renderAccountScreen(<SettingsPage />)

    // `apps/shop` is a public site: bouncing somebody off a bookmarked address
    // would lose it (TASK-0023 4장).
    expect(await screen.findByText(messages.auth.requireSignIn.title)).toBeVisible()
  })

  it('reports a failed read, with a way to try again', async () => {
    testServer.server.use(networkFailureOn('get', mockPaths.me))
    renderAccountScreen(<SettingsPage />, { session: sessionBuyer })

    expect(await screen.findByText(copy.loadErrorTitle)).toBeVisible()
    expect(screen.getByRole('button', { name: copy.retryLabel })).toBeVisible()
  })

  it('recovers when the retry succeeds', async () => {
    const user = userEvent.setup()
    testServer.server.use(networkFailureOn('get', mockPaths.me))
    renderAccountScreen(<SettingsPage />, { session: sessionBuyer })

    await user.click(await screen.findByRole('button', { name: copy.retryLabel }))

    // The override is one handler deep; the default answers the second read.
    testServer.server.resetHandlers()
    await user.click(await screen.findByRole('button', { name: copy.retryLabel }))

    expect(await screen.findByRole('form', { name: profileCopy.legend })).toBeVisible()
  })

  it('shows the profile once it arrives', async () => {
    await openSettings()

    expect(nameBox()).toHaveValue('김민준')
    expect(screen.getByText('buyer@demo-shopping.test')).toBeVisible()
  })
})

describe('editing the profile (F1)', () => {
  it('saves the new name and shows it', async () => {
    const user = userEvent.setup()
    await openSettings()

    await user.clear(nameBox())
    await user.type(nameBox(), '김민서')
    await user.click(screen.getByRole('button', { name: profileCopy.save }))

    expect(await screen.findByText(profileCopy.savedNotice)).toBeVisible()
    // The screen shows what came back, not what was typed: `PATCH /me` answers
    // with the whole profile and that answer is what replaces the state.
    expect(nameBox()).toHaveValue('김민서')
  })

  it('keeps the email out of reach', async () => {
    await openSettings()

    // Read as text, not as a disabled input — a disabled control leaves the tab
    // order and a keyboard user could not read the value it was showing them.
    expect(screen.queryByLabelText(profileCopy.emailLabel)).toBeNull()
    expect(screen.getByText('buyer@demo-shopping.test')).toBeVisible()
  })

  it('puts a rejected name under the name field (U2)', async () => {
    const user = userEvent.setup()
    await openSettings()

    await user.clear(nameBox())
    await user.click(screen.getByRole('button', { name: profileCopy.save }))

    // The rule is `profileNameSchema`'s and the sentence is this app's; nothing
    // about the length is restated in the screen.
    expect(await screen.findByText(profileCopy.nameError)).toBeVisible()
    expect(nameBox()).toHaveAttribute('aria-invalid', 'true')
    expect(nameBox()).toHaveAccessibleDescription(new RegExp(profileCopy.nameError))
  })

  it('rejects an avatar that is not a URL, and accepts an empty box', async () => {
    const user = userEvent.setup()
    await openSettings()

    const avatar = screen.getByLabelText(profileCopy.avatarLabel)

    await user.clear(avatar)
    await user.type(avatar, 'not-a-url')
    await user.click(screen.getByRole('button', { name: profileCopy.save }))
    expect(await screen.findByText(profileCopy.avatarError)).toBeVisible()

    await user.clear(avatar)
    await user.click(screen.getByRole('button', { name: profileCopy.save }))
    expect(await screen.findByText(profileCopy.savedNotice)).toBeVisible()
  })

  it('shows a server failure and keeps what was typed (U6)', async () => {
    const user = userEvent.setup()
    await openSettings()

    testServer.server.use(
      httpFailureOn('patch', mockPaths.me, 500, 'INTERNAL_ERROR', '서버 오류입니다.'),
    )

    await user.clear(nameBox())
    await user.type(nameBox(), '박지후')
    await user.click(screen.getByRole('button', { name: profileCopy.save }))

    expect(await screen.findByText(copy.errors.INTERNAL_ERROR)).toBeVisible()
    // The value survives the failure — retyping it would be the whole cost of a
    // 500 landing on somebody halfway through a form.
    expect(nameBox()).toHaveValue('박지후')
  })

  it('quotes a request id only for a failure the reader cannot act on', async () => {
    const user = userEvent.setup()
    await openSettings()

    testServer.server.use(
      httpFailureOn('patch', mockPaths.me, 500, 'INTERNAL_ERROR', '서버 오류입니다.'),
    )
    await user.click(screen.getByRole('button', { name: profileCopy.save }))

    // The label is the id's accessible name, not visible text — a UUID with a
    // heading over it would be shouting at somebody who cannot act on it.
    expect(await screen.findByLabelText(copy.requestIdLabel)).toBeVisible()
  })

  it('sends one request for two clicks in the same tick (U3)', async () => {
    await openSettings()
    const saves = countRequests('PATCH', '/me')

    // Dispatched synchronously on purpose. `setSubmitting(true)` is not visible
    // to a second event in the same tick — React has not re-rendered — so a
    // state check would let the second one through and `Button.loading` alone
    // would not save it. The guard being tested is `useForm`'s `busy` ref.
    const save = screen.getByRole('button', { name: profileCopy.save })
    fireEvent.click(save)
    fireEvent.click(save)

    await screen.findByText(profileCopy.savedNotice)
    expect(saves()).toBe(1)
  })
})

describe('notification switches (F9)', () => {
  it('saves the one that was pressed and leaves the others alone', async () => {
    const user = userEvent.setup()
    await openSettings()

    const marketing = switchNamed(copy.settings.notifications.switches.notifyMarketing.label)
    expect(marketing).toHaveAttribute('aria-checked', 'false')

    await user.click(marketing)
    await waitFor(() => {
      expect(preferenceSnapshot().notifyMarketing).toBe(true)
    })

    // A body carrying all three would overwrite two values nobody touched with
    // whatever this screen last read.
    expect(preferenceSnapshot().notifyOrder).toBe(DEFAULT_USER_PREFERENCE.notifyOrder)
    expect(preferenceSnapshot().notifyClaim).toBe(DEFAULT_USER_PREFERENCE.notifyClaim)
  })

  it('turning one off is what F9 asks for', async () => {
    const user = userEvent.setup()
    await openSettings()

    await user.click(switchNamed(copy.settings.notifications.switches.notifyOrder.label))

    await waitFor(() => {
      expect(preferenceSnapshot().notifyOrder).toBe(false)
    })
    expect(await screen.findByText(copy.settings.notifications.savedNotice)).toBeVisible()
  })

  it('reports a refused save', async () => {
    const user = userEvent.setup()
    await openSettings()

    testServer.server.use(networkFailureOn('patch', mockPaths.mePreferences))
    await user.click(switchNamed(copy.settings.notifications.switches.notifyClaim.label))

    expect(await screen.findByText(copy.failures.network)).toBeVisible()
  })
})

describe('withdrawal (F10)', () => {
  async function openDialog(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
    await user.click(screen.getByRole('button', { name: withdrawalCopy.trigger }))

    return screen.findByRole('dialog', { name: withdrawalCopy.confirmTitle })
  }

  it('sends nothing until the phrase is typed', async () => {
    const user = userEvent.setup()
    await openSettings()

    const deletes = countRequests('DELETE', '/me')
    const dialog = await openDialog(user)
    await user.click(within(dialog).getByRole('button', { name: withdrawalCopy.confirmLabel }))

    // Not "the dialog was shown" — the destructive call is unreachable. A
    // confirmation whose button works before the phrase is typed is the
    // formality R4 refuses.
    expect(deletes()).toBe(0)
    expect(screen.queryByText(withdrawalCopy.doneTitle)).toBeNull()
  })

  it('says what is erased and what survives, in the dialog itself', async () => {
    const user = userEvent.setup()
    await openSettings()

    const dialog = await openDialog(user)

    for (const line of [...withdrawalCopy.erased, ...withdrawalCopy.kept]) {
      expect(within(dialog).getByText(line)).toBeVisible()
    }
  })

  it('withdraws once the phrase matches, and reports the server’s own counts', async () => {
    const user = userEvent.setup()
    await openSettings()

    const dialog = await openDialog(user)
    await user.type(
      within(dialog).getByLabelText(withdrawalCopy.phraseLabel),
      withdrawalCopy.phrase,
    )
    await user.click(within(dialog).getByRole('button', { name: withdrawalCopy.confirmLabel }))

    expect(await screen.findByText(withdrawalCopy.doneTitle)).toBeVisible()
    // Three addresses erased, sessions ended across every app — counted by the
    // API, not guessed by the screen.
    const receipt = screen.getByRole('status')
    expect(within(receipt.parentElement ?? receipt).getByText('3')).toBeVisible()
  })

  it('keeps the dialog open when the request fails', async () => {
    const user = userEvent.setup()
    await openSettings()

    testServer.server.use(networkFailureOn('delete', mockPaths.me))

    const dialog = await openDialog(user)
    await user.type(
      within(dialog).getByLabelText(withdrawalCopy.phraseLabel),
      withdrawalCopy.phrase,
    )
    await user.click(within(dialog).getByRole('button', { name: withdrawalCopy.confirmLabel }))

    expect(await within(dialog).findByText(copy.failures.network)).toBeVisible()
    expect(screen.queryByText(withdrawalCopy.doneTitle)).toBeNull()
  })

  it('can be driven from the keyboard alone (P4 · U5)', async () => {
    const user = userEvent.setup()
    await openSettings()

    const trigger = screen.getByRole('button', { name: withdrawalCopy.trigger })
    trigger.focus()
    await user.keyboard('{Enter}')

    const dialog = await screen.findByRole('dialog', { name: withdrawalCopy.confirmTitle })

    // Initial focus is the close control, not the destructive button, so a
    // stray Enter dismisses rather than destroys.
    expect(within(dialog).getByLabelText(withdrawalCopy.closeLabel)).toHaveFocus()

    await user.keyboard('{Escape}')
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
  })
})
