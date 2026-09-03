/**
 * The quiet parts of a page shell: the width the content sits in, the link that
 * skips past the header, and the three glyphs the density toggle wears.
 *
 * `PageContainer` is the single definition of "how wide is a page and how far
 * from the edge" — the gutter is `--space-gutter`, a density token that runs
 * from 14px to 48px depending on step and viewport, so the whole shell breathes
 * with the shopper's choice.
 *
 * `SkipLink` is invisible until it is focused. Tab into the canvas below and it
 * appears; that is the entire component, and it is the difference between
 * reaching a storefront's content with a keyboard in one keystroke and in ten.
 */

import type { Meta, StoryObj } from '@storybook/react-vite'

import {
  DensityMaximalIcon,
  DensityMinimalIcon,
  DensityStandardIcon,
  PageContainer,
  SkipLink,
} from '../../src/layout'
import { Row, Specimen, Stack } from '../support/layout'

function Shell() {
  return (
    <Stack>
      <SkipLink href="#story-main">Skip to content</SkipLink>

      <PageContainer className="bg-surface-muted py-4" width="wide">
        <p className="text-sm" id="story-main">
          PageContainer · wide — the storefront default
        </p>
      </PageContainer>

      <PageContainer className="bg-surface-muted py-4" width="narrow">
        <p className="text-sm">PageContainer · narrow — forms and prose</p>
      </PageContainer>

      <Row>
        <Specimen label="DensityMinimalIcon">
          <DensityMinimalIcon className="size-6" />
        </Specimen>
        <Specimen label="DensityStandardIcon">
          <DensityStandardIcon className="size-6" />
        </Specimen>
        <Specimen label="DensityMaximalIcon">
          <DensityMaximalIcon className="size-6" />
        </Specimen>
      </Row>
    </Stack>
  )
}

const meta = {
  title: 'Components/AppShell',
  component: Shell,
  tags: ['autodocs'],
} satisfies Meta<typeof Shell>

export default meta

type Story = StoryObj<typeof meta>

export const Pieces: Story = {}
