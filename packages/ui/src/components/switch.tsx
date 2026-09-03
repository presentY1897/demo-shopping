'use client'

/**
 * An on/off toggle that takes effect immediately.
 *
 * A switch is not a checkbox: it commits the moment it moves, so it belongs to
 * settings rather than to a form that is submitted. Radix gives it
 * `role="switch"`, `aria-checked`, Space and Enter handling, and the hidden
 * input for the cases where it *is* inside a form.
 *
 * The track is 44px wide, so the control clears the touch floor horizontally
 * without help; `touch-target` on the button covers the vertical axis.
 */

import * as SwitchPrimitive from '@radix-ui/react-switch'
import type { ReactNode } from 'react'
import { useId } from 'react'

import { cx } from '../lib/cx'
import { FOCUS_RING } from '../lib/styles'

export interface SwitchProps {
  readonly checked?: boolean
  readonly defaultChecked?: boolean
  readonly onCheckedChange?: (checked: boolean) => void
  readonly disabled?: boolean
  readonly required?: boolean
  readonly name?: string
  readonly value?: string
  readonly id?: string
  readonly label?: ReactNode
  readonly description?: ReactNode
  readonly 'aria-label'?: string
  readonly 'aria-describedby'?: string
  readonly className?: string
}

export function Switch({
  checked,
  defaultChecked,
  onCheckedChange,
  disabled = false,
  required,
  name,
  value,
  id,
  label,
  description,
  className,
  ...aria
}: SwitchProps) {
  const generatedId = useId()
  const controlId = id ?? generatedId

  return (
    <div className={cx('flex items-center gap-2', className)}>
      <SwitchPrimitive.Root
        checked={checked}
        className={cx(
          'touch-target group inline-flex shrink-0 items-center justify-center rounded-md',
          FOCUS_RING,
          'disabled:cursor-not-allowed disabled:opacity-50',
        )}
        defaultChecked={defaultChecked}
        disabled={disabled}
        id={controlId}
        name={name}
        onCheckedChange={onCheckedChange}
        required={required}
        value={value}
        {...aria}
      >
        <span className="bg-border-strong group-data-[state=checked]:bg-primary flex h-6 w-11 items-center rounded-full p-0.5 transition-colors">
          <SwitchPrimitive.Thumb className="bg-surface block size-5 rounded-full shadow-xs transition-transform data-[state=checked]:translate-x-5" />
        </span>
      </SwitchPrimitive.Root>

      {label === undefined ? null : (
        <label
          className={cx(
            'text-fg flex cursor-pointer flex-col text-sm',
            disabled && 'cursor-not-allowed opacity-50',
          )}
          htmlFor={controlId}
        >
          <span>{label}</span>
          {description === undefined ? null : (
            <span className="text-fg-subtle text-xs">{description}</span>
          )}
        </label>
      )}
    </div>
  )
}
