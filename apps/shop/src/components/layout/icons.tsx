/**
 * The three glyphs this app's shell needs.
 *
 * `packages/ui` ships the icons its own components require and no more — a
 * shared package that grows an icon set becomes a dependency every app pays for
 * (see `packages/ui/src/components/icons.tsx`). A hamburger, a bag and an
 * account mark are storefront vocabulary, so they live in the storefront.
 *
 * The numbers are `viewBox` coordinates. Size comes from the `size-*` utility
 * the caller passes; colour is inherited through `currentColor`.
 */

import type { SVGProps } from 'react'

type IconProps = Omit<SVGProps<SVGSVGElement>, 'children' | 'viewBox'>

function Icon({ className, ...props }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      focusable="false"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    />
  )
}

export function MenuIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Icon>
  )
}

/** The cart. A tote rather than a trolley — this is a fashion storefront. */
export function CartIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 8h14l-1.2 11.2a1 1 0 0 1-1 .8H7.2a1 1 0 0 1-1-.8Z" />
      <path d="M9 8V6.5a3 3 0 0 1 6 0V8" />
    </Icon>
  )
}

export function AccountIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </Icon>
  )
}
