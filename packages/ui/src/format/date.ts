/**
 * Dates, formatted by `Intl` for the same reason money is.
 *
 * An order list that writes `2026. 9. 3.` by hand has picked a locale, a
 * calendar and a time zone on the reader's behalf. This asks the platform, and
 * takes the time zone as an argument so a server render and a browser render of
 * the same timestamp agree — the usual cause of a shipping date that moves by a
 * day between SSR and hydration.
 */

/** What a caller has in hand: a `Date`, an ISO string, or epoch milliseconds. */
export type DateInput = Date | string | number

export const DATE_STYLES = ['date', 'dateTime', 'time'] as const
export type DateStyle = (typeof DATE_STYLES)[number]

export interface DateFormatOptions {
  /** BCP 47 tag; the runtime's own locale when omitted. */
  readonly locale?: string
  /**
   * IANA zone. **Pass it.** Omitted, the server formats in the container's zone
   * (UTC) and the browser in the visitor's, and the two disagree by hours.
   */
  readonly timeZone?: string
  readonly style?: DateStyle
}

const STYLE_OPTIONS: Readonly<Record<DateStyle, Intl.DateTimeFormatOptions>> = {
  date: { dateStyle: 'medium' },
  dateTime: { dateStyle: 'medium', timeStyle: 'short' },
  time: { timeStyle: 'short' },
}

/**
 * Normalises the three accepted inputs to a `Date`, rejecting the one that
 * silently poisons everything downstream: `new Date('nope')` is a `Date` whose
 * every method returns `NaN`, and `Intl` renders it as the literal text
 * "Invalid Date" in the middle of an order list.
 */
export function toDate(value: DateInput): Date {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`Not a valid date: ${String(value)}`)
  }
  return date
}

export function formatDate(value: DateInput, options: DateFormatOptions = {}): string {
  return new Intl.DateTimeFormat(options.locale, {
    ...STYLE_OPTIONS[options.style ?? 'date'],
    timeZone: options.timeZone,
  }).format(toDate(value))
}
