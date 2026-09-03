/**
 * The three density steps, drawn as what they actually change: how many columns
 * of product the page gives you.
 *
 * Filled blocks rather than the stroked outlines the rest of `icons.tsx` uses.
 * These are read at 16px inside a 44px control and have to be told apart from
 * each other at a glance — an outline of six small rectangles is a grey smudge
 * at that size, a filled one is a grid.
 *
 * The numbers are `viewBox` coordinates. They are geometry, not CSS lengths, and
 * the rendered size comes from the `size-*` utility the caller passes.
 */

import type { SVGProps } from 'react'

type IconProps = Omit<SVGProps<SVGSVGElement>, 'children' | 'viewBox'>

function Icon({ className, ...props }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="currentColor"
      focusable="false"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    />
  )
}

/** Step 1 — one wide column, the most whitespace. */
export function DensityMinimalIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect height="16" rx="2" width="15" x="4.5" y="4" />
    </Icon>
  )
}

/** Step 2 — two columns, the balance point. */
export function DensityStandardIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect height="16" rx="1.5" width="8" x="3" y="4" />
      <rect height="16" rx="1.5" width="8" x="13" y="4" />
    </Icon>
  )
}

/** Step 3 — the dense grid. */
export function DensityMaximalIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect height="7" rx="1" width="6" x="2.5" y="4" />
      <rect height="7" rx="1" width="6" x="9" y="4" />
      <rect height="7" rx="1" width="6" x="15.5" y="4" />
      <rect height="7" rx="1" width="6" x="2.5" y="13" />
      <rect height="7" rx="1" width="6" x="9" y="13" />
      <rect height="7" rx="1" width="6" x="15.5" y="13" />
    </Icon>
  )
}
