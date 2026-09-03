/**
 * The colour layer, read off the stylesheet the browser loaded (D-206).
 *
 * Nothing on this page is typed in. The token *names* are discovered by walking
 * `document.styleSheets`, the values are the ones `getComputedStyle` reports,
 * and every contrast ratio is computed from the pixels a 1×1 canvas painted with
 * that colour. Add a role to `tokens.css` and it appears here; change a
 * lightness and the ratio beside it moves.
 */

import type { Meta, StoryObj } from '@storybook/react-vite'
import type { RefObject } from 'react'
import { useEffect, useRef, useState } from 'react'

import {
  contrastRatio,
  deriveContrastPairs,
  over,
  readComputedColors,
  resolveColor,
  type ContrastPair,
  type Rgba,
} from '../support/color'
import {
  collectCustomProperties,
  rootDeclaredValues,
  rootTokenNames,
  substituteVars,
} from '../support/css-variables'
import {
  Mono,
  ReadAtRuntime,
  TokenPage,
  TokenSection,
  TokenTable,
  UNMEASURED,
  Verdict,
} from '../support/docs-ui'

type Layer = 'palette' | 'semantic' | 'structural'

interface ColorToken {
  readonly name: string
  /** As written in `tokens.css` — a literal, or the role it points at. */
  readonly declared: string
  /** The same value with every `var()` followed to its end. */
  readonly resolved: string
  /** What the browser says it painted. */
  readonly computed: string
  readonly rgba: Rgba | null
  readonly layer: Layer
}

interface Snapshot {
  readonly tokens: readonly ColorToken[]
  readonly pairs: readonly ContrastPair[]
}

/**
 * Which of the two layers a token belongs to, decided by the token itself.
 *
 * A semantic role is exactly a token whose value points at another colour token
 * — that *is* what the two-layer split in `tokens.css` means — so the tables
 * below cannot fall out of step with the file. `transparent`, `currentColor` and
 * `inherit` are structural: they are in the colour namespace but they are not
 * colours, and the canvas refusing them is how they are found.
 */
function layerOf(declared: string, rgba: Rgba | null, contextual: boolean): Layer {
  if (declared.includes('var(--color-')) return 'semantic'
  if (contextual || rgba === null || rgba.a === 0) return 'structural'
  return 'palette'
}

function readSnapshot(host: HTMLElement): Snapshot {
  const rules = collectCustomProperties(host.ownerDocument)
  const names = rootTokenNames(rules, '--color-')
  const declaredValues = rootDeclaredValues(rules)
  const computedValues = readComputedColors(host, names)

  const tokens = names.map<ColorToken>((name) => {
    const declared = declaredValues.get(name) ?? ''
    const resolved = substituteVars(declared, declaredValues)
    const rgba = resolveColor(resolved, host.ownerDocument)
    const computed = computedValues.get(name)

    return {
      computed: computed?.value ?? UNMEASURED,
      declared,
      layer: layerOf(declared, rgba, computed?.contextual ?? false),
      name,
      resolved,
      rgba,
    }
  })

  return { pairs: deriveContrastPairs(names), tokens }
}

/** Reads the palette once the story is on screen, where there is a document to read. */
function useColorSnapshot(): [RefObject<HTMLDivElement | null>, Snapshot | null] {
  const hostRef = useRef<HTMLDivElement>(null)
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (host !== null) setSnapshot(readSnapshot(host))
  }, [])

  return [hostRef, snapshot]
}

function Swatch({ token }: { readonly token: ColorToken }) {
  return (
    <span
      className="border-border inline-block size-8 shrink-0 rounded-md border align-middle"
      style={{ background: `var(${token.name})` }}
    />
  )
}

function ratioOf(foreground: Rgba | null, background: Rgba | null): number | null {
  if (foreground === null || background === null) return null
  // The overlay is deliberately translucent; scoring it as if it were opaque
  // would report a contrast the user never sees.
  return contrastRatio(over(foreground, background), background)
}

function ratioText(ratio: number | null): string {
  return ratio === null ? UNMEASURED : ratio.toFixed(2)
}

function ContrastCell({
  ratio,
  minimum,
}: {
  readonly ratio: number | null
  readonly minimum: number
}) {
  if (ratio === null) return <span className="text-fg-subtle">{UNMEASURED}</span>

  return (
    <span className="flex items-center gap-2">
      <Mono>{ratioText(ratio)}</Mono>
      <Verdict label={ratio >= minimum ? 'AA' : 'below'} ok={ratio >= minimum} />
    </span>
  )
}

