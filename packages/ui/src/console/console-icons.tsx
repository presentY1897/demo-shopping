/**
 * The two glyphs the shell draws for itself.
 *
 * Not in `components/icons.tsx`: that file is "what the base components need",
 * and these are the console's own furniture. Not props either — the shell owns
 * the toggle button, so it owns the picture on it, and an app that had to
 * supply one could supply the wrong one.
 *
 * The numbers are `viewBox` coordinates — geometry, not CSS lengths.
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

/**
 * A panel with a rail down its left — the sidebar itself, not a hamburger.
 * The button does one thing on a phone and another on a desktop (4.3), and this
 * says "the navigation panel" in both cases.
 */
export function ConsoleNavIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect height="16" rx="2" width="18" x="3" y="4" />
      <path d="M9 4v16" />
    </Icon>
  )
}
