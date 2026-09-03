/**
 * Layout scaffolding shared by the stories.
 *
 * Every class here resolves to a token, exactly as a component's would: a story
 * that padded itself with an arbitrary length would be showing the system at a
 * spacing the system does not have, and the density toolbar would leave it
 * behind.
 */

import type { ReactNode } from 'react'

/** A wrapping row — the shape most "every variant" stories want. */
export function Row({ children }: { readonly children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-3">{children}</div>
}

/** A vertical stack. */
export function Stack({ children }: { readonly children: ReactNode }) {
  return <div className="flex flex-col gap-3">{children}</div>
}

/**
 * A specimen with a caption underneath.
 *
 * The caption is a `<figcaption>` rather than a bare `<span>` so the label is
 * associated with what it labels for a screen reader too — a story that
 * documents accessibility should not be the exception to it.
 */
export function Specimen({
  label,
  children,
}: {
  readonly label: string
  readonly children: ReactNode
}) {
  return (
    <figure className="flex flex-col items-start gap-1">
      <div className="flex items-center gap-3">{children}</div>
      <figcaption className="text-fg-subtle font-mono text-2xs">{label}</figcaption>
    </figure>
  )
}

/**
 * A labelled form control.
 *
 * Used instead of a bare field in every form story on purpose: an unlabelled
 * input is an axe violation, and `test/story-a11y.spec.tsx` fails the build on
 * it. The stories have to be examples worth copying.
 */
export function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  readonly label: string
  readonly htmlFor?: string
  readonly hint?: string
  readonly children: ReactNode
}) {
  return (
    <div className="flex max-w-96 flex-col gap-1">
      <label className="text-fg-muted text-sm" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint === undefined ? null : <p className="text-fg-subtle text-xs">{hint}</p>}
    </div>
  )
}
