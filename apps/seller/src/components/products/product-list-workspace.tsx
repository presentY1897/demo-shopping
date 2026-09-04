'use client'

import type { ApiFailure, ProductStatus, SellerProductListItem } from '@shopping/shared'
import { failureMessage, quotableRequestId } from '@shopping/shared'
import {
  Badge,
  Button,
  Checkbox,
  DataList,
  EmptyState,
  ErrorNotice,
  ErrorState,
  Link,
  Modal,
  Pagination,
  Skeleton,
  Table,
  ToastProvider,
  useToast,
} from '@shopping/ui/components'
import type { TableColumn } from '@shopping/ui/components'
import { useCallback, useState } from 'react'

import { useCategories } from '@/lib/products/use-catalog-taxonomy'
import { useSellerProducts } from '@/lib/products/use-seller-products'
import type { ProductListMessages } from '@/messages'
import { messagesFor } from '@/messages'

import { ProductFilters } from './product-filters'

/**
 * `/products` — the listing table, its filter and the two bulk actions.
 *
 * **The badge reads a constant, never a number typed here** (R4 · F10). The
 * server decides `isLowStock` from `LOW_STOCK_THRESHOLD` and sends the answer;
 * a screen that compared `totalStock <= 5` would be a second definition, and the
 * one that would not be updated the day the threshold moves.
 *
 * **Selection is shown as a count, always** (R3). It only ever holds ids from
 * the page on screen, and anything that replaces those rows clears it — so the
 * number beside 「판매 중지」 is a number the seller can count.
 */
export interface ProductListWorkspaceProps {
  readonly title: string
  readonly messages?: ProductListMessages
  readonly statusLabels?: Readonly<Record<ProductStatus, string>>
}

export function ProductListWorkspace(props: ProductListWorkspaceProps) {
  const messages = props.messages ?? messagesFor().productList

  return (
    <ToastProvider closeLabel={messages.toast.closeLabel} regionLabel={messages.toast.regionLabel}>
      <ProductListScreen {...props} />
    </ToastProvider>
  )
}

/** What a confirmation dialog is currently asking about, if anything. */
type Pending =
  | { readonly kind: 'bulk'; readonly status: ProductStatus }
  | { readonly kind: 'duplicate'; readonly item: SellerProductListItem }
  | null

