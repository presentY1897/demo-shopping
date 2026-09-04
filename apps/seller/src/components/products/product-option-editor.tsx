'use client'

import { PRODUCT_MAX_OPTIONS, PRODUCT_MAX_VARIANTS } from '@shopping/shared'
import { Button, CloseIcon, IconButton, Input } from '@shopping/ui/components'
import { useEffect, useId, useRef } from 'react'

import type { OptionAxis, OptionIssue } from '@/lib/products/combinations'
import { combinationCount } from '@/lib/products/combinations'
import { fill } from '@/lib/products/product-form'
import type { ProductOptionMessages } from '@/messages'

/**
 * 옵션 정의 — the axes and their choices (TASK-0114 4장).
 *
 * **A `fieldset` per axis, and a `fieldset` for the set of them.** The
 * accessible name of a group of inputs comes from its `legend` and from nowhere
 * else; a column of boxes labelled only by their neighbours is a list of
 * unnamed text fields to a screen reader. `FormField variant="group"` does the
 * same job for the attribute form, and this is the same shape without a
 * `FormApi` behind it — these values are not one form field, they are the
 * structure the table below is generated from.
 *
 * **In 수정 모드 the axes are locked.** Adding or removing one changes the
 * arity of every existing combination at once, which no listing with order
 * history survives, and the API refuses it as a 400 (TASK-0113 4장). A control
 * that could be pressed and always failed would be worse than none
 * (TASK-0018 4.5), so the buttons are absent and the reason is on screen (F7b).
 */

export interface ProductOptionEditorProps {
  readonly axes: readonly OptionAxis[]
  readonly onChange: (axes: readonly OptionAxis[]) => void
  /** 수정 모드: the axes are the stored ones and only their values may move. */
  readonly axesLocked: boolean
  readonly issues: readonly OptionIssue[]
  readonly messages: ProductOptionMessages
}

