'use client'

/**
 * Every token on one page, at whichever density step is selected.
 *
 * The point of this page is not to be pretty — it is to make a token wrong in a
 * way you can see. So it deliberately renders through the same utility classes a
 * component would use (`text-lg`, `rounded-md`, `h-control-md`) rather than
 * reading the CSS variables directly: a value that only resolves at `:root` and
 * silently fails to answer a nested `data-density` would look correct here if
 * this page cheated, and that is exactly the bug worth catching.
 */

import { DENSITY_LEVELS, gridColumnsFor, type DensityLevel } from '@shopping/ui'
import { useDensity } from '@shopping/ui/density'
import type { ReactNode, RefObject } from 'react'
import { useEffect, useRef, useState } from 'react'

import type { Messages } from '@/messages'

type TokenMessages = Messages['tokens']

/** The only layer a component is allowed to use. */
const SEMANTIC_COLORS = [
  ['surface', 'surface-sunken', 'surface-raised', 'surface-muted', 'surface-inverse'],
  ['fg', 'fg-muted', 'fg-subtle', 'fg-inverse'],
  ['border', 'border-strong', 'border-interactive', 'ring'],
  ['primary', 'primary-strong', 'primary-surface', 'primary-fg'],
  ['danger', 'danger-strong', 'danger-surface', 'danger-fg'],
  ['success', 'success-surface', 'success-fg'],
  ['warning', 'warning-surface', 'warning-fg'],
  ['muted', 'muted-fg', 'status-ok', 'status-degraded', 'status-down'],
]

/** Shown so the semantic names above can be traced to a value, not to be used. */
const PALETTE = [
  ['neutral-0', 'neutral-50', 'neutral-100', 'neutral-200', 'neutral-300', 'neutral-400'],
  ['neutral-500', 'neutral-600', 'neutral-700', 'neutral-800', 'neutral-900', 'neutral-950'],
  ['blue-100', 'blue-500', 'blue-600', 'teal-100', 'teal-500', 'teal-600'],
  ['violet-100', 'violet-500', 'violet-600', 'green-100', 'green-500'],
  ['amber-100', 'amber-500', 'red-100', 'red-500', 'red-600'],
]

/**
 * Written out rather than generated: Tailwind scans source text for class names,
 * so `text-${size}` would compile to nothing at all.
 */
const TYPE_SCALE = [
  ['2xs', 'text-2xs'],
  ['xs', 'text-xs'],
  ['sm', 'text-sm'],
  ['base', 'text-base'],
  ['lg', 'text-lg'],
  ['xl', 'text-xl'],
  ['2xl', 'text-2xl'],
  ['3xl', 'text-3xl'],
  ['4xl', 'text-4xl'],
  ['5xl', 'text-5xl'],
] as const

const SPACING_STEPS = [1, 2, 3, 4, 6, 8, 12, 16, 24] as const

const RADII = [
  ['xs', 'rounded-xs'],
  ['sm', 'rounded-sm'],
  ['md', 'rounded-md'],
  ['lg', 'rounded-lg'],
  ['xl', 'rounded-xl'],
  ['2xl', 'rounded-2xl'],
] as const

const SHADOWS = [
  ['xs', 'shadow-xs'],
  ['sm', 'shadow-sm'],
  ['md', 'shadow-md'],
  ['lg', 'shadow-lg'],
  ['overlay', 'shadow-overlay'],
] as const

const CONTROL_SIZES = [
  ['control-sm', 'h-control-sm px-3'],
  ['control-md', 'h-control-md px-4'],
  ['control-lg', 'h-control-lg px-6'],
] as const

const GRID_CARDS = 6

function Section({
  title,
  caption,
  children,
}: {
  readonly title: string
  readonly caption: string
  readonly children: ReactNode
}) {
  return (
    <section className="border-border flex flex-col gap-4 border-t pt-8">
      <header>
        <h2 className="text-xl font-semibold">{title}</h2>
        <p className="text-fg-muted mt-1 text-sm">{caption}</p>
      </header>
      {children}
    </section>
  )
}

function Swatch({ name }: { readonly name: string }) {
  return (
    <figure className="flex flex-col gap-1">
      <div
        className="border-border h-12 rounded-md border"
        style={{ background: `var(--color-${name})` }}
      />
      <figcaption className="text-fg-subtle font-mono text-2xs">{name}</figcaption>
    </figure>
  )
}

function SwatchGrid({ rows }: { readonly rows: readonly (readonly string[])[] }) {
  return (
    <div className="flex flex-col gap-3">
      {rows.map((row) => (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6" key={row.join()}>
          {row.map((name) => (
            <Swatch key={name} name={name} />
          ))}
        </div>
      ))}
    </div>
  )
}

