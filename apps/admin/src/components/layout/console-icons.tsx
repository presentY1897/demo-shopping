/**
 * The two glyphs the top bar's reserved slots wear.
 *
 * In the app rather than in `packages/ui`: the shell owns its own furniture
 * (the nav toggle), but what goes in the slots is the app's business. The bell
 * now carries a real unread badge, and the badge is drawn *around* this glyph by
 * `NotificationSlot` rather than inside it — the icon stays a plain path, and
 * the next console can wear it with a different count on it.
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

export function BellIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 9a6 6 0 0 1 12 0c0 4 1.5 5.5 2 6H4c.5-.5 2-2 2-6" />
      <path d="M10 19a2 2 0 0 0 4 0" />
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
