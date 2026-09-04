/**
 * The glyphs the base components need.
 *
 * Inline rather than an icon package: these are the only icons `packages/ui`
 * requires to work, and a dependency that ships a thousand of them to deliver a
 * handful is a bundle cost every app pays. Domain icons are the apps' business —
 * which is why the empty and error states take their illustration as a prop.
 *
 * Every path is stroked in `currentColor`, so an icon inherits whatever text
 * colour the control around it resolved from the token layer. The numbers below
 * are `viewBox` coordinates — geometry, not CSS lengths — and the rendered size
 * comes from the `size-*` utility the caller passes.
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

export function CheckIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 12.5 9.5 18 20 6.5" />
    </Icon>
  )
}

/** The indeterminate state of a checkbox, and nothing else. */
export function MinusIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 12h14" />
    </Icon>
  )
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m6 9 6 6 6-6" />
    </Icon>
  )
}

/** Cursor pagination moves one page at a time, so these are the only two. */
export function ChevronLeftIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m15 6-6 6 6 6" />
    </Icon>
  )
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m9 6 6 6-6 6" />
    </Icon>
  )
}

/** Reordering a gallery one place at a time (TASK-0033), so these two pair up. */
export function ChevronUpIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m6 15 6-6 6 6" />
    </Icon>
  )
}

/** "This is the one people see first" — the primary image of a product gallery. */
export function StarIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m12 3.5 2.6 5.4 5.9.85-4.25 4.15 1 5.9L12 17.02 6.75 19.8l1-5.9L3.5 9.75l5.9-.85z" />
    </Icon>
  )
}

export function CloseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 6 18 18M18 6 6 18" />
    </Icon>
  )
}