function LayerTable({
  tokens,
  layer,
  caption,
  surface,
}: {
  readonly tokens: readonly ColorToken[]
  readonly layer: Layer
  readonly caption: string
  readonly surface: Rgba | null
}) {
  const rows = tokens
    .filter((token) => token.layer === layer)
    .map((token) => ({
      cells: [
        <Swatch key="swatch" token={token} />,
        <Mono key="name">{token.name}</Mono>,
        <Mono key="value">{layer === 'semantic' ? token.declared : token.computed}</Mono>,
        <Mono key="ratio">{ratioText(ratioOf(token.rgba, surface))}</Mono>,
      ],
      key: token.name,
    }))

  return (
    <TokenTable
      caption={`${caption} · ${String(rows.length)}`}
      headers={[
        'swatch',
        'token',
        layer === 'semantic' ? 'points at' : 'computed',
        'ratio on --color-surface',
      ]}
      rows={rows}
    />
  )
}

function StructuralTable({ tokens }: { readonly tokens: readonly ColorToken[] }) {
  const rows = tokens
    .filter((token) => token.layer === 'structural')
    .map((token) => ({
      cells: [<Mono key="name">{token.name}</Mono>, <Mono key="value">{token.declared}</Mono>],
      key: token.name,
    }))

  return (
    <TokenTable
      caption={`Keywords kept in the colour namespace · ${String(rows.length)}`}
      headers={['token', 'value']}
      rows={rows}
    />
  )
}

function PairSample({ pair }: { readonly pair: ContrastPair }) {
  return (
    <span
      className="inline-flex items-center rounded-sm px-2 py-1 text-sm"
      style={{ background: `var(${pair.background})`, color: `var(${pair.foreground})` }}
    >
      Ag 123
    </span>
  )
}

function ColourReference() {
  const [hostRef, snapshot] = useColorSnapshot()
  const byName = new Map((snapshot?.tokens ?? []).map((token) => [token.name, token]))
  const surface = byName.get('--color-surface')?.rgba ?? null

  return (
    <div ref={hostRef}>
      <TokenPage
        lead="Two layers: a palette that holds values, and a semantic layer of roles that points at it. Components may only use the second."
        source="packages/config/tailwind/tokens.css"
        title="Colour"
      >
        <ReadAtRuntime>
          Every name below was found by walking this document&rsquo;s stylesheets, every value is
          what <Mono>getComputedStyle</Mono> reports, and every ratio is computed from the pixels a
          1×1 canvas painted. Nothing on this page is a copy of the token file — which is why it
          cannot disagree with it.
        </ReadAtRuntime>

        <TokenSection
          description="The only layer a component is allowed to name. A role that stopped pointing at the palette is how a redesign turns into a search-and-replace."
          title="Semantic roles"
        >
          <LayerTable
            caption="Semantic tokens"
            layer="semantic"
            surface={surface}
            tokens={snapshot?.tokens ?? []}
          />
        </TokenSection>

        <TokenSection
          description="Referenced by the roles above and by nothing else. Tailwind's own palette is deleted in tokens.css, so bg-red-500 renders nothing at all."
          title="Palette"
        >
          <LayerTable
            caption="Palette tokens"
            layer="palette"
            surface={surface}
            tokens={snapshot?.tokens ?? []}
          />
        </TokenSection>

        <TokenSection
          description="In the colour namespace, but not colours. They are structural, which is why they survived the namespace reset."
          title="Keywords"
        >
          <StructuralTable tokens={snapshot?.tokens ?? []} />
        </TokenSection>

        <TokenSection
          description="Derived from the token names — --color-danger-fg is the foreground for --color-danger because of how the two are named. A role added tomorrow arrives here on its own. The same thresholds are enforced in CI by test/color-tokens.spec.ts."
          title="Contrast pairs"
        >
          <TokenTable
            caption={`Foreground on background · ${String(snapshot?.pairs.length ?? 0)}`}
            headers={['sample', 'foreground', 'background', 'ratio', 'required']}
            rows={(snapshot?.pairs ?? []).map((pair) => ({
              cells: [
                <PairSample key="sample" pair={pair} />,
                <Mono key="fg">{pair.foreground}</Mono>,
                <Mono key="bg">{pair.background}</Mono>,
                <ContrastCell
                  key="ratio"
                  minimum={pair.minimum}
                  ratio={ratioOf(
                    byName.get(pair.foreground)?.rgba ?? null,
                    byName.get(pair.background)?.rgba ?? null,
                  )}
                />,
                <Mono key="min">{`${pair.minimum.toFixed(1)}:1`}</Mono>,
              ],
              key: `${pair.foreground} on ${pair.background}`,
            }))}
          />
        </TokenSection>
      </TokenPage>
    </div>
  )
}

const meta = {
  title: 'Design tokens/Colour',
  component: ColourReference,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof ColourReference>

export default meta

type Story = StoryObj<typeof meta>

export const Reference: Story = {}
