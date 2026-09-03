/**
 * Value formatters — no React, no DOM.
 *
 * Kept apart from `src/components` because these are the half of the data
 * layer a server component and a test can use directly, and because a formatter
 * that imported a component would drag the client bundle into an API route.
 */

export { currencyFractionDigits, formatMoney, MONEY_DISPLAYS, toMajorUnits } from './money'
export type { Money, MoneyDisplay, MoneyFormatOptions } from './money'

export { DATE_STYLES, formatDate, toDate } from './date'
export type { DateFormatOptions, DateInput, DateStyle } from './date'
