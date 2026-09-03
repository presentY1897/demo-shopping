/**
 * `Button` — variants, sizes, and the two states that are easy to get wrong.
 */

import type { Meta, StoryObj } from '@storybook/react-vite'

import { Button, BUTTON_SIZES, BUTTON_VARIANTS } from '../../src/components'
import { Row, Stack } from '../support/layout'

const meta = {
  title: 'Components/Button',
  component: Button,
  tags: ['autodocs'],
  args: {
    children: 'Place order',
    variant: 'primary',
    size: 'md',
  },
  argTypes: {
    variant: { control: 'inline-radio', options: [...BUTTON_VARIANTS] },
    size: { control: 'inline-radio', options: [...BUTTON_SIZES] },
  },
} satisfies Meta<typeof Button>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

/**
 * The variants are enumerated from `BUTTON_VARIANTS`, not typed out. A variant
 * added to the component appears here without anyone editing the story — which
 * is the difference between documentation and a second implementation.
 */
export const Variants: Story = {
  render: (args) => (
    <Row>
      {BUTTON_VARIANTS.map((variant) => (
        <Button {...args} key={variant} variant={variant}>
          {variant}
        </Button>
      ))}
    </Row>
  ),
}

/**
 * Heights come from `--spacing-control-*`, whose `max(--touch-min, …)` holds
 * every size at or above the 44px floor at every density step. Switch the
 * density toolbar to maximal: the padding shrinks and the height does not.
 */
export const Sizes: Story = {
  render: (args) => (
    <Row>
      {BUTTON_SIZES.map((size) => (
        <Button {...args} key={size} size={size}>
          {size}
        </Button>
      ))}
    </Row>
  ),
}

/**
 * `loading` is not `disabled`.
 *
 * A natively disabled element leaves the tab order, so a keyboard user's focus
 * is thrown to the top of the document the moment a submit button starts
 * working. The loading button stays focusable, announces `aria-busy`, and
 * refuses the click.
 */
export const States: Story = {
  render: (args) => (
    <Row>
      <Button {...args}>Idle</Button>
      <Button {...args} disabled>
        Disabled
      </Button>
      <Button {...args} loading>
        Loading
      </Button>
    </Row>
  ),
}

/** Full width, for the bottom of a mobile sheet. */
export const FullWidth: Story = {
  args: { fullWidth: true },
}

/**
 * Edge cases: a label longer than the button, and a label of one character.
 * Neither may push the control below the touch floor or wrap into an unreadable
 * shape.
 */
export const EdgeCases: Story = {
  render: (args) => (
    <Stack>
      <div className="max-w-96">
        <Button {...args} fullWidth>
          A label long enough to prove the control grows with its content instead of clipping it
        </Button>
      </div>
      <Row>
        <Button {...args}>1</Button>
        <Button {...args} size="sm">
          1
        </Button>
      </Row>
    </Stack>
  ),
}
