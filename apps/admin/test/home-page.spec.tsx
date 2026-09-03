/**
 * The same three checks as `apps/shop`, against this app's own page.
 *
 * The apps share the preset, the setup file and the handlers; what they do not
 * share is their {@link APP_ID_HEADER} value, which is how the API tells the
 * three sessions apart (DECISIONS 2장). So that is what this spec pins down
 * beyond the render.
 */

import { mockPaths, networkFailure } from '@shopping/api-mocks'
import { healthOk } from '@shopping/api-mocks'
import { APP_ID_HEADER, healthEntries } from '@shopping/shared'
import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import HomePage from '@/app/page'
import { messagesFor } from '@/messages'

import { testServer } from './setup'

const { health } = messagesFor()

const appIdsSeen: string[] = []
testServer.server.events.on('request:start', ({ request }) => {
  appIdsSeen.push(request.headers.get(APP_ID_HEADER) ?? '(none)')
})

beforeEach(() => {
  appIdsSeen.length = 0
})

describe('the admin home page', () => {
  it('renders the mocked health payload', async () => {
    render(await HomePage())

    expect(screen.getByText(healthOk.version)).toBeVisible()
    expect(screen.getAllByText(health.statusLabels.ok)).toHaveLength(healthEntries(healthOk).length)
  })

  it('identifies itself as admin on the call', async () => {
    render(await HomePage())

    expect(appIdsSeen).toEqual(['admin'])
  })

  it('shows the failure panel when the API is unreachable', async () => {
    testServer.server.use(networkFailure(mockPaths.health))
    render(await HomePage())

    expect(within(screen.getByRole('alert')).getByText(health.failures.network)).toBeVisible()
  })
})
