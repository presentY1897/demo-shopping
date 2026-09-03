import type { IncomingMessage, ServerResponse } from 'node:http'

import type { ArgumentsHost } from '@nestjs/common'
import { BadRequestException, NotFoundException } from '@nestjs/common'
import type { ApiErrorBody } from '@shopping/shared'
import { apiErrorSchema } from '@shopping/shared'
import { describe, expect, it, vi } from 'vitest'

import type { AppConfig } from '../config/app-config.js'
import { AllExceptionsFilter } from './all-exceptions.filter.js'
import { mappingForStatus } from './http-error-code.js'

interface Captured {
  status: number
  body: ApiErrorBody
}

function configFor(nodeEnv: AppConfig['nodeEnv']): AppConfig {
  return { nodeEnv } as AppConfig
}

/** Minimal `ArgumentsHost` plus a place to read what the filter wrote. */
function hostFor(): { host: ArgumentsHost; captured: Captured } {
  const captured = { status: 0, body: {} as ApiErrorBody }

  const response = {
    headersSent: false,
    writeHead: vi.fn((status: number) => {
      captured.status = status
      return response
    }),
    end: vi.fn((payload?: string) => {
      if (payload !== undefined) captured.body = JSON.parse(payload) as ApiErrorBody
    }),
  } as unknown as ServerResponse

  const request = { method: 'GET', url: '/api/v1/nope', headers: {} } as IncomingMessage

  const host = {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
  } as unknown as ArgumentsHost

  return { host, captured }
}

function runFilter(exception: unknown, nodeEnv: AppConfig['nodeEnv'] = 'production'): Captured {
  const { host, captured } = hostFor()
  new AllExceptionsFilter(configFor(nodeEnv)).catch(exception, host)
  return captured
}

describe('AllExceptionsFilter', () => {
  it('renders a 404 in the shared envelope with a Korean message', () => {
    const captured = runFilter(new NotFoundException('Cannot GET /api/v1/nope'))

    expect(captured.status).toBe(404)
    expect(apiErrorSchema.safeParse(captured.body).success).toBe(true)
    expect(captured.body.error.code).toBe('NOT_FOUND')
    // Through the mapping rather than as a literal: `http-error-code.spec.ts`
    // is where the sentences themselves are checked, and quoting one here would
    // make a copy edit look like a regression in the filter (TASK-0117 R1).
    expect(captured.body.error.message).toBe(mappingForStatus(404).message)
    expect(captured.body.error.details).toEqual(['Cannot GET /api/v1/nope'])
  })

  it('turns an unknown throw into a 500 without leaking the internal message', () => {
    const captured = runFilter(new Error('connection string postgres://user:pw@host/db'))

    expect(captured.status).toBe(500)
    expect(captured.body.error.code).toBe('INTERNAL_ERROR')
    expect(captured.body.error.message).toBe(mappingForStatus(500).message)
    expect(JSON.stringify(captured.body)).not.toContain('postgres://')
  })

  it('never includes a stack trace outside local development', () => {
    for (const nodeEnv of ['production', 'test'] as const) {
      const captured = runFilter(new Error('boom'), nodeEnv)

      expect(captured.body.error.details).toEqual([])
      expect(JSON.stringify(captured.body)).not.toContain('stack')
    }
  })

  it('includes the stack in development, where it is the point', () => {
    const captured = runFilter(new Error('boom'), 'development')

    expect(captured.body.error.details).toHaveLength(1)
    expect(JSON.stringify(captured.body)).toContain('stack')
  })

  it('does not attach a stack to a client error, even in development', () => {
    const captured = runFilter(new BadRequestException(), 'development')

    expect(captured.status).toBe(400)
    expect(JSON.stringify(captured.body)).not.toContain('stack')
  })

  it('forwards field messages as details but drops non-string payloads', () => {
    const captured = runFilter(
      new BadRequestException({
        statusCode: 400,
        message: ['이름을 입력해주세요', { internal: 'secret' }],
      }),
    )

    expect(captured.body.error.code).toBe('BAD_REQUEST')
    expect(captured.body.error.details).toEqual(['이름을 입력해주세요'])
  })
})
