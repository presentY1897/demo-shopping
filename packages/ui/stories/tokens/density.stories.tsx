/**
 * Density × viewport, and the 44px floor that survives both (D-205, D-206).
 *
 * The matrix is the part of this design system that cannot be shown with a
 * screenshot: three density steps crossed with three viewport bands is nine
 * answers, and six of them depend on `@media` conditions the current window is
 * not satisfying. `stories/support/viewport-probe.ts` measures them where they
 * are real — an off-screen frame at each band edge — so every cell below is a
 * length a browser laid out rather than a number read out of the stylesheet.
 */

import type { Meta, StoryObj } from '@storybook/react-vite'
import type { RefObject } from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import {
  Button,
  BUTTON_SIZES,
  Checkbox,
  IconButton,
  Input,
  Switch,
  CloseIcon,
} from '../../src/components'
import {
  DENSITY_ATTRIBUTE,
  DENSITY_LEVELS,
  DENSITY_VIEWPORTS,
  densityViewportFor,
  type DensityLevel,
  type DensityViewport,
} from '../../src/density/density'
import { measureLength } from '../support/css-variables'
import {
  Mono,
  px,
  ReadAtRuntime,
  TokenPage,
  TokenSection,
  TokenTable,
  UNMEASURED,
  Verdict,
} from '../support/docs-ui'
import { measureDensityMatrix, probeWidthFor, type DensityMatrix } from '../support/viewport-probe'

const STEP_NAMES: Readonly<Record<DensityLevel, string>> = {
  1: 'minimal',
  2: 'standard',
  3: 'maximal',
}

const GRID_CARDS = 6

/* --------------------------------------------------------------- matrix -- */

interface MatrixRow {
  readonly label: string
  readonly read: (viewport: DensityViewport, level: DensityLevel, matrix: DensityMatrix) => string
}

const MATRIX_ROWS: readonly MatrixRow[] = [
  { label: '--space-unit', read: (v, l, m) => px(m[v][l].spaceUnit) },
  { label: '--font-scale', read: (v, l, m) => m[v][l].fontScale },
  { label: '--radius-scale', read: (v, l, m) => m[v][l].radiusScale },
  { label: '--density-cols', read: (v, l, m) => m[v][l].columns },
  { label: '--space-gutter', read: (v, l, m) => px(m[v][l].gutter) },
  { label: '--text-base', read: (v, l, m) => px(m[v][l].baseText) },
  { label: '--spacing-control-sm', read: (v, l, m) => px(m[v][l].controls.sm) },
  { label: '--spacing-control-md', read: (v, l, m) => px(m[v][l].controls.md) },
  { label: '--spacing-control-lg', read: (v, l, m) => px(m[v][l].controls.lg) },
  { label: '--touch-min', read: (v, l, m) => px(m[v][l].touchMin) },
]

function MatrixTable({
  viewport,
  matrix,
}: {
  readonly viewport: DensityViewport
  readonly matrix: DensityMatrix | null
}) {
  return (
    <TokenTable
      caption={`${viewport} band · measured in a frame ${String(probeWidthFor(viewport))}px wide`}
      headers={[
        'token',
        ...DENSITY_LEVELS.map((level) => `${String(level)} · ${STEP_NAMES[level]}`),
      ]}
      rows={MATRIX_ROWS.map((row) => ({
        cells: [
          <Mono key="token">{row.label}</Mono>,
          ...DENSITY_LEVELS.map((level) => (
            <Mono key={level}>
              {matrix === null ? UNMEASURED : row.read(viewport, level, matrix)}
            </Mono>
          )),
        ],
        key: `${viewport}-${row.label}`,
      }))}
    />
  )
}

/* ------------------------------------------------------------- controls -- */

/**
 * Every interactive box in the base set, measured as the browser laid it out.
 *
 * The floor is not asserted here either: `--touch-min` is measured alongside the
 * controls and the verdict compares two readings. Nothing on this page knows
 * that the number is 44.
 */
const CONTROLS = [
  ...BUTTON_SIZES.map((size) => ({
    id: `button-${size}`,
    label: `Button size="${size}"`,
    node: <Button size={size}>Order</Button>,
  })),
  {
    id: 'icon-button',
    label: 'IconButton size="sm"',
    node: (
      <IconButton label="Close" size="sm">
        <CloseIcon className="size-4" />
      </IconButton>
    ),
  },
  { id: 'checkbox', label: 'Checkbox', node: <Checkbox aria-label="Agree" /> },
  { id: 'switch', label: 'Switch', node: <Switch aria-label="Notifications" /> },
  { id: 'input', label: 'Input', node: <Input aria-label="Email" /> },
] as const

interface ControlReading {
  readonly height: number
  readonly floor: number | null
}

function useControlHeights(
  hostRef: RefObject<HTMLDivElement | null>,
  density: unknown,
): ReadonlyMap<string, ControlReading> {
  const [readings, setReadings] = useState<ReadonlyMap<string, ControlReading>>(new Map())

  useLayoutEffect(() => {
    const host = hostRef.current
    if (host === null) return

    const measure = (): void => {
      const next = new Map<string, ControlReading>()
      for (const cell of host.querySelectorAll<HTMLElement>('[data-measure]')) {
        const key = cell.dataset.measure
        const target = cell.firstElementChild
        if (key === undefined || target === null) continue
        next.set(key, {
          floor: measureLength(cell, 'var(--touch-min)'),
          height: target.getBoundingClientRect().height,
        })
      }
      setReadings(next)
    }

    measure()

    // A control's height moves with the density step and with the viewport band,
    // and the band changes without this component re-rendering.
    const observer = new ResizeObserver(measure)
    observer.observe(host)
    return () => {
      observer.disconnect()
    }
  }, [hostRef, density])

  return readings
}

