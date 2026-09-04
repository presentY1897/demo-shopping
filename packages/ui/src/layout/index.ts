/**
 * App shell pieces — the parts of a page that are not the page.
 *
 * Kept out of `@shopping/ui` (the React-free surface) and out of
 * `@shopping/ui/components` (the base set every app composes) because these
 * carry layout policy: how wide a page is, where the skip link goes, what the
 * density toggle looks like. `apps/shop` composes its header and footer from
 * them from these.
 *
 * The console shell is *not* here — it lives behind `@shopping/ui/console`
 * (TASK-0019 4.1). `apps/shop` imports this entry point on every screen, and a
 * storefront whose bundle contains an admin sidebar unless the bundler happens
 * to shake it out is a performance regression waiting for a bad day.
 */

export { DensityToggle } from './density-toggle'
export type { DensityToggleProps } from './density-toggle'

export { DensityMaximalIcon, DensityMinimalIcon, DensityStandardIcon } from './density-icons'

export { PageContainer, PAGE_CONTAINER_WIDTHS } from './page-container'
export type { PageContainerProps, PageContainerWidth } from './page-container'

export { SkipLink } from './skip-link'
export type { SkipLinkProps } from './skip-link'

export { useMinWidth } from './use-min-width'

export { useViewportBand } from './use-viewport-band'
