/**
 * The formatter is pure logic, so it is tested as input → output — no rendering,
 * no mocking (QUALITY-GATES Q5 순수 로직).
 *
 * The assertions are about the *rules the currency implies*, which is the whole
 * point of TASK-0016 F5: the same integer renders as ₩12,000 or $120.00 with no
 * branch in the calling code and no "원" anywhere in this package.
 */

import { describe, expect, it } from 'vitest'

import { currencyFractionDigits, formatMoney, toMajorUnits } from './money'

describe('currencyFractionDigits', () => {
  it('is 0 for a currency with no minor unit', () => {
    expect(currencyFractionDigits('KRW', 'ko-KR')).toBe(0)
    expect(currencyFractionDigits('JPY', 'en-US')).toBe(0)
  })

  it('is 2 for a currency with cents', () => {
    expect(currencyFractionDigits('USD', 'en-US')).toBe(2)
    expect(currencyFractionDigits('EUR', 'en-US')).toBe(2)
  })

  it('rejects a code the runtime does not know', () => {
    expect(() => currencyFractionDigits('NOPE', 'en-US')).toThrow(RangeError)
  })
})

describe('toMajorUnits', () => {
  it('leaves a zero-decimal currency alone', () => {
    expect(toMajorUnits({ amount: 12000, currency: 'KRW' }, 'ko-KR')).toBe(12000)
  })

  it('shifts a two-decimal currency by its minor unit', () => {
    expect(toMajorUnits({ amount: 1250, currency: 'USD' }, 'en-US')).toBe(12.5)
  })
})

describe('formatMoney', () => {
  it('formats KRW with no decimal point', () => {
    expect(formatMoney({ amount: 12000, currency: 'KRW' }, { locale: 'ko-KR' })).toBe('₩12,000')
  })

  it('formats USD from cents', () => {
    expect(formatMoney({ amount: 1250, currency: 'USD' }, { locale: 'en-US' })).toBe('$12.50')
  })

  it('keeps the trailing zeros a currency requires', () => {
    // Left to `Intl`'s default this is "$120", which reads as a different price.
    expect(formatMoney({ amount: 12000, currency: 'USD' }, { locale: 'en-US' })).toBe('$120.00')
  })

  it('reads the symbol and its position from the locale, not from the caller', () => {
    const korean = formatMoney({ amount: 1250, currency: 'USD' }, { locale: 'ko-KR' })
    const american = formatMoney({ amount: 1250, currency: 'USD' }, { locale: 'en-US' })

    expect(korean).not.toBe(american)
    expect(korean).toContain('12.50')
    expect(american).toBe('$12.50')
  })

  it('can name the currency by code instead of by symbol', () => {
    expect(
      formatMoney({ amount: 12000, currency: 'KRW' }, { display: 'code', locale: 'ko-KR' }),
    ).toContain('KRW')
  })

  it('formats zero and negative amounts', () => {
    expect(formatMoney({ amount: 0, currency: 'KRW' }, { locale: 'ko-KR' })).toBe('₩0')
    expect(formatMoney({ amount: -5000, currency: 'KRW' }, { locale: 'ko-KR' })).toContain('5,000')
  })

  it('refuses a fractional amount', () => {
    // Money is an integer count of minor units (DECISIONS 7장). A float here
    // means someone divided somewhere, and the rounding error is already in.
    expect(() => formatMoney({ amount: 12.5, currency: 'KRW' }, { locale: 'ko-KR' })).toThrow(
      RangeError,
    )
  })

  it('falls back to the runtime locale when none is given', () => {
    // Not asserting the output — that depends on the machine. Asserting that
    // omitting the locale is allowed and still produces the currency.
    expect(formatMoney({ amount: 12000, currency: 'KRW' })).toContain('12,000')
  })
})
