/**
 * `DensityToggle` — the control this design system exists for.
 *
 * The tokens, the boot script and the store all arrived in TASK-0014; until
 * TASK-0018 nothing on screen let a shopper change the value, which made the
 * headline feature of the storefront reachable only from devtools.
 *
 * **Clicking a step here really does change the page.** It writes
 * `<html data-density>` and localStorage exactly as it does in `apps/shop`, so
 * the surrounding story canvas re-renders at the step you picked and the choice
 * survives a reload of this Storybook. The Density toolbar above writes the same
 * attribute; the two are the same setting seen from two places.
 *
 * It is a radio group, not three buttons: the group is a single tab stop and the
 * arrows move between steps, which is what a header can afford.
 */

import type { Meta, StoryObj } from '@storybook/react-vite'

import { DensityProvider } from '../../src/density'
import { DensityToggle } from '../../src/layout'
import { Stack } from '../support/layout'

/**
 * English, because Storybook's chrome is. In the app these come from
 * `apps/shop/src/messages/ko.ts` — `packages/ui` contains no Korean.
 */
const LABELS = { 1: 'minimal', 2: 'standard', 3: 'maximal' } as const

const meta = {
  title: 'Components/DensityToggle',
  component: DensityToggle,
  tags: ['autodocs'],
  args: {
    labels: LABELS,
    legend: 'Display density',
  },
  decorators: [
    (Story) => (
      <DensityProvider>
        <Story />
      </DensityProvider>
    ),
  ],
} satisfies Meta<typeof DensityToggle>

export default meta

type Story = StoryObj<typeof meta>

/** The header form: icon only, with the label as a tooltip and as the ARIA name. */
export const IconOnly: Story = {}

/** The popover and settings form, where the words fit and hover is not available. */
export const WithLabels: Story = {
  args: { showLabels: true },
}

/** With the group's name on screen — a settings screen rather than a header. */
export const VisibleLegend: Story = {
  args: { legendHidden: false, showLabels: true },
}

/**
 * What the toggle is *for*: the same markup, at the step it selects. The blocks
 * below are padded and rounded entirely by tokens, so they move with the choice.
 */
export const WhatItChanges: Story = {
  render: (args) => (
    <Stack>
      <DensityToggle {...args} />
      <div className="bg-surface-muted flex flex-col gap-3 rounded-lg p-4">
        <p className="text-base">Spacing, type scale and radius all move together</p>
        <div className="flex gap-3">
          <span className="bg-surface-raised rounded-md px-4 py-2 text-sm">chip</span>
          <span className="bg-surface-raised rounded-md px-4 py-2 text-sm">chip</span>
          <span className="bg-surface-raised rounded-md px-4 py-2 text-sm">chip</span>
        </div>
      </div>
    </Stack>
  ),
}
