/**
 * F2 — the three layers that keep a front-end spec off the network (4.8).
 *
 * The counters in `setupTestServer` are the third layer and assert themselves
 * at the end of every spec file. What is left to pin down is that the other two
 * are actually in force.
 */

import { lookup } from 'node:dns/promises'

import { describe, expect, it } from 'vitest'

import { outboundTarget, setupTestServer, TEST_SERVER_LISTEN_OPTIONS } from './node'

const testServer = setupTestServer()

describe('the mock server', () => {
  it('refuses to let an unhandled request through', () => {
    expect(TEST_SERVER_LISTEN_OPTIONS.onUnhandledRequest).toBe('error')
  })

  it('has opened no real connection and seen no unhandled request', () => {
    expect(testServer.outboundConnections()).toEqual([])
    expect(testServer.unhandledRequests()).toEqual([])
  })
})

describe('the test base URL', () => {
  it('is unroutable, so a request that escapes msw cannot reach a developer API', async () => {
    // RFC 6761 reserves `.invalid`; a resolver must answer NXDOMAIN without
    // asking anyone. `localhost:4020` would have hit this worktree's own API.
    const failure = await lookup('api.test.invalid').then(
      () => null,
      (error: NodeJS.ErrnoException) => error,
    )

    expect(failure?.code).toMatch(/ENOTFOUND|EAI_AGAIN/)
  })
})

/**
 * The guard is only as good as its ability to tell a socket aimed at the
 * network from vitest's own plumbing. The shapes below are the ones Node
 * actually hands `Socket.prototype.connect`: `net.connect(port, host)` arrives
 * pre-normalised as a single `[options, callback]` array.
 */
describe('the outbound socket guard', () => {
  it('recognises the normalised form undici uses', () => {
    expect(outboundTarget([[{ host: 'localhost', port: '4020' }, null]])).toBe('localhost:4020')
  })

  it('recognises a plain options object', () => {
    expect(outboundTarget([{ host: '127.0.0.1', port: 4020 }])).toBe('127.0.0.1:4020')
  })

  it('recognises port and host as positional arguments', () => {
    expect(outboundTarget([4020, 'api.example.com'])).toBe('api.example.com:4020')
  })

  it('ignores a unix socket, which is how a worker talks to its runner', () => {
    expect(outboundTarget(['/tmp/vitest.sock'])).toBeNull()
    expect(outboundTarget([{ path: '/tmp/vitest.sock' }])).toBeNull()
  })
})
