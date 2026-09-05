'use client'

import type { ApiFailure, DemoCarrierCode, OrderStatus, SellerOrderAction } from '@shopping/shared'
import { failureMessage, quotableRequestId } from '@shopping/shared'
import { CONSOLE_DENSITY } from '@shopping/ui'
import {
  Badge,
  Button,
  DataList,
  EmptyState,
  ErrorNotice,
  ErrorState,
  GuardedButton,
  Link,
  Modal,
  ShipmentTracking,
  Skeleton,
  Table,
  Textarea,
  ToastProvider,
  useToast,
} from '@shopping/ui/components'
import type { TableColumn } from '@shopping/ui/components'
import { useCallback, useId, useState } from 'react'

import { CONSOLE_TIME_ZONE, dateTime, money } from '@/lib/orders/format'
import { actionRouteOf, isPressable, needsReason } from '@/lib/orders/order-console'
import { useSellerOrder } from '@/lib/orders/use-seller-order'
import type { OrderDetailMessages } from '@/messages'
import { messagesFor } from '@/messages'

import { OrderPrintDocument } from './order-print-document'
import { ShipDialog } from './ship-dialog'

/**
 * `/orders/[id]` — 한 건을 보고, 상태를 옮기고, 종이로 뽑는다.
 *
 * **버튼은 상태가 아니라 `GET …/actions` 가 정한다** (F5 · 설계서 4장). 화면이
 * 「`PREPARING` 이면 발송」을 적으면 그 판단이 세 앱에 흩어지고, 규칙이 바뀔 때 한
 * 곳만 고쳐진다. 조건이 모자란 것도 목록에 들어오므로 **감추지 않고 비활성 + 사유**로
 * 그린다 — 버튼을 감추면 판매자는 그것을 찾다가 포기한다.
 *
 * 목적지에 따라 세 문 중 하나로 간다(`actionRouteOf`). 그 표가 왜 필요한지는 그쪽
 * 주석이 설명하고, 요점은 **배송완료가 전이 라우트로 가면 배송 표가 따라오지 않는
 * 것**이다 (TASK-0061 4.4).
 */
export interface OrderDetailWorkspaceProps {
  readonly sellerOrderId: string
  readonly messages?: OrderDetailMessages
}

export function OrderDetailWorkspace(props: OrderDetailWorkspaceProps) {
  const messages = props.messages ?? messagesFor().orderDetail

  return (
    <ToastProvider closeLabel={messages.toast.closeLabel} regionLabel={messages.toast.regionLabel}>
      <OrderDetailScreen {...props} />
    </ToastProvider>
  )
}

/** 지금 확인을 기다리는 것. `null` 이면 대화상자가 닫혀 있다. */
type Pending =
  { readonly kind: 'ship' } | { readonly kind: 'confirm'; readonly to: OrderStatus } | null

