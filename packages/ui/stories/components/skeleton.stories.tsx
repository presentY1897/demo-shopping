/**
 * `Skeleton` — the shape of the content that is coming.
 *
 * A spinner says "wait"; a skeleton says "wait, and here is where the three
 * lines and the thumbnail will be". The second one does not move the page when
 * the data lands, which is the difference between a good CLS score and a bad one.
 */

import type { Meta, StoryObj } from '@storybook/react-vite'

import { Skeleton, SKELETON_SHAPES } from '../../src/components'
import { Specimen, Stack } from '../support/layout'

const meta = {
  title: 'Components/Skeleton',
  component: Skeleton,
  tags: ['autodocs'],
  args: { lines: 3, shape: 'text' },
  argTypes: {
    shape: { control: 'inline-radio', options: [...SKELETON_SHAPES] },
  },
} satisfies Meta<typeof Skeleton>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

/** Enumerated from `SKELETON_SHAPES`, so a new shape documents itself. */
export const Shapes: Story = {
  render: (args) => (
    <Stack>
      {SKELETON_SHAPES.map((shape) => (
        <Specimen key={shape} label={shape}>
          <Skeleton {...args} shape={shape} />
        </Specimen>
      ))}
    </Stack>
  ),
}

/**
 * The last line of a paragraph is short. Without that, a text skeleton reads as
 * a solid grey block rather than as copy.
 */
export const Paragraph: Story = {
  args: { lines: 5 },
}

/**
 * The placeholder is `aria-hidden` — grey rectangles are not information. When
 * the wait itself needs announcing, `label` renders a polite live region beside
 * it. The text comes from the app; this package has no copy.
 */
export const Announced: Story = {
  args: { label: 'Loading orders' },
}

/** A product card's placeholder: image, two lines of title, a price. */
export const CardPlaceholder: Story = {
  render: () => (
    <div className="border-border flex max-w-96 flex-col gap-3 rounded-lg border p-4">
      <Skeleton shape="block" />
      <Skeleton lines={2} />
      <Skeleton shape="circle" />
    </div>
  ),
}
