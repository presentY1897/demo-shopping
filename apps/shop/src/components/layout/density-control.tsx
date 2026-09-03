'use client'

/**
 * Where the density toggle sits, and the one-time nudge towards it.
 *
 * The control itself is `DensityToggle` from `@shopping/ui/layout`; this file is
 * the *placement* decision, which is app-specific and viewport-dependent
 * (TASK-0018 4.3).
 *
 * | viewport | form |
 * | --- | --- |
 * | ~767 | one button showing the current step, opening a popover with labels |
 * | 768~ | the three steps laid out in the header, icon only, with tooltips |
 *
 * A phone header cannot spare 132px for three permanent controls — logo,
 * hamburger, cart and account already take 266 of a 360px screen — and a
 * tooltip is not readable on a device that cannot hover, which is why the
 * popover form shows the words.
 *
 * Only one of the two is ever mounted (D-055): `useViewportBand` decides, and
 * both forms are built to the same height so the swap at hydration cannot move
 * the page.
 */

import { IconButton, Popover } from '@shopping/ui/components'
import { useDensity, type DensityLevel } from '@shopping/ui/density'
import {
  DensityMaximalIcon,
  DensityMinimalIcon,
  DensityStandardIcon,
  DensityToggle,
  useViewportBand,
} from '@shopping/ui/layout'
import type { ComponentType } from 'react'

import type { DensityControlMessages } from '@/messages'

import { DensityHint } from './density-hint'

/** The trigger wears the step it would change — "현재 값 표시" (TASK-0018 2장). */
const STEP_ICONS: Readonly<Record<DensityLevel, ComponentType<{ readonly className?: string }>>> = {
  1: DensityMinimalIcon,
  2: DensityStandardIcon,
  3: DensityMaximalIcon,
}

export function DensityControl({ messages }: { readonly messages: DensityControlMessages }) {
  const compact = useViewportBand() === 'base'

  return (
    <div className="relative flex items-center">
      {compact ? <CompactControl messages={messages} /> : <WideControl messages={messages} />}
      <DensityHint messages={messages} />
    </div>
  )
}

function WideControl({ messages }: { readonly messages: DensityControlMessages }) {
  return <DensityToggle labels={messages.names} legend={messages.legend} />
}

function CompactControl({ messages }: { readonly messages: DensityControlMessages }) {
  const { density } = useDensity()
  const CurrentIcon = STEP_ICONS[density]

  return (
    <Popover
      align="end"
      title={messages.legend}
      trigger={
        // The current step's name is part of the button's own name, so a screen
        // reader user learns the value without opening the panel.
        <IconButton
          label={`${messages.openLabel} · ${messages.names[density]}`}
          size="sm"
          variant="ghost"
        >
          <CurrentIcon className="size-5" />
        </IconButton>
      }
    >
      <DensityToggle labels={messages.names} legend={messages.legend} showLabels />
    </Popover>
  )
}
