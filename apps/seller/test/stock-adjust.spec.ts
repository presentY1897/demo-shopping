/**
 * The one decision this screen makes before the server sees anything.
 *
 * Pure logic, and the reason it is worth its own file is F2b: the absence of an
 * absolute input is a design decision, and the way it stays absent is that the
 * only function turning a typed value into a request takes a **delta**. A test
 * that pinned the rendered markup would let somebody add a "재고" box beside it
 * and still pass.
 */

import { STOCK_MAX_MOVEMENT, STOCK_REASON_MAX_LENGTH } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import { parseDelta, parseStockAdjust, previewBalance } from '@/lib/products/stock-adjust'

const base = { type: 'ADJUST', reason: '' } as const

describe('parseDelta', () => {
  it('reads a signed integer', () => {
    expect(parseDelta('5')).toBe(5)
    expect(parseDelta('+5')).toBe(5)
    expect(parseDelta('-2')).toBe(-2)
    expect(parseDelta('  7 ')).toBe(7)
  })

  it('answers nothing for an empty box rather than zero', () => {
    // `Number('')` is 0, which would turn "아직 안 적었다" into "0 을 적었다" —
    // a refusal with the wrong sentence on it.
    expect(parseDelta('')).toBeNull()
    expect(parseDelta('   ')).toBeNull()
  })

  it('answers nothing for what is not an integer', () => {
    expect(parseDelta('3.5')).toBeNull()
    expect(parseDelta('abc')).toBeNull()
    expect(parseDelta('5개')).toBeNull()
  })
})

describe('parseStockAdjust', () => {
  it('makes a request the API would accept', () => {
    const parsed = parseStockAdjust({ ...base, delta: '+5', type: 'INBOUND', reason: ' 입고 ' })

    expect(parsed).toEqual({ ok: true, request: { delta: 5, type: 'INBOUND', reason: '입고' } })
  })

  it('leaves the reason out rather than sending an empty one', () => {
    const parsed = parseStockAdjust({ ...base, delta: '-2' })

    expect(parsed.ok && 'reason' in parsed.request).toBe(false)
  })

  it('refuses an empty box, naming the field (F8)', () => {
    expect(parseStockAdjust({ ...base, delta: '' })).toEqual({ ok: false, issue: 'required' })
  })

  it('refuses zero, which is not an adjustment (F8)', () => {
    expect(parseStockAdjust({ ...base, delta: '0' })).toEqual({ ok: false, issue: 'zero' })
    expect(parseStockAdjust({ ...base, delta: '+0' })).toEqual({ ok: false, issue: 'zero' })
  })

  it('refuses more than one movement may carry', () => {
    expect(parseStockAdjust({ ...base, delta: String(STOCK_MAX_MOVEMENT + 1) })).toEqual({
      ok: false,
      issue: 'range',
    })
    expect(parseStockAdjust({ ...base, delta: String(STOCK_MAX_MOVEMENT) }).ok).toBe(true)
  })

  it('refuses a reason longer than the contract allows', () => {
    const long = 'ㄱ'.repeat(STOCK_REASON_MAX_LENGTH + 1)

    expect(parseStockAdjust({ ...base, delta: '1', reason: long })).toEqual({
      ok: false,
      issue: 'reason_too_long',
    })
  })

  it('does not decide whether the result would be negative', () => {
    // Only the server knows the stock at the instant the request lands. A screen
    // that refused this would be refusing on a number it read seconds ago (F9).
    expect(parseStockAdjust({ ...base, delta: '-999' }).ok).toBe(true)
  })
})

describe('previewBalance (R1)', () => {
  it('shows the absolute number the seller was thinking of', () => {
    expect(previewBalance(12, '+5')).toBe(17)
    expect(previewBalance(12, '-2')).toBe(10)
  })

  it('says nothing until there is a number', () => {
    expect(previewBalance(12, '')).toBeNull()
    expect(previewBalance(12, '0')).toBeNull()
    expect(previewBalance(12, 'abc')).toBeNull()
  })

  it('promises nothing the server is going to reject', () => {
    // The screen does not refuse a negative result — it just stops predicting.
    expect(previewBalance(3, '-4')).toBeNull()
    expect(previewBalance(3, '-3')).toBe(0)
  })
})
