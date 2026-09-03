/**
 * A multi-line text field.
 *
 * `min-h-control-lg` rather than a fixed height: the floor follows the density
 * step like every other control, and the browser's resize handle takes it from
 * there.
 */

import type { TextareaHTMLAttributes } from 'react'

import { cx } from '../lib/cx'
import { FIELD_STYLES, fieldBorderClassName } from './input'

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  readonly invalid?: boolean
}

export function Textarea({ invalid = false, className, rows = 3, ...props }: TextareaProps) {
  return (
    <textarea
      aria-invalid={invalid || undefined}
      className={cx(
        FIELD_STYLES,
        fieldBorderClassName(invalid),
        'min-h-control-lg px-3 py-2 text-base',
        className,
      )}
      data-invalid={invalid || undefined}
      rows={rows}
      {...props}
    />
  )
}
