/**
 * The page, end to end against the mock API.
 *
 * `HomePage` is no longer an async Server Component. It awaits nothing: the
 * liveness read moved into `ApiWakeGate`'s effect so the markup — heading, copy,
 * skeleton — is produced and sent while the API is still booting (TASK-0101 4.3).
 * The request then goes out from the client, where msw's interceptor sits, so a
 * single process still holds both the fetch and the DOM.
 *
 * The wake-up states themselves are covered in `api-wake-gate.spec.tsx`, with a
 * policy turned down to milliseconds. What is left here is the page: what it
 * renders before anything has answered, and that the call carries this app's id.
 */

import {
  driftedHealthPayload,
  healthOk,
  malformedResponse,
  mockPaths,
  neverAnswers,
} from '@shopping/api-mocks'
import { APP_ID_HEADER, healthEntries } from '@shopping/shared'
import { render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import HomePage from '@/app/page'
import { messagesFor } from '@/messages'

import { testServer } from './setup'

const { health, home, wake } = messagesFor()

/**
 * The liveness rows, and only those.
 *
 * The home screen grew a second list in TASK-0018 — the density preview grid,
 * which is a `<ul>` of placeholder cards — so a bare `getAllByRole('listitem')`
 * now counts nine things. Scoping to the panel is what keeps this assertion
 * about the payload rather than about whatever else the page happens to render.
 */
function healthRows(): readonly HTMLElement[] {
  const panel = screen.getByRole('heading', { name: health.title }).closest('section')

  if (panel === null) throw new Error('the health panel has no section around its heading')

  return within(panel).getAllByRole('listitem')
}

const requests: string[] = []

beforeEach(() => {
  requests.length = 0
  testServer.server.events.on('request:start', ({ request }) => {
    requests.push(request.url)
  })
})

afterEach(() => {
  testServer.server.events.removeAllListeners('request:start')
})

/**
 * F4 — the prewarm does not hold the render up.
 *
 * Measured rather than argued: the server render is checked for an await and for
 * a request, and neither is there. That is a stronger claim than "we timed it
 * and it was quick", because there is nothing left to be slow.
 */
describe('the server render', () => {
  it('returns markup rather than a promise', () => {
    expect(HomePage()).not.toBeInstanceOf(Promise)
  })

  it('makes no API call of its own', () => {
    HomePage()

    expect(requests).toEqual([])
  })

  it('paints the page while the API is still asleep', () => {
    testServer.server.use(neverAnswers(mockPaths.health))
    render(<HomePage />)

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(home.title)
    expect(screen.getByText(home.description)).toBeVisible()
    expect(screen.getByText(health.notice)).toBeVisible()
    expect(screen.getByRole('region', { name: health.title })).toHaveAttribute('aria-busy', 'true')
  })
})

describe('the mocked payload reaches the screen', () => {
  it('shows the version and uptime the mock API answered', async () => {
    render(<HomePage />)

    expect(await screen.findByText(healthOk.version)).toBeVisible()
    expect(screen.getByText(`${healthOk.uptime}${health.uptimeUnit}`)).toBeVisible()
  })

  it('shows one labelled row per liveness field', async () => {
    render(<HomePage />)
    await screen.findByText(healthOk.version)

    const rows = healthRows()

    expect(rows).toHaveLength(healthEntries(healthOk).length)
    expect(within(rows[0]!).getByText(health.itemLabels.status!)).toBeVisible()
    expect(within(rows[0]!).getByText(health.statusLabels.ok)).toBeVisible()
  })

  it('does not render the failure panel while the API answers', async () => {
    render(<HomePage />)
    await screen.findByText(healthOk.version)

    expect(screen.queryByRole('alert')).toBeNull()
  })
})

/**
 * U6, at the page level — a broken contract is shown, not swallowed.
 *
 * This is also the one failure the page reaches without waiting out a backoff: a
 * body that does not match the schema is not retried, because the same request
 * would produce the same wrong body (see `isWorthRetrying`).
 */
describe('a payload that no longer matches the schema', () => {
  it('is reported instead of rendered', async () => {
    testServer.server.use(malformedResponse(mockPaths.health, driftedHealthPayload))
    render(<HomePage />)

    const alert = await screen.findByRole('alert')

    expect(within(alert).getByText(health.failures.malformed_response)).toBeVisible()
  })

  it('keeps the rest of the page up', async () => {
    testServer.server.use(malformedResponse(mockPaths.health, driftedHealthPayload))
    render(<HomePage />)

    expect(await screen.findByText(wake.failureTitle)).toBeVisible()
    expect(screen.getByRole('heading', { level: 1 })).toBeVisible()
    expect(screen.queryByText(health.uptimeLabel)).toBeNull()
  })
})

describe('the call itself', () => {
  it('carries this app id, which is how the API tells the three sessions apart', async () => {
    const appIdsSeen: string[] = []
    testServer.server.events.on('request:start', ({ request }) => {
      appIdsSeen.push(request.headers.get(APP_ID_HEADER) ?? '(none)')
    })

    render(<HomePage />)
    await screen.findByText(healthOk.version)

    // Asserted as a set: how many calls a screen makes is its own business and
    // changes with it — the session renewal joined this one on boot in
    // TASK-0023. What must never change is that every one of them carries the
    // id, because that is what selects this app's refresh cookie on an API all
    // three share (D-218).
    expect(appIdsSeen.length).toBeGreaterThan(0)
    expect([...new Set(appIdsSeen)]).toEqual(['shop'])
  })
})
