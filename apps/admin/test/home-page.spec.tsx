/**
 * The same checks as `apps/shop`, against this app's own page.
 *
 * The three apps share the preset, the setup file, the handlers and — since
 * TASK-0101 — the wake-up gate. What they do not share is their
 * {@link APP_ID_HEADER} value, which is how the API tells the three sessions
 * apart (DECISIONS 2장). So that is what this spec pins down beyond the render,
 * along with the two things a cold start makes visible here: the page paints
 * while the API is still asleep, and a failure is shown rather than swallowed.
 *
 * The wake-up sequence itself — thresholds, backoff, automatic recovery — is
 * covered once, in `apps/shop/test/api-wake-gate.spec.tsx`, against the same
 * component.
 */

import {
  driftedHealthPayload,
  healthOk,
  malformedResponse,
  mockPaths,
  neverAnswers,
} from '@shopping/api-mocks'
import { APP_ID_HEADER, healthEntries } from '@shopping/shared'
import { screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import HomePage from '@/app/page'
import { messagesFor, screenTitle } from '@/messages'

import { renderWithAuth } from './support/auth'
import { testServer } from './setup'

const { health, wake } = messagesFor()

const appIdsSeen: string[] = []
testServer.server.events.on('request:start', ({ request }) => {
  appIdsSeen.push(request.headers.get(APP_ID_HEADER) ?? '(none)')
})

beforeEach(() => {
  appIdsSeen.length = 0
})

describe('the admin home page', () => {
  it('renders the mocked health payload', async () => {
    renderWithAuth(<HomePage />)

    expect(await screen.findByText(healthOk.version)).toBeVisible()
    expect(screen.getAllByText(health.statusLabels.ok)).toHaveLength(healthEntries(healthOk).length)
  })

  it('identifies itself as admin on every call', async () => {
    renderWithAuth(<HomePage />)
    await screen.findByText(healthOk.version)

    // Asserted as a set: how many calls a screen makes is its own business and
    // changes with it — the session renewal joined this one on boot in
    // TASK-0023. What must never change is that every one of them carries the
    // id, because that is what selects this app's refresh cookie on an API all
    // three share (D-218).
    expect(appIdsSeen.length).toBeGreaterThan(0)
    expect([...new Set(appIdsSeen)]).toEqual(['admin'])
  })

  it('paints while the API is still asleep', () => {
    // F4 — the server render awaits nothing, so the shell is there before the
    // API has answered anything at all (TASK-0101 4.3).
    testServer.server.use(neverAnswers(mockPaths.health))
    renderWithAuth(<HomePage />)

    // The heading is the dashboard's, not the console's: `PageHeader` owns
    // the `<h1>` on every console screen and the console's name is in the
    // sidebar (TASK-0019 4.5).
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(screenTitle('/'))
    expect(screen.getByRole('region', { name: health.title })).toHaveAttribute('aria-busy', 'true')
  })

  it('shows the failure panel and a retry when the contract is broken', async () => {
    testServer.server.use(malformedResponse(mockPaths.health, driftedHealthPayload))
    renderWithAuth(<HomePage />)

    const alert = await screen.findByRole('alert')

    expect(within(alert).getByText(health.failures.malformed_response)).toBeVisible()
    expect(screen.getByRole('button', { name: wake.retryLabel })).toBeVisible()
  })

  it('says search is usable when the API reports it ready', async () => {
    renderWithAuth(<HomePage />)

    expect(await screen.findByText(wake.search.ready)).toBeVisible()
  })
})
