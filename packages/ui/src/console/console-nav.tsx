/**
 * The menu itself — the same element in the sidebar column and in the sheet.
 *
 * It is the `<nav>` landmark, not something inside one, so that everything it
 * draws (the brand link included) is inside a landmark rather than loose on the
 * page. That is why `brand` is a prop here instead of a sibling: the sidebar
 * column has a brand above the menu, the sheet has it in the drawer's own
 * title, and duplicating the landmark to accommodate that would give a screen
 * reader two navigations to choose between.
 *
 * **Which item is lit is decided once, for the whole menu** — see
 * `activeConsoleMenuItem`. Asking each item independently would light both
 * `/orders` and `/orders/returns` on a returns screen.
 */

import type { ComponentType, ReactNode } from 'react'
import { useId } from 'react'

import { cx } from '../lib/cx'
import { FOCUS_RING } from '../lib/styles'
import { activeConsoleMenuItem, type ConsoleMenu } from './menu'

/**
 * What the shell needs from a link.
 *
 * `packages/ui` does not know about `next/link` and must not: each app passes
 * its own router link straight in. Everything here is a plain anchor prop, so
 * `Link` satisfies it as-is.
 */
export interface ConsoleLinkProps {
  readonly href: string
  readonly className?: string
  readonly children: ReactNode
  readonly 'aria-current'?: 'page'
  readonly onClick?: () => void
}

export type ConsoleLinkComponent = ComponentType<ConsoleLinkProps>

export interface ConsoleNavProps {
  readonly menu: ConsoleMenu
  /** Current pathname. The app reads it from its router and passes it down. */
  readonly currentPath: string
  /** Names the landmark. There is more than one `<nav>` on a console page. */
  readonly label: string
  readonly linkComponent: ConsoleLinkComponent
  /** Rendered above the menu, inside the landmark. */
  readonly brand?: ReactNode
  /** Called after a link is followed — the sheet closes itself with it. */
  readonly onNavigate?: () => void
  readonly className?: string
}

/** Base of every row: the 44px floor applies to a menu link like any control. */
const ITEM_STYLES = 'min-h-touch flex items-center rounded-md px-3 text-sm transition-colors'

export function ConsoleNav({
  menu,
  currentPath,
  label,
  linkComponent: Link,
  brand,
  onNavigate,
  className,
}: ConsoleNavProps) {
  const headingId = useId()
  const active = activeConsoleMenuItem(menu, currentPath)

  return (
    <nav aria-label={label} className={cx('flex flex-col gap-5', className)}>
      {brand}

      {menu.map((section) => {
        const labelId = `${headingId}-${section.id}`

        return (
          <div className="flex flex-col gap-1" key={section.id}>
            {section.label === undefined ? null : (
              <h2
                className="text-fg-subtle text-2xs px-3 font-semibold tracking-wide uppercase"
                id={labelId}
              >
                {section.label}
              </h2>
            )}

            <ul
              aria-labelledby={section.label === undefined ? undefined : labelId}
              className="flex flex-col"
            >
              {section.items.map((item) => {
                const current = item.href === active?.href

                return (
                  <li key={item.href}>
                    <Link
                      // The state is announced, not only coloured. Weight
                      // carries the same information for anyone who cannot see
                      // the tint.
                      aria-current={current ? 'page' : undefined}
                      className={cx(
                        ITEM_STYLES,
                        FOCUS_RING,
                        current
                          ? 'bg-primary-surface text-fg font-semibold'
                          : 'text-fg-muted hover:bg-surface-muted hover:text-fg',
                      )}
                      href={item.href}
                      onClick={onNavigate}
                    >
                      {item.label}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        )
      })}
    </nav>
  )
}
