import type { IncomingMessage, ServerResponse } from 'node:http'

import type { ApiErrorBody } from '@shopping/shared'
import { apiErrorSchema } from '@shopping/shared'
import { describe, expect, it, vi } from 'vitest'

import { createNotFoundFallback } from './not-found.middleware.js'

function run(request: Partial<IncomingMessage>, headersSent = false) {
  const captured = { status: 0, body: {} as ApiErrorBody, ended: false }

  const response = {
    headersSent,
    writeHead: vi.fn((status: number) => {
      captured.status = status
      return response
    }),
    end: vi.fn((payload?: string) => {
      captured.ended = true
      if (payload !== undefined) captured.body = JSON.parse(payload) as ApiErrorBody
    }),
  } as unknown as ServerResponse

  createNotFoundFallback()(request as IncomingMessage, response)
  return captured
}

describe('notFoundFallback', () => {
  it('answers a path outside the API prefix with the shared envelope', () => {
    const captured = run({ method: 'GET', url: '/nope', headers: {} })

    expect(captured.status).toBe(404)
    expect(apiErrorSchema.safeParse(captured.body).success).toBe(true)
    expect(captured.body.error.code).toBe('NOT_FOUND')
    expect(captured.body.error.details).toEqual(['Cannot GET /nope'])
  })

  it('carries the request id it was given, so the log line and the body agree', () => {
    const captured = run({
      method: 'GET',
      url: '/nope',
      headers: { 'x-request-id': 'abc-123' },
    })

    expect(captured.body.error.requestId).toBe('abc-123')
  })

  it('makes an id up rather than answering without one', () => {
    const captured = run({ method: 'GET', url: '/nope', headers: {} })

    expect(captured.body.error.requestId).not.toBe('')
  })

  it('closes a response whose headers already went out instead of throwing', () => {
    const captured = run({ method: 'GET', url: '/nope', headers: {} }, true)

    expect(captured.ended).toBe(true)
    expect(captured.status).toBe(0)
  })
})
