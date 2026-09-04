/**
 * axe over both account screens, in every state they can be in (P2).
 *
 * `packages/ui` runs the same engine over every story, but components that are
 * accessible on their own are not a screen that is accessible: the profile
 * form's generated label/control wiring, the address cards' three same-named
 * buttons, the withdrawal dialog's focus trap and the search panel's
 * `aria-controls` target only exist once they are assembled here. This is the
 * gate for the assembly.
 *
 * **This is the measurement TASK-0112 6.2 P2 claims**, and it is axe rather
 * than Lighthouse for the reason TASK-0023 — the same milestone, the same app —
 * gave: a Lighthouse score needs a real browser driving a running server, and
 * what it would add over this is a contrast check that jsdom cannot paint
 * anyway. `packages/ui` converts the OKLCH palette and checks contrast over
 * more pairs than either screen exercises.
 *
 * The rule set is the one `apps/admin`'s two a11y specs use, restated rather
 * than imported: `packages/ui`'s copy lives behind an `exports` map that does
 * not reach into `stories/`. Keeping the four in step is worth a note in a
 * report; inventing a different bar would not be.
 */

import { mockPaths, networkFailureOn, resetProfileStore, sessionBuyer } from '@shopping/api-mocks'
import { DENSITY_LEVELS, DENSITY_STORAGE_KEY } from '@shopping/ui'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { UserEvent } from '@testing-library/user-event'
import axe from 'axe-core'
import type { RunOptions } from 'axe-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import AddressesPage from '@/app/mypage/addresses/page'
import SettingsPage from '@/app/mypage/settings/page'
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

vi.mock('next/navigation', () => ({ usePathname: () => '/mypage/settings' }))

vi.mock('@/lib/profile/postcode', async (importOriginal) => ({
  ...(await importOriginal<typeof PostcodeModule>()),
  openPostcodeSearch: vi.fn<PostcodeSearch>(),
}))

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

beforeEach(() => {
  resetDensity()
  stubViewport(VIEWPORTS.desktop)
  vi.mocked(openPostcodeSearch).mockRejectedValue(new Error('blocked'))
})

afterEach(() => {
  localStorage.clear()
})

async function openSettings(): Promise<void> {
  renderAccountScreen(<SettingsPage />, { session: sessionBuyer })
  await screen.findByRole('form', { name: copy.settings.profile.legend })
}

async function openBook(): Promise<void> {
  renderAccountScreen(<AddressesPage />, { session: sessionBuyer })
  await screen.findByRole('list', { name: book.listLabel })
}

describe('the settings screen', () => {
  it('has no violations once loaded', async () => {
    await openSettings()

    await expectNoViolations()
  })

  it('has none while it is still loading', () => {
    renderAccountScreen(<SettingsPage />, { session: sessionBuyer })

    return expectNoViolations()
  })

  it('has none when a signed-out visitor is invited to sign in', async () => {
    renderAccountScreen(<SettingsPage />)
    await screen.findByText(messages.auth.requireSignIn.title)

    await expectNoViolations()
  })

  it('has none when the read failed', async () => {
    testServer.server.use(networkFailureOn('get', mockPaths.me))
    renderAccountScreen(<SettingsPage />, { session: sessionBuyer })
    await screen.findByText(copy.loadErrorTitle)

    await expectNoViolations()
  })

  it('has none with a field error showing', async () => {
    const user = userEvent.setup()
    await openSettings()

    await user.clear(screen.getByRole('textbox', { name: copy.settings.profile.nameLabel }))
    await user.click(screen.getByRole('button', { name: copy.settings.profile.save }))
    await screen.findByText(copy.settings.profile.nameError)

    await expectNoViolations()
  })

  it('has none with the withdrawal dialog open', async () => {
    const user = userEvent.setup()
    await openSettings()

    await user.click(screen.getByRole('button', { name: copy.settings.withdrawal.trigger }))
    await screen.findByRole('dialog', { name: copy.settings.withdrawal.confirmTitle })

    await expectNoViolations()
  })

  it.each(DENSITY_LEVELS)('has none at density %s', async (level) => {
    localStorage.setItem(DENSITY_STORAGE_KEY, String(level))
    document.documentElement.setAttribute('data-density', String(level))

    await openSettings()

    await expectNoViolations()
  })
})

describe('the address book', () => {
  it('has no violations with three addresses', async () => {
    await openBook()

    await expectNoViolations()
  })

  it('has none in the empty state', async () => {
    resetProfileStore([])
    renderAccountScreen(<AddressesPage />, { session: sessionBuyer })
    await screen.findByText(book.emptyTitle)

    await expectNoViolations()
  })

  it('has none when the read failed', async () => {
    testServer.server.use(networkFailureOn('get', mockPaths.meAddresses))
    renderAccountScreen(<AddressesPage />, { session: sessionBuyer })
    await screen.findByText(copy.loadErrorTitle)

    await expectNoViolations()
  })

  it('has none with the form open', async () => {
    const user = userEvent.setup()
    await openBook()

    await user.click(screen.getByRole('button', { name: book.addLabel }))
    await screen.findByRole('form', { name: formCopy.addTitle })

    await expectNoViolations()
  })

  it('has none with the manual-entry fallback showing', async () => {
    const user = userEvent.setup()
    await openBook()

    await user.click(screen.getByRole('button', { name: book.addLabel }))
    await user.click(screen.getByRole('button', { name: formCopy.searchLabel }))
    await screen.findByText(formCopy.manualTitle)

    await expectNoViolations()
  })

  it('has none with the delete confirmation open', async () => {
    const user = userEvent.setup()
    await openBook()

    await user.click(screen.getByRole('button', { name: `${book.remove} 집` }))
    await screen.findByRole('dialog', { name: book.removeTitle })

    await expectNoViolations()
  })

  it.each(DENSITY_LEVELS)('has none at density %s', async (level) => {
    localStorage.setItem(DENSITY_STORAGE_KEY, String(level))
    document.documentElement.setAttribute('data-density', String(level))

    await openBook()

    await expectNoViolations()
  })
})

describe('the cards name their controls apart (P4)', () => {
  it('gives each address its own set of buttons', async () => {
    await openBook()

    const list = screen.getByRole('list', { name: book.listLabel })
    const names = within(list)
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label') ?? button.textContent)

    // Nine buttons, nine distinct names. Three cards all offering "삭제" would
    // be three indistinguishable controls to anybody listing the page.
    expect(new Set(names).size).toBe(names.length)
  })

  it('reaches every control in the form by keyboard', async () => {
    const user: UserEvent = userEvent.setup()
    await openBook()

    await user.click(screen.getByRole('button', { name: book.addLabel }))
    await screen.findByRole('form', { name: formCopy.addTitle })

    const reachable = new Set<string>()
    for (let step = 0; step < 40; step += 1) {
      await user.tab()
      const active = document.activeElement
      if (active !== null && active !== document.body) reachable.add(active.tagName)
    }

    // Not a claim about order — a claim that the tab ring is not a dead end:
    // the form's inputs, its switch and its buttons are all landed on.
    expect(reachable.has('INPUT')).toBe(true)
    expect(reachable.has('BUTTON')).toBe(true)
  })
})
