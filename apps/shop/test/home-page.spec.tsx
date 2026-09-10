/** Home remains synchronous and renders navigation while the API wakes. */

import { mockPaths, neverAnswers } from '@shopping/api-mocks'
import { APP_ID_HEADER } from '@shopping/shared'
import { DensityProvider } from '@shopping/ui/density'
import { screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import HomePage from '@/app/page'
import { messagesFor } from '@/messages'

import { renderWithAuth } from './support/auth'
import { testServer } from './setup'

vi.mock('next/navigation', async () => {
  const { nextNavigationMock } = await import('./support/navigation')

  return nextNavigationMock()
})

const { health, home } = messagesFor()

/**
 * The page inside the two providers the real layout gives it.
 *
 * TASK-0044 put a demo nudge and two product sections on this page: the first
 * asks who is signed in, the second two ask which density step is chosen. A bare
 * `render` would throw on either, which reads as a page bug and is a missing
 * provider.
 */
function renderHome() {
  return renderWithAuth(
    <DensityProvider>
      <HomePage />
    </DensityProvider>,
  )
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

    // Still true after TASK-0044 put product rows on this page. They read their
    // own data from the browser (`useSection`) precisely so that this stays
    // true — a server render that waited would meet a ninety second cold start
    // with a five second timeout.
    expect(requests).toEqual([])
  })

  it('paints the page while the API is still asleep', () => {
    testServer.server.use(neverAnswers(mockPaths.health))
    renderHome()

    // The hero, not a section: TASK-0044 gave the page product rows, and those
    // arrive after mount. What is in the markup is what a visitor can read while
    // the API is still waking.
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(home.heroTitle)
    expect(screen.queryByText(health.title)).toBeNull()
    expect(screen.getByRole('heading', { name: home.newTitle })).toBeVisible()
  })
})

describe('the call itself', () => {
  it('carries this app id, which is how the API tells the three sessions apart', async () => {
    const appIdsSeen: string[] = []
    testServer.server.events.on('request:start', ({ request }) => {
      appIdsSeen.push(request.headers.get(APP_ID_HEADER) ?? '(none)')
    })

    renderHome()
    await waitFor(() =>
      expect(screen.getAllByRole('link', { name: home.moreLabel })).toHaveLength(2),
    )

    // Asserted as a set: how many calls a screen makes is its own business and
    // changes with it — the session renewal joined this one on boot in
    // TASK-0023. What must never change is that every one of them carries the
    // id, because that is what selects this app's refresh cookie on an API all
    // three share (D-218).
    expect(appIdsSeen.length).toBeGreaterThan(0)
    expect([...new Set(appIdsSeen)]).toEqual(['shop'])
  })
})
