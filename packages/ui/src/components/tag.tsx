/**
 * A chip: a filter that has been applied, a keyword on a product, a selected
 * option that can be taken back off.
 *
 * Distinct from `Badge` because it can be removed. A badge reports state; a tag
 * is something the user put there.
 *
 * `removeLabel` is required *by the type* whenever `onRemove` is passed. The
 * remove control is an icon button, and an icon button with no accessible name
 * is unusable — making the two props a single union means the compiler asks for
 * the label instead of a reviewer noticing it is missing.
 */

import type { ReactNode } from 'react'

import { cx } from '../lib/cx'
import { CloseIcon } from './icons'
import { IconButton } from './icon-button'

export const TAG_VARIANTS = ['neutral', 'primary'] as const
export type TagVariant = (typeof TAG_VARIANTS)[number]

const VARIANT_STYLES: Readonly<Record<TagVariant, string>> = {
  neutral: 'border-border bg-surface-muted text-fg',
  primary: 'border-primary bg-primary-surface text-fg',
}

interface TagBaseProps {
  readonly variant?: TagVariant
  readonly className?: string
  readonly children?: ReactNode
}

interface RemovableTagProps extends TagBaseProps {
  readonly onRemove: () => void
  /** Accessible name of the remove button, from the app's catalog. */
  readonly removeLabel: string
}

interface StaticTagProps extends TagBaseProps {
  readonly onRemove?: never
  readonly removeLabel?: never
}

export type TagProps = RemovableTagProps | StaticTagProps

export function Tag({ variant = 'neutral', className, children, ...rest }: TagProps) {
  const removable = rest.onRemove !== undefined

  return (
    <span
      className={cx(
        'inline-flex items-center rounded-md border text-sm',
        VARIANT_STYLES[variant],
        // A removable tag grows to the touch floor because it contains a
        // control; a static one is just text and does not need to.
        removable ? 'min-h-touch gap-1 py-0 pr-0 pl-3' : 'gap-1 px-3 py-1',
        className,
      )}
    >
      {children}
      {rest.onRemove === undefined ? null : (
        <IconButton
          className="text-fg-subtle hover:text-fg"
          label={rest.removeLabel}
          onClick={rest.onRemove}
          size="sm"
          variant="ghost"
        >
          <CloseIcon className="size-4" />
        </IconButton>
      )}
    </span>
  )
}
