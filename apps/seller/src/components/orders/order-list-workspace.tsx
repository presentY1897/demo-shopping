'use client'

import type { ApiFailure, DemoCarrierCode, SellerOrderListItem } from '@shopping/shared'
import { apiFailure, failureMessage, quotableRequestId } from '@shopping/shared'
import {
  Badge,
  Button,
  Checkbox,
  DataList,
  EmptyState,
  ErrorNotice,
  ErrorState,
  Link,
  Pagination,
  Skeleton,
  Table,
  TableToCards,
  Tabs,
  ToastProvider,
  useToast,
} from '@shopping/ui/components'
import type { TableColumn } from '@shopping/ui/components'
import { useMinWidth } from '@shopping/ui/layout'
import { useCallback, useState } from 'react'

import { fetchSellerOrder } from '@/lib/orders/console-api'
import { dateTime, money } from '@/lib/orders/format'
import type { SellerOrderTab } from '@/lib/orders/order-console'
import { isShippable, SELLER_ORDER_TABS, tabCountOf } from '@/lib/orders/order-console'
import { exportFileName, ordersToCsv } from '@/lib/orders/order-export'
import { runAction } from '@/lib/orders/use-seller-order'
import { useSellerOrders } from '@/lib/orders/use-seller-orders'
import type { OrderListMessages } from '@/messages'
import { messagesFor } from '@/messages'

import { OrderFilters } from './order-filters'
import { OrderPrintDocument } from './order-print-document'
import { ShipDialog } from './ship-dialog'

/**
 * `/orders` — 들어온 주문의 목록, 그 위의 뱃지, 그리고 발송까지.
 *
 * **표와 카드 중 하나만 마운트한다** (설계서 「모바일 전용 UI 패턴」). 미디어 쿼리로
 * 둘 다 그리면 DOM 이 두 배가 되고 접근성 트리도 중복된다 — 그래서 뷰포트 훅이
 * 고르고, 열의 정의(`TableColumn[]`)는 **한 벌**이라 두 모양이 다른 것을 보여 줄 수
 * 없다.
 *
 * **서버 렌더에서 아무것도 기다리지 않는다.** 제목·탭·필터는 API 가 깨어나는 동안
 * 만들어져 나가고, 그것이 이 화면에 네 상태가 있는 이유다 (P5 · U1).
 */
export interface OrderListWorkspaceProps {
  readonly title: string
  readonly messages?: OrderListMessages
}

/** 데스크톱과 모바일을 가르는 폭. 표가 다섯 열 아래로 눌리기 시작하는 지점이다. */
const TABLE_MIN_WIDTH = 768

export function OrderListWorkspace(props: OrderListWorkspaceProps) {
  const messages = props.messages ?? messagesFor().orderList

  return (
    <ToastProvider closeLabel={messages.toast.closeLabel} regionLabel={messages.toast.regionLabel}>
      <OrderListScreen {...props} />
    </ToastProvider>
  )
}

/** 일괄 처리 하나의 결말. 실패한 건은 번호와 이유로 남는다 (R1). */
interface BulkOutcome {
  readonly done: number
  readonly failed: readonly { readonly orderNumber: string; readonly reason: string }[]
}

