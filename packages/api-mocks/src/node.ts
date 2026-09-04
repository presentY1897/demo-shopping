import net from 'node:net'

import type { RequestHandler } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll } from 'vitest'

import {
  defaultHandlers,
  resetAttributeStore,
  resetCategoryStore,
  resetSessionStore,
  resetUploadStore,
} from './handlers'

/**
 * How the mock server is started, kept as a value so a spec can assert on it.
 *
 * `error` rather than the default `warn`: a warning scrolls past and the request
 * still goes out. This is the first of the three layers that keep a front-end
 * spec off the network (TASK-0107 4.8) — the second is the `.invalid` base URL
 * the vitest preset sets, the third is the counters below.
 */
export const TEST_SERVER_LISTEN_OPTIONS = { onUnhandledRequest: 'error' } as const

export interface TestServer {
  readonly server: ReturnType<typeof setupServer>
  /** Requests msw had no handler for. Non-zero fails the spec file. */
  unhandledRequests: () => readonly string[]
  /** TCP connections the process actually opened. Non-zero fails the spec file. */
  outboundConnections: () => readonly string[]
}

/**
 * `net.Socket.prototype` with `connect` seen as a plain property.
 *
 * Node declares four overloads and normalises them internally, so the real
 * argument list is not any one of them — `connect` arrives as a single
 * `[options, callback]` array from `net.connect`. Typing it as an opaque
 * variadic keeps the wrapper honest instead of asserting a shape that is wrong.
 */
const socketPrototype = net.Socket.prototype as unknown as {
  connect: (...args: unknown[]) => net.Socket
}

/** The `host:port` a connect call is aimed at, or `null` for an IPC socket. */
export function outboundTarget(args: readonly unknown[]): string | null {
  const [first, second] = args

  // `net.connect(port, host)` reaches the prototype as `[[options, callback]]`.
  if (Array.isArray(first)) return outboundTarget(first as readonly unknown[])

  if (typeof first === 'number' || (typeof first === 'string' && /^\d+$/.test(first))) {
    return `${typeof second === 'string' ? second : 'localhost'}:${first}`
  }
  if (typeof first === 'object' && first !== null && 'port' in first) {
    const { host, port } = first as { host?: string; port?: unknown }
    return `${host ?? 'localhost'}:${String(port)}`
  }
  // A unix socket or a named pipe — vitest's own plumbing, not the network.
  return null
}

/**
 * Starts the mock API for one spec file and proves it stayed the only API.
 *
 * Called from each app's `test/setup.ts`, which vitest evaluates once per spec
 * file, so the hooks below are that file's own.
 *
 * The socket counter is the measurement behind F2. The msw counter alone would
 * miss a request made through a transport msw does not patch, and a spec that
 * swallowed the `onUnhandledRequest` error in a `try/catch` would hide it from
 * the counter too. `net.Socket.prototype.connect` is where every one of them
 * ends up — undici routes an IP literal and a hostname through it alike — so
 * counting there is a claim about the process rather than about msw.
 */
export function setupTestServer(...extraHandlers: readonly RequestHandler[]): TestServer {
  const server = setupServer(...defaultHandlers, ...extraHandlers)

  const unhandled: string[] = []
  server.events.on('request:unhandled', ({ request }) => {
    unhandled.push(`${request.method} ${request.url}`)
  })

  const outbound: string[] = []
  const originalConnect = socketPrototype.connect

  beforeAll(() => {
    server.listen(TEST_SERVER_LISTEN_OPTIONS)

    socketPrototype.connect = function patchedConnect(
      this: net.Socket,
      ...args: unknown[]
    ): net.Socket {
      const target = outboundTarget(args)
      if (target !== null) outbound.push(target)

      return originalConnect.apply(this, args)
    }
  })

  // Per-test overrides (`server.use(...)`) end with the test that declared them,
  // and so does anything a test wrote into a stateful handler: the category and
  // attribute endpoints keep rows a test can create, move and delete, and rows
  // that survived into the next test would make specs pass or fail by their
  // order in the file. Attributes are reset after categories because a
  // definition only means anything relative to a category that still exists.
  afterEach(() => {
    server.resetHandlers()
    resetCategoryStore()
    resetAttributeStore()
    resetUploadStore()
    // Back to signed out: a spec that signed in, or borrowed another role, must
    // not decide who the next one is.
    resetSessionStore()
  })

  afterAll(() => {
    socketPrototype.connect = originalConnect
    server.close()

    if (unhandled.length > 0) {
      throw new Error(`Requests reached no mock handler: ${unhandled.join(', ')}`)
    }
    if (outbound.length > 0) {
      throw new Error(`Test opened real network connections: ${outbound.join(', ')}`)
    }
  })

  return {
    outboundConnections: () => outbound,
    server,
    unhandledRequests: () => unhandled,
  }
}