function ControlMatrix({ density }: { readonly density: unknown }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const readings = useControlHeights(hostRef, density)

  return (
    <div ref={hostRef}>
      {/*
        The controls are rendered for real — the same components an app ships —
        and measured. A specimen drawn with a `height` copied from the token
        would prove only that the copy is what it is.

        `inert` rather than `aria-hidden`: these are focusable controls, and
        `aria-hidden` on a focusable element is itself an axe violation. `inert`
        takes them out of the tab order and the accessibility tree together,
        which is what a specimen that exists only to be measured should be.
      */}
      <div className="pointer-events-none absolute opacity-0" inert>
        {DENSITY_LEVELS.map((level) => (
          <div key={level} {...{ [DENSITY_ATTRIBUTE]: String(level) }}>
            {CONTROLS.map((control) => (
              <div data-measure={`${control.id}-${String(level)}`} key={control.id}>
                {control.node}
              </div>
            ))}
          </div>
        ))}
      </div>

      <TokenTable
        caption="Laid-out height per density step, against the measured --touch-min"
        headers={[
          'control',
          ...DENSITY_LEVELS.map((level) => `${String(level)} · ${STEP_NAMES[level]}`),
        ]}
        rows={CONTROLS.map((control) => ({
          cells: [
            <Mono key="label">{control.label}</Mono>,
            ...DENSITY_LEVELS.map((level) => {
              const reading = readings.get(`${control.id}-${String(level)}`)
              if (reading === undefined) return <Mono key={level}>{UNMEASURED}</Mono>
              const ok = reading.floor !== null && reading.height >= reading.floor
              return (
                <span className="flex items-center gap-2" key={level}>
                  <Mono>{px(reading.height)}</Mono>
                  <Verdict label={ok ? 'floor' : 'below'} ok={ok} />
                </span>
              )
            }),
          ],
          key: control.id,
        }))}
      />
    </div>
  )
}

/* ---------------------------------------------------------- three up ----- */

function DensitySample({ level }: { readonly level: DensityLevel }) {
  return (
    <section
      className="border-border bg-surface-sunken flex flex-col gap-3 rounded-lg border p-4"
      {...{ [DENSITY_ATTRIBUTE]: String(level) }}
    >
      <h3 className="text-fg-subtle font-mono text-2xs">
        {`data-density="${String(level)}" · ${STEP_NAMES[level]}`}
      </h3>
      <p className="text-base">가나다라 Ag 123</p>
      <div className="grid-density gap-2">
        {Array.from({ length: GRID_CARDS }, (_, index) => (
          <div className="bg-surface border-border h-10 rounded-md border" key={index} />
        ))}
      </div>
      <Button size="md">Order</Button>
    </section>
  )
}

/* -------------------------------------------------------------- page ----- */

function useViewportWidth(): number | null {
  const [width, setWidth] = useState<number | null>(null)

  useEffect(() => {
    const update = (): void => {
      setWidth(window.innerWidth)
    }
    update()
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('resize', update)
    }
  }, [])

  return width
}

function DensityReference({ density }: { readonly density: string }) {
  const [matrix, setMatrix] = useState<DensityMatrix | null>(null)
  const width = useViewportWidth()

  useEffect(() => {
    let cancelled = false
    void measureDensityMatrix().then((result) => {
      if (!cancelled) setMatrix(result)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <TokenPage
      lead="Three steps crossed with three viewport bands. The step decides the scale; the band decides the grid; the touch floor answers to neither."
      source="packages/config/tailwind/density.css"
      title="Density × viewport"
    >
      <ReadAtRuntime>
        The nine cells are measured in an off-screen frame sized to each band, so the media queries
        that decide them are actually satisfied. The control heights below are measured off the real
        components at the density in the toolbar. Current window:{' '}
        <Mono>{width === null ? UNMEASURED : `${String(width)}px`}</Mono> ·{' '}
        <Mono>{width === null ? UNMEASURED : densityViewportFor(width)}</Mono> band · toolbar{' '}
        <Mono>{density}</Mono>.
      </ReadAtRuntime>

      {DENSITY_VIEWPORTS.map((viewport) => (
        <TokenSection
          key={viewport}
          title={`${viewport} band — from ${String(probeWidthFor(viewport))}px`}
        >
          <MatrixTable matrix={matrix} viewport={viewport} />
        </TokenSection>
      ))}

      <TokenSection
        description="Whatever --space-unit shrinks to at the maximal step, an interactive box still ends up at least --touch-min tall. The token does that with max(); this table checks that the components use the token."
        title="Control height and touch target"
      >
        <ControlMatrix density={density} />
      </TokenSection>

      <TokenSection
        description="Each panel renders at its own step, nested inside a page running another. That only works because every scaling token is declared inline in tokens.css — otherwise the multiplier would resolve once at :root and these three would be identical."
        title="Three steps, side by side"
      >
        <div className="grid gap-4 lg:grid-cols-3">
          {DENSITY_LEVELS.map((level) => (
            <DensitySample key={level} level={level} />
          ))}
        </div>
      </TokenSection>
    </TokenPage>
  )
}

const meta = {
  title: 'Design tokens/Density',
  component: DensityReference,
  parameters: { layout: 'padded' },
  render: (_args, context) => <DensityReference density={String(context.globals.density)} />,
} satisfies Meta<typeof DensityReference>

export default meta

type Story = StoryObj<typeof meta>

export const Reference: Story = { args: { density: '2' } }
