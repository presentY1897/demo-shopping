'use client'

import { Badge } from '@shopping/ui/components'
import { useId } from 'react'

import type { VariantDiff } from '@/lib/products/combinations'
import { isUnchanged } from '@/lib/products/combinations'
import { fill } from '@/lib/products/product-form'
import type { ProductDiffMessages } from '@/messages'

/**
 * What saving would do to the combinations, shown **before** it is done
 * (TASK-0114 F7).
 *
 * This is the point of the editor. A seller adding `XL` to 사이즈 is about to
 * cause three different things at once — three rows created, none removed, and
 * twelve left with their stock untouched — and the fear that stops them is the
 * third one: 「사이즈를 하나 더했더니 재고가 전부 0이 됐다」. So all three are
 * counted, and the one nobody would think to ask about is stated out loud.
 *
 * `role="status"` and not `role="alert"`: this is not a refusal, it is the
 * answer to a question the seller just asked by typing. An assertive live
 * region would interrupt them mid-keystroke.
 *
 * Only rendered in 수정 모드. On a new listing every combination is added, so
 * a panel saying so would be counting the rows already visible below it.
 */

export interface ProductDiffNoticeProps {
  readonly diff: VariantDiff
  readonly messages: ProductDiffMessages
}

export function ProductDiffNotice({ diff, messages }: ProductDiffNoticeProps) {
  const headingId = useId()
  const unchanged = isUnchanged(diff)

  return (
    <section
      aria-labelledby={headingId}
      className="border-border bg-surface-muted flex flex-col gap-2 rounded-lg border p-4"
      role="status"
    >
      <h3 className="text-fg text-sm font-medium" id={headingId}>
        {messages.title}
      </h3>

      {unchanged ? (
        <p className="text-fg-muted text-sm">{messages.unchanged}</p>
      ) : (
        <ul className="flex flex-wrap items-center gap-2">
          {diff.added.length === 0 ? null : (
            <li>
              <Badge variant="success">
                {fill(messages.added, { count: String(diff.added.length) })}
              </Badge>
            </li>
          )}
          {diff.deactivated.length === 0 ? null : (
            <li>
              <Badge variant="warning">
                {fill(messages.deactivated, { count: String(diff.deactivated.length) })}
              </Badge>
            </li>
          )}
          <li>
            <Badge variant="neutral">
              {fill(messages.kept, { count: String(diff.kept.length) })}
            </Badge>
          </li>
        </ul>
      )}

      {diff.deactivated.length === 0 ? null : (
        <p className="text-fg-muted text-sm">{messages.deactivatedHint}</p>
      )}
    </section>
  )
}
