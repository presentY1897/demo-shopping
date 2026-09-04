'use client'

import { Button, CloseIcon, IconButton, Input } from '@shopping/ui/components'
import type { FormApi } from '@shopping/ui/form'
import { FormField } from '@shopping/ui/form'
import { useEffect, useRef } from 'react'

import { fill } from '@/lib/attributes/text'
import type { AttributeFormMessages } from '@/messages'

interface AttributeOptionEditorProps {
  readonly form: FormApi
  readonly messages: AttributeFormMessages
}

function optionsOf(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : []
}

/**
 * The choice list of a `SELECT` or `MULTI_SELECT`.
 *
 * **One field, several inputs.** The schema validates `options` as a whole —
 * "at least one", "no duplicates" — so the error belongs to the set rather than
 * to a row, and `FormField variant="group"` is what gives a set an accessible
 * name (a `fieldset`/`legend`; a set of inputs labelled only by their siblings
 * has none). That is also why the inputs are not bound with `form.text`: the
 * binder addresses a single value by name, and these are one array.
 *
 * **A new choice takes focus.** Adding a row and leaving the caret where it was
 * means a keyboard user has to tab back through every existing choice to reach
 * the box they just asked for.
 */
export function AttributeOptionEditor({ form, messages }: AttributeOptionEditorProps) {
  const options = optionsOf(form.values.options)
  const list = useRef<HTMLDivElement | null>(null)

  /**
   * Which box to put the caret in once React has drawn it.
   *
   * A ref rather than state: the value is consumed by the effect and never
   * rendered, and setting state inside an effect only to clear it is a cascading
   * render React's own lint rule refuses.
   */
  const pendingFocus = useRef<number | null>(null)

  useEffect(() => {
    const index = pendingFocus.current
    if (index === null) return

    pendingFocus.current = null
    list.current?.querySelectorAll<HTMLInputElement>('input')[index]?.focus()
  }, [options.length])

  const replace = (next: readonly string[]): void => {
    form.setValue('options', next)
  }

  return (
    <FormField
      form={form}
      hint={messages.optionsHint}
      label={messages.optionsLabel}
      name="options"
      variant="group"
    >
      <div className="flex flex-col gap-2" ref={list}>
        {options.map((option, index) => (
          <div className="flex items-center gap-2" key={index}>
            <Input
              aria-label={fill(messages.optionItemLabel, { index: index + 1 })}
              autoComplete="off"
              className="grow"
              invalid={form.errorFor('options') !== undefined}
              onChange={(event) => {
                replace(options.map((entry, at) => (at === index ? event.target.value : entry)))
              }}
              placeholder={messages.optionPlaceholder}
              value={option}
            />
            <IconButton
              label={fill(messages.optionRemoveLabel, { index: index + 1 })}
              onClick={() => {
                replace(options.filter((_entry, at) => at !== index))
              }}
              size="sm"
              variant="ghost"
            >
              <CloseIcon />
            </IconButton>
          </div>
        ))}

        <div>
          <Button
            onClick={() => {
              pendingFocus.current = options.length
              replace([...options, ''])
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            {messages.optionAddLabel}
          </Button>
        </div>
      </div>
    </FormField>
  )
}
