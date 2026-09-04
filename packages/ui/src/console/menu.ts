/**
 * The console's navigation, as data — and the one rule that reads it.
 *
 * The shell renders a menu; it does not know one. `apps/seller` and
 * `apps/admin` each own their definition, built from the route table in
 * `docs/design/pages.md`, and M04 puts a permission filter in front of it
 * (TASK-0019 2장). Nothing in this file is Korean, and nothing in it is a
 * component: it is imported by the sidebar, by the topbar and by each app's
 * placeholder screens, which read a title out of the same definition rather
 * than repeating it.
 */

/** One destination. `href` is an app-absolute path, matching `pages.md`. */
export interface ConsoleMenuItem {
  readonly href: string
  readonly label: string
}

/**
 * A labelled run of items.
 *
 * Thirteen entries in one list is a list nobody reads, so the definitions group
 * them. The label is optional because the first group — the dashboard, alone —
 * has nothing to say that the item does not.
 */
export interface ConsoleMenuSection {
  /** Stable key. Not shown. */
  readonly id: string
  readonly label?: string
  readonly items: readonly ConsoleMenuItem[]
}

export type ConsoleMenu = readonly ConsoleMenuSection[]

/** Every item, in menu order. */
export function consoleMenuItems(menu: ConsoleMenu): readonly ConsoleMenuItem[] {
  return menu.flatMap((section) => section.items)
}

/**
 * Whether this item covers that path.
 *
 * The root is exact-match only. Treating it as a prefix would light the
 * dashboard on every screen in the console, which is the one bug this rule has
 * to avoid; everything else matches its own subtree, so `/products/new` marks
 * `/products` as the section being worked in (F2).
 */
export function isConsoleMenuItemActive(href: string, pathname: string): boolean {
  if (href === ROOT) return pathname === ROOT
  return pathname === href || pathname.startsWith(`${href}/`)
}

/**
 * The item a path belongs to, or `null` when the path is outside the menu.
 *
 * **Longest match wins.** A menu that later carries both `/orders` and
 * `/orders/returns` must light the second one on `/orders/returns/3`, and
 * source order is not something a definition's author should have to think
 * about.
 */
export function activeConsoleMenuItem(menu: ConsoleMenu, pathname: string): ConsoleMenuItem | null {
  let best: ConsoleMenuItem | null = null

  for (const item of consoleMenuItems(menu)) {
    if (!isConsoleMenuItemActive(item.href, pathname)) continue
    if (best === null || item.href.length > best.href.length) best = item
  }

  return best
}

/** The item at exactly this path — what a placeholder screen asks for. */
export function consoleMenuItemAt(menu: ConsoleMenu, href: string): ConsoleMenuItem | null {
  return consoleMenuItems(menu).find((item) => item.href === href) ?? null
}

const ROOT = '/'
