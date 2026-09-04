'use client'

/**
 * The console — sidebar, top bar, content — for `apps/seller` and `apps/admin`.
 *
 * The two consoles are the same shell with a different menu, and the menu is a
 * prop because each app owns its own routes (M04 puts a permission filter in
 * front of the same definition). Nothing Korean reaches this file; every string
 * arrives through `labels`.
 *
 * **Three decisions are worth knowing before changing anything here** — all of
 * them TASK-0019 4장.
 *
 * 1. *The sidebar turns at 1024px, which is not a density band.* The console has
 *    no density (D-033), so `useViewportBand`'s 768/1280 would have meant
 *    choosing the console's breakpoint to suit a product grid. `useMinWidth`
 *    answers the width this layout actually cares about, and D-055 is honoured
 *    the same way `apps/shop`'s header honours it: **one form is mounted**, a
 *    column or a sheet, never both with one hidden by CSS.
 *
 * 2. *Nothing shifts when the sidebar arrives.* It is `position: fixed`, so
 *    mounting it moves nothing, and the content wrapper reserves its width with
 *    `lg:pl-60` — a media query, which is correct from the first paint, before
 *    any JavaScript has run. Without that reservation the desktop layout would
 *    jump right at hydration on every cold load.
 *
 * 3. *Collapsing hides the sidebar rather than shrinking it to icons.* An icon
 *    rail needs a distinct glyph per entry (22 across the two apps) and would
 *    make "정산 관리" and "수수료 설정" the same picture. The toggle exists to
 *    give a wide table its width back, which hiding does completely.
 *
 * The collapsed state lives in React, not localStorage: the shell is in the root
 * layout, so it survives client navigation, and persisting it would need a
 * second inline boot script (TASK-0018 4.1) on pages whose static prerender is
 * the whole cold-start answer (TASK-0101).
 */

import { useState } from 'react'
import type { ReactNode } from 'react'

import { Drawer } from '../components/drawer'
import { IconButton } from '../components/icon-button'
import { SkipLink } from '../layout/skip-link'
import { useMinWidth } from '../layout/use-min-width'
import { cx } from '../lib/cx'
import { FOCUS_RING } from '../lib/styles'
import { ConsoleNavIcon } from './console-icons'
import { ConsoleNav, type ConsoleLinkComponent } from './console-nav'
import { ConsoleTopbar } from './console-topbar'
import { activeConsoleMenuItem, type ConsoleMenu } from './menu'

/**
 * Where the sidebar stops being a column.
 *
 * 1024 is Tailwind's `lg`, which the content wrapper below uses to reserve the
 * column's width. The two have to be the same number: `lg` is `64rem`, which is
 * 1024px at the default root font size, and this is the one assumption that
 * ties the JS branch to the CSS reservation.
 */
export const CONSOLE_SIDEBAR_MIN_WIDTH = 1024

/** The skip link's destination, and the element it focuses. */
const MAIN_ID = 'console-main'

export interface ConsoleShellLabels {
  readonly skipToContent: string
  /** Names the `<nav>` landmark — "주요 메뉴". */
  readonly navLabel: string
  /** Toggle, below 1024px. */
  readonly openNav: string
  /** Toggle, at or above 1024px, per state. */
  readonly collapseSidebar: string
  readonly expandSidebar: string
  /** The × inside the sheet. */
  readonly closeNav: string
  /** One line under the sheet's title, describing what it holds. */
  readonly navSheetDescription: string
}

export interface ConsoleShellProps {
  readonly menu: ConsoleMenu
  /** Current pathname, from the app's router. */
  readonly currentPath: string
  /** The console's name. Shown in the sidebar and as the sheet's title. */
  readonly brand: string
  readonly brandHref?: string
  readonly labels: ConsoleShellLabels
  readonly linkComponent: ConsoleLinkComponent
  /** M11 fills this. Until then the app passes something that says so. */
  readonly notifications?: ReactNode
  /** M04 fills this. */
  readonly userMenu?: ReactNode
  readonly children: ReactNode
}

