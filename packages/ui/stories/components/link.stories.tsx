/**
 * `Link` — a plain anchor with token styling.
 *
 * `packages/ui` must not depend on `next/link`: the moment it does, the package
 * stops rendering anywhere that is not a Next app — including this Storybook.
 * Client-side navigation belongs to the app, and `linkClassName()` is exported
 * for the app that supplies its own anchor and wants only the styling.
 */

import type { Meta, StoryObj } from '@storybook/react-vite'

import { Link, LINK_VARIANTS } from '../../src/components'
import { Row, Stack } from '../support/layout'

const meta = {
  title: 'Components/Link',
  component: Link,
  tags: ['autodocs'],
  args: {
    children: 'Shipping and returns',
    href: '#link',
    variant: 'default',
  },
  argTypes: {
    variant: { control: 'inline-radio', options: [...LINK_VARIANTS] },
  },
} satisfies Meta<typeof Link>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Variants: Story = {
  render: (args) => (
    <Row>
      {LINK_VARIANTS.map((variant) => (
        <Link {...args} key={variant} variant={variant}>
          {variant}
        </Link>
      ))}
    </Row>
  ),
}

/**
 * `external` sets `rel="noreferrer noopener"` with the target, because
 * `target="_blank"` on its own hands the opened page a reference back to this
 * one. `externalLabel` is announced after the link text and comes from the
 * app's catalog — a warning in the wrong language is worse than none.
 */
export const External: Story = {
  args: {
    children: 'WAI-ARIA Authoring Practices',
    external: true,
    externalLabel: '(opens in a new tab)',
    href: 'https://www.w3.org/WAI/ARIA/apg/',
    variant: 'standalone',
  },
}

/** A link inside a sentence keeps the line box: WCAG 2.5.8 exempts it from the touch floor. */
export const InProse: Story = {
  render: (args) => (
    <Stack>
      <p className="max-w-96 text-sm">
        Orders are split per seller, so a single checkout can produce several shipments. The{' '}
        <Link {...args} href="#link">
          delivery policy
        </Link>{' '}
        explains how each one is tracked.
      </p>
    </Stack>
  ),
}
