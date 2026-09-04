/**
 * The top of every console screen: what this is, what you can do to it, and
 * what you can narrow it by.
 *
 * A convention rather than a suggestion (TASK-0019 4.6). Thirty-odd operations
 * screens are coming, written by different TASKs months apart, and without one
 * component they will put the primary action on the left, then the right, then
 * under the filters — which is the kind of inconsistency nobody reports and
 * everybody feels.
 *
 * **It owns the `<h1>`.** The shell cannot: a root layout does not know an
 * order's number, and a screen rendered on its own in a test still has to be a
 * document with a heading.
 *
 * No hook, no browser API — server-renderable, deliberately. On a console
 * screen this heading is usually the LCP element, and putting it behind a
 * client boundary would make the largest paint wait for hydration.
 */

import type { ReactNode } from 'react'

import { cx } from '../lib/cx'

export interface PageHeaderProps {
  readonly title: ReactNode
  /** One line under the title. Not a place for a paragraph. */
  readonly description?: ReactNode
  /** Buttons for this screen. Right-aligned on a wide viewport. */
  readonly actions?: ReactNode
  /** Search, status pills, date range — whatever narrows what is below. */
  readonly filters?: ReactNode
  readonly className?: string
}

export function PageHeader({ title, description, actions, filters, className }: PageHeaderProps) {
  return (
    <header className={cx('flex flex-col gap-4', className)}>
      {/*
        `flex-wrap` rather than a viewport branch: the actions drop under the
        title when they stop fitting, which depends on how many there are and
        how long the title is, not on which breakpoint the window is in.
      */}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-fg text-2xl font-bold">{title}</h1>
          {description === undefined ? null : (
            <p className="text-fg-muted text-sm">{description}</p>
          )}
        </div>

        {actions === undefined ? null : (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        )}
      </div>

      {filters === undefined ? null : (
        <div className="border-border bg-surface-sunken flex flex-wrap items-end gap-2 rounded-md border p-3">
          {filters}
        </div>
      )}
    </header>
  )
}
