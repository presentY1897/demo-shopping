/**
 * `DataList` — **the four states**, which is what TASK-0104 F4 was waiting for.
 *
 * That gate asked for loading / empty / error / ready stories and could not be
 * met, because in TASK-0015 there was no component that had four states. This is
 * that component, and these are those stories.
 *
 * `loading`, `empty` and `error` are required props with no defaults. Forgetting
 * the empty branch — the one nobody sees while the seed data is loaded — does
 * not compile.
 */

import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'

import {
  Button,
  Card,
  DataList,
  DATA_LIST_STATES,
  EmptyState,
  ErrorState,
  Grid,
  Skeleton,
  type DataListState,
} from '../../src/components'
import { Row, Specimen, Stack } from '../support/layout'

const PRODUCTS = ['Wool coat', 'Linen shirt', 'Denim trousers', 'Leather belt']

function Products() {
  return (
    <Grid as="ul">
      {PRODUCTS.map((name) => (
        <Card as="li" key={name}>
          <p className="text-fg text-sm font-medium">{name}</p>
          <p className="text-fg-muted text-xs">₩120,000</p>
        </Card>
      ))}
    </Grid>
  )
}

/** The three non-`ready` branches, composed the way a real screen composes them. */
const SLOTS = {
  empty: (
    <EmptyState
      action={<Button variant="outline">Clear filters</Button>}
      description="No product matches the filters you selected."
      title="No results"
    />
  ),
  error: (
    <ErrorState
      description="The server did not answer in time."
      detail="req_01H9Z8QYV3"
      onRetry={() => undefined}
      retryLabel="Try again"
      title="Could not load products"
    />
  ),
  loading: (
    <Grid>
      {[0, 1, 2, 3].map((index) => (
        <Skeleton key={index} label={index === 0 ? 'Loading products' : undefined} lines={3} />
      ))}
    </Grid>
  ),
}

const meta = {
  title: 'Components/DataList',
  component: DataList,
  tags: ['autodocs'],
  args: { ...SLOTS, children: <Products />, state: 'ready' },
  argTypes: {
    state: { control: 'inline-radio', options: [...DATA_LIST_STATES] },
  },
} satisfies Meta<typeof DataList>

export default meta

type Story = StoryObj<typeof meta>

/** A list with rows in it. */
export const Ready: Story = {}

/** `aria-busy` is set while this branch is up, and the placeholder is the shape of the rows. */
export const Loading: Story = { args: { state: 'loading' } }

/** Polite: the reader filtered something away and needs to be told. */
export const Empty: Story = { args: { state: 'empty' } }

/** Assertive, with a way out. Not an empty list — that would read as "nothing found". */
export const Error: Story = { args: { state: 'error' } }

/** All four beside each other, which is the comparison a screenshot of one cannot make. */
export const FourStates: Story = {
  render: (args) => (
    <Stack>
      {DATA_LIST_STATES.map((state) => (
        <Specimen key={state} label={state}>
          <DataList {...args} state={state} />
        </Specimen>
      ))}
    </Stack>
  ),
}

function StateSwitcher(args: React.ComponentProps<typeof DataList>) {
  const [state, setState] = useState<DataListState>('loading')

  return (
    <Stack>
      <Row>
        {DATA_LIST_STATES.map((next) => (
          <Button
            key={next}
            onClick={() => {
              setState(next)
            }}
            size="sm"
            variant={state === next ? 'primary' : 'outline'}
          >
            {next}
          </Button>
        ))}
      </Row>
      <DataList {...args} state={state} />
    </Stack>
  )
}

/**
 * The transition, driven by hand. Loading → ready must not flash the empty
 * state on the way through, and an error must not look like an empty list.
 */
export const Switcher: Story = {
  render: (args) => <StateSwitcher {...args} />,
}
