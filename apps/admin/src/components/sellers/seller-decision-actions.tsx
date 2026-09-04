'use client'

import type { Seller } from '@shopping/shared'
import { Button, GuardedButton } from '@shopping/ui/components'

import type { SellerDecision } from '@/lib/sellers/decisions'
import { decisionsFor } from '@/lib/sellers/decisions'
import type { SellerReviewMessages } from '@/messages'

/**
 * The decisions a store can be given right now, as buttons.
 *
 * **Which buttons appear is the store's status**, and only that — `decisionsFor`
 * mirrors the state machine, so a `PENDING` row offers 승인·반려 and an `ACTIVE`
 * one offers 정지. A row that offered all four would be three buttons whose only
 * possible answer is a 400.
 *
 * **A button the operator may not press is disabled with a reason, never
 * hidden** (`docs/design/pages.md` 진입 가드 규약). Hiding it makes the console
 * look like it has fewer capabilities than it does, which for a portfolio demo
 * is the opposite of the point; `GuardedButton` keeps it in the tab order and
 * puts the reason in the accessibility tree rather than only in a tooltip.
 *
 * Used by both screens, which is what keeps the queue and the detail from
 * growing two answers to "what can I do with this application" (TASK-0110 R6).
 */

interface SellerDecisionActionsProps {
  readonly seller: Seller
  readonly messages: SellerReviewMessages
  /** Why this operator may not take that decision, or `undefined` when they may. */
  readonly denialFor: (decision: SellerDecision) => string | undefined
  readonly onSelect: (decision: SellerDecision) => void
  readonly size?: 'sm' | 'md'
  /** Shown when the status offers nothing. The detail screen wants it; a row does not. */
  readonly emptyLabel?: string
  /** A table cell puts its actions at the end; a section puts them at the start. */
  readonly align?: 'start' | 'end'
}

export function SellerDecisionActions({
  seller,
  messages,
  denialFor,
  onSelect,
  size = 'sm',
  emptyLabel,
  align = 'end',
}: SellerDecisionActionsProps) {
  const decisions = decisionsFor(seller.status)

  if (decisions.length === 0) {
    return emptyLabel === undefined ? null : <p className="text-fg-muted text-sm">{emptyLabel}</p>
  }

  return (
    <div className={align === 'end' ? 'flex flex-wrap justify-end gap-2' : 'flex flex-wrap gap-2'}>
      {decisions.map((decision) => {
        const denial = denialFor(decision)
        /**
         * The store's name is in the accessible name because twenty rows
         * otherwise offer twenty buttons called 승인, and neither a screen
         * reader user nor a test can tell which row one belongs to. The visible
         * word is still part of the name, which is what WCAG 2.5.3 asks.
         */
        const label = `${seller.brandName} ${messages.actions[decision]}`

        return denial === undefined ? (
          <Button
            aria-label={label}
            key={decision}
            onClick={() => {
              onSelect(decision)
            }}
            size={size}
            variant="outline"
          >
            {messages.actions[decision]}
          </Button>
        ) : (
          <GuardedButton
            aria-label={label}
            blocked
            key={decision}
            reason={denial}
            size={size}
            variant="outline"
          >
            {messages.actions[decision]}
          </GuardedButton>
        )
      })}
    </div>
  )
}
