import { healthResponseSchema } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import { defineFixture, fixtureSchemaOf, isFixture } from './define'
import { healthOk } from './fixtures/health'

describe('defineFixture', () => {
  it('parses at definition time', () => {
    expect(() =>
      defineFixture(healthResponseSchema, {
        status: 'ok',
        database: 'ok',
        search: 'ok',
        // Typechecks, and `nonnegative()` still rejects it — which is why the
        // contract is a schema and not an interface.
        uptime: -1,
        version: '0.0.0',
      }),
    ).toThrow(/uptime/)
  })

  it('rejects a value the type system cannot see through', () => {
    expect(() =>
      defineFixture(healthResponseSchema, {
        status: 'ok',
        database: 'ok',
        search: 'ok',
        uptime: 12,
        version: '',
      }),
    ).toThrow(/version/)
  })

  it('brands what it returns', () => {
    expect(isFixture(healthOk)).toBe(true)
    expect(fixtureSchemaOf(healthOk)).toBe(healthResponseSchema)
  })

  it('does not brand a plain object literal', () => {
    expect(isFixture({ status: 'ok' })).toBe(false)
    expect(fixtureSchemaOf({ status: 'ok' })).toBeNull()
  })

  it('freezes the fixture so no spec can hand an unparsed value to the next', () => {
    expect(Object.isFrozen(healthOk)).toBe(true)
  })

  it('keeps the brand out of the serialised body msw sends', () => {
    expect(JSON.parse(JSON.stringify(healthOk))).toEqual({
      status: 'ok',
      database: 'ok',
      search: 'ok',
      uptime: 12,
      version: '0.0.0',
    })
  })
})
