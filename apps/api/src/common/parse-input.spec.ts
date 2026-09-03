import { BadRequestException } from '@nestjs/common'
import { roleSchema } from '@shopping/shared'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { parseInput } from './parse-input.js'

function detailsOf(error: unknown): unknown {
  if (!(error instanceof BadRequestException)) throw error

  const payload: unknown = error.getResponse()

  return typeof payload === 'object' && payload !== null && 'message' in payload
    ? payload.message
    : payload
}

describe('parseInput', () => {
  it('returns the parsed value', () => {
    expect(parseInput(roleSchema, 'ADMIN_SUPER')).toBe('ADMIN_SUPER')
  })

  it('reports the offending field in Korean, one entry per issue', () => {
    const schema = z.object({ role: roleSchema, note: z.string() })

    try {
      parseInput(schema, { role: 'ROOT', note: 3 })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(detailsOf(error)).toEqual([
        'role 값이 올바르지 않습니다.',
        'note 값이 올바르지 않습니다.',
      ])
    }
  })

  it('uses the label for a value that has no path of its own', () => {
    try {
      parseInput(z.uuid(), 'not-a-uuid', 'userId')
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(detailsOf(error)).toEqual(['userId 값이 올바르지 않습니다.'])
    }
  })

  it('falls back to a generic message when there is neither', () => {
    try {
      parseInput(z.uuid(), 'not-a-uuid')
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(detailsOf(error)).toEqual(['요청 값이 올바르지 않습니다.'])
    }
  })

  it('answers 400', () => {
    try {
      parseInput(roleSchema, 'ROOT')
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException)
      expect((error as BadRequestException).getStatus()).toBe(400)
    }
  })
})
