/**
 * `Card` and `Grid`, as far as jsdom can see them — which is the semantics, not
 * the geometry.
 *
 * The layout claims these two components make (the column matrix, the container
 * query) are made in CSS and are asserted against the real compiled stylesheet
 * in `test/grid-columns.spec.tsx` and `test/container-query.spec.tsx`. There is
 * no layout engine here, so anything this file said about pixels would be a
 * restatement of the source rather than an observation.
 */

import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Card } from './card'
import { Grid } from './grid'

describe('Card', () => {
  it('renders its media, body and actions', () => {
    render(
      <Card
        actions={<button type="button">Buy</button>}
        media={<span role="img" aria-label="Wool coat photo" />}
      >
        <p>Wool coat</p>
      </Card>,
    )

    expect(screen.getByRole('img', { name: 'Wool coat photo' })).toBeInTheDocument()
    expect(screen.getByText('Wool coat')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Buy' })).toBeInTheDocument()
  })

  it('omits the media and action wrappers when there is nothing to put in them', () => {
    const { container } = render(<Card>Body only</Card>)

    // One layout row with a single child: an empty wrapper would still take the
    // gap and leave a card that looks mis-padded next to one that has media.
    expect(container.querySelector('div > div')?.children).toHaveLength(1)
  })

  it('can be a list item', () => {
    render(
      <ul>
        <Card as="li">Wool coat</Card>
      </ul>,
    )

    expect(screen.getByRole('listitem')).toHaveTextContent('Wool coat')
  })
})

describe('Grid', () => {
  it('renders its children', () => {
    render(
      <Grid>
        <p>One</p>
        <p>Two</p>
      </Grid>,
    )

    expect(screen.getByText('One')).toBeVisible()
    expect(screen.getByText('Two')).toBeVisible()
  })

  it('stays a list for a screen reader once the markers are stripped', () => {
    // Tailwind's preflight removes the marker, and Safari then stops announcing
    // the element as a list. Restating the role is the documented fix.
    render(
      <Grid as="ul">
        <Card as="li">Wool coat</Card>
        <Card as="li">Linen shirt</Card>
      </Grid>,
    )

    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(2)
  })

  it('is not a list when it is a plain grid', () => {
    render(
      <Grid>
        <p>One</p>
      </Grid>,
    )

    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })
})
