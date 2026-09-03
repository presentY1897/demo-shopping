/**
 * `Card` — the component that proves the container query.
 *
 * Every story below renders **the same card** at three widths *in one viewport*.
 * A media query cannot tell them apart: the window is one width, so a
 * `md:flex-row` card would lay the 200px one out exactly like the 1200px one.
 * The card asks about itself instead (`@container/card`), so the narrow copy
 * stacks and the wide copy goes side by side, at the same instant, on the same
 * screen.
 *
 * `test/container-query.spec.tsx` compiles these class names and fails if any of
 * them turns back into a `@media` rule.
 */

import type { Meta, StoryObj } from '@storybook/react-vite'

import { Badge, Button, Card, CARD_VARIANTS, Grid } from '../../src/components'
import { formatMoney } from '../../src/format'
import { Specimen, Stack } from '../support/layout'

function Thumbnail() {
  return (
    <div
      aria-hidden="true"
      className="bg-surface-muted text-fg-subtle flex aspect-square w-full items-center justify-center text-xs"
    >
      image
    </div>
  )
}

function Body() {
  return (
    <>
      <p className="text-fg text-sm font-medium">Wool blend overcoat</p>
      <p className="text-fg-muted text-xs">Studio Meridian</p>
      <p className="text-fg text-sm tabular-nums">
        {formatMoney({ amount: 249000, currency: 'KRW' }, { locale: 'ko-KR' })}
      </p>
      <Badge size="sm" variant="success">
        Free delivery
      </Badge>
    </>
  )
}

const meta = {
  title: 'Components/Card',
  component: Card,
  tags: ['autodocs'],
  args: {
    children: <Body />,
    media: <Thumbnail />,
    variant: 'raised',
  },
  argTypes: {
    variant: { control: 'inline-radio', options: [...CARD_VARIANTS] },
  },
} satisfies Meta<typeof Card>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Variants: Story = {
  render: (args) => (
    <Stack>
      {CARD_VARIANTS.map((variant) => (
        <Specimen key={variant} label={variant}>
          <Card {...args} variant={variant} />
        </Specimen>
      ))}
    </Stack>
  ),
}

/**
 * **The demonstration.** One viewport, three card widths, three layouts. Narrow
 * stacks the thumbnail above the body; wide puts it beside. Nothing here reads
 * the window.
 */
export const RespondsToItsOwnWidth: Story = {
  render: (args) => (
    <Stack>
      <Specimen label="narrow — stacked">
        <div className="w-64">
          <Card {...args} />
        </div>
      </Specimen>
      <Specimen label="medium — stacked">
        <div className="w-96">
          <Card {...args} />
        </div>
      </Specimen>
      <Specimen label="wide — side by side">
        <div className="w-full">
          <Card {...args} />
        </div>
      </Specimen>
    </Stack>
  ),
}

/**
 * The same card in a one-column and a four-column grid. This is the case a
 * breakpoint cannot serve: both grids are on the same page at the same window
 * width.
 */
export const InAGrid: Story = {
  render: (args) => (
    <Stack>
      <Specimen label="1 column">
        <Grid as="ul" columns={1}>
          <Card {...args} as="li" />
        </Grid>
      </Specimen>
      <Specimen label="4 columns">
        <Grid as="ul" columns={4}>
          {[0, 1, 2, 3].map((index) => (
            <Card {...args} as="li" key={index} />
          ))}
        </Grid>
      </Specimen>
    </Stack>
  ),
}

/** Actions sit under the body when the card is narrow and beside it when wide. */
export const WithActions: Story = {
  args: {
    actions: (
      <>
        <Button size="sm">Add to cart</Button>
        <Button size="sm" variant="ghost">
          Save
        </Button>
      </>
    ),
  },
}

export const EdgeCases: Story = {
  render: (args) => (
    <Stack>
      <Specimen label="no media">
        <Card {...args} media={undefined} />
      </Specimen>
      <Specimen label="long unbroken text">
        <div className="w-64">
          <Card {...args}>
            <p className="text-fg truncate text-sm">
              StudioMeridianWoolBlendOvercoatLongProductNameWithNoSpaces
            </p>
          </Card>
        </div>
      </Specimen>
    </Stack>
  ),
}
