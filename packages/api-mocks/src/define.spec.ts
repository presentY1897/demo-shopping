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
        demoCleanup: { lastRunAt: null },
        searchIndex: { pending: 0, lastRunAt: null, oldestPendingAt: null },
        reservationExpiry: { status: 'ok', lastRunAt: null, releasedCount: 0 },
        paymentReconcile: { status: 'ok', lastRunAt: null, resolvedCount: 0 },
        orderConfirm: { status: 'ok', lastRunAt: null, confirmedCount: 0 },
        paymentStraggler: { status: 'ok', lastRunAt: null, fixedCount: 0 },
        deliverySimulator: { status: 'ok', lastRunAt: null, advancedCount: 0 },
        paymentWebhook: { lastReceivedAt: null },
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
        demoCleanup: { lastRunAt: null },
        searchIndex: { pending: 0, lastRunAt: null, oldestPendingAt: null },
        reservationExpiry: { status: 'ok', lastRunAt: null, releasedCount: 0 },
        paymentReconcile: { status: 'ok', lastRunAt: null, resolvedCount: 0 },
        orderConfirm: { status: 'ok', lastRunAt: null, confirmedCount: 0 },
        paymentStraggler: { status: 'ok', lastRunAt: null, fixedCount: 0 },
        deliverySimulator: { status: 'ok', lastRunAt: null, advancedCount: 0 },
        paymentWebhook: { lastReceivedAt: null },
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
      demoCleanup: { lastRunAt: '2026-09-05T00:00:00.000Z' },
      searchIndex: { pending: 0, lastRunAt: '2026-09-05T00:00:00.000Z', oldestPendingAt: null },
      reservationExpiry: { status: 'ok', lastRunAt: '2026-09-05T00:00:00.000Z', releasedCount: 0 },
      paymentReconcile: { status: 'ok', lastRunAt: '2026-09-05T00:00:00.000Z', resolvedCount: 0 },
      orderConfirm: { status: 'ok', lastRunAt: '2026-09-05T00:00:00.000Z', confirmedCount: 0 },
      paymentStraggler: { status: 'ok', lastRunAt: '2026-09-05T00:00:00.000Z', fixedCount: 0 },
      deliverySimulator: {
        status: 'ok',
        lastRunAt: '2026-09-05T00:00:00.000Z',
        advancedCount: 0,
      },
      paymentWebhook: { lastReceivedAt: '2026-09-05T00:00:00.000Z' },
    })
  })
})