/**
 * Reports the box the browser actually laid out.
 *
 * The 44px floor is a claim about rendered pixels, and a claim about rendered
 * pixels should be readable off the screen rather than derived from the
 * stylesheet by whoever is reviewing.
 */
function Measured({
  className,
  label,
  measuring,
  accessibleName,
  children,
}: {
  readonly className: string
  readonly label: string
  readonly measuring: string
  /** For a button whose visible content is a glyph rather than a word. */
  readonly accessibleName?: string
  readonly children: ReactNode
}) {
  const ref = useRef<HTMLButtonElement>(null)
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)

  useEffect(() => {
    const element = ref.current
    if (element === null) return

    const observer = new ResizeObserver(() => {
      const box = element.getBoundingClientRect()
      setSize({ width: box.width, height: box.height })
    })
    observer.observe(element)

    return () => {
      observer.disconnect()
    }
  }, [])

  return (
    <div className="flex items-center gap-3">
      <button
        aria-label={accessibleName}
        className={`bg-primary text-primary-fg rounded-md font-medium ${className}`}
        ref={ref}
        type="button"
      >
        {children}
      </button>
      <span className="text-fg-subtle font-mono text-xs">
        {label}:{' '}
        {size === null ? measuring : `${size.width.toFixed(1)} × ${size.height.toFixed(1)}px`}
      </span>
    </div>
  )
}

