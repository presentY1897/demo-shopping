/**
 * `Grid` — the product grid, with the column count coming from the density ×
 * viewport matrix.
 *
 * `docs/design/pages.md` defines nine cells: three density steps crossed with
 * three viewport bands. Writing them as `grid-cols-1 md:grid-cols-2
 * xl:grid-cols-3` would mean writing that triple out once per step and keeping
 * three copies in step with the CSS, so the matrix lives in `density.css` as
 * `--density-cols` and this is one class that reads it.
 *
 * Switch the density toolbar and resize the canvas: the same `<Grid>` goes
 * 1 / 2 / 3 columns at minimal and 2 / 4 / 6 at maximal, with nothing re-rendered
 * and no JavaScript involved. The exact numbers are documented on the
 * **Design tokens › Density** page, which measures them in three real viewports.
 */

import type { Meta, StoryObj } from '@storybook/react-vite'

import { Card, Grid, GRID_COLUMNS, GRID_GAPS } from '../../src/components'
import { Specimen, Stack } from '../support/layout'

const PRODUCTS = [
  'Wool overcoat',
  'Linen shirt',
  'Denim trousers',
  'Leather belt',
  'Cashmere scarf',
  'Canvas tote',
]

function Tile({ name }: { readonly name: string }) {
  return (
    <Card as="li" variant="outline">
      <div
        aria-hidden="true"
        className="bg-surface-muted text-fg-subtle flex aspect-square w-full items-center justify-center text-xs"
      >
        image
      </div>
      <p className="text-fg text-sm font-medium">{name}</p>
    </Card>
  )
}

const meta = {
  title: 'Components/Grid',
  component: Grid,
  tags: ['autodocs'],
  args: {
    as: 'ul',
    children: PRODUCTS.map((name) => <Tile key={name} name={name} />),
    columns: 'density',
    gap: 'md',
  },
  argTypes: {
    columns: { control: 'select', options: [...GRID_COLUMNS] },
    gap: { control: 'inline-radio', options: [...GRID_GAPS] },
  },
} satisfies Meta<typeof Grid>

export default meta

type Story = StoryObj<typeof meta>

/** The matrix. Change the density toolbar and the canvas width. */
export const DensityMatrix: Story = {}

/** A fixed count, for a console screen that pins itself to density 2. */
export const FixedColumns: Story = {
  render: (args) => (
    <Stack>
      {([1, 2, 3, 4] as const).map((columns) => (
        <Specimen key={columns} label={`${String(columns)} columns`}>
          <Grid {...args} columns={columns}>
            {PRODUCTS.slice(0, columns).map((name) => (
              <Tile key={name} name={name} />
            ))}
          </Grid>
        </Specimen>
      ))}
    </Stack>
  ),
}

/** Gaps are `--space-unit` multiples, so the gutter narrows with the step too. */
export const Gaps: Story = {
  render: (args) => (
    <Stack>
      {GRID_GAPS.map((gap) => (
        <Specimen key={gap} label={gap}>
          <Grid {...args} columns={3} gap={gap}>
            {PRODUCTS.slice(0, 3).map((name) => (
              <Tile key={name} name={name} />
            ))}
          </Grid>
        </Specimen>
      ))}
    </Stack>
  ),
}

/** A grid holding one item, and a plain (non-list) grid. */
export const EdgeCases: Story = {
  render: (args) => (
    <Stack>
      <Specimen label="one item">
        <Grid {...args}>
          <Tile name={PRODUCTS[0] ?? ''} />
        </Grid>
      </Specimen>
      <Specimen label="not a list">
        <Grid as="div" columns={2}>
          <p className="text-fg text-sm">Any content</p>
          <p className="text-fg text-sm">Any content</p>
        </Grid>
      </Specimen>
    </Stack>
  ),
}
