/**
 * The furniture the token documentation is set in.
 *
 * Presentation only — no page here decides what a token *is*. Everything is
 * drawn with the same semantic tokens a component uses, so the documentation is
 * itself a specimen: if `--color-border` goes wrong, these tables go wrong with
 * it rather than staying legible on a set of colours nobody ships.
 */

import type { ReactNode } from 'react'

export function TokenPage({
  title,
  lead,
  source,
  children,
}: {
  readonly title: string
  readonly lead: string
  /** Where the values on this page are declared. */
  readonly source: string
  readonly children: ReactNode
}) {
  return (
    <article className="flex max-w-5xl flex-col gap-8 py-4">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold">{title}</h1>
        <p className="text-fg-muted">{lead}</p>
        <p className="text-fg-subtle font-mono text-xs">{source}</p>
      </header>
      {children}
    </article>
  )
}

export function TokenSection({
  title,
  description,
  children,
}: {
  readonly title: string
  readonly description?: string
  readonly children: ReactNode
}) {
  return (
    <section className="border-border flex flex-col gap-4 border-t pt-6">
      <header className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold">{title}</h2>
        {description === undefined ? null : <p className="text-fg-muted text-sm">{description}</p>}
      </header>
      {children}
    </section>
  )
}

/**
 * The callout that says where a number came from.
 *
 * On every page, because it is the claim the whole exercise rests on: these are
 * readings, not transcriptions.
 */
export function ReadAtRuntime({ children }: { readonly children: ReactNode }) {
  return (
    <p className="border-border bg-surface-sunken text-fg-muted rounded-md border p-3 text-sm">
      {children}
    </p>
  )
}

export interface TableRow {
  readonly key: string
  readonly cells: readonly ReactNode[]
}

/**
 * A data table with real headers.
 *
 * `<th scope="col">` rather than a grid of `<div>`s: a screen reader announces
 * "spacing unit, 4px" instead of "4px", and the accessibility gate over these
 * stories would be worth very little if the documentation of the design system
 * were the least accessible thing in it.
 */
export function TokenTable({
  caption,
  headers,
  rows,
}: {
  readonly caption: string
  readonly headers: readonly string[]
  readonly rows: readonly TableRow[]
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-120 border-collapse text-left text-sm">
        <caption className="text-fg-subtle pb-2 text-left text-xs">{caption}</caption>
        <thead>
          <tr className="border-border border-b">
            {headers.map((header) => (
              <th className="text-fg-muted py-2 pr-4 font-medium" key={header} scope="col">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr className="border-border border-b" key={row.key}>
              {row.cells.map((cell, index) => (
                <td className="py-2 pr-4 align-middle" key={`${row.key}-${String(index)}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** A token name or a value, set in the mono stack. */
export function Mono({ children }: { readonly children: ReactNode }) {
  return <code className="font-mono text-xs">{children}</code>
}

/** Something the page could not observe — jsdom, or a stylesheet that never loaded. */
export const UNMEASURED = '—'

/** A measured length, to one decimal place. */
export function px(value: number | null): string {
  return value === null ? UNMEASURED : `${value.toFixed(1)}px`
}

/**
 * A pass/fail marker.
 *
 * The word is the state; the colour only repeats it. Colour alone would fail
 * WCAG 1.4.1 — in a document about accessible colour, which would be quite a
 * thing to ship.
 */
export function Verdict({ ok, label }: { readonly ok: boolean; readonly label: string }) {
  return (
    <span
      className={
        ok
          ? 'bg-success-surface text-fg inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium'
          : 'bg-danger-surface text-fg inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium'
      }
    >
      {label}
    </span>
  )
}
