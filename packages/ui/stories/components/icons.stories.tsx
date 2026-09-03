/**
 * The glyphs `packages/ui` ships.
 *
 * Inline rather than an icon package: these are the only icons the base
 * components need, and a dependency that ships a thousand of them to deliver a
 * handful is a bundle cost every app pays. Domain icons are the apps' business —
 * which is why `EmptyState` and `ErrorState` take their illustration as a prop.
 *
 * Every path is stroked in `currentColor`, so an icon inherits whatever text
 * colour the control around it resolved from the token layer — which is why the
 * row below changes colour with the surrounding text and not with a prop.
 */

import type { Meta, StoryObj } from '@storybook/react-vite'

import {
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  MinusIcon,
} from '../../src/components'
import { Row, Specimen, Stack } from '../support/layout'

const GLYPHS = [
  { Glyph: CheckIcon, name: 'CheckIcon' },
  { Glyph: MinusIcon, name: 'MinusIcon' },
  { Glyph: ChevronDownIcon, name: 'ChevronDownIcon' },
  { Glyph: ChevronLeftIcon, name: 'ChevronLeftIcon' },
  { Glyph: ChevronRightIcon, name: 'ChevronRightIcon' },
  { Glyph: CloseIcon, name: 'CloseIcon' },
] as const

function IconSet() {
  return (
    <Stack>
      <Row>
        {GLYPHS.map(({ Glyph, name }) => (
          <Specimen key={name} label={name}>
            <Glyph className="size-6" />
          </Specimen>
        ))}
      </Row>

      <div className="text-primary">
        <Row>
          {GLYPHS.map(({ Glyph, name }) => (
            <Glyph className="size-6" key={name} />
          ))}
          <span className="text-sm">inherits the surrounding colour</span>
        </Row>
      </div>

      <div className="text-danger">
        <Row>
          {GLYPHS.map(({ Glyph, name }) => (
            <Glyph className="size-4" key={name} />
          ))}
          <span className="text-sm">and the surrounding size utility</span>
        </Row>
      </div>
    </Stack>
  )
}

const meta = {
  title: 'Components/Icons',
  component: IconSet,
  tags: ['autodocs'],
} satisfies Meta<typeof IconSet>

export default meta

type Story = StoryObj<typeof meta>

export const Glyphset: Story = {}
