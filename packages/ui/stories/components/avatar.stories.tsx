/**
 * `Avatar` — an image with a text fallback.
 *
 * Radix tracks the image's load state and swaps in the fallback only once
 * loading has actually failed, so a slow avatar does not flash initials and then
 * replace them. `alt` is required and is also where the default initial comes
 * from, so an avatar cannot end up both unlabelled and blank.
 */

import type { Meta, StoryObj } from '@storybook/react-vite'

import { Avatar, AVATAR_SIZES } from '../../src/components'
import { Row, Specimen } from '../support/layout'

const meta = {
  title: 'Components/Avatar',
  component: Avatar,
  tags: ['autodocs'],
  args: { alt: 'Nari Store', size: 'md' },
  argTypes: {
    size: { control: 'inline-radio', options: [...AVATAR_SIZES] },
  },
} satisfies Meta<typeof Avatar>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Sizes: Story = {
  render: (args) => (
    <Row>
      {AVATAR_SIZES.map((size) => (
        <Specimen key={size} label={size}>
          <Avatar {...args} size={size} />
        </Specimen>
      ))}
    </Row>
  ),
}

/**
 * The fallback is the first *grapheme* of `alt`, not `alt[0]`: a name beginning
 * with an emoji or anything outside the BMP would be cut in half by indexing.
 */
export const Fallbacks: Story = {
  render: (args) => (
    <Row>
      <Specimen label="from alt">
        <Avatar {...args} alt="Nari Store" />
      </Specimen>
      <Specimen label="Hangul">
        <Avatar {...args} alt="나리 스토어" />
      </Specimen>
      <Specimen label="astral plane">
        <Avatar {...args} alt="🛍️ Store" />
      </Specimen>
      <Specimen label="explicit">
        <Avatar {...args} fallback="UI" />
      </Specimen>
    </Row>
  ),
}

/** A src that will never load, which is the case the fallback exists for. */
export const BrokenImage: Story = {
  args: { src: 'https://example.invalid/missing.png' },
}
