import { DENSITY_VIEWPORT_MIN_WIDTH } from '@shopping/ui'

/** Matches the preview's md:grid-cols-* layouts using the shared breakpoint. */
export function previewImageSizes(columns: 2 | 3): string {
  return `(min-width: ${String(DENSITY_VIEWPORT_MIN_WIDTH.md)}px) ${String(Math.floor(100 / columns))}vw, 100vw`
}
