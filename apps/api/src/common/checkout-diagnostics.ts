import { AsyncLocalStorage } from 'node:async_hooks'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Pool } from 'pg'

import { principalOf } from '../auth/request-principal.js'

export const CHECKOUT_DIAGNOSTICS_HEADER = 'X-Checkout-Diagnostics'
const ROUTE = /^\/api\/v1\/(?:cart|checkouts|orders|payments)(?:\/|$)/

interface Span {
  count: number
  ms: number
}
interface Trace {
  started: number
  spans: Map<string, Span>
}
const context = new AsyncLocalStorage<Trace>()

/** Numeric measurements only. Labels come from the fixed instrumentation below. */
export function observeMethod(target: object, key: string, label: string): void {
  const original: unknown = Reflect.get(target, key)
  if (typeof original !== 'function') throw new Error(`Missing diagnostic method: ${key}`)
  Reflect.set(target, key, function (this: unknown, ...args: unknown[]): unknown {
    const trace = context.getStore()
    if (trace === undefined) return Reflect.apply(original, this, args) as unknown
    const started = performance.now()
    let recorded = false
    const done = () => {
      if (recorded) return
      recorded = true
      const span = trace.spans.get(label) ?? { count: 0, ms: 0 }
      span.count += 1
      span.ms += performance.now() - started
      trace.spans.set(label, span)
    }
    const callback = args.at(-1)
    const callbackApi = label.startsWith('db_') && typeof callback === 'function'
    if (callbackApi) {
      args[args.length - 1] = function (this: unknown, ...values: unknown[]) {
        done()
        return Reflect.apply(callback, this, values) as unknown
      }
    }
    try {
      const result: unknown = Reflect.apply(original, this, args)
      if (result instanceof Promise) return result.finally(done)
      if (!callbackApi) done()
      return result
    } catch (error) {
      done()
      throw error
    }
  })
}

export function observePool(pool: Pool): void {
  observeMethod(pool, 'connect', 'db_acquire')
  const tracked = new WeakSet<object>()
  pool.on('connect', (client) => {
    if (tracked.has(client)) return
    tracked.add(client)
    observeMethod(client, 'query', 'db_query')
  })
}

/** Measures through serialization, immediately before Node writes response headers. */
export function checkoutDiagnostics(
  request: IncomingMessage,
  response: ServerResponse,
  next: () => void,
): void {
  if (
    request.headers[CHECKOUT_DIAGNOSTICS_HEADER.toLowerCase()] !== '1' ||
    !ROUTE.test((request.url ?? '').split('?')[0] ?? '')
  ) {
    next()
    return
  }
  const trace: Trace = { started: performance.now(), spans: new Map() }
  const writeHead: unknown = Reflect.get(response, 'writeHead')
  if (typeof writeHead !== 'function') throw new Error('Response headers unavailable')
  Reflect.set(response, 'writeHead', function (this: ServerResponse, ...args: unknown[]) {
    if (
      !response.headersSent &&
      response.statusCode < 400 &&
      principalOf(request)?.roles.includes('BUYER')
    ) {
      const total = `total;dur=${(performance.now() - trace.started).toFixed(2)}`
      const spans = [...trace.spans].map(
        ([name, span]) => `${name};dur=${span.ms.toFixed(2)};desc="${span.count}"`,
      )
      response.setHeader('Server-Timing', [total, ...spans].join(', '))
      response.setHeader('Cache-Control', 'private, no-store')
    }
    return Reflect.apply(writeHead, this, args) as ServerResponse
  })
  context.run(trace, next)
}
