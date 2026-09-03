/**
 * Class fragments repeated across components.
 *
 * Only fragments that carry a *decision* live here — the focus ring, the
 * disabled treatment, the overlay surface. Anything a single component owns
 * stays in that component's file, so reading one component does not mean
 * chasing a shared constants module.
 *
 * Every class below resolves to a token from `@shopping/config/tailwind`:
 * `outline-ring` is `--color-ring`, `rounded-md` is `--radius-md`, and the
 * spacing utilities compile against `--space-unit`. Nothing here names a pixel.
 */

/**
 * The focus indicator, on every interactive component.
 *
 * `:focus-visible` rather than `:focus` so a mouse click does not leave a ring
 * behind, and an outline rather than a box-shadow ring so the indicator
 * survives `overflow: hidden` and Windows high-contrast mode. The default UA
 * outline is deliberately *not* reset: if a component ever forgets this class,
 * the browser's own ring is still there.
 */
export const FOCUS_RING =
  'focus-visible:outline-ring focus-visible:outline-2 focus-visible:outline-offset-2'

/**
 * How a control looks when it cannot be used.
 *
 * `aria-disabled` is covered alongside `disabled` because a busy submit button
 * stays focusable (see `Button`), and it has to look the same as a disabled one.
 */
export const DISABLED_STYLES =
  'disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50'

/** The dimmed backdrop behind a modal or drawer. */
export const OVERLAY_STYLES = 'fixed inset-0 z-40 bg-overlay'

/** The panel a modal, drawer or popover is drawn on. */
export const RAISED_SURFACE = 'border-border bg-surface-raised text-fg border'
