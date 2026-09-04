'use client'

import type { ApiFailure, SellerVariant } from '@shopping/shared'
import { failureMessage, quotableRequestId } from '@shopping/shared'
import {
  Badge,
  Button,
  DataList,
  EmptyState,
  ErrorNotice,
  ErrorState,
  Link,
  Skeleton,
  Table,
  ToastProvider,
  useToast,
} from '@shopping/ui/components'
import type { TableColumn } from '@shopping/ui/components'
import { useCallback, useRef, useState } from 'react'

import type { StockAdjustDraft } from '@/lib/products/stock-adjust'
import { parseStockAdjust } from '@/lib/products/stock-adjust'
import { useVariantStock } from '@/lib/products/use-variant-stock'
import type { ProductStockMessages } from '@/messages'
import { messagesFor } from '@/messages'

import { StockAdjustCell } from './stock-adjust-cell'
import { StockLedgerPanel } from './stock-ledger-panel'

/**
 * `/products/[id]/stock` — Variant 별 재고와 그 이력 (TASK-0116 4장).
 *
 * **Every number on this screen moves by a delta.** There is no control here
 * that sets a stock level, on purpose: the seller's "17" means "17 as of what I
 * am looking at", and between the read and the save something may have sold. A
 * delta says the same intent in a way the gap cannot corrupt (F2b), and it is
 * also the only shape the ledger can record — a level would have to be turned
 * back into a movement by somebody, and that somebody would be guessing.
 */
export interface StockWorkspaceProps {
  readonly productId: string
  readonly title: string
  readonly productName?: string
  readonly messages?: ProductStockMessages
}

export function StockWorkspace(props: StockWorkspaceProps) {
  const messages = props.messages ?? messagesFor().productStock

  return (
    <ToastProvider closeLabel={messages.toast.closeLabel} regionLabel={messages.toast.regionLabel}>
      <StockScreen {...props} />
    </ToastProvider>
  )
}

