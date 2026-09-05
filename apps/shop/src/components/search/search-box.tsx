'use client'

/**
 * 검색창 + 자동완성 (TASK-0041 F1).
 *
 * The ARIA combobox pattern written out rather than pulled from a library: the
 * input keeps focus and owns the keyboard, the list is `aria-controls`led by it,
 * and the highlighted candidate is named by `aria-activedescendant` instead of
 * being focused. That last part is the point of the pattern — moving focus into
 * the list would take it out of the field, and the next keystroke would go
 * somewhere the person is not looking.
 *
 * **↑↓ move a highlight; Enter searches.** With a candidate highlighted Enter
 * takes it, with none it searches for exactly what was typed — so the keyboard
 * never forces a suggestion on somebody who meant their own words. Escape closes
 * the list and leaves the text alone, which is what lets a mistaken opening be
 * undone without retyping.
 *
 * **It is a `GET` form, and it stays one.** This box is in the header of every
 * page, so it must work where no router is mounted and before hydration; the
 * field that is *submitted* is therefore a hidden input carrying the highlighted
 * candidate, and Enter needs no JavaScript at all. Everything below is the
 * highlight — behaviour that is genuinely additional, on top of a control that
 * already worked.
 */

import { Button, Input } from '@shopping/ui/components'
import Form from 'next/form'
import { useCallback, useId, useState } from 'react'
import { flushSync } from 'react-dom'

import { useSuggestions } from '@/lib/search/use-suggestions'
import type { SearchSlotMessages } from '@/messages'

/** No highlight — Enter searches for what was typed. */
const NONE = -1

export interface SearchBoxProps {
  readonly messages: SearchSlotMessages
  /** What the field starts with. */
  readonly defaultValue?: string
  /**
   * Handles the search instead of letting the form navigate.
   *
   * The header passes nothing: it must work before hydration and where no router
   * is mounted, so its submit is the plain `GET /search` the markup already
   * describes. The results screen passes a handler, because it *is* the
   * destination — a navigation there would throw away the filters the visitor
   * can see on screen, while a handler folds the new word into the query it
   * already has.
   */
  readonly onSearch?: (term: string) => void
  readonly className?: string
}

export function SearchBox({ messages, defaultValue = '', onSearch, className }: SearchBoxProps) {
  const listboxId = useId()
  const optionId = useId()

  const [term, setTerm] = useState(defaultValue)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(NONE)

  const suggestions = useSuggestions(term, open)
  const expanded = open && suggestions.length > 0

  /** What a submit sends: the highlighted candidate, or what was typed. */
  const effective = active === NONE ? term : (suggestions[active] ?? term)

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Escape') {
        setOpen(false)
        setActive(NONE)

        return
      }

      if (!expanded) return

      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        // Prevented so the caret stays put: the browser's own binding for ↑↓ in
        // a text field jumps to the start and end of the value.
        event.preventDefault()

        const step = event.key === 'ArrowDown' ? 1 : -1

        // Wrapping *through* `NONE` on purpose — arrowing past the last
        // candidate lands back on what was typed, so the raw term is always
        // reachable without deleting a highlight.
        setActive((held) => {
          const next = held + step

          if (next >= suggestions.length) return NONE
          if (next < NONE) return suggestions.length - 1

          return next
        })
      }
    },
    [expanded, suggestions.length],
  )

  return (
    <Form
      action="/search"
      className={className}
      onSubmit={
        onSearch === undefined
          ? undefined
          : (event) => {
              event.preventDefault()
              setOpen(false)
              setActive(NONE)
              onSearch(effective.trim())
            }
      }
      role="search"
    >
      {/*
        The submitted field. Separate from the visible one so that a highlighted
        candidate is what gets sent without the text under the cursor changing —
        arrowing through candidates must not overwrite what somebody typed, or
        Escape would have nothing left to return them to.
      */}
      <input name="q" type="hidden" value={effective} />

      <div className="relative">
        <div className="flex w-full items-center gap-2">
          <Input
            aria-activedescendant={
              expanded && active !== NONE ? `${optionId}-${String(active)}` : undefined
            }
            aria-autocomplete="list"
            aria-controls={listboxId}
            aria-expanded={expanded}
            aria-label={messages.label}
            className="min-w-0 flex-1"
            onBlur={() => {
              setOpen(false)
              setActive(NONE)
            }}
            onChange={(event) => {
              setTerm(event.target.value)
              setOpen(true)
              setActive(NONE)
            }}
            onKeyDown={onKeyDown}
            placeholder={messages.placeholder}
            role="combobox"
            type="search"
            value={term}
          />
          <Button type="submit" variant="secondary">
            {messages.submit}
          </Button>
        </div>

        {/*
          Always in the tree, so `aria-controls` has something to point at even
          while it is empty. `hidden` rather than a conditional keeps that anchor
          stable across every keystroke.
        */}
        <ul
          aria-label={messages.suggestionsLabel}
          className="border-border bg-surface absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-md border shadow-md"
          hidden={!expanded}
          id={listboxId}
          role="listbox"
        >
          {suggestions.map((suggestion, index) => (
            <li
              aria-selected={index === active}
              className="text-fg min-h-touch aria-selected:bg-surface-muted flex cursor-pointer items-center px-3 text-sm"
              id={`${optionId}-${String(index)}`}
              key={suggestion}
              // `onMouseDown` with the default prevented: a plain click handler
              // never runs, because the field's blur closes the list first and
              // takes the option out of the tree with it.
              onMouseDown={(event) => {
                const form = event.currentTarget.closest('form')

                event.preventDefault()

                if (onSearch !== undefined) {
                  setTerm(suggestion)
                  setOpen(false)
                  setActive(NONE)
                  onSearch(suggestion.trim())

                  return
                }

                // The native path submits the DOM, and the hidden field still
                // holds the previous term until React commits — so flush first.
                flushSync(() => {
                  setTerm(suggestion)
                  setActive(NONE)
                  setOpen(false)
                })
                form?.requestSubmit()
              }}
              role="option"
            >
              {suggestion}
            </li>
          ))}
        </ul>

        <p aria-live="polite" className="sr-only">
          {expanded ? messages.suggestionsHint.replace('{count}', String(suggestions.length)) : ''}
        </p>
      </div>
    </Form>
  )
}