function OrderListScreen({ title, messages = messagesFor().orderList }: OrderListWorkspaceProps) {
  const orders = useSellerOrders()
  const vocabulary = messagesFor().orders
  const toast = useToast()
  const wide = useMinWidth(TABLE_MIN_WIDTH)

  const [shipping, setShipping] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<ApiFailure | null>(null)
  const [outcome, setOutcome] = useState<BulkOutcome | null>(null)
  const [printed, setPrinted] = useState<readonly PrintedOrder[]>([])

  const { state, selected, toggle, toggleAll, pagination, summary } = orders
  const items = state.status === 'ready' ? state.items : []
  const allSelected = items.length > 0 && items.every((item) => selected.has(item.id))
  const describe = useCallback(
    (value: ApiFailure) =>
      failureMessage(value, { errors: messagesFor().errors, failures: messagesFor().apiFailures }),
    [],
  )

  /**
   * 고른 것 중 **발송할 수 있는 것**만.
   *
   * 체크박스는 상태를 가리지 않는다. 고를 수 없는 이유를 침묵으로 말하는 것보다,
   * 고른 뒤에 「이 중 다섯 건은 발송할 수 없어요」라고 말하는 편이 낫다.
   */
  const shippable = items.filter((item) => selected.has(item.id) && isShippable(item.status))

  async function confirmShipping(carrierCode: DemoCarrierCode | undefined): Promise<void> {
    if (busy) return

    setBusy(true)
    setFailure(null)
    setOutcome(null)

    const failed: { orderNumber: string; reason: string }[] = []
    let done = 0

    // **한 건씩이고, 실패해도 멈추지 않는다** (R1). 전체를 한 요청으로 묶으면 하나가
    // 거절될 때 나머지도 함께 되돌아가는데, 판매자가 원한 것은 「되는 것은 보내라」다.
    for (const item of shippable) {
      try {
        await runAction(item.id, 'SHIPPED', carrierCode === undefined ? {} : { carrierCode })
        done += 1
      } catch (error) {
        failed.push({ orderNumber: item.orderNumber, reason: describe(apiFailure(error)) })
      }
    }

    setBusy(false)
    orders.refresh()

    if (failed.length === 0) {
      setShipping(false)
      toast.toast({
        title: messages.ship.done.replace('{count}', String(done)),
        variant: 'success',
      })

      return
    }

    setOutcome({ done, failed })
    toast.toast({
      title: messages.ship.partial
        .replace('{done}', String(done))
        .replace('{failed}', String(failed.length)),
      variant: 'warning',
    })
  }

  async function exportSelection(): Promise<void> {
    if (busy) return

    setBusy(true)

    const collected = await orders.collectAll()

    setBusy(false)

    if (!collected.ok) {
      setFailure(collected.failure)

      return
    }

    if (collected.value.length === 0) {
      toast.toast({ title: messages.bulk.exportEmpty, variant: 'neutral' })

      return
    }

    download(
      ordersToCsv(collected.value, {
        columns: messages.bulk.exportColumns,
        emptyTracking: messages.table.noTracking,
        formatDate: dateTime,
        statusLabels: vocabulary.statusLabels,
      }),
      exportFileName('orders', new Date()),
    )
    toast.toast({
      title: messages.bulk.exported.replace('{count}', String(collected.value.length)),
      variant: 'success',
    })
  }

  async function printSelection(): Promise<void> {
    if (busy) return

    setBusy(true)

    try {
      // 한 건씩 상세를 읽는다. 목록에는 수령인 전체와 항목이 없고(F6 · A5), 종이에
      // 필요한 것은 정확히 그 둘이다.
      const documents = await Promise.all(
        items.filter((item) => selected.has(item.id)).map((item) => fetchSellerOrder(item.id)),
      )

      setPrinted(documents.map((order) => ({ id: order.sellerOrder.id, order })))
      // 브라우저가 그린 뒤에 인쇄 대화상자를 연다. 같은 틱에 부르면 방금 넣은
      // 주문서가 아직 없는 문서를 인쇄한다.
      requestAnimationFrame(() => {
        globalThis.print?.()
      })
    } catch (error) {
      setFailure(apiFailure(error))
    } finally {
      setBusy(false)
    }
  }

  const columns: readonly TableColumn<SellerOrderListItem>[] = [
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
          aria-label={messages.table.selectRow.replace('{orderNumber}', row.orderNumber)}
          checked={selected.has(row.id)}
          onCheckedChange={() => {
            toggle(row.id)
          }}
        />
      ),
    },
    {
      key: 'orderNumber',
      header: messages.table.orderNumber,
      cell: (row) => <Link href={`/orders/${row.id}`}>{row.orderNumber}</Link>,
    },
    {
      key: 'orderedAt',
      header: messages.table.orderedAt,
      cell: (row) => dateTime(row.orderedAt),
    },
    {
      key: 'status',
      header: messages.table.status,
      cell: (row) => <Badge variant="neutral">{vocabulary.statusLabels[row.status]}</Badge>,
    },
    {
      key: 'recipient',
      header: messages.table.recipient,
      cell: (row) => row.maskedRecipientName,
    },
    {
      key: 'items',
      header: messages.table.items,
      cell: (row) => (
        <span className="flex flex-col">
          <span>{headlineOf(row, messages)}</span>
          <span className="text-fg-muted text-xs">
            {messages.table.quantity.replace('{count}', String(row.totalQuantity))}
          </span>
        </span>
      ),
    },
    {
      key: 'paidAmount',
      header: messages.table.paidAmount,
      numeric: true,
      cell: (row) => money(row.paidAmount),
    },
    {
      key: 'tracking',
      header: messages.table.tracking,
      cell: (row) => row.trackingNumber ?? messages.table.noTracking,
    },
  ]

  const rows = (
    <>
      {wide ? (
        <Table
          caption={messages.table.caption}
          columns={columns}
          rowKey={(row) => row.id}
          rows={items}
          stickyHeader
        />
      ) : (
        <TableToCards
          actions={(row) => <Link href={`/orders/${row.id}`}>{messages.table.open}</Link>}
          caption={messages.table.caption}
          columns={columns}
          rowKey={(row) => row.id}
          rows={items}
          titleKey="orderNumber"
        />
      )}
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
    </>
  )

  const body = (
    <DataList
      empty={
        orders.isFiltered ? (
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
          onRetry={orders.reload}
          retryLabel={messages.retry}
          title={messages.errorTitle}
        />
      }
      loading={<Skeleton label={messages.loadingLabel} shape="text" />}
      state={state.status === 'ready' ? (items.length === 0 ? 'empty' : 'ready') : state.status}
    >
      {rows}
    </DataList>
  )

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-fg text-2xl font-bold">{title}</h1>
          <p className="text-fg-muted text-sm">{messages.description}</p>
        </div>
        <p className="flex flex-wrap items-center gap-2">
          {summary === null ? null : summary.actionRequired === 0 ? (
            <Badge variant="neutral">{messages.badges.none}</Badge>
          ) : (
            <>
              <Badge variant="warning">
                {messages.badges.actionRequired.replace('{count}', String(summary.actionRequired))}
              </Badge>
              {summary.newOrders === 0 ? null : (
                <Badge variant="primary">
                  {messages.badges.newOrders.replace('{count}', String(summary.newOrders))}
                </Badge>
              )}
            </>
          )}
        </p>
      </header>

      <Tabs
        aria-label={messages.tabs.label}
        items={SELLER_ORDER_TABS.map((tab) => ({
          value: tab,
          label:
            summary === null
              ? messages.tabs.names[tab]
              : messages.tabs.countLabel
                  .replace('{name}', messages.tabs.names[tab])
                  .replace('{count}', String(tabCountOf(tab, summary.counts))),
          // 활성 탭에만 내용을 준다. 여섯 벌을 만들면 같은 표가 여섯 번 생기고,
          // 라딕스가 하나만 그린다는 사실에 기대는 코드가 된다.
          content: tab === orders.filters.tab ? body : null,
        }))}
        onValueChange={(value) => {
          orders.setFilters({ ...orders.filters, tab: value as SellerOrderTab })
        }}
        value={orders.filters.tab}
      />

      <OrderFilters
        disabled={state.status === 'loading'}
        messages={messages}
        onChange={orders.setFilters}
        value={orders.filters}
      />

      {selected.size === 0 ? null : (
        <div
          aria-label={messages.bulk.selected.replace('{count}', String(selected.size))}
          className="border-border bg-surface-muted flex flex-wrap items-center gap-3 rounded-md border p-3"
          role="group"
        >
          <span className="text-fg text-sm font-medium">
            {messages.bulk.selected.replace('{count}', String(selected.size))}
          </span>
          <Button
            onClick={() => {
              if (shippable.length === 0) {
                toast.toast({ title: messages.ship.nothingShippable, variant: 'neutral' })

                return
              }

              setOutcome(null)
              setFailure(null)
              setShipping(true)
            }}
            size="sm"
            type="button"
          >
            {messages.bulk.ship}
          </Button>
          <Button onClick={() => void printSelection()} size="sm" type="button">
            {messages.bulk.print}
          </Button>
          <Button disabled={busy} onClick={() => void exportSelection()} size="sm" type="button">
            {busy ? messages.bulk.exporting : messages.bulk.export}
          </Button>
          <Button onClick={orders.clearSelection} size="sm" type="button" variant="ghost">
            {messages.bulk.clear}
          </Button>
        </div>
      )}

      {failure === null ? null : (
        <ErrorNotice
          copiedLabel={messages.failure.copiedLabel}
          copyLabel={messages.failure.copyLabel}
          description={describe(failure)}
          requestIdHint={messages.failure.requestIdHint}
          requestIdLabel={messages.failure.requestIdLabel}
          title={messages.failure.title}
          {...requestIdProp(failure)}
        />
      )}

      <ShipDialog
        busy={busy}
        closeLabel={messages.closeLabel}
        count={shippable.length}
        failed={outcome?.failed ?? []}
        failure={failure}
        failureMessages={messages.failure}
        messages={messages.ship}
        onClose={() => {
          setShipping(false)
          setOutcome(null)
          setFailure(null)
        }}
        onConfirm={(carrierCode) => void confirmShipping(carrierCode)}
        open={shipping}
        vocabulary={vocabulary}
      />

      <div data-print-document="">
        {printed.map((entry) => (
          <OrderPrintDocument
            key={entry.id}
            messages={messagesFor().orderDetail.print}
            order={entry.order}
            statusLabels={vocabulary.statusLabels}
          />
        ))}
      </div>
    </div>
  )
}

/** 인쇄 대기 중인 주문서 하나. */
interface PrintedOrder {
  readonly id: string
  readonly order: Awaited<ReturnType<typeof fetchSellerOrder>>
}

/** 인용할 가치가 있을 때만 요청 번호를 붙인다. */
function requestIdProp(failure: ApiFailure): { readonly requestId?: string } {
  const requestId = quotableRequestId(failure)

  return requestId === null ? {} : { requestId }
}

/** 「울 코트 외 2건」. 개수는 서버가 세고 문장은 여기서 만든다. */
function headlineOf(row: SellerOrderListItem, messages: OrderListMessages): string {
  if (row.itemCount <= 1) return row.headline

  return messages.table.headlineWithRest
    .replace('{headline}', row.headline)
    .replace('{rest}', String(row.itemCount - 1))
}

/**
 * 만들어진 문자열을 파일로 내려보낸다.
 *
 * `Blob` 과 임시 URL 을 쓰는 이유는 `data:` URL 에 길이 제한이 있고 한글이 인코딩을
 * 한 번 더 지나기 때문이다. 다 쓴 URL 을 되돌려주지 않으면 탭이 살아 있는 동안 그
 * 메모리가 남는다.
 */
function download(content: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a')

  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}