function StockScreen({
  productId,
  title,
  productName,
  messages = messagesFor().productStock,
}: StockWorkspaceProps) {
  const stock = useVariantStock(productId)
  const toast = useToast()
  const [busyId, setBusyId] = useState<string | null>(null)
  /**
   * The actual guard against a second click (U3).
   *
   * `busyId` is state, so a second click **in the same tick** — a real
   * double-click, and what `fireEvent` reproduces — reads the value from before
   * the first click's render and sails past the check. The disabled attribute
   * has the same problem: it is applied on the next render, not on the click
   * that caused it. A ref is written and read in the same tick, so it is the one
   * that holds. Two movements is not two renders; it is stock that moved twice.
   */
  const inFlight = useRef(false)
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({})
  const [failure, setFailure] = useState<ApiFailure | null>(null)

  const describe = useCallback(
    (value: ApiFailure) =>
      failureMessage(value, { errors: messagesFor().errors, failures: messagesFor().apiFailures }),
    [],
  )

  async function apply(variant: SellerVariant, draft: StockAdjustDraft): Promise<void> {
    if (inFlight.current) return

    const parsed = parseStockAdjust(draft)

    if (!parsed.ok) return

    inFlight.current = true
    setBusyId(variant.id)
    setErrors((held) => ({ ...held, [variant.id]: '' }))
    setFailure(null)

    const answer = await stock.adjust(variant.id, parsed.request)

    inFlight.current = false
    setBusyId(null)

    if (!answer.ok) {
      const field = fieldRefusal(answer.failure)

      // A refusal about the number goes on the number (F9). Anything else is
      // about the request as a whole and gets the panel.
      if (field === null) setFailure(answer.failure)
      else setErrors((held) => ({ ...held, [variant.id]: field }))

      return
    }

    toast.toast({
      title: messages.adjusted.replace('{stock}', answer.balanceAfter.toLocaleString('ko-KR')),
      variant: 'success',
    })
  }

  const variants = stock.state.status === 'ready' ? stock.state.variants : []

  const columns: readonly TableColumn<SellerVariant>[] = [
    { key: 'option', header: messages.option, cell: (row) => row.optionLabel },
    { key: 'sku', header: messages.sku, cell: (row) => row.sku },
    {
      key: 'stock',
      header: messages.stock,
      numeric: true,
      cell: (row) => (
        <span className="flex items-center justify-end gap-2">
          {row.stock.toLocaleString('ko-KR')}
          {row.stock === 0 ? <Badge variant="danger">{messages.badges.out}</Badge> : null}
          {row.isLowStock ? <Badge variant="warning">{messages.badges.low}</Badge> : null}
        </span>
      ),
    },
    {
      key: 'adjust',
      header: messages.adjustColumn,
      cell: (row) => (
        <StockAdjustCell
          busy={busyId === row.id}
          messages={messages.adjust}
          onApply={(draft) => void apply(row, draft)}
          optionLabel={row.optionLabel}
          stock={row.stock}
          {...(errors[row.id] === undefined || errors[row.id] === ''
            ? {}
            : { serverError: errors[row.id] })}
        />
      ),
    },
    {
      key: 'history',
      header: messages.historyColumn,
      cell: (row) => (
        <Button
          aria-expanded={stock.openLedger === row.id}
          onClick={() => {
            stock.toggleLedger(row.id)
          }}
          size="sm"
          type="button"
          variant="ghost"
        >
          {stock.openLedger === row.id
            ? messages.ledger.close
            : messages.ledger.openLabel.replace('{option}', row.optionLabel)}
        </Button>
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <Link href="/products" variant="subtle">
          {messages.backToList}
        </Link>
        <h1 className="text-fg text-2xl font-bold">{title}</h1>
        <p className="text-fg-muted text-sm">
          {productName === undefined
            ? messages.description
            : messages.subtitle.replace('{name}', productName)}
        </p>
      </header>

      {failure === null ? null : (
        <StockFailureNotice describe={describe} failure={failure} messages={messages} />
      )}

      <DataList
        empty={<EmptyState description={messages.empty.description} title={messages.empty.title} />}
        error={
          <ErrorState
            description={stock.state.status === 'error' ? describe(stock.state.failure) : undefined}
            onRetry={stock.reload}
            retryLabel={messages.retry}
            title={messages.errorTitle}
          />
        }
        loading={<Skeleton label={messages.loadingLabel} shape="text" />}
        state={
          stock.state.status === 'ready'
            ? variants.length === 0
              ? 'empty'
              : 'ready'
            : stock.state.status
        }
      >
        <Table
          caption={messages.caption}
          columns={columns}
          pinFirstColumn
          rowKey={(row) => row.id}
          rows={variants}
          stickyHeader
        />
        {stock.openLedger === null || stock.ledger === null ? null : (
          <StockLedgerPanel
            describe={describe}
            messages={messages.ledger}
            onRetry={stock.reload}
            retryLabel={messages.retry}
            state={stock.ledger}
          />
        )}
      </DataList>
    </div>
  )
}

/**
 * The refusal's sentence, when it is about the field the seller can fix.
 *
 * `null` for anything else — a 500 or a dead network is not something a number
 * in a box can answer, and putting it there would tell the seller their input
 * was wrong when it was not.
 */
function fieldRefusal(failure: ApiFailure): string | null {
  if (failure.kind !== 'http') return null

  for (const detail of failure.details) {
    if (
      typeof detail === 'object' &&
      detail !== null &&
      'field' in detail &&
      detail.field === 'delta' &&
      'message' in detail &&
      typeof detail.message === 'string'
    ) {
      return detail.message
    }
  }

  return null
}

/** The refusal panel, with the id only when it is worth quoting. */
function StockFailureNotice({
  failure,
  messages,
  describe,
}: {
  readonly failure: ApiFailure
  readonly messages: ProductStockMessages
  readonly describe: (value: ApiFailure) => string
}) {
  const requestId = quotableRequestId(failure)

  return (
    <ErrorNotice
      copiedLabel={messages.failure.copiedLabel}
      copyLabel={messages.failure.copyLabel}
      description={describe(failure)}
      requestIdHint={messages.failure.requestIdHint}
      requestIdLabel={messages.failure.requestIdLabel}
      title={messages.failure.title}
      {...(requestId === null ? {} : { requestId })}
    />
  )
}