export function ProductOptionEditor({
  axes,
  onChange,
  axesLocked,
  issues,
  messages,
}: ProductOptionEditorProps) {
  const headingId = useId()
  const combinations = combinationCount(axes)

  /**
   * Which box to put the caret in once React has drawn it.
   *
   * Adding a choice and leaving the caret where it was means a keyboard user
   * has to tab back through every existing choice to reach the box they just
   * asked for. A ref rather than state: the value is consumed by the effect and
   * never rendered.
   */
  const pendingFocus = useRef<string | null>(null)
  const panel = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const selector = pendingFocus.current
    if (selector === null) return

    pendingFocus.current = null
    panel.current?.querySelector<HTMLInputElement>(selector)?.focus()
  }, [axes])

  const replaceAxis = (index: number, next: OptionAxis): void => {
    onChange(axes.map((axis, at) => (at === index ? next : axis)))
  }

  const issuesFor = (optionIndex: number, valueIndex: number | null): readonly OptionIssue[] =>
    issues.filter((issue) => issue.optionIndex === optionIndex && issue.valueIndex === valueIndex)

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3" ref={panel}>
      <div>
        <h2 className="text-fg text-base font-medium" id={headingId}>
          {messages.title}
        </h2>
        <p className="text-fg-muted mt-1 text-sm">{messages.description}</p>
      </div>

      {axesLocked ? (
        <p className="border-border bg-surface-muted text-fg-muted rounded-md border px-3 py-2 text-sm">
          {messages.lockedNotice}
        </p>
      ) : null}

      {axes.length === 0 ? (
        <p className="border-border text-fg-muted rounded-lg border border-dashed p-6 text-center text-sm">
          {messages.emptyBody}
        </p>
      ) : null}

      {axes.map((axis, optionIndex) => (
        <fieldset
          className="border-border flex flex-col gap-3 rounded-lg border p-4"
          key={optionIndex}
        >
          <legend className="text-fg-muted px-1 text-sm">
            {fill(messages.legend, { index: String(optionIndex + 1) })}
          </legend>

          <div className="flex items-start gap-2">
            <div className="flex grow flex-col gap-1">
              <Input
                aria-label={messages.nameLabel}
                autoComplete="off"
                disabled={axesLocked}
                invalid={issuesFor(optionIndex, null).length > 0}
                onChange={(event) => {
                  replaceAxis(optionIndex, { ...axis, name: event.target.value })
                }}
                placeholder={messages.namePlaceholder}
                value={axis.name}
              />
              <IssueList issues={issuesFor(optionIndex, null)} messages={messages} />
            </div>

            {axesLocked ? null : (
              <IconButton
                label={messages.removeLabel}
                onClick={() => {
                  onChange(axes.filter((_unused, at) => at !== optionIndex))
                }}
                variant="ghost"
              >
                <CloseIcon />
              </IconButton>
            )}
          </div>

          <fieldset className="flex flex-col gap-2 border-0 p-0">
            <legend className="text-fg-muted mb-1 text-sm">{messages.valuesLabel}</legend>

            {axis.values.map((value, valueIndex) => (
              <div className="flex flex-col gap-1" key={valueIndex}>
                <div className="flex items-center gap-2">
                  <Input
                    aria-label={fill(messages.valueLabel, { index: String(valueIndex + 1) })}
                    autoComplete="off"
                    className="grow"
                    data-option={optionIndex}
                    data-value={valueIndex}
                    invalid={issuesFor(optionIndex, valueIndex).length > 0}
                    onChange={(event) => {
                      replaceAxis(optionIndex, {
                        ...axis,
                        values: axis.values.map((entry, at) =>
                          at === valueIndex ? event.target.value : entry,
                        ),
                      })
                    }}
                    placeholder={messages.valuePlaceholder}
                    value={value}
                  />
                  <IconButton
                    label={fill(messages.removeValueLabel, { index: String(valueIndex + 1) })}
                    onClick={() => {
                      replaceAxis(optionIndex, {
                        ...axis,
                        values: axis.values.filter((_unused, at) => at !== valueIndex),
                      })
                    }}
                    size="sm"
                    variant="ghost"
                  >
                    <CloseIcon />
                  </IconButton>
                </div>
                <IssueList issues={issuesFor(optionIndex, valueIndex)} messages={messages} />
              </div>
            ))}

            <div>
              <Button
                onClick={() => {
                  pendingFocus.current = `[data-option="${String(optionIndex)}"][data-value="${String(axis.values.length)}"]`
                  replaceAxis(optionIndex, { ...axis, values: [...axis.values, ''] })
                }}
                size="sm"
                type="button"
                variant="outline"
              >
                {messages.addValueLabel}
              </Button>
            </div>
          </fieldset>
        </fieldset>
      ))}

      <div className="flex flex-wrap items-center gap-3">
        {axesLocked || axes.length >= PRODUCT_MAX_OPTIONS ? null : (
          <Button
            onClick={() => {
              onChange([...axes, { name: '', values: [''] }])
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            {messages.addLabel}
          </Button>
        )}

        <p className="text-fg-muted text-sm" role="status">
          {fill(messages.countLabel, {
            count: String(combinations),
            max: String(PRODUCT_MAX_VARIANTS),
          })}
        </p>
      </div>
    </section>
  )
}

/**
 * The messages under one input.
 *
 * Text and not only a colour: `Input`'s red border says nothing to a screen
 * reader and colour alone fails WCAG 1.4.1 — the same rule `FormField` states
 * for the fields it owns.
 */
function IssueList({
  issues,
  messages,
}: {
  readonly issues: readonly OptionIssue[]
  readonly messages: ProductOptionMessages
}) {
  if (issues.length === 0) return null

  return (
    <ul className="flex flex-col gap-1">
      {issues.map((issue) => (
        <li className="text-danger text-xs" key={issue.code}>
          {messages.issues[issue.code]}
        </li>
      ))}
    </ul>
  )
}
