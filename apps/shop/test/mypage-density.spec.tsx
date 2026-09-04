/**
 * The display density, where it is chosen and where it is promoted
 * (TASK-0112 F7 · F8, U4 · P6).
 *
 * `/mypage/settings` is the first screen in this storefront that lets somebody
 * change the step *and* watch what happens, so it is where the promotion
 * finally has consequences: until M04 the value lived only in localStorage and
 * signing in silently discarded it.
 *
 * The six-combination render check (U4) is not decoration. Every layout on
 * these two screens is written in density-scaled tokens — `gap-*`, `py-*`,
 * `text-*` all resolve through `--space-unit` and `--font-scale` — so "does it
 * still render" is a claim about the *component tree*, which is the half jsdom
 * can decide. The other half, whether it still looks right, is P3's and is
 * checked at three viewport widths in the same way.
 */

import { mockPaths, networkFailureOn, preferenceSnapshot, sessionBuyer } from '@shopping/api-mocks'
import { DENSITY_LEVELS, DENSITY_STORAGE_KEY } from '@shopping/ui'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import AddressesPage from '@/app/mypage/addresses/page'
import SettingsPage from '@/app/mypage/settings/page'
import { messagesFor } from '@/messages'

import { appliedDensity, renderAccountScreen, resetDensity } from './support/mypage'
import { stubViewport, VIEWPORTS } from './support/viewport'
import { testServer } from './setup'

const messages = messagesFor()
const copy = messages.mypage
const stepNames = messages.layout.density.names

vi.mock('next/navigation', () => ({ usePathname: () => '/mypage/settings' }))

beforeEach(() => {
  resetDensity()
  stubViewport(VIEWPORTS.desktop)
})

afterEach(() => {
  localStorage.clear()
})

/** The toggle on the settings screen, once the screen is up. */
async function openToggle(): Promise<HTMLElement> {
  renderAccountScreen(<SettingsPage />, { session: sessionBuyer })

  return screen.findByRole('radiogroup', { name: copy.settings.density.title })
}

describe('changing the step (F7)', () => {
  it('renders at the new step immediately and saves it', async () => {
    const user = userEvent.setup()
    const toggle = await openToggle()

    await user.click(within(toggle).getByRole('radio', { name: stepNames[3] }))

    // Immediately: the attribute is written synchronously, because this is the
    // one setting whose effect the person can see and a control that waits for
    // a round trip is dead for the length of a cold start.
    expect(appliedDensity()).toBe('3')
    await waitFor(() => {
      expect(preferenceSnapshot().density).toBe('MAXIMAL')
    })
    expect(await screen.findByText(copy.settings.density.savedNotice)).toBeVisible()
  })

  it('keeps the step applied when the save fails, and says where it is kept', async () => {
    const user = userEvent.setup()
    const toggle = await openToggle()

    testServer.server.use(networkFailureOn('patch', mockPaths.mePreferences))
    await user.click(within(toggle).getByRole('radio', { name: stepNames[1] }))

    expect(await screen.findByText(copy.failures.network)).toBeVisible()
    // Not rolled back. Telling somebody the step did not apply when it plainly
    // did would be the screen contradicting their own eyes.
    expect(appliedDensity()).toBe('1')
    expect(localStorage.getItem(DENSITY_STORAGE_KEY)).toBe('1')
  })
})

describe('promoting what this browser stored (F8)', () => {
  it('lifts a signed-out choice onto the account, once', async () => {
    // A visitor picked 맥시멀 while signed out; the account still holds the
    // untouched default.
    localStorage.setItem(DENSITY_STORAGE_KEY, '3')
    expect(preferenceSnapshot().density).toBe('STANDARD')

    renderAccountScreen(<SettingsPage />, { session: sessionBuyer })

    await waitFor(() => {
      expect(preferenceSnapshot().density).toBe('MAXIMAL')
    })
    // And from here the server value is the single source: the screen is
    // showing what the account now holds, not what localStorage happened to say.
    expect(appliedDensity()).toBe('3')
  })

  it('promotes nothing when this browser stored nothing', async () => {
    let writes = 0
    testServer.server.events.on('request:start', ({ request }) => {
      if (request.method === 'PATCH' && request.url.endsWith('/me/preferences')) writes += 1
    })

    await openToggle()
    await screen.findByRole('form', { name: copy.settings.profile.legend })

    // Without this branch every sign-in would overwrite the account with
    // whatever the default happens to be.
    expect(writes).toBe(0)
    testServer.server.events.removeAllListeners()
  })

  it('applies the account’s step to a browser that stored a different one', async () => {
    localStorage.setItem(DENSITY_STORAGE_KEY, '3')
    renderAccountScreen(<SettingsPage />, { session: sessionBuyer })

    await waitFor(() => {
      expect(preferenceSnapshot().density).toBe('MAXIMAL')
    })

    // localStorage is a cache from here on; the account is the source.
    expect(localStorage.getItem(DENSITY_STORAGE_KEY)).toBe('3')
  })
})

describe('every step renders both screens (U4 · P6)', () => {
  const screens = [
    [
      '설정',
      <SettingsPage key="settings" />,
      () => screen.findByRole('form', { name: copy.settings.profile.legend }),
    ],
    [
      '배송지',
      <AddressesPage key="addresses" />,
      () => screen.findByRole('list', { name: copy.addresses.listLabel }),
    ],
  ] as const

  it.each(
    screens.flatMap(([name, element, ready]) =>
      DENSITY_LEVELS.map(
        (level) => [`${name} · 밀도 ${String(level)}`, level, element, ready] as const,
      ),
    ),
  )('%s', async (_name, level, element, ready) => {
    localStorage.setItem(DENSITY_STORAGE_KEY, String(level))
    document.documentElement.setAttribute('data-density', String(level))

    renderAccountScreen(element, { session: sessionBuyer })

    expect(await ready()).toBeVisible()
    expect(appliedDensity()).toBe(String(level))
  })
})

describe('every verification viewport renders both screens (P3)', () => {
  it.each(Object.entries(VIEWPORTS))('%s', async (_name, width) => {
    stubViewport(width)
    renderAccountScreen(<AddressesPage />, { session: sessionBuyer })

    // jsdom has no layout, so this is the half of P3 it can decide: the tree is
    // the same at every width because the layout is written in wrapping flex
    // and a two-column grid that collapses, not in per-viewport branches. The
    // header is the app's only viewport-branching component (D-055).
    const list = await screen.findByRole('list', { name: copy.addresses.listLabel })

    expect(list).toBeVisible()
    // Scoped to the address list: the shell's own nav is a list too, and
    // counting every `listitem` on the page would be counting its two links.
    expect(within(list).getAllByRole('listitem')).toHaveLength(3)
  })
})
