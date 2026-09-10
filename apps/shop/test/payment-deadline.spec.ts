import { createApiClient, type Payment } from '@shopping/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getApiClient } from '@/lib/api'
import {
  authorizePayment,
  capturePayment,
  confirmTossPayment,
  readPayment,
  startCardPayment,
  startTossPayment,
} from '@/lib/payment/payment-api'

vi.mock('@/lib/api', () => ({ getApiClient: vi.fn() }))

const id = '019596d0-1f1c-7c2e-9a0e-6a0000000001'
const payment: Payment = {
  id,
  orderId: id,
  provider: 'VIRTUAL_CARD',
  status: 'PAID',
  authorizedAmount: 1000,
  canceledAmount: 0,
  paymentKey: null,
  approvedAt: null,
  refunds: [],
}

function responseAfter(delay: number) {
  const fetch = vi.fn(
    (_input: string, init: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        const timer = setTimeout(() => {
          resolve(new Response(JSON.stringify({ payment }), { status: 200 }))
        }, delay)
        init.signal?.addEventListener(
          'abort',
          () => {
            clearTimeout(timer)
            reject(Object.assign(new Error('Deadline'), { name: 'TimeoutError' }))
          },
          { once: true },
        )
      }),
  )
  vi.mocked(getApiClient).mockReturnValue(
    createApiClient({
      appId: 'shop',
      baseUrl: 'https://api.test.invalid',
      fetch,
    }),
  )
  return fetch
}

beforeEach(() => {
  vi.useFakeTimers()
  // Native AbortSignal.timeout uses an internal clock. Keep its semantics while
  // sharing Vitest's clock with the delayed transport, without sleeping 15s.
  vi.spyOn(AbortSignal, 'timeout').mockImplementation((milliseconds) => {
    const controller = new AbortController()
    setTimeout(
      () => controller.abort(Object.assign(new Error('Deadline'), { name: 'TimeoutError' })),
      milliseconds,
    )
    return controller.signal
  })
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const writes = [
  ['card creation', () => startCardPayment(id, id)],
  ['Toss creation', () => startTossPayment(id)],
  ['Toss approval', () => confirmTossPayment(id, 'test-key', 1000)],
  ['approval', () => authorizePayment(id)],
  ['capture', () => capturePayment(id)],
] as const

describe('payment request deadline', () => {
  it.each(writes)('%s receives an 8s success without resubmitting', async (_name, call) => {
    const fetch = responseAfter(8000)
    const result = call().then(
      (value) => value,
      (error: unknown) => error,
    )
    await vi.advanceTimersByTimeAsync(8000)
    expect(await result).toEqual(payment)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it.each(writes)('%s still times out at 15s for result recovery', async (_name, call) => {
    const fetch = responseAfter(60000)
    let settled = false
    const result = call()
      .then(
        (value) => value,
        (error: unknown) => error,
      )
      .finally(() => {
        settled = true
      })
    await vi.advanceTimersByTimeAsync(14999)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await result).toMatchObject({ kind: 'timeout' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('keeps payment reads bounded to 5s', async () => {
    const fetch = responseAfter(8000)
    const result = readPayment(id).catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(5000)
    expect(await result).toMatchObject({ kind: 'timeout' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
