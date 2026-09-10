import { shopperCheckout, shopperCheckoutCoupons, sessionBuyer } from '@shopping/api-mocks'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AuthProvider } from '@/lib/auth/auth-context'
import { createSessionClient } from '@/lib/auth/session-client'
import * as checkoutApi from '@/lib/checkout/checkout-api'
import { useCheckout } from '@/lib/checkout/use-checkout'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(new Date(shopperCheckout.checkout.expiresAt).getTime() - 600_000))
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function pendingBoot() {
  let resolve!: (value: Response) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<Response>((yes, no) => {
    resolve = yes
    reject = no
  })
  const gate = { promise, resolve, reject }
  const refresh = vi.fn<typeof fetch>().mockReturnValue(gate.promise)
  const client = createSessionClient({
    appId: 'shop',
    baseUrl: 'http://api.test.invalid',
    fetch: refresh,
  })
  const read = vi.spyOn(checkoutApi, 'readCheckout').mockResolvedValue(shopperCheckout)
  const coupons = vi
    .spyOn(checkoutApi, 'readCheckoutCoupons')
    .mockResolvedValue(shopperCheckoutCoupons)
  const rendered = renderHook(() => useCheckout(shopperCheckout.checkout.id), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <AuthProvider client={client}>{children}</AuthProvider>
    ),
  })
  return { gate, refresh, read, coupons, ...rendered }
}

it('waits for boot authentication before loading the checkout and coupons', async () => {
  const boot = pendingBoot()
  await waitFor(() => expect(boot.refresh).toHaveBeenCalledOnce())
  expect(boot.read).not.toHaveBeenCalled()
  expect(boot.coupons).not.toHaveBeenCalled()
  expect(boot.result.current.state.status).toBe('loading')
  await act(async () => {
    boot.gate.resolve(Response.json(sessionBuyer))
    await boot.gate.promise
  })
  await waitFor(() => expect(boot.result.current.state.status).toBe('ready'))
  expect(boot.read).toHaveBeenCalledOnce()
  expect(boot.coupons).toHaveBeenCalledOnce()
})

it('does not issue late checkout requests after leaving during boot', async () => {
  const boot = pendingBoot()
  await waitFor(() => expect(boot.refresh).toHaveBeenCalledOnce())
  boot.unmount()
  await act(async () => {
    boot.gate.resolve(Response.json(sessionBuyer))
    await boot.gate.promise
  })
  expect(boot.read).not.toHaveBeenCalled()
  expect(boot.coupons).not.toHaveBeenCalled()
})

it('settles to the existing error state when authentication fails', async () => {
  const boot = pendingBoot()
  boot.read.mockRejectedValue(new Error('Unauthorized'))
  boot.coupons.mockRejectedValue(new Error('Unauthorized'))
  await act(async () => {
    boot.gate.reject(new Error('Network unavailable'))
    await Promise.resolve()
  })
  await waitFor(() => expect(boot.result.current.state.status).toBe('failed'))
})
