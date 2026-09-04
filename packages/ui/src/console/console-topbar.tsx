/**
 * The bar above the content: where you are, and the two slots that are not
 * filled yet.
 *
 * **The location is a `<p>`, not a heading.** The `<h1>` belongs to the screen
 * (`PageHeader`), because a root layout cannot know an order's number and
 * because a screen has to be a document with a heading when it is rendered on
 * its own. What the bar shows instead is the *menu entry* the current path
 * falls in — which the shell already computes for the sidebar, so the two can
 * never disagree and no page has to pass a title up (TASK-0019 4.5).
 *
 * The nav toggle arrives as a node rather than as a handler: below 1024px it is
 * a dialog trigger and above it a plain button, and which one it is belongs to
 * the shell. What this file guarantees is that it is in the same place, at the
 * same size, at every width — a control that appeared at a breakpoint would
 * shove the location text sideways at hydration.
 */

import type { ReactNode } from 'react'

export interface ConsoleTopbarProps {
  /** Menu entry for the current path, or the console's name when outside it. */
  readonly location: string
  readonly navToggle: ReactNode
  readonly notifications?: ReactNode
  readonly userMenu?: ReactNode
}

export function ConsoleTopbar({
  location,
  navToggle,
  notifications,
  userMenu,
}: ConsoleTopbarProps) {
  return (
    <header className="bg-surface border-border h-control-lg sticky top-0 z-20 flex shrink-0 items-center gap-2 border-b px-4">
      {navToggle}

      {/* `truncate` and `min-w-0`: a long entry must not push the slots off a
          360px bar. */}
      <p className="text-fg min-w-0 flex-1 truncate text-sm font-medium">{location}</p>

      <div className="flex shrink-0 items-center gap-1">
        {notifications}
        {userMenu}
      </div>
    </header>
  )
}
