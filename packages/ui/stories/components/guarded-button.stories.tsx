/**
 * `GuardedButton` — the action you may not take, shown rather than hidden.
 *
 * Blocked is `aria-disabled`, not `disabled`, so the control stays in the tab
 * order and the reason is reachable by keyboard. The sentence is in the DOM
 * (`aria-describedby`) as well as in the tooltip, because a tooltip never
 * appears on touch and is not read in forms mode.
 */

import type { Meta, StoryObj } from '@storybook/react-vite'

import { GuardedButton } from '../../src/components'

const meta = {
  title: 'Components/GuardedButton',
  component: GuardedButton,
  tags: ['autodocs'],
  args: { children: 'Delete category' },
} satisfies Meta<typeof GuardedButton>

export default meta

type Story = StoryObj<typeof meta>

/** Nothing blocks it, so it is an ordinary `Button`. */
export const Allowed: Story = {
  args: { variant: 'danger' },
}

/** The role does not hold the permission at all. */
export const Blocked: Story = {
  args: {
    blocked: true,
    reason: 'This role cannot delete categories.',
    variant: 'danger',
  },
}

/** The role holds it, but not for this row — the other half of a denial. */
export const BlockedByScope: Story = {
  args: {
    blocked: true,
    reason: 'This row belongs to another store.',
    variant: 'outline',
  },
}

/** The hint follows the control's own placement. */
export const ReasonBelow: Story = {
  args: {
    blocked: true,
    reason: 'Only the platform owner may approve a payout.',
    reasonSide: 'bottom',
    children: 'Approve payout',
  },
}
