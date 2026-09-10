import {
  healthHandlers,
  healthOk,
  healthSearchIndexing,
  malformedResponse,
  mockPaths,
  networkFailure,
  neverAnswers,
  wakesAfter,
} from '@shopping/api-mocks'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useContext } from 'react'
import { describe, expect, it } from 'vitest'

import { ApiWakeGate } from '@/components/api-wake-gate'
import { SectionReadiness } from '@/lib/products/section-readiness'
import { WAKE_POLICY } from '@/lib/wake-policy'
import { messagesFor } from '@/messages'
import { testServer } from './setup'

const { health, wake } = messagesFor()
const FAST = {
  ...WAKE_POLICY,
  attemptTimeoutsMs: [300, 300, 300],
  backoffMs: [10, 20],
  noticeAfterMs: 40,
  tickMs: 10,
  searchRecheckDelaysMs: [30, 60, 120],
  searchRecheckTimeoutMs: 300,
}

function ReadinessProbe() {
  return <p>{useContext(SectionReadiness) ? 'products ready' : 'products pending'}</p>
}
function renderGate() {
  render(
    <ApiWakeGate policy={FAST} wake={wake}>
      <ReadinessProbe />
    </ApiWakeGate>,
  )
}
async function expectReady() {
  expect(await screen.findByText('products ready')).toBeVisible()
  expect(screen.queryByText(health.title)).toBeNull()
  expect(screen.queryByText(healthOk.version)).toBeNull()
  expect(screen.queryByRole('status')).toBeNull()
  expect(screen.queryByRole('alert')).toBeNull()
}

describe('storefront readiness', () => {
  it('renders the shell immediately and only explains a prolonged wait', async () => {
    testServer.server.use(neverAnswers(mockPaths.health))
    renderGate()
    expect(screen.getByText('products pending')).toBeVisible()
    expect(screen.queryByRole('status')).toBeNull()
    expect(await screen.findByText(wake.storefrontPreparing)).toBeVisible()
    expect(screen.queryByText(health.title)).toBeNull()
    expect(screen.queryByText(wake.coldStartNotice)).toBeNull()
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it('silently enables products when healthy', async () => {
    renderGate()
    await expectReady()
  })

  it('recovers automatically when the API wakes', async () => {
    testServer.server.use(wakesAfter(mockPaths.health, 2, healthOk))
    renderGate()
    await expectReady()
  })

  it('keeps a brief error and supports keyboard retry', async () => {
    testServer.server.use(networkFailure(mockPaths.health))
    renderGate()
    expect(await screen.findByRole('alert')).toHaveTextContent(wake.storefrontFailed)
    expect(screen.queryByText(health.failures.network)).toBeNull()
    const button = screen.getByRole('button', { name: wake.retryLabel })
    await userEvent.tab()
    expect(button).toHaveFocus()
    testServer.server.use(...healthHandlers)
    await userEvent.keyboard('{Enter}')
    await expectReady()
  })

  it('enables products after automatic search rechecking', async () => {
    testServer.server.use(malformedResponse(mockPaths.health, healthSearchIndexing))
    renderGate()
    expect(await screen.findByRole('status')).toHaveTextContent(wake.storefrontPreparing)
    expect(screen.getByText('products pending')).toBeVisible()
    expect(screen.queryByText(wake.search.indexing)).toBeNull()
    testServer.server.use(...healthHandlers)
    await expectReady()
  })

  it('bounds search rechecks and retains manual recovery', async () => {
    let requests = 0
    const handler = ({ request }: { request: Request }) => {
      if (new URL(request.url).pathname === mockPaths.health.slice(1)) requests += 1
    }
    testServer.server.events.on('request:start', handler)
    try {
      testServer.server.use(malformedResponse(mockPaths.health, healthSearchIndexing))
      renderGate()
      await waitFor(() => expect(requests).toBe(1 + FAST.searchRecheckDelaysMs.length))
      await new Promise((resolve) => setTimeout(resolve, 200))
      expect(requests).toBe(1 + FAST.searchRecheckDelaysMs.length)
      testServer.server.use(...healthHandlers)
      await userEvent.click(screen.getByRole('button', { name: wake.retryLabel }))
      await expectReady()
    } finally {
      testServer.server.events.removeListener('request:start', handler)
    }
  })
})