/** Current viewport width, so the grid section can show which band applies. */
function useViewportWidth(): number | null {
  const [width, setWidth] = useState<number | null>(null)

  useEffect(() => {
    const update = () => {
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

/** Reads `--density-cols` back off an element, i.e. what the browser decided. */
function useComputedColumns(
  ref: RefObject<HTMLElement | null>,
  density: DensityLevel,
  width: number | null,
): string | null {
  const [columns, setColumns] = useState<string | null>(null)

  useEffect(() => {
    const element = ref.current
    if (element === null) return
    setColumns(getComputedStyle(element).getPropertyValue('--density-cols').trim())
  }, [ref, density, width])

  return columns
}

/**
 * The step selector. Deliberately plain — the real toggle belongs to the header
 * in TASK-0018, and building a polished one here would mean building it twice.
 */
function DensityToggle({ messages }: { readonly messages: TokenMessages }) {
  const { density, setDensity, levels } = useDensity()

  return (
    <fieldset className="flex flex-wrap items-center gap-2">
      <legend className="text-fg-muted mb-2 text-sm">{messages.density.legend}</legend>
      {levels.map((level) => (
        <button
          aria-pressed={level === density}
          className={`min-h-touch rounded-md border px-4 text-sm font-medium ${
            level === density
              ? 'border-primary bg-primary text-primary-fg'
              : 'border-border-interactive text-fg'
          }`}
          key={level}
          onClick={() => {
            setDensity(level)
          }}
          type="button"
        >
          {`${String(level)} · ${messages.density.names[level]}`}
        </button>
      ))}
    </fieldset>
  )
}

/** One density step rendered in isolation, to compare the three side by side. */
function DensitySample({
  level,
  messages,
}: {
  readonly level: DensityLevel
  readonly messages: TokenMessages
}) {
  return (
    <div
      className="border-border bg-surface-sunken flex flex-col gap-3 rounded-lg border p-4"
      data-density={level}
    >
      <p className="text-fg-subtle font-mono text-2xs">
        {`data-density="${String(level)}" · ${messages.density.names[level]}`}
      </p>
      <p className="text-base">{messages.labels.sampleText}</p>
      <div className="grid-density gap-2">
        {Array.from({ length: GRID_CARDS }, (_, index) => (
          <div className="bg-surface border-border h-10 rounded-md border" key={index} />
        ))}
      </div>
      <button
        className="bg-primary text-primary-fg h-control-md rounded-md px-4 text-sm font-medium"
        type="button"
      >
        {messages.labels.sampleButton}
      </button>
    </div>
  )
}

export function TokenPreview({ messages }: { readonly messages: TokenMessages }) {
  const { density } = useDensity()
  const width = useViewportWidth()
  const gridRef = useRef<HTMLDivElement>(null)
  const cssColumns = useComputedColumns(gridRef, density, width)

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-8 px-gutter py-8">
      <header className="flex flex-col gap-4">
        <div>
          <h1 className="text-primary text-3xl font-bold">{messages.title}</h1>
          <p className="text-fg-muted mt-1">{messages.description}</p>
          <p className="text-fg-subtle mt-1 text-sm">{messages.devOnlyNotice}</p>
        </div>

        <DensityToggle messages={messages} />

        <p className="text-fg-subtle text-sm">
          {`${messages.density.current}: ${String(density)} · ${messages.density.names[density]}`}
          {' — '}
          {messages.density.hint}
        </p>
      </header>

      <Section caption={messages.captions.color} title={messages.sections.color}>
        <h3 className="text-fg-muted text-sm font-semibold">{messages.labels.semantic}</h3>
        <SwatchGrid rows={SEMANTIC_COLORS} />
        <h3 className="text-fg-muted mt-4 text-sm font-semibold">{messages.labels.palette}</h3>
        <SwatchGrid rows={PALETTE} />
      </Section>

      <Section caption={messages.captions.typography} title={messages.sections.typography}>
        <dl className="flex flex-col gap-2">
          {TYPE_SCALE.map(([name, className]) => (
            <div className="flex items-baseline gap-4" key={name}>
              <dt className="text-fg-subtle w-16 shrink-0 font-mono text-2xs">{name}</dt>
              <dd className={className}>{messages.labels.sampleText}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section caption={messages.captions.spacing} title={messages.sections.spacing}>
        <dl className="flex flex-col gap-2">
          {SPACING_STEPS.map((step) => (
            <div className="flex items-center gap-4" key={step}>
              <dt className="text-fg-subtle w-16 shrink-0 font-mono text-2xs">{step}</dt>
              <dd
                className="bg-primary h-3 rounded-xs"
                // Inline rather than `w-4`: the point is to show the multiplier
                // resolving against `--space-unit` at this element.
                style={{ width: `calc(var(--space-unit) * ${String(step)})` }}
              />
            </div>
          ))}
        </dl>
      </Section>

      <Section caption={messages.captions.shape} title={messages.sections.shape}>
        <div className="grid grid-cols-3 gap-4 sm:grid-cols-6">
          {RADII.map(([name, className]) => (
            <figure className="flex flex-col gap-1" key={name}>
              <div className={`bg-surface-muted border-border h-16 border ${className}`} />
              <figcaption className="text-fg-subtle font-mono text-2xs">{name}</figcaption>
            </figure>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-5">
          {SHADOWS.map(([name, className]) => (
            <figure className="flex flex-col gap-1" key={name}>
              <div className={`bg-surface-raised h-16 rounded-md ${className}`} />
              <figcaption className="text-fg-subtle font-mono text-2xs">{name}</figcaption>
            </figure>
          ))}
        </div>
      </Section>

      <Section caption={messages.captions.control} title={messages.sections.control}>
        <div className="flex flex-col gap-3">
          {CONTROL_SIZES.map(([name, className]) => (
            <Measured
              className={className}
              key={name}
              label={messages.labels.measuredHeight}
              measuring={messages.labels.measuring}
            >
              {`${messages.labels.sampleButton} · ${name}`}
            </Measured>
          ))}

          {/*
            No height, no padding, a one-glyph label: whatever this button ends
            up as, `touch-target` is the only thing holding it at 44 × 44.
          */}
          <Measured
            accessibleName={messages.labels.iconButton}
            className="touch-target"
            label={messages.labels.measuredHeight}
            measuring={messages.labels.measuring}
          >
            <span aria-hidden="true">+</span>
          </Measured>
        </div>
        <p className="text-fg-subtle text-sm">{messages.labels.touchFloor}</p>
      </Section>

      <Section caption={messages.captions.grid} title={messages.sections.grid}>
        <p className="text-fg-subtle font-mono text-xs">
          {`${messages.labels.viewportWidth}: ${width === null ? '—' : `${String(width)}px`}`}
          {` · ${messages.labels.columnsFromCss}: ${cssColumns ?? '—'}`}
          {` · ${messages.labels.columnsFromMatrix}: ${
            width === null ? '—' : String(gridColumnsFor(density, width))
          }`}
        </p>
        <div className="grid-density gap-4" ref={gridRef}>
          {Array.from({ length: GRID_CARDS * 2 }, (_, index) => (
            <div
              className="bg-surface-muted border-border flex h-24 items-center justify-center rounded-md border"
              key={index}
            >
              <span className="text-fg-subtle font-mono text-2xs">{index + 1}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section caption={messages.captions.comparison} title={messages.sections.comparison}>
        <div className="grid gap-4 lg:grid-cols-3">
          {DENSITY_LEVELS.map((level) => (
            <DensitySample key={level} level={level} messages={messages} />
          ))}
        </div>
      </Section>
    </main>
  )
}
