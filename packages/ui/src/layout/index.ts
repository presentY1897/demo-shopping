/**
 * App shell pieces — the parts of a page that are not the page.
 *
 * Kept out of `@shopping/ui` (the React-free surface) and out of
 * `@shopping/ui/components` (the base set every app composes) because these
 * carry layout policy: how wide a page is, where the skip link goes, what the
 * density toggle looks like. `apps/shop` composes its header and footer from
 * them; TASK-0019 does the same for the two consoles.
 */

export { DensityToggle } from './density-toggle'
export type { DensityToggleProps } from './density-toggle'

export { DensityMaximalIcon, DensityMinimalIcon, DensityStandardIcon } from './density-icons'

export { PageContainer, PAGE_CONTAINER_WIDTHS } from './page-container'
export type { PageContainerProps, PageContainerWidth } from './page-container'

export { SkipLink } from './skip-link'
export type { SkipLinkProps } from './skip-link'

export { useViewportBand } from './use-viewport-band'
