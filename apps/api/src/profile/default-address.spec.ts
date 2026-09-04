import { describe, expect, it } from 'vitest'

import type { AddressPosition } from './default-address.js'
import { defaultOnCreate, promotedAfterDelete } from './default-address.js'

/**
 * 순수 로직, so every branch is named here (QUALITY-GATES Q5 강화).
 *
 * Dates are literals rather than the process clock — `new Date()` is a lint
 * error in `apps/api` and would make the tie-break case impossible to write on
 * purpose (TASK-0106 4.7).
 */

function at(iso: string, id: string): AddressPosition {
  return { id, createdAt: new Date(iso) }
}

describe('defaultOnCreate', () => {
  it('honours an explicit request', () => {
    expect(defaultOnCreate(true, 3)).toBe(true)
  })

  it('makes the first address the default even when nobody asked', () => {
    // The state this exists to prevent: addresses saved, none of them default,
    // and checkout with nothing to preselect.
    expect(defaultOnCreate(false, 0)).toBe(true)
  })

  it('leaves a later address alone when it was not asked for', () => {
    expect(defaultOnCreate(false, 1)).toBe(false)
  })

  it('still honours the request on the first address', () => {
    expect(defaultOnCreate(true, 0)).toBe(true)
  })
})

describe('promotedAfterDelete', () => {
  it('promotes nobody when the book is now empty', () => {
    expect(promotedAfterDelete([])).toBeNull()
  })

  it('promotes the only survivor', () => {
    expect(promotedAfterDelete([at('2026-09-01T00:00:00.000Z', 'a')])).toBe('a')
  })

  it('promotes the most recently saved address', () => {
    const book = [
      at('2026-09-01T00:00:00.000Z', 'old'),
      at('2026-09-03T00:00:00.000Z', 'new'),
      at('2026-09-02T00:00:00.000Z', 'middle'),
    ]

    expect(promotedAfterDelete(book)).toBe('new')
  })

  it('does not depend on the order the rows arrived in', () => {
    const book = [at('2026-09-03T00:00:00.000Z', 'new'), at('2026-09-01T00:00:00.000Z', 'old')]

    expect(promotedAfterDelete(book)).toBe('new')
  })

  it('breaks a tie on the id, which is a UUIDv7 and therefore the later one', () => {
    const sameInstant = '2026-09-03T00:00:00.000Z'
    const book = [
      at(sameInstant, '0192f0c1-0000-7000-8000-000000000001'),
      at(sameInstant, '0192f0c1-0000-7000-8000-000000000002'),
    ]

    expect(promotedAfterDelete(book)).toBe('0192f0c1-0000-7000-8000-000000000002')
    expect(promotedAfterDelete([...book].reverse())).toBe('0192f0c1-0000-7000-8000-000000000002')
  })
})
