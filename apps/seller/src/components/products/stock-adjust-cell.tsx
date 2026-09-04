'use client'

import type { SellerStockAdjustType } from '@shopping/shared'
import {
  sellerStockAdjustTypes,
  STOCK_MAX_MOVEMENT,
  STOCK_REASON_MAX_LENGTH,
} from '@shopping/shared'
import { Button, Input, Select } from '@shopping/ui/components'
import { useId, useState } from 'react'

import type { StockAdjustDraft, StockAdjustIssue } from '@/lib/products/stock-adjust'
import { parseStockAdjust, previewBalance } from '@/lib/products/stock-adjust'
import type { StockAdjustMessages } from '@/messages'

/**
 * The adjustment control — **and the absence of an absolute field is the point**
 * (F2b, 4장 「조정량 UI」).
 *
 * There is no box here that says 재고 and takes `17`. A seller who wants 17 is
 * told `12 → 17` while they type `+5`, so the number they were thinking of is on
 * screen without a request that would overwrite whatever sold in between (R1).
 *
 * **The refusal that only the server can make lands here too.** A result that
 * would go below zero is a 400 on `delta`, and it is shown on this input rather
 * than as a banner, because the field is where the correction happens (F9).
 */
export interface StockAdjustCellProps {
  readonly messages: StockAdjustMessages
  readonly optionLabel: string
  readonly stock: number
  readonly busy: boolean
  /** Set by the caller from the server's `details[].field === 'delta'`. */
  readonly serverError?: string
  readonly onApply: (draft: StockAdjustDraft) => void
}

export function StockAdjustCell({
  messages,
  optionLabel,
  stock,
  busy,
  serverError,
  onApply,
}: StockAdjustCellProps) {
  const deltaId = useId()
  const typeId = useId()
  const reasonId = useId()
  const errorId = useId()
  const previewId = useId()
  const [delta, setDelta] = useState('')
  const [type, setType] = useState<SellerStockAdjustType>('INBOUND')
  const [reason, setReason] = useState('')
  const [issue, setIssue] = useState<StockAdjustIssue | null>(null)

  const preview = previewBalance(stock, delta)
  const message = issue === null ? serverError : issueMessage(messages, issue)

  function apply(): void {
    const draft: StockAdjustDraft = { delta, type, reason }
    const parsed = parseStockAdjust(draft)

    if (!parsed.ok) {
      setIssue(parsed.issue)

      return
    }

    setIssue(null)
    onApply(draft)
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="flex w-28 flex-col gap-1">
        <label className="text-fg-muted text-xs" htmlFor={deltaId}>
          {`${optionLabel} ${messages.deltaLabel}`}
        </label>
        <Input
          aria-describedby={[
            message === undefined ? null : errorId,
            preview === null ? null : previewId,
          ]
            .filter((value) => value !== null)
            .join(' ')}
          disabled={busy}
          id={deltaId}
          inputMode="numeric"
          invalid={message !== undefined}
          onChange={(event) => {
            setDelta(event.target.value)
            setIssue(null)
          }}
          placeholder={messages.deltaPlaceholder}
          value={delta}
        />
      </div>

      <div className="flex w-24 flex-col gap-1">
        <label className="text-fg-muted text-xs" htmlFor={typeId}>
          {`${optionLabel} ${messages.typeLabel}`}
        </label>
        <Select
          disabled={busy}
          id={typeId}
          onValueChange={(next) => {
            setType(next as SellerStockAdjustType)
          }}
          options={sellerStockAdjustTypes.map((value) => ({
            value,
            label: messages.typeOptions[value],
          }))}
          value={type}
        />
      </div>

      <div className="flex w-40 flex-col gap-1">
        <label className="text-fg-muted text-xs" htmlFor={reasonId}>
          {`${optionLabel} ${messages.reasonLabel}`}
        </label>
        <Input
          disabled={busy}
          id={reasonId}
          maxLength={STOCK_REASON_MAX_LENGTH}
          onChange={(event) => {
            setReason(event.target.value)
          }}
          placeholder={messages.reasonPlaceholder}
          value={reason}
        />
      </div>

      <Button disabled={busy} onClick={apply} type="button">
        {messages.apply}
      </Button>

      {preview === null ? null : (
        <p className="text-fg-muted text-sm" id={previewId}>
          {messages.preview
            .replace('{from}', stock.toLocaleString('ko-KR'))
            .replace('{to}', preview.toLocaleString('ko-KR'))}
        </p>
      )}

      {message === undefined ? null : (
        <p className="text-danger w-full text-sm" id={errorId} role="alert">
          {message}
        </p>
      )}
    </div>
  )
}

function issueMessage(messages: StockAdjustMessages, issue: StockAdjustIssue): string {
  switch (issue) {
    case 'required':
      return messages.deltaRequired
    case 'zero':
      return messages.deltaZero
    case 'range':
      return messages.deltaRange.replace('{max}', STOCK_MAX_MOVEMENT.toLocaleString('ko-KR'))
    case 'reason_too_long':
      return messages.reasonTooLong.replace('{max}', String(STOCK_REASON_MAX_LENGTH))
  }
}
