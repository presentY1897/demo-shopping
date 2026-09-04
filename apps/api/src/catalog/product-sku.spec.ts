import { SKU_PATTERN, SKU_PREFIX_PATTERN } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import { defaultSkuPrefix, generatedSku } from './product-sku.js'

/**
 * The rule TASK-0036 7.5 found broken, pinned down without a database.
 *
 * The bug it reported is reproducible from two strings alone: two UUIDv7 values
 * thirty seconds apart share their leading eight hex characters, so the old
 * rule gave both products the same prefix and both first variants the same SKU.
 * That is what the first block below asserts — on the *fixed* rule, so a
 * regression to the old derivation fails here rather than in an integration
 * spec's 409.
 */

/** Two ids a UUIDv7 generator would produce `gapMs` apart in one store. */
function uuidV7(unixMs: number, tail: string): string {
  const time = unixMs.toString(16).padStart(12, '0')

  return `${time.slice(0, 8)}-${time.slice(8, 12)}-7abc-8def-${tail.padStart(12, '0')}`
}

const BASE_MS = 0x0199_c4a2_0000

describe('defaultSkuPrefix — 65초 창 안의 두 상품 (TASK-0036 7.5)', () => {
  it('separates two products created thirty seconds apart', () => {
    const first = defaultSkuPrefix(uuidV7(BASE_MS, '00000000aaaa'))
    const second = defaultSkuPrefix(uuidV7(BASE_MS + 30_000, '00000000bbbb'))

    // The half that changes is the id's random tail; the timestamp half is
    // identical, which is precisely the situation the old rule could not tell
    // apart.
    expect(first).not.toBe(second)
  })

  it('separates two products created in the same millisecond', () => {
    const first = defaultSkuPrefix(uuidV7(BASE_MS, '00000000aaaa'))
    const second = defaultSkuPrefix(uuidV7(BASE_MS, '00000000bbbb'))

    expect(first).not.toBe(second)
  })

  it('keeps the timestamp half, so prefixes sort in creation order', () => {
    const earlier = defaultSkuPrefix(uuidV7(BASE_MS, 'ffffffffffff'))
    const later = defaultSkuPrefix(uuidV7(BASE_MS + 10 * 60_000, '000000000000'))

    // Even with the later product holding the smallest possible tail, the
    // leading characters still order the two.
    expect(earlier < later).toBe(true)
  })

  it('is a function of the row and nothing else', () => {
    const id = uuidV7(BASE_MS, '00000000aaaa')

    // The update path recomputes the prefix when an added option value creates
    // new combinations. A different answer there would split one product's SKUs
    // into two families.
    expect(defaultSkuPrefix(id)).toBe(defaultSkuPrefix(id))
  })
})

describe('defaultSkuPrefix — 형식', () => {
  it('is accepted by the shared prefix pattern', () => {
    expect(SKU_PREFIX_PATTERN.test(defaultSkuPrefix(uuidV7(BASE_MS, '00000000aaaa')))).toBe(true)
  })

  it('produces SKUs the database’s own format check accepts', () => {
    const prefix = defaultSkuPrefix(uuidV7(BASE_MS, '00000000aaaa'))

    expect(SKU_PATTERN.test(generatedSku(prefix, 1))).toBe(true)
    expect(SKU_PATTERN.test(generatedSku(prefix, 200))).toBe(true)
  })

  it('is uppercase hex of a fixed length', () => {
    expect(defaultSkuPrefix('0199c4a2-0000-7abc-8def-00000000aaaa')).toBe('0199C4A200AAAA')
  })

  it('refuses a derivation that would not survive the format check', () => {
    // Not reachable from a request — the column and the schema both hold a
    // UUID — but the guard is what turns a future change to the derivation into
    // a loud failure instead of a constraint violation halfway through a write.
    expect(() => defaultSkuPrefix('-@@@@@@@@@@@@')).toThrow(/SKU 접두사/)
  })
})

describe('generatedSku', () => {
  it('numbers from the offset it is given', () => {
    // The suffix is the position in the combination expansion, which is what
    // TASK-0032 F1 fixed as "판매자가 표에서 읽는 순서". Changing the prefix rule
    // did not touch it.
    expect(generatedSku('TEE', 1)).toBe('TEE-1')
    expect(generatedSku('TEE', 12)).toBe('TEE-12')
  })
})
