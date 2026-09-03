/**
 * F4 · F5 — the home page is an async Server Component, and the fetch it makes
 * before returning any markup is answered by the mock API.
 *
 * There is no Next runtime here. `HomePage` is an async function; awaiting it
 * runs `loadHealth()` → `getApiClient()` → `globalThis.fetch`, which is exactly
 * where msw's interceptor sits (TASK-0107 4.1). Rendering what it returns then
 * happens in jsdom, so one process holds both the server fetch and the DOM.
 */

import {
  driftedHealthPayload,
  httpFailure,
  malformedResponse,
  mockPaths,
  networkFailure,
} from '@shopping/api-mocks'
import { healthDegraded, healthOk } from '@shopping/api-mocks'
import { APP_ID_HEADER, healthEntries } from '@shopping/shared'
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import HomePage from '@/app/page'
import { messagesFor } from '@/messages'

import { testServer } from './setup'

const { health } = messagesFor()

async function renderHome(): Promise<void> {
  render(await HomePage())
}

describe('the mocked payload reaches the screen', () => {
  it('shows the version and uptime the mock API answered', async () => {
    await renderHome()

    expect(screen.getByText(healthOk.version)).toBeVisible()
    expect(screen.getByText(`${healthOk.uptime}${health.uptimeUnit}`)).toBeVisible()
  })

  it('shows one labelled row per liveness field', async () => {
    await renderHome()

    const rows = screen.getAllByRole('listitem')

    expect(rows).toHaveLength(healthEntries(healthOk).length)
    expect(within(rows[0]!).getByText(health.itemLabels.status!)).toBeVisible()
    expect(within(rows[0]!).getByText(health.statusLabels.ok)).toBeVisible()
  })

  it('follows the mock API into a degraded state', async () => {
    testServer.server.use(malformedResponse(mockPaths.health, healthDegraded))
    await renderHome()

    expect(screen.getByText(health.statusLabels.degraded)).toBeVisible()
    expect(screen.getByText(health.statusLabels.down)).toBeVisible()
  })

  it('does not render the failure panel while the API answers', async () => {
    await renderHome()

    expect(screen.queryByRole('alert')).toBeNull()
  })
})

/** U6 — every way the API can fail is shown, not swallowed (4.7). */
describe('a failing API', () => {
  it('says so on a 404', async () => {
    testServer.server.use(httpFailure(mockPaths.health, 404, 'NOT_FOUND', 'No such endpoint'))
    await renderHome()

    expect(within(screen.getByRole('alert')).getByText(health.failures.http)).toBeVisible()
  })

  it('says so on a 500', async () => {
    testServer.server.use(httpFailure(mockPaths.health, 500, 'INTERNAL_ERROR', 'Boom'))
    await renderHome()

    expect(within(screen.getByRole('alert')).getByText(health.failures.http)).toBeVisible()
  })

  it('says so when the API is unreachable', async () => {
    testServer.server.use(networkFailure(mockPaths.health))
    await renderHome()

    expect(within(screen.getByRole('alert')).getByText(health.failures.network)).toBeVisible()
  })

  it('says so when the payload no longer matches the schema', async () => {
    testServer.server.use(malformedResponse(mockPaths.health, driftedHealthPayload))
    await renderHome()

    expect(
      within(screen.getByRole('alert')).getByText(health.failures.malformed_response),
    ).toBeVisible()
  })

  it('keeps the rest of the page up', async () => {
    testServer.server.use(networkFailure(mockPaths.health))
    await renderHome()

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

    await renderHome()

    expect(appIdsSeen).toEqual(['shop'])
    testServer.server.events.removeAllListeners('request:start')
  })
})