function ProductListScreen({
  title,
  messages = messagesFor().productList,
  statusLabels = messagesFor().products.statusLabels,
}: ProductListWorkspaceProps) {
  const catalogue = useSellerProducts()
  const categories = useCategories()
  const toast = useToast()
  const [pending, setPending] = useState<Pending>(null)
  const [failure, setFailure] = useState<ApiFailure | null>(null)
  const [busy, setBusy] = useState(false)

  const { state, selected, toggle, toggleAll, pagination } = catalogue
  const items = state.status === 'ready' ? state.items : []
  const allSelected = items.length > 0 && items.every((item) => selected.has(item.id))
  const describe = useCallback(
    (value: ApiFailure) =>
      failureMessage(value, { errors: messagesFor().errors, failures: messagesFor().apiFailures }),
    [],
  )

  const columns: readonly TableColumn<SellerProductListItem>[] = [
    {
      key: 'select',
      header: (
        <Checkbox
          aria-label={messages.table.selectAll}
          checked={allSelected}
          disabled={items.length === 0}
          onCheckedChange={toggleAll}
        />
      ),
      cell: (row) => (
        <Checkbox
          aria-label={messages.table.selectRow.replace('{name}', row.name)}
          checked={selected.has(row.id)}
          onCheckedChange={() => {
            toggle(row.id)
          }}
        />
      ),
    },
    { key: 'name', header: messages.table.name, cell: (row) => row.name },
    {
      key: 'status',
      header: messages.table.status,
      cell: (row) => <Badge variant="neutral">{statusLabels[row.status]}</Badge>,
    },
    {
      key: 'stock',
      header: messages.table.totalStock,
      numeric: true,
      cell: (row) => (
        <span className="flex items-center justify-end gap-2">
          {row.totalStock.toLocaleString('ko-KR')}
          {row.totalStock === 0 ? <Badge variant="danger">{messages.badges.out}</Badge> : null}
          {row.isLowStock ? <Badge variant="warning">{messages.badges.low}</Badge> : null}
        </span>
      ),
    },
    {
      key: 'price',
      header: messages.table.minPrice,
      numeric: true,
      cell: (row) =>
        row.minPrice === null
          ? messages.table.noPrice
          : `${row.minPrice.toLocaleString('ko-KR')}원`,
    },
    {
      key: 'actions',
      header: messages.table.actions,
      cell: (row) => (
        <span className="flex items-center gap-2">
          <Link href={`/products/${row.id}/stock`}>{messages.table.manageStock}</Link>
          <Link href={`/products/${row.id}/edit`}>{messages.table.edit}</Link>
          <Button
            onClick={() => {
              setPending({ kind: 'duplicate', item: row })
            }}
            size="sm"
            type="button"
            variant="ghost"
          >
            {messages.table.duplicate}
          </Button>
        </span>
      ),
    },
  ]

  async function confirm(): Promise<void> {
    if (pending === null || busy) return

    // U3: the dialog's button is disabled while this runs, so a second click
    // cannot become a second request.
    setBusy(true)
    setFailure(null)

    if (pending.kind === 'bulk') {
      const answer = await catalogue.setStatus(pending.status)

      setBusy(false)

      if (!answer.ok) {
        setFailure(answer.failure)

        return
      }

      setPending(null)
      toast.toast({
        title: messages.bulk.done.replace('{count}', String(answer.value)),
        variant: 'success',
      })

      return
    }

    const answer = await catalogue.duplicate(pending.item)

    setBusy(false)

    if (!answer.ok) {
      setFailure(answer.failure)

      return
    }

    setPending(null)
    toast.toast({
      title: messages.duplicate.done.replace('{name}', answer.value.name),
      variant: 'success',
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-fg text-2xl font-bold">{title}</h1>
          <p className="text-fg-muted text-sm">{messages.description}</p>
        </div>
        <Link href="/products/new" variant="standalone">
          {messages.newProduct}
        </Link>
      </header>

      <ProductFilters
        categories={categories.state.status === 'ready' ? categories.state.data : []}
        disabled={state.status === 'loading'}
        messages={messages}
        onChange={catalogue.setFilters}
        statusLabels={statusLabels}
        value={catalogue.filters}
      />

      {selected.size > 0 ? (
        <div
          className="border-border bg-surface-muted flex flex-wrap items-center gap-3 rounded-md border p-3"
          role="group"
          aria-label={messages.bulk.selected.replace('{count}', String(selected.size))}
        >
          <span className="text-fg text-sm font-medium">
            {messages.bulk.selected.replace('{count}', String(selected.size))}
          </span>
          <Button
            onClick={() => {
              setPending({ kind: 'bulk', status: 'ACTIVE' })
            }}
            size="sm"
            type="button"
          >
            {messages.bulk.activate}
          </Button>
          <Button
            onClick={() => {
              setPending({ kind: 'bulk', status: 'INACTIVE' })
            }}
            size="sm"
            type="button"
          >
            {messages.bulk.deactivate}
          </Button>
          <Button onClick={catalogue.clearSelection} size="sm" type="button" variant="ghost">
            {messages.bulk.clear}
          </Button>
        </div>
      ) : null}

      <DataList
        empty={
          catalogue.isFiltered ? (
            <EmptyState
              description={messages.filteredEmpty.description}
              title={messages.filteredEmpty.title}
            />
          ) : (
            <EmptyState description={messages.empty.description} title={messages.empty.title} />
          )
        }
        error={
          <ErrorState
            description={state.status === 'error' ? describe(state.failure) : undefined}
            onRetry={catalogue.reload}
            retryLabel={messages.retry}
            title={messages.errorTitle}
          />
        }
        loading={<Skeleton label={messages.loadingLabel} shape="text" />}
        state={state.status === 'ready' ? (items.length === 0 ? 'empty' : 'ready') : state.status}
      >
        <Table
          caption={messages.table.caption}
          columns={columns}
          pinFirstColumn
          rowKey={(row) => row.id}
          rows={items}
          stickyHeader
        />
        <Pagination
          hasNext={pagination.hasNext}
          hasPrevious={pagination.hasPrevious}
          label={messages.pagination.label}
          nextLabel={messages.pagination.next}
          onNext={pagination.goNext}
          onPrevious={pagination.goPrevious}
          previousLabel={messages.pagination.previous}
          status={messages.pagination.page.replace('{page}', String(pagination.pageIndex + 1))}
        />
      </DataList>

      <Modal
        description={
          pending?.kind === 'bulk'
            ? messages.bulk.confirmBody.replace('{count}', String(selected.size))
            : pending?.kind === 'duplicate'
              ? messages.duplicate.confirmBody.replace('{name}', pending.item.name)
              : ''
        }
        footer={
          <div className="flex justify-end gap-2">
            <Button
              onClick={() => {
                setPending(null)
                setFailure(null)
              }}
              type="button"
              variant="ghost"
            >
              {pending?.kind === 'duplicate' ? messages.duplicate.cancel : messages.bulk.cancel}
            </Button>
            <Button disabled={busy} onClick={() => void confirm()} type="button" variant="primary">
              {pending?.kind === 'duplicate' ? messages.duplicate.confirm : messages.bulk.confirm}
            </Button>
          </div>
        }
        closeLabel={messages.closeLabel}
        onOpenChange={(next) => {
          if (!next) {
            setPending(null)
            setFailure(null)
          }
        }}
        open={pending !== null}
        title={
          pending?.kind === 'duplicate'
            ? messages.duplicate.confirmTitle
            : messages.bulk.confirmTitle
        }
      >
        <div className="flex flex-col gap-3">
          {pending?.kind === 'duplicate' ? (
            <p className="text-fg-muted text-sm">{messages.duplicate.draftNotice}</p>
          ) : null}
          {failure === null ? null : <FailureNotice failure={failure} messages={messages} />}
        </div>
      </Modal>
    </div>
  )
}

/** The refusal a dialog shows, with the id only when it is worth quoting. */
function FailureNotice({
  failure,
  messages,
}: {
  readonly failure: ApiFailure
  readonly messages: ProductListMessages
}) {
  const requestId = quotableRequestId(failure)

  return (
    <ErrorNotice
      copiedLabel={messages.failure.copiedLabel}
      copyLabel={messages.failure.copyLabel}
      description={failureMessage(failure, {
        errors: messagesFor().errors,
        failures: messagesFor().apiFailures,
      })}
      requestIdHint={messages.failure.requestIdHint}
      requestIdLabel={messages.failure.requestIdLabel}
      title={messages.failure.title}
      {...(requestId === null ? {} : { requestId })}
    />
  )
}
