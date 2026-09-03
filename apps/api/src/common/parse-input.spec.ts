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

  it('names the offending field, one entry per issue', () => {
    const schema = z.object({ role: roleSchema, note: z.string() })

    try {
      parseInput(schema, { role: 'ROOT', note: 3 })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(detailsOf(error)).toMatchObject([
        { field: 'role', code: 'INVALID' },
        { field: 'note', code: 'INVALID' },
      ])
    }
  })

  it('joins a nested path with dots, the way a form names its fields', () => {
    const schema = z.object({ attributes: z.array(z.object({ options: z.string() })) })

    try {
      parseInput(schema, { attributes: [{ options: 3 }] })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(detailsOf(error)).toMatchObject([{ field: 'attributes.0.options' }])
    }
  })

  it('uses the label for a value that has no path of its own', () => {
    try {
      parseInput(z.uuid(), 'not-a-uuid', 'userId')
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(detailsOf(error)).toMatchObject([{ field: 'userId', code: 'INVALID' }])
    }
  })

  // A refinement over the whole body names no input, so there is no field to
  // report and the entry stays the plain string `details` has always allowed.
  it('falls back to a plain sentence when there is neither', () => {
    try {
      parseInput(z.uuid(), 'not-a-uuid')
      expect.unreachable('should have thrown')
    } catch (error) {
      const details = detailsOf(error) as unknown[]

      expect(details).toHaveLength(1)
      expect(typeof details[0]).toBe('string')
      expect(details[0]).toMatch(/[가-힣]/)
    }
  })

  /**
   * Every structured entry still carries copy, whatever the copy is.
   *
   * The sentence is a fallback for a catalog that has no line for `INVALID`
   * (TASK-0117 4.1), so what matters is that it exists and is in Korean — not
   * what it says. Asserting the words would pin this spec to prose, which is
   * the thing the task removed from the front-end.
   */
  it('always carries a fallback sentence beside the field', () => {
    try {
      parseInput(z.object({ role: roleSchema }), { role: 'ROOT' })
      expect.unreachable('should have thrown')
    } catch (error) {
      const [entry] = detailsOf(error) as { message: string }[]

      expect(entry?.message).toMatch(/[가-힣]/)
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
