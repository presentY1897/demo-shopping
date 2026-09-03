/**
 * `Badge` — a non-interactive status label.
 *
 * Text is `--color-fg` on the tinted surfaces rather than the accent colour on
 * white: every one of those pairs is held at 4.5:1 by `color-tokens.spec.ts`,
 * and an accent-on-tint pair would be the one combination nothing checks.
 */

import type { Meta, StoryObj } from '@storybook/react-vite'

import { Badge, BADGE_SIZES, BADGE_VARIANTS } from '../../src/components'
import { Row, Specimen } from '../support/layout'

const meta = {
  title: 'Components/Badge',
  component: Badge,
  tags: ['autodocs'],
  args: { children: 'On sale', size: 'md', variant: 'neutral' },
  argTypes: {
    variant: { control: 'inline-radio', options: [...BADGE_VARIANTS] },
    size: { control: 'inline-radio', options: [...BADGE_SIZES] },
  },
} satisfies Meta<typeof Badge>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Variants: Story = {
  render: (args) => (
    <Row>
      {BADGE_VARIANTS.map((variant) => (
        <Badge {...args} key={variant} variant={variant}>
          {variant}
        </Badge>
      ))}
    </Row>
  ),
}

export const Sizes: Story = {
  render: (args) => (
    <Row>
      {BADGE_SIZES.map((size) => (
        <Specimen key={size} label={size}>
          <Badge {...args} size={size}>
            Shipped
          </Badge>
        </Specimen>
      ))}
    </Row>
  ),
}

/** A long label must not wrap into two lines inside a pill. */
export const EdgeCases: Story = {
  render: (args) => (
    <div className="flex max-w-96 flex-wrap gap-2">
      <Badge {...args}>1</Badge>
      <Badge {...args} variant="warning">
        Awaiting settlement for the previous billing period
      </Badge>
    </div>
  ),
}
