/**
 * `formatMoney` and `formatDate` — the two values a commerce screen renders more
 * than any other, and the two it is easiest to hardcode.
 *
 * `docs/design/pages.md` 공통 규칙 forbids appending "원": a component that does
 * has silently decided the currency, and the first USD order is where that shows
 * up. The symbol, its position, the group separator and the number of decimals
 * all come from the currency and the locale here — nothing in `packages/ui`
 * knows what any of them look like.
 *
 * The amounts are integers in the currency's **minor unit**, because that is the
 * one scale on which every currency is an integer: 12000 KRW is ₩12,000 and 1250
 * USD is $12.50. Floating point on money is out (DECISIONS 7장).
 */

import type { Meta, StoryObj } from '@storybook/react-vite'

import { formatDate, formatMoney, type Money } from '../../src/format'
import { Stack } from '../support/layout'

const AMOUNTS: readonly { readonly money: Money; readonly locale: string }[] = [
  { locale: 'ko-KR', money: { amount: 12000, currency: 'KRW' } },
  { locale: 'ko-KR', money: { amount: 249000, currency: 'KRW' } },
  { locale: 'en-US', money: { amount: 12000, currency: 'KRW' } },
  { locale: 'en-US', money: { amount: 1250, currency: 'USD' } },
  { locale: 'ko-KR', money: { amount: 1250, currency: 'USD' } },
  { locale: 'en-US', money: { amount: 129900, currency: 'EUR' } },
  { locale: 'ja-JP', money: { amount: 1250, currency: 'JPY' } },
]

const INSTANT = '2026-09-03T20:30:00.000Z'

const DATES = [
  { locale: 'ko-KR', style: 'date', timeZone: 'Asia/Seoul' },
  { locale: 'ko-KR', style: 'dateTime', timeZone: 'Asia/Seoul' },
  { locale: 'ko-KR', style: 'time', timeZone: 'Asia/Seoul' },
  { locale: 'en-US', style: 'dateTime', timeZone: 'Asia/Seoul' },
  { locale: 'en-US', style: 'dateTime', timeZone: 'UTC' },
] as const

function Formatters() {
  return (
    <Stack>
      <table className="text-fg border-separate border-spacing-0 text-sm">
        <caption className="text-fg-muted pb-2 text-start text-sm">
          Money — one integer, formatted by its own currency
        </caption>
        <thead>
          <tr className="bg-surface-muted">
            <th className="border-border border-b px-3 py-2 text-start" scope="col">
              Value
            </th>
            <th className="border-border border-b px-3 py-2 text-start" scope="col">
              Locale
            </th>
            <th className="border-border border-b px-3 py-2 text-end" scope="col">
              Rendered
            </th>
          </tr>
        </thead>
        <tbody>
          {AMOUNTS.map(({ money, locale }) => (
            <tr key={`${money.currency}-${String(money.amount)}-${locale}`}>
              <th className="border-border border-b px-3 py-2 text-start font-mono" scope="row">
                {`${String(money.amount)} ${money.currency}`}
              </th>
              <td className="border-border text-fg-muted border-b px-3 py-2 font-mono">{locale}</td>
              <td className="border-border border-b px-3 py-2 text-end tabular-nums">
                {formatMoney(money, { locale })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <table className="text-fg border-separate border-spacing-0 text-sm">
        <caption className="text-fg-muted pb-2 text-start text-sm">
          {`Dates — one instant (${INSTANT}), formatted five ways`}
        </caption>
        <thead>
          <tr className="bg-surface-muted">
            <th className="border-border border-b px-3 py-2 text-start" scope="col">
              Style
            </th>
            <th className="border-border border-b px-3 py-2 text-start" scope="col">
              Zone
            </th>
            <th className="border-border border-b px-3 py-2 text-end" scope="col">
              Rendered
            </th>
          </tr>
        </thead>
        <tbody>
          {DATES.map((options) => (
            <tr key={`${options.locale}-${options.style}-${options.timeZone}`}>
              <th className="border-border border-b px-3 py-2 text-start font-mono" scope="row">
                {`${options.locale} · ${options.style}`}
              </th>
              <td className="border-border text-fg-muted border-b px-3 py-2 font-mono">
                {options.timeZone}
              </td>
              <td className="border-border border-b px-3 py-2 text-end">
                {formatDate(INSTANT, options)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="text-fg-muted max-w-96 text-sm">
        The last two rows are the same instant. A server that formats in its own zone shows a buyer
        the wrong day, which is why the zone is an argument rather than a default.
      </p>
    </Stack>
  )
}

const meta = {
  title: 'Components/Formatters',
  component: Formatters,
  tags: ['autodocs'],
} satisfies Meta<typeof Formatters>

export default meta

type Story = StoryObj<typeof meta>

export const MoneyAndDates: Story = {}
