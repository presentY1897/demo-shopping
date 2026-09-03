/**
 * `IconButton` — a button whose content is a glyph.
 *
 * `label` is a required prop, not an optional one. An icon button with no
 * accessible name is the most common accessibility defect in a component
 * library, and the compiler asking for the name is the only fix that survives
 * `aria-label={someVariable}`.
 */

import type { Meta, StoryObj } from '@storybook/react-vite'

import {
  CheckIcon,
  ChevronDownIcon,
  CloseIcon,
  IconButton,
  ICON_BUTTON_SIZES,
  ICON_BUTTON_VARIANTS,
  MinusIcon,
} from '../../src/components'
import { Row, Specimen } from '../support/layout'

const meta = {
  title: 'Components/IconButton',
  component: IconButton,
  tags: ['autodocs'],
  args: {
    label: 'Close',
    children: <CloseIcon className="size-4" />,
    variant: 'ghost',
    size: 'md',
  },
  argTypes: {
    variant: { control: 'inline-radio', options: [...ICON_BUTTON_VARIANTS] },
    size: { control: 'inline-radio', options: [...ICON_BUTTON_SIZES] },
  },
} satisfies Meta<typeof IconButton>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Variants: Story = {
  render: (args) => (
    <Row>
      {ICON_BUTTON_VARIANTS.map((variant) => (
        <Specimen key={variant} label={variant}>
          <IconButton {...args} variant={variant} />
        </Specimen>
      ))}
    </Row>
  ),
}

/**
 * `size-control-*` is already at or above the touch floor at every density, and
 * `touch-target` restates the floor so a future smaller glyph cannot fall
 * through it.
 */
export const Sizes: Story = {
  render: (args) => (
    <Row>
      {ICON_BUTTON_SIZES.map((size) => (
        <Specimen key={size} label={size}>
          <IconButton {...args} size={size} />
        </Specimen>
      ))}
    </Row>
  ),
}

export const States: Story = {
  render: (args) => (
    <Row>
      <Specimen label="idle">
        <IconButton {...args} variant="outline" />
      </Specimen>
      <Specimen label="disabled">
        <IconButton {...args} disabled variant="outline" />
      </Specimen>
      <Specimen label="loading">
        <IconButton {...args} loading variant="outline" />
      </Specimen>
    </Row>
  ),
}

/** The four glyphs the base set ships. Domain icons belong to the apps. */
export const Glyphs: Story = {
  render: (args) => (
    <Row>
      <Specimen label="CheckIcon">
        <IconButton {...args} label="Confirm" variant="outline">
          <CheckIcon className="size-4" />
        </IconButton>
      </Specimen>
      <Specimen label="MinusIcon">
        <IconButton {...args} label="Remove" variant="outline">
          <MinusIcon className="size-4" />
        </IconButton>
      </Specimen>
      <Specimen label="ChevronDownIcon">
        <IconButton {...args} label="Expand" variant="outline">
          <ChevronDownIcon className="size-4" />
        </IconButton>
      </Specimen>
      <Specimen label="CloseIcon">
        <IconButton {...args} label="Close" variant="outline">
          <CloseIcon className="size-4" />
        </IconButton>
      </Specimen>
    </Row>
  ),
}