function OrderDetailScreen({
  sellerOrderId,
  messages = messagesFor().orderDetail,
}: OrderDetailWorkspaceProps) {
  const detail = useSellerOrder(sellerOrderId)
  const vocabulary = messagesFor().orders
  const toast = useToast()
  const reasonId = useId()

  const [pending, setPending] = useState<Pending>(null)
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState(false)
  const [failure, setFailure] = useState<ApiFailure | null>(null)

  const describe = useCallback(
    (value: ApiFailure) =>
      failureMessage(value, { errors: messagesFor().errors, failures: messagesFor().apiFailures }),
    [],
  )

  const ready = detail.state.status === 'ready' ? detail.state : null

  async function run(to: OrderStatus, carrierCode?: DemoCarrierCode): Promise<void> {
    setFailure(null)

    const answer = await detail.run(to, {
      ...(carrierCode === undefined ? {} : { carrierCode }),
      ...(needsReason(to) ? { reason } : {}),
    })

    if (!answer.ok) {
      setFailure(answer.failure)

      return
    }

    setPending(null)
    setReason('')
    toast.toast({
      title: messages.actions.done.replace('{status}', vocabulary.statusLabels[answer.value]),
      variant: 'success',
    })
  }

  function press(action: SellerOrderAction): void {
    setFailure(null)
    setReasonError(false)
    setReason('')

    // 발송만 고를 것이 있다(운송사). 나머지는 확인 하나이거나 사유 한 줄이다.
    setPending(
      actionRouteOf(action.to) === 'shipment'
        ? { kind: 'ship' }
        : {
            kind: 'confirm',
            to: action.to,
          },
    )
  }

  function confirm(to: OrderStatus): void {
    if (needsReason(to) && reason.trim() === '') {
      // U2: 오류를 **그 필드에** 붙인다. 대화상자 위의 문장 하나로는 어느 칸이
      // 문제인지 말하지 못한다.
      setReasonError(true)

      return
    }

    void run(to)
  }

  const itemColumns: readonly TableColumn<
    NonNullable<typeof ready>['order']['sellerOrder']['items'][number]
  >[] = [
    {
      key: 'product',
      header: messages.items.product,
      cell: (row) => row.snapshot.productName,
    },
    {
      key: 'option',
      header: messages.items.option,
      cell: (row) =>
        row.snapshot.optionLabel === '' ? messages.items.noOption : row.snapshot.optionLabel,
    },
    {
      key: 'quantity',
      header: messages.items.quantity,
      numeric: true,
      cell: (row) => row.quantity,
    },
    {
      key: 'unitPrice',
      header: messages.items.unitPrice,
      numeric: true,
      cell: (row) => money(row.unitPrice),
    },
    {
      key: 'amount',
      header: messages.items.amount,
      numeric: true,
      cell: (row) => money(row.productAmount),
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-col gap-1">
          <Link href="/orders">{messages.backToList}</Link>
          <h1 className="text-fg text-2xl font-bold">{messages.title}</h1>
          {ready === null ? null : (
            <p className="text-fg-muted text-sm">
              {messages.subtitle.replace('{orderNumber}', ready.order.orderNumber)}
            </p>
          )}
        </div>
        {ready === null ? null : (
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="neutral">
              {vocabulary.statusLabels[ready.order.sellerOrder.status]}
            </Badge>
            <Button
              onClick={() => {
                globalThis.print?.()
              }}
              size="sm"
              type="button"
              variant="secondary"
            >
              {messages.print.action}
            </Button>
          </div>
        )}
      </header>

      <DataList
        empty={
          <EmptyState description={messages.notFound.description} title={messages.notFound.title} />
        }
        error={
          <ErrorState
            description={
              detail.state.status === 'error' ? describe(detail.state.failure) : undefined
            }
            onRetry={detail.reload}
            retryLabel={messages.retry}
            title={messages.errorTitle}
          />
        }
        loading={<Skeleton label={messages.loadingLabel} shape="text" />}
        state={detail.state.status === 'ready' ? 'ready' : detail.state.status}
      >
        {ready === null ? null : (
          <div className="flex flex-col gap-6">
            <section aria-label={messages.actions.legend} className="flex flex-wrap gap-2">
              {ready.actions.map((action) => (
                <ActionButton action={action} key={action.to} messages={messages} onPress={press} />
              ))}
            </section>

            {/*
              대화상자가 열려 있으면 그 안에 같은 알림이 있다. 둘을 함께 그리면 같은
              문장이 화면에 두 번 나오고, 보조 기술은 그것을 두 번 읽는다.
            */}
            {failure === null || pending !== null ? null : (
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

            <section className="flex flex-col gap-2">
              <h2 className="text-fg text-lg font-medium">{messages.sections.items}</h2>
              <Table
                caption={messages.items.caption}
                columns={itemColumns}
                rowKey={(row) => row.id}
                rows={ready.order.sellerOrder.items}
              />
            </section>

            <section aria-label={messages.sections.recipient} className="flex flex-col gap-2">
              <h2 className="text-fg text-lg font-medium">{messages.sections.recipient}</h2>
              {/*
                **전체 이름과 연락처가 여기 있다.** 목록에서는 가려 나가고(F6) 상세에서
                보여 주는 것이 설계서의 규약이다 — 판매자는 이 화면에서 상자에 붙일
                주소를 옮겨 적는다.
              */}
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="text-fg-muted">{messages.recipient.name}</dt>
                <dd>{ready.order.recipient.name}</dd>
                <dt className="text-fg-muted">{messages.recipient.phone}</dt>
                <dd>{ready.order.recipient.phone}</dd>
                <dt className="text-fg-muted">{messages.recipient.address}</dt>
                <dd>
                  [{ready.order.recipient.postalCode}] {ready.order.recipient.addressLine1}{' '}
                  {ready.order.recipient.addressLine2 ?? ''}
                </dd>
              </dl>
            </section>

            <section className="flex flex-col gap-2">
              <h2 className="text-fg text-lg font-medium">{messages.sections.amounts}</h2>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="text-fg-muted">{messages.amounts.productAmount}</dt>
                <dd>{money(ready.order.sellerOrder.productAmount)}</dd>
                <dt className="text-fg-muted">{messages.amounts.couponDiscountAmount}</dt>
                <dd>{money(ready.order.sellerOrder.couponDiscountAmount)}</dd>
                <dt className="text-fg-muted">{messages.amounts.pointDiscountAmount}</dt>
                <dd>{money(ready.order.sellerOrder.pointDiscountAmount)}</dd>
                <dt className="text-fg-muted">{messages.amounts.shippingFee}</dt>
                <dd>{money(ready.order.sellerOrder.shippingFee)}</dd>
                <dt className="text-fg-muted font-medium">{messages.amounts.paidAmount}</dt>
                <dd className="font-medium">{money(ready.order.sellerOrder.paidAmount)}</dd>
              </dl>
            </section>

            <section className="flex flex-col gap-2">
              <h2 className="text-fg text-lg font-medium">{messages.sections.shipment}</h2>
              {/*
                구매자 화면과 **같은 컴포넌트**다 (`packages/ui`). 두 벌을 만들면
                「판매자 화면에는 있는데 구매자 화면에는 없는 값」이 생기고, 그것을
                메우는 두 번째 조회가 반드시 따라온다.
              */}
              <ShipmentTracking
                density={CONSOLE_DENSITY}
                labels={messages.tracking}
                locale="ko-KR"
                onCopyTrackingNumber={(trackingNumber) => {
                  void navigator.clipboard?.writeText(trackingNumber)
                  toast.toast({ title: messages.copiedTrackingNumber, variant: 'success' })
                }}
                shipment={ready.order.sellerOrder.shipment}
                timeZone={CONSOLE_TIME_ZONE}
              />
            </section>

            <section className="flex flex-col gap-2">
              <h2 className="text-fg text-lg font-medium">{messages.history.title}</h2>
              {ready.order.sellerOrder.history.length === 0 ? (
                <p className="text-fg-muted text-sm">{messages.history.empty}</p>
              ) : (
                <Table
                  caption={messages.history.caption}
                  columns={[
                    {
                      key: 'at',
                      header: messages.history.at,
                      cell: (row) => dateTime(row.occurredAt),
                    },
                    {
                      key: 'change',
                      header: messages.history.change,
                      cell: (row) =>
                        row.fromStatus === null
                          ? messages.history.created
                          : messages.history.step
                              .replace('{from}', vocabulary.statusLabels[row.fromStatus])
                              .replace('{to}', vocabulary.statusLabels[row.toStatus]),
                    },
                    {
                      key: 'actor',
                      header: messages.history.actor,
                      // **누가 옮겼는가.** 분쟁에서 근거가 되는 것이 이 칸이고,
                      // `SYSTEM` 이 사람이 아니라는 사실이 여기서 문장이 된다.
                      cell: (row) => vocabulary.actorLabels[row.actor],
                    },
                    {
                      key: 'reason',
                      header: messages.history.reason,
                      cell: (row) => row.reason ?? messages.history.noReason,
                    },
                  ]}
                  rowKey={(row) => row.id}
                  rows={ready.order.sellerOrder.history}
                />
              )}
            </section>
          </div>
        )}
      </DataList>

      <ShipDialog
        busy={detail.busy}
        closeLabel={messages.closeLabel}
        count={1}
        failure={failure}
        failureMessages={messages.failure}
        messages={messages.ship}
        onClose={() => {
          setPending(null)
          setFailure(null)
        }}
        onConfirm={(carrierCode) => void run('SHIPPED', carrierCode)}
        open={pending?.kind === 'ship'}
        vocabulary={vocabulary}
      />

      <Modal
        closeLabel={messages.closeLabel}
        description={messages.actions.confirmBody.replace(
          '{action}',
          pending?.kind === 'confirm' ? vocabulary.actionLabels[pending.to] : '',
        )}
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
              {messages.actions.cancel}
            </Button>
            <Button
              disabled={detail.busy}
              onClick={() => {
                if (pending?.kind === 'confirm') confirm(pending.to)
              }}
              type="button"
              variant="primary"
            >
              {messages.actions.confirm}
            </Button>
          </div>
        }
        onOpenChange={(next) => {
          if (!next) {
            setPending(null)
            setFailure(null)
          }
        }}
        open={pending?.kind === 'confirm'}
        title={messages.actions.confirmTitle}
      >
        <div className="flex flex-col gap-3">
          {pending?.kind === 'confirm' && needsReason(pending.to) ? (
            <div className="flex flex-col gap-1">
              <label className="text-fg-muted text-sm" htmlFor={reasonId}>
                {messages.actions.reasonLabel}
              </label>
              <Textarea
                aria-invalid={reasonError || undefined}
                id={reasonId}
                onChange={(event) => {
                  setReason(event.target.value)
                  setReasonError(false)
                }}
                placeholder={messages.actions.reasonPlaceholder}
                value={reason}
              />
              {reasonError ? (
                <p className="text-danger text-sm" role="alert">
                  {messages.actions.reasonRequired}
                </p>
              ) : null}
            </div>
          ) : null}

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
        </div>
      </Modal>

      <div data-print-document="">
        {ready === null ? null : (
          <OrderPrintDocument
            messages={messages.print}
            order={ready.order}
            statusLabels={vocabulary.statusLabels}
          />
        )}
      </div>
    </div>
  )
}

/**
 * 서버가 준 버튼 하나.
 *
 * **감추지 않는다.** 조건이 모자란 전이도 `GET …/actions` 의 답에 들어 있고
 * (`enabled: false` + `blockedBy`), 그것을 감추면 판매자는 버튼을 **찾다가** 포기한다.
 * `GuardedButton` 이 `aria-disabled` 로 그리는 것도 같은 이유다 — 네이티브
 * `disabled` 는 탭 순서에서 빠져 키보드 사용자에게는 존재조차 알려지지 않는다.
 *
 * 두 갈래를 삼항으로 쓰지 않고 나누는 것은 타입 때문이다. `blocked` 와 `reason` 은
 * 짝이고(그쪽 `BlockedProps`), 스프레드로 넘기면 그 짝이 컴파일러에게 보이지 않는다 —
 * 사유 없는 비활성 버튼을 막으려고 만든 장치가 그 순간 무력해진다.
 */
function ActionButton({
  action,
  messages,
  onPress,
}: {
  readonly action: SellerOrderAction
  readonly messages: OrderDetailMessages
  readonly onPress: (action: SellerOrderAction) => void
}) {
  const vocabulary = messagesFor().orders
  const label = vocabulary.actionLabels[action.to]

  if (isPressable(action)) {
    return (
      <GuardedButton
        onClick={() => {
          onPress(action)
        }}
        type="button"
        variant="primary"
      >
        {label}
      </GuardedButton>
    )
  }

  return (
    <GuardedButton
      blocked
      reason={messages.actions.blocked.replace(
        '{requirement}',
        action.blockedBy === null
          ? messages.actions.blockedUnknown
          : vocabulary.requirementLabels[action.blockedBy],
      )}
      type="button"
      variant="primary"
    >
      {label}
    </GuardedButton>
  )
}

/** 인용할 가치가 있을 때만 요청 번호를 붙인다. */
function requestIdProp(failure: ApiFailure): { readonly requestId?: string } {
  const requestId = quotableRequestId(failure)

  return requestId === null ? {} : { requestId }
}