export function ConsoleShell({
  menu,
  currentPath,
  brand,
  brandHref = '/',
  labels,
  linkComponent,
  notifications,
  userMenu,
  children,
}: ConsoleShellProps) {
  const wide = useMinWidth(CONSOLE_SIDEBAR_MIN_WIDTH)
  const [expanded, setExpanded] = useState(true)
  const [sheetOpen, setSheetOpen] = useState(false)

  const columnShown = wide && expanded
  const Link = linkComponent

  const nav = (onNavigate?: () => void, brandNode?: ReactNode) => (
    <ConsoleNav
      brand={brandNode}
      currentPath={currentPath}
      label={labels.navLabel}
      linkComponent={linkComponent}
      menu={menu}
      onNavigate={onNavigate}
    />
  )

  /**
   * Below 1024px the toggle *is* the sheet's trigger.
   *
   * Driving the sheet from state and leaving it triggerless looks equivalent
   * and is not: Radix returns focus to the trigger it knows about, and with no
   * trigger an operator who closes the sheet with Escape is left on `<body>`
   * with nothing focused. Measured, not assumed — the spec beside this file
   * fails on exactly that.
   */
  const navToggle = wide ? (
    <IconButton
      aria-expanded={expanded}
      label={expanded ? labels.collapseSidebar : labels.expandSidebar}
      onClick={() => {
        setExpanded((open) => !open)
      }}
      size="sm"
      variant="ghost"
    >
      <ConsoleNavIcon className="size-5" />
    </IconButton>
  ) : (
    // Left, not bottom: the sheet reads as the column it replaces, and the
    // trigger it slides out from is at the top-left corner.
    <Drawer
      closeLabel={labels.closeNav}
      description={labels.navSheetDescription}
      onOpenChange={setSheetOpen}
      open={sheetOpen}
      side="left"
      title={brand}
      trigger={
        <IconButton label={labels.openNav} size="sm" variant="ghost">
          <ConsoleNavIcon className="size-5" />
        </IconButton>
      }
    >
      {nav(() => {
        // The route changes under the sheet and Radix has no reason to know
        // that happened.
        setSheetOpen(false)
      })}
    </Drawer>
  )

  return (
    <>
      <SkipLink href={`#${MAIN_ID}`}>{labels.skipToContent}</SkipLink>

      {columnShown ? (
        // `fixed`, so it is outside the flow and its arrival at hydration moves
        // nothing. `overflow-y-auto` because thirteen entries plus their group
        // headings outgrow a short laptop window.
        <div className="bg-surface border-border fixed inset-y-0 left-0 z-30 flex w-60 flex-col overflow-y-auto border-r px-2 py-4">
          {nav(
            undefined,
            <Link
              className={cx(
                'text-fg min-h-touch flex items-center rounded-md px-3 text-lg font-bold',
                FOCUS_RING,
              )}
              href={brandHref}
            >
              {brand}
            </Link>,
          )}
        </div>
      ) : null}

      <div
        className="bg-surface-sunken flex min-h-dvh flex-col lg:pl-60 lg:data-[sidebar=collapsed]:pl-0"
        data-sidebar={expanded ? 'expanded' : 'collapsed'}
      >
        <ConsoleTopbar
          location={activeConsoleMenuItem(menu, currentPath)?.label ?? brand}
          navToggle={navToggle}
          notifications={notifications}
          userMenu={userMenu}
        />

        {/*
          `tabIndex={-1}` is what makes the skip link work: without it the
          fragment moves the scroll position but not the focus, and the next Tab
          goes back into the navigation the operator just skipped.
        */}
        <main className="flex flex-1 flex-col gap-6 px-6 py-6" id={MAIN_ID} tabIndex={-1}>
          {children}
        </main>
      </div>
    </>
  )
}
