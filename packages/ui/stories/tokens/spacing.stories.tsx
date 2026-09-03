/**
 * Spacing, corner radius and elevation.
 *
 * `--spacing` is wired to Tailwind's spacing multiplier, so `p-4`, `gap-3` and
 * `size-10` all compile to `calc(var(--space-unit) * n)` — the entire utility
 * scale answers to the density step without a single component naming a
 * density. The bars below are the proof: they are drawn from the multiplier,
 * and their measured widths are read back off the page.
 */

import type { Meta, StoryObj } from '@storybook/react-vite'
import type { RefObject } from 'react'
import { useEffect, useRef, useState } from 'react'

import {
  collectCustomProperties,
  measureLength,
  rootDeclaredValues,
  rootTokenNames,
} from '../support/css-variables'
import { Mono, px, ReadAtRuntime, TokenPage, TokenSection, TokenTable } from '../support/docs-ui'

/** Multiples a layout actually reaches for. Not token values — steps on the scale. */
const MULTIPLES = [1, 2, 3, 4, 6, 8, 12, 16, 24] as const

interface Measured {
  readonly name: string
  readonly declared: string
  readonly measured: number | null
}

interface SpaceSnapshot {
  readonly unit: number | null
  readonly gutter: number | null
  readonly multiples: readonly { readonly step: number; readonly measured: number | null }[]
  readonly radii: readonly Measured[]
  readonly shadows: readonly Measured[]
}

function readSnapshot(host: HTMLElement): SpaceSnapshot {
  const rules = collectCustomProperties(host.ownerDocument)
  const declared = rootDeclaredValues(rules)

  /**
   * Tokens under a prefix that are actually lengths.
   *
   * `--radius-scale` shares the `--radius-` namespace and is a bare multiplier;
   * the browser rejects it as a size, so the measurement comes back empty and it
   * falls out here — without this page holding a list of which names are real.
   */
  const measuredTokens = (prefix: string): readonly Measured[] =>
    rootTokenNames(rules, prefix)
      .map((name) => ({
        declared: declared.get(name) ?? '',
        measured: measureLength(host, `var(${name})`),
        name,
      }))
      .filter((token) => token.measured !== null)

  return {
    gutter: measureLength(host, 'var(--space-gutter)'),
    multiples: MULTIPLES.map((step) => ({
      measured: measureLength(host, `calc(var(--spacing) * ${String(step)})`),
      step,
    })),
    radii: measuredTokens('--radius-'),
    shadows: rootTokenNames(rules, '--shadow-').map((name) => ({
      declared: declared.get(name) ?? '',
      measured: null,
      name,
    })),
    unit: measureLength(host, 'var(--spacing)'),
  }
}

function useSpaceSnapshot(
  density: unknown,
): [RefObject<HTMLDivElement | null>, SpaceSnapshot | null] {
  const hostRef = useRef<HTMLDivElement>(null)
  const [snapshot, setSnapshot] = useState<SpaceSnapshot | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (host !== null) setSnapshot(readSnapshot(host))
  }, [density])

  return [hostRef, snapshot]
}

function SpacingReference({ density }: { readonly density: string }) {
  const [hostRef, snapshot] = useSpaceSnapshot(density)

  return (
    <div ref={hostRef}>
      <TokenPage
        lead="One multiplier drives the whole utility scale. Corner radius has its own multiplier; shadows deliberately have none."
        source="packages/config/tailwind/tokens.css · density.css"
        title="Spacing, radius and elevation"
      >
        <ReadAtRuntime>
          Each length is measured off an element the browser laid out, at the density currently
          selected in the toolbar — <Mono>getBoundingClientRect</Mono> on a box sized with the token
          itself. Reading the custom property instead would return{' '}
          <Mono>calc(var(--space-unit) * 4)</Mono>, which is a declaration, not a size.
        </ReadAtRuntime>

        <TokenSection
          description="--space-unit is what every spacing utility multiplies. --space-gutter is the page edge, derived from it and stepped up per viewport band."
          title="The unit"
        >
          <TokenTable
            caption="Base lengths at the current density and viewport"
            headers={['token', 'measured']}
            rows={[
              {
                cells: [
                  <Mono key="n">--spacing</Mono>,
                  <Mono key="v">{px(snapshot?.unit ?? null)}</Mono>,
                ],
                key: 'unit',
              },
              {
                cells: [
                  <Mono key="n">--space-gutter</Mono>,
                  <Mono key="v">{px(snapshot?.gutter ?? null)}</Mono>,
                ],
                key: 'gutter',
              },
            ]}
          />
        </TokenSection>

        <TokenSection
          description="The steps a layout reaches for, drawn from the multiplier rather than from a list of lengths."
          title="Scale"
        >
          <TokenTable
            caption="Spacing multiples"
            headers={['utility', 'expression', 'measured', 'bar']}
            rows={(snapshot?.multiples ?? []).map((entry) => ({
              cells: [
                <Mono key="u">{`p-${String(entry.step)}`}</Mono>,
                <Mono key="e">{`calc(var(--spacing) * ${String(entry.step)})`}</Mono>,
                <Mono key="m">{px(entry.measured)}</Mono>,
                <span
                  className="bg-primary block h-3 rounded-xs"
                  key="bar"
                  style={{ inlineSize: `calc(var(--spacing) * ${String(entry.step)})` }}
                />,
              ],
              key: String(entry.step),
            }))}
          />
        </TokenSection>

        <TokenSection
          description="Corner softness is part of the density feel: minimal rounds generously, maximal barely at all. --radius-scale carries that."
          title="Radius"
        >
          <TokenTable
            caption={`Radius tokens · ${String(snapshot?.radii.length ?? 0)}`}
            headers={['token', 'declared', 'measured', 'sample']}
            rows={(snapshot?.radii ?? []).map((radius) => ({
              cells: [
                <Mono key="n">{radius.name}</Mono>,
                <Mono key="d">{radius.declared}</Mono>,
                <Mono key="m">{px(radius.measured)}</Mono>,
                <span
                  className="bg-surface-muted border-border block size-12 border"
                  key="s"
                  style={{ borderRadius: `var(${radius.name})` }}
                />,
              ],
              key: radius.name,
            }))}
          />
        </TokenSection>

        <TokenSection
          description="Tinted with the neutral hue rather than pure black, so a raised card does not look like it is sitting on a different page than the borders around it. Elevation does not scale with density."
          title="Elevation"
        >
          <TokenTable
            caption={`Shadow tokens · ${String(snapshot?.shadows.length ?? 0)}`}
            headers={['token', 'sample']}
            rows={(snapshot?.shadows ?? []).map((shadow) => ({
              cells: [
                <Mono key="n">{shadow.name}</Mono>,
                <span
                  className="bg-surface-raised block size-12 rounded-md"
                  key="s"
                  style={{ boxShadow: `var(${shadow.name})` }}
                />,
              ],
              key: shadow.name,
            }))}
          />
        </TokenSection>
      </TokenPage>
    </div>
  )
}

const meta = {
  title: 'Design tokens/Spacing',
  component: SpacingReference,
  parameters: { layout: 'padded' },
  render: (_args, context) => <SpacingReference density={String(context.globals.density)} />,
} satisfies Meta<typeof SpacingReference>

export default meta

type Story = StoryObj<typeof meta>

export const Reference: Story = { args: { density: '2' } }
