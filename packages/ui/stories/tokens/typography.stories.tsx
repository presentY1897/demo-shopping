/**
 * The type scale, measured at whatever density the toolbar is set to.
 *
 * The sizes are declared as `calc(<rem> * var(--font-scale))`, so a scale step is
 * not one number but three — one per density. Switching the toolbar re-measures
 * every row on this page, which is the only honest way to document a scale that
 * moves.
 */

import type { Meta, StoryObj } from '@storybook/react-vite'
import type { RefObject } from 'react'
import { useEffect, useRef, useState } from 'react'

import {
  collectCustomProperties,
  rootDeclaredValues,
  rootTokenNames,
} from '../support/css-variables'
import {
  Mono,
  ReadAtRuntime,
  TokenPage,
  TokenSection,
  TokenTable,
  UNMEASURED,
} from '../support/docs-ui'

const SAMPLE = '가나다라 Ag 123'

interface TypeStep {
  readonly name: string
  readonly declared: string
  /** What the browser resolved the declaration to, in px. */
  readonly measured: string
  readonly lineHeight: string
}

interface TypeSnapshot {
  readonly steps: readonly TypeStep[]
  readonly stacks: readonly { readonly name: string; readonly value: string }[]
  readonly metrics: readonly { readonly name: string; readonly value: string }[]
}

/** `--text-sm--line-height` is a modifier on `--text-sm`, not a step of its own. */
const MODIFIER = /--line-height$/

/**
 * A family unlikely to be anything a token names, used to tell a font stack from
 * the other things that live under `--font-`.
 *
 * The namespace holds Tailwind's weight scale and this project's density
 * multiplier as well as the two stacks. Rather than filtering by name — which
 * would mean this page knowing which tokens exist — each candidate is assigned
 * to `font-family` and kept only if the browser accepted it. `500` and `1` do
 * not survive that.
 */
const FAMILY_SENTINEL = 'cursive'

function readSnapshot(host: HTMLElement): TypeSnapshot {
  const doc = host.ownerDocument
  const view = doc.defaultView
  const rules = collectCustomProperties(doc)
  const declared = rootDeclaredValues(rules)

  const probe = doc.createElement('div')
  probe.style.position = 'absolute'
  probe.style.visibility = 'hidden'
  probe.textContent = SAMPLE
  host.append(probe)

  const steps = rootTokenNames(rules, '--text-', MODIFIER).map<TypeStep>((name) => {
    probe.style.fontSize = `var(${name})`
    probe.style.lineHeight = `var(${name}--line-height)`
    const computed = view === null ? null : view.getComputedStyle(probe)

    return {
      declared: declared.get(name) ?? '',
      lineHeight: computed === null ? UNMEASURED : computed.lineHeight,
      measured: computed === null ? UNMEASURED : computed.fontSize,
      name,
    }
  })

  probe.remove()

  const named = (prefix: string) =>
    rootTokenNames(rules, prefix).map((name) => ({ name, value: declared.get(name) ?? '' }))

  const family = doc.createElement('div')
  family.style.position = 'absolute'
  family.style.visibility = 'hidden'
  host.append(family)

  const stacks = named('--font-').filter(({ name }) => {
    if (view === null) return false
    family.style.fontFamily = FAMILY_SENTINEL
    const sentinel = view.getComputedStyle(family).fontFamily
    family.style.fontFamily = `var(${name})`
    return view.getComputedStyle(family).fontFamily !== sentinel
  })

  family.remove()

  return {
    metrics: [...named('--tracking-'), ...named('--leading-')],
    stacks,
    steps,
  }
}

function useTypeSnapshot(
  density: unknown,
): [RefObject<HTMLDivElement | null>, TypeSnapshot | null] {
  const hostRef = useRef<HTMLDivElement>(null)
  const [snapshot, setSnapshot] = useState<TypeSnapshot | null>(null)

  // `density` is the toolbar global. It is not read — it is depended on, so that
  // every measurement is retaken when the step changes.
  useEffect(() => {
    const host = hostRef.current
    if (host !== null) setSnapshot(readSnapshot(host))
  }, [density])

  return [hostRef, snapshot]
}

function TypographyReference({ density }: { readonly density: string }) {
  const [hostRef, snapshot] = useTypeSnapshot(density)

  return (
    <div ref={hostRef}>
      <TokenPage
        lead="One scale, multiplied by the density step. Line heights are ratios, so a line box grows with the type instead of being set in stone."
        source="packages/config/tailwind/tokens.css"
        title="Typography"
      >
        <ReadAtRuntime>
          The px column is <Mono>getComputedStyle(el).fontSize</Mono> on an element carrying that
          token, at the density currently selected in the toolbar. Change the step and the whole
          column moves — because the declaration does, not because this page knows about density.
        </ReadAtRuntime>

        <TokenSection
          description="No webfont: a downloaded face is a render-blocking request on the LCP path and a network dependency in CI. Pretendard is honoured when the visitor already has it."
          title="Font stacks"
        >
          <TokenTable
            caption="Family tokens"
            headers={['token', 'stack', 'sample']}
            rows={(snapshot?.stacks ?? []).map((stack) => ({
              cells: [
                <Mono key="name">{stack.name}</Mono>,
                <span className="text-fg-muted text-xs" key="value">
                  {stack.value}
                </span>,
                <span key="sample" style={{ fontFamily: `var(${stack.name})` }}>
                  {SAMPLE}
                </span>,
              ],
              key: stack.name,
            }))}
          />
        </TokenSection>

        <TokenSection
          description="Line heights run a little looser than a Latin-only scale would: Hangul syllable blocks are full height, so 1.5 that reads as airy in English reads as cramped in Korean."
          title="Scale"
        >
          <TokenTable
            caption={`Type steps · ${String(snapshot?.steps.length ?? 0)}`}
            headers={['token', 'declared', 'computed', 'line-height', 'sample']}
            rows={(snapshot?.steps ?? []).map((step) => ({
              cells: [
                <Mono key="name">{step.name}</Mono>,
                <Mono key="declared">{step.declared}</Mono>,
                <Mono key="measured">{step.measured}</Mono>,
                <Mono key="leading">{step.lineHeight}</Mono>,
                <span
                  key="sample"
                  style={{
                    fontSize: `var(${step.name})`,
                    lineHeight: `var(${step.name}--line-height)`,
                  }}
                >
                  {SAMPLE}
                </span>,
              ],
              key: step.name,
            }))}
          />
        </TokenSection>

        <TokenSection
          description="Ratios and letter spacing, which do not scale with density because they are already relative to the type size."
          title="Tracking and leading"
        >
          <TokenTable
            caption={`Metric tokens · ${String(snapshot?.metrics.length ?? 0)}`}
            headers={['token', 'value']}
            rows={(snapshot?.metrics ?? []).map((metric) => ({
              cells: [
                <Mono key="name">{metric.name}</Mono>,
                <Mono key="value">{metric.value}</Mono>,
              ],
              key: metric.name,
            }))}
          />
        </TokenSection>
      </TokenPage>
    </div>
  )
}

const meta = {
  title: 'Design tokens/Typography',
  component: TypographyReference,
  parameters: { layout: 'padded' },
  render: (_args, context) => <TypographyReference density={String(context.globals.density)} />,
} satisfies Meta<typeof TypographyReference>

export default meta

type Story = StoryObj<typeof meta>

export const Reference: Story = { args: { density: '2' } }
