/**
 * Money, formatted from the value's own currency.
 *
 * DECISIONS 1장 requires amounts to be modelled with their currency and
 * `docs/design/pages.md` 공통 규칙 forbids a hardcoded "원": a component that
 * appends a symbol has silently decided the currency, and the first USD order
 * is where that shows up. Everything below asks `Intl` instead — the symbol, its
 * position, the group separator and the number of decimals all come from the
 * currency and the locale, never from this file.
 *
 * Nothing here touches React or the DOM, so `@shopping/ui` exports it from its
 * React-free entry point and a server component can format a total.
 */

/**
 * An amount in the currency's **minor unit**, as an integer.
 *
 * Integer because DECISIONS 7장 forbids floating point on money: `0.1 + 0.2` is
 * not `0.3`, and an apportioned refund that loses a remainder is a defect the
 * ledger tables exist to make impossible. Minor unit because that is the only
 * scale on which every currency is an integer — 12000 KRW is ₩12,000 and 1250
 * USD is $12.50. `currencyFractionDigits` is what converts back.
 */
export interface Money {
  readonly amount: number
  /** ISO 4217, uppercase — `KRW`, `USD`. */
  readonly currency: string
}

export const MONEY_DISPLAYS = ['symbol', 'narrowSymbol', 'code', 'name'] as const
export type MoneyDisplay = (typeof MONEY_DISPLAYS)[number]

export interface MoneyFormatOptions {
  /**
   * BCP 47 tag. Left undefined the runtime's own locale decides, which is right
   * for a design-system default: `packages/ui` does not know an app's locale and
   * must not pick Korean on its behalf (`packages/ui` 에는 한국어가 없다).
   */
  readonly locale?: string
  readonly display?: MoneyDisplay
}

/**
 * How many decimals the currency has — 0 for KRW and JPY, 2 for USD and EUR.
 *
 * Read from `Intl` rather than from a table in this file. A table would be a
 * second source of truth for something the platform already knows, and the entry
 * nobody remembers to add is the one that renders 1250 KRW as ₩12.50.
 *
 * Throws `RangeError` for a currency code the runtime does not recognise, which
 * is the same thing `Intl.NumberFormat` does and a better outcome than quietly
 * formatting an amount at the wrong scale.
 */
export function currencyFractionDigits(currency: string, locale?: string): number {
  const { maximumFractionDigits } = new Intl.NumberFormat(locale, {
    currency,
    style: 'currency',
  }).resolvedOptions()

  // Optional in the type because a compact or engineering notation can resolve
  // without one. A currency format always has it; 0 is the safe reading anyway,
  // since a currency with no minor unit is the case that would produce it.
  return maximumFractionDigits ?? 0
}

/** The minor-unit amount as a decimal number in the currency's major unit. */
export function toMajorUnits(money: Money, locale?: string): number {
  return money.amount / 10 ** currencyFractionDigits(money.currency, locale)
}

/**
 * `₩12,000` · `$12.50` · `¥1,250` — whichever the currency and locale imply.
 *
 * The fraction digits are pinned to the currency's own so that a KRW total never
 * grows a decimal point and a USD total never loses one; left to the default,
 * `Intl` would drop a trailing `.00`.
 */
export function formatMoney(money: Money, options: MoneyFormatOptions = {}): string {
  if (!Number.isInteger(money.amount)) {
    throw new RangeError(
      `Money.amount must be an integer number of minor units, received ${String(money.amount)}`,
    )
  }

  const digits = currencyFractionDigits(money.currency, options.locale)

  return new Intl.NumberFormat(options.locale, {
    currency: money.currency,
    currencyDisplay: options.display ?? 'symbol',
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
    style: 'currency',
  }).format(money.amount / 10 ** digits)
}
