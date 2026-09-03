'use client'

/**
 * Tabbed panels.
 *
 * Radix implements the WAI-ARIA tabs pattern: the list is one tab stop, arrow
 * keys move between tabs, Home and End jump to the ends, and each panel is tied
 * to its tab with `aria-controls` / `aria-labelledby`. `activationMode`
 * decides whether an arrow key switches the panel immediately or only marks the
 * tab until Enter — "manual" is the right choice when a panel loads data.
 *
 * The tabs are an array prop rather than composed children so that a story can
 * enumerate them (TASK-0104) and so a tab and its panel cannot drift apart.
 */

import * as TabsPrimitive from '@radix-ui/react-tabs'
import type { ReactNode } from 'react'

import { cx } from '../lib/cx'
import { FOCUS_RING } from '../lib/styles'

export const TABS_ORIENTATIONS = ['horizontal', 'vertical'] as const
export type TabsOrientation = (typeof TABS_ORIENTATIONS)[number]

export const TABS_ACTIVATION_MODES = ['automatic', 'manual'] as const
export type TabsActivationMode = (typeof TABS_ACTIVATION_MODES)[number]

export interface TabItem {
  readonly value: string
  readonly label: ReactNode
  readonly content: ReactNode
  readonly disabled?: boolean
}

export interface TabsProps {
  readonly items: readonly TabItem[]
  readonly value?: string
  readonly defaultValue?: string
  readonly onValueChange?: (value: string) => void
  readonly orientation?: TabsOrientation
  readonly activationMode?: TabsActivationMode
  readonly 'aria-label'?: string
  readonly className?: string
}

export function Tabs({
  items,
  value,
  defaultValue,
  onValueChange,
  orientation = 'horizontal',
  activationMode = 'automatic',
  className,
  ...aria
}: TabsProps) {
  const horizontal = orientation === 'horizontal'

  return (
    <TabsPrimitive.Root
      activationMode={activationMode}
      className={cx('flex', horizontal ? 'flex-col' : 'flex-row gap-4', className)}
      defaultValue={defaultValue ?? items[0]?.value}
      onValueChange={onValueChange}
      orientation={orientation}
      value={value}
    >
      <TabsPrimitive.List
        className={cx(
          'border-border flex',
          horizontal ? 'flex-row border-b' : 'shrink-0 flex-col border-r',
        )}
        {...aria}
      >
        {items.map((item) => (
          <TabsPrimitive.Trigger
            className={cx(
              'text-fg-muted min-h-touch flex items-center justify-center px-4 text-sm font-medium transition-colors',
              FOCUS_RING,
              'data-[state=active]:text-primary data-[state=active]:border-primary',
              horizontal
                ? '-mb-px border-b-2 border-transparent'
                : '-mr-px border-r-2 border-transparent',
              'hover:text-fg disabled:cursor-not-allowed disabled:opacity-50',
            )}
            disabled={item.disabled}
            key={item.value}
            value={item.value}
          >
            {item.label}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>

      {items.map((item) => (
        <TabsPrimitive.Content
          className={cx('text-fg flex-1 text-sm', horizontal ? 'pt-4' : 'pt-0')}
          key={item.value}
          value={item.value}
        >
          {item.content}
        </TabsPrimitive.Content>
      ))}
    </TabsPrimitive.Root>
  )
}
