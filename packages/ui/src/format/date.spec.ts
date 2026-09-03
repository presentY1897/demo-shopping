/**
 * Dates, tested for the two things that actually go wrong: an invalid input
 * rendered as the words "Invalid Date", and a time zone that differs between the
 * server render and the browser render.
 */

import { describe, expect, it } from 'vitest'

import { formatDate, toDate } from './date'

const INSTANT = '2026-09-03T20:30:00.000Z'

describe('toDate', () => {
  it('accepts a Date, an ISO string and epoch milliseconds', () => {
    const expected = new Date(INSTANT).getTime()

    expect(toDate(new Date(INSTANT)).getTime()).toBe(expected)
    expect(toDate(INSTANT).getTime()).toBe(expected)
    expect(toDate(expected).getTime()).toBe(expected)
  })

  it('rejects an unparseable string rather than passing on an Invalid Date', () => {
    expect(() => toDate('not-a-date')).toThrow(RangeError)
  })

  it('rejects an Invalid Date object', () => {
    expect(() => toDate(new Date(Number.NaN))).toThrow(RangeError)
  })
})

describe('formatDate', () => {
  it('formats a date in the requested locale', () => {
    expect(formatDate(INSTANT, { locale: 'en-US', timeZone: 'UTC' })).toBe('Sep 3, 2026')
  })

  it('includes the time when asked', () => {
    expect(formatDate(INSTANT, { locale: 'en-US', style: 'dateTime', timeZone: 'UTC' })).toContain(
      '8:30',
    )
  })

  it('formats the time alone', () => {
    const time = formatDate(INSTANT, { locale: 'en-US', style: 'time', timeZone: 'UTC' })

    expect(time).toContain('8:30')
    expect(time).not.toContain('2026')
  })

  it('renders the same instant differently in two zones', () => {
    // The bug this prevents: an order placed at 20:30 UTC is 4 September in
    // Seoul, and a server that formats in UTC shows the buyer the wrong day.
    const utc = formatDate(INSTANT, { locale: 'en-US', timeZone: 'UTC' })
    const seoul = formatDate(INSTANT, { locale: 'en-US', timeZone: 'Asia/Seoul' })

    expect(utc).toBe('Sep 3, 2026')
    expect(seoul).toBe('Sep 4, 2026')
  })

  it('uses the runtime locale and zone when none are given', () => {
    expect(formatDate(INSTANT)).toContain('2026')
  })
})
