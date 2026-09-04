/**
 * The seller and admin console shell.
 *
 * Its own entry point rather than a corner of `@shopping/ui/layout`
 * (TASK-0019 4.1): `apps/shop` imports that one on every screen, and a
 * storefront whose bundle contains an admin sidebar unless the bundler happens
 * to shake it out is a regression on the one gate `apps/shop` is already
 * fighting (P1, TASK-0018 6.4).
 *
 * Registered in `test/story-coverage.spec.ts`. An entry point that is not
 * listed there ships components that no story renders — which means no axe run,
 * which means the accessibility gate passed without looking at them.
 */

export { ConsoleShell, CONSOLE_SIDEBAR_MIN_WIDTH } from './console-shell'
export type { ConsoleShellLabels, ConsoleShellProps } from './console-shell'

export type { ConsoleLinkComponent, ConsoleLinkProps } from './console-nav'

export { PageHeader } from './page-header'
export type { PageHeaderProps } from './page-header'

export {
  activeConsoleMenuItem,
  consoleMenuItemAt,
  consoleMenuItems,
  isConsoleMenuItemActive,
} from './menu'
export type { ConsoleMenu, ConsoleMenuItem, ConsoleMenuSection } from './menu'
