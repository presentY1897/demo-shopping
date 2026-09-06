'use client'

import type { ApiFailure, ClaimAction, ClaimItem, SellerClaimDetail } from '@shopping/shared'
import { failureMessage, hasCode, quotableRequestId } from '@shopping/shared'
import {
  Badge,
  Button,
  DataList,
  EmptyState,
  ErrorNotice,
  ErrorState,
  Link,
  Modal,
  Skeleton,
  Table,
  Textarea,
  ToastProvider,
  useToast,
} from '@shopping/ui/components'
import type { TableColumn } from '@shopping/ui/components'
import { useCallback, useId, useState } from 'react'

import { reasonFieldOf } from '@/lib/claims/claim-console'
import { useSellerClaim } from '@/lib/claims/use-seller-claim'
import { dateTime, money } from '@/lib/orders/format'
import type { ClaimDetailMessages, ClaimVocabularyMessages } from '@/messages'
import { messagesFor } from '@/messages'

/**
 * `/claims/[id]` — 한 건을 보고, 승인·거절하고, 수거와 검수를 민다.
 *
 * **버튼은 상태가 아니라 서버의 `actions` 가 정한다.** 화면이 「`INSPECTING` 이면 검수
 * 버튼」을 적으면 그 판단이 세 앱에 흩어지고, 규칙이 바뀔 때 한 곳만 고쳐진다.
 *
 * **그리고 그 걸음이 어느 문으로 가는지도 서버가 답한다** (`action.route`). 전이
 * 라우트로 수거·검수를 밀면 상태는 옮겨지지만 **옮겨지기만 한다** — 회수 운송장은 나지
 * 않고 검수 결과는 적히지 않으며, 합격했는데 환불이 시작되지 않는다. 「반품완료인데
 * 아무 일도 일어나지 않은 반품」이 그것이고, 아무 오류도 나지 않는다.
 *
 * **귀책은 읽기 전용이다.** 판매자가 그것을 바꾸는 서버 계약이 없다 — 반품의 귀책은
 * 신청 사유에서 파생돼 신청 시점에 굳는다. 컨트롤을 내지 않고 **왜 여기서 바꿀 수
 * 없는지**를 적는 것이 이 화면의 규약이다.
 */
export interface ClaimDetailWorkspaceProps {
  readonly claimId: string
  readonly messages?: ClaimDetailMessages
}

export function ClaimDetailWorkspace(props: ClaimDetailWorkspaceProps) {
  const messages = props.messages ?? messagesFor().claimDetail

  return (
    <ToastProvider closeLabel={messages.toast.closeLabel} regionLabel={messages.toast.regionLabel}>
      <ClaimDetailScreen {...props} />
    </ToastProvider>
  )
}

function ClaimDetailScreen({
  claimId,
  messages = messagesFor().claimDetail,
}: ClaimDetailWorkspaceProps) {
  const detail = useSellerClaim(claimId)
  const vocabulary = messagesFor().claims
  const toast = useToast()
  const reasonId = useId()

  const [pending, setPending] = useState<ClaimAction | null>(null)
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState(false)
  const [failure, setFailure] = useState<ApiFailure | null>(null)

  const describe = useCallback(
    (value: ApiFailure) =>
      failureMessage(value, { errors: messagesFor().errors, failures: messagesFor().apiFailures }),
    [],
  )

  const ready = detail.state.status === 'ready' ? detail.state.claim : null
  const pendingField = pending === null ? null : reasonFieldOf(pending)

  async function run(action: ClaimAction): Promise<void> {
    setFailure(null)

    const answer = await detail.run(action, { reason })

    if (!answer.ok) {
      /*
       * **서버가 사유를 요구했으면 그 답도 그 칸에 그린다** (U2 · TASK-0070 5장).
       *
       * 화면이 먼저 막는 것은 친절이고 규칙은 서버에 있다. 그런데 서버의 거절을 화면
       * 어딘가의 배너로 그리면, 화면의 검사와 서버의 검사가 **다른 자리를 가리킨다** —
       * 같은 잘못에 두 가지 모양의 답이 나가는 것은 그 자체로 결함이다.
       */
      if (pendingField !== null && hasCode(answer.failure, 'CLAIM_REASON_REQUIRED')) {
        setReasonError(true)

        return
      }

      setFailure(answer.failure)

      return
    }

    setPending(null)
    setReason('')
    toast.toast({
      title: answer.value.changed
        ? messages.actions.done.replace('{status}', vocabulary.statusLabels[answer.value.status])
        : messages.actions.unchanged,
      variant: answer.value.changed ? 'success' : 'neutral',
    })
  }

  function confirm(action: ClaimAction): void {
    if (reasonFieldOf(action) !== null && reason.trim() === '') {
      // U2: 오류를 **그 필드에** 붙인다. 대화상자 위의 문장 하나로는 어느 칸이 문제인지
      // 말하지 못한다.
      setReasonError(true)

      return
    }

    void run(action)
  }

  const itemColumns: readonly TableColumn<ClaimItem>[] = [
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
      key: 'refund',
      header: messages.items.refund,
      numeric: true,
      /*
       * **`ClaimItem.refundAmount` 가 아니라 견적의 줄에서 읽는다.**
       *
       * 저 값은 아직 계산되지 않아 언제나 0 이고(TASK-0068), 그 0 은 「0원을 돌려준다」가
       * 아니라 「아직 계산하지 않았다」다. 그대로 그리면 화면은 **틀린 금액을 자신 있게**
       * 적는다.
       */
      cell: (row) => money(quoteAmountOf(ready, row.orderItemId)),
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-col gap-1">
          <Link href="/claims">{messages.backToList}</Link>
          <h1 className="text-fg text-2xl font-bold">{messages.title}</h1>
          {ready === null ? null : (
            <p className="text-fg-muted text-sm">
              {messages.subtitle.replace('{orderNumber}', ready.claim.orderNumber)}
            </p>
          )}
        </div>
        {ready === null ? null : (
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="neutral">{vocabulary.typeLabels[ready.claim.type]}</Badge>
            <Badge variant="neutral">{vocabulary.statusLabels[ready.claim.status]}</Badge>
            <Badge variant={ready.stage === 'WAITING' ? 'warning' : 'neutral'}>
              {vocabulary.stageLabels[ready.stage]}
            </Badge>
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
              {ready.actions.length === 0 ? (
                <p className="text-fg-muted text-sm">{messages.actions.empty}</p>
              ) : (
                ready.actions.map((action) => (
                  <Button
                    // U3: 도는 동안 두 번째 클릭이 두 번째 요청이 되지 않는다.
                    disabled={detail.busy}
                    key={`${action.route}:${action.to}`}
                    onClick={() => {
                      setFailure(null)
                      setReasonError(false)
                      setReason('')
                      setPending(action)
                    }}
                    type="button"
                    variant="primary"
                  >
                    {actionLabelOf(action, vocabulary)}
                  </Button>
                ))
              )}
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

            <section aria-label={messages.sections.deadline} className="flex flex-col gap-2">
              <h2 className="text-fg text-lg font-medium">{messages.sections.deadline}</h2>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="text-fg-muted">{messages.deadline.label}</dt>
                <dd className="flex flex-wrap items-center gap-2">
                  {dateTime(ready.dueAt)}
                  {/* 색이 아니라 문장이 지연을 말한다. */}
                  <Badge variant={ready.overdue ? 'danger' : 'neutral'}>
                    {ready.overdue ? messages.deadline.overdue : messages.deadline.onTime}
                  </Badge>
                </dd>
              </dl>
              {ready.overdue ? (
                <p className="text-danger text-sm" role="alert">
                  {messages.deadline.overdueNotice.replace('{due}', dateTime(ready.dueAt))}
                </p>
              ) : null}
              {/* 주말만 세고 공휴일은 보지 않는다는 사실을 감추지 않는다. */}
              <p className="text-fg-subtle text-xs">{messages.deadline.rule}</p>
            </section>

            <section className="flex flex-col gap-2">
              <h2 className="text-fg text-lg font-medium">{messages.sections.items}</h2>
              <Table
                caption={messages.items.caption}
                columns={itemColumns}
                rowKey={(row) => row.id}
                rows={ready.claim.items}
              />
            </section>

            <section aria-label={messages.sections.request} className="flex flex-col gap-2">
              <h2 className="text-fg text-lg font-medium">{messages.sections.request}</h2>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="text-fg-muted">{messages.request.requestedAt}</dt>
                <dd>{dateTime(ready.claim.requestedAt)}</dd>
                <dt className="text-fg-muted">{messages.request.reason}</dt>
                <dd className="whitespace-pre-wrap">{ready.claim.reason}</dd>
              </dl>
            </section>

            {ready.return === null ? null : (
              <section aria-label={messages.sections.photos} className="flex flex-col gap-2">
                <h2 className="text-fg text-lg font-medium">{messages.sections.photos}</h2>
                {ready.return.photos.length === 0 ? (
                  <p className="text-fg-muted text-sm">{messages.photos.empty}</p>
                ) : (
                  <ul className="flex flex-wrap gap-3">
                    {ready.return.photos.map((photo, index) => (
                      <li key={photo.key}>
                        {photo.url === null ? (
                          /*
                            **URL 이 없는 것은 오류가 아니다.** 저장소가 설정되지 않은
                            배포에서는 열쇠만 있고 공개 주소가 없다 (TASK-0011 4.5).
                            깨진 이미지 아이콘 대신 문장으로 말한다.
                          */
                          <p className="border-border text-fg-muted flex h-24 w-20 items-center justify-center rounded-md border p-2 text-center text-xs">
                            {messages.photos.unavailable}
                          </p>
                        ) : (
                          <>
                            {/*
                              평범한 `<img>` 다. 주소는 서버가 준 것을 그대로 쓰고
                              (프론트에서 조합하지 않는다), `next/image` 는 저장소 호스트
                              마다 `remotePatterns` 항목을 요구한다.
                            */}
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              alt={messages.photos.alt.replace('{index}', String(index + 1))}
                              className="border-border h-24 w-20 rounded-md border object-cover"
                              loading="lazy"
                              src={photo.url}
                            />
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            {/*
              **제목을 상태로 정하지 않는다.** 같은 금액이 아직 안 나갔으면 예정액이고
              나갔으면 나간 액수이며, 어느 쪽인지는 서버의 `refunded` 하나가 답한다 —
              화면이 상태로 되짚으면 끝난 클레임이 「환불 예정액」을 보여 준다.
            */}
            <section
              aria-label={
                ready.refunded ? messages.quote.refundedTitle : messages.quote.pendingTitle
              }
              className="flex flex-col gap-2"
            >
              <h2 className="text-fg text-lg font-medium">
                {ready.refunded ? messages.quote.refundedTitle : messages.quote.pendingTitle}
              </h2>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="text-fg-muted">{messages.quote.itemsAmount}</dt>
                <dd>{money(ready.quote.itemsAmount)}</dd>
                {/*
                  **배송비는 부호를 살려서.** 「반품비 차감」과 「원 배송비 환불」을 하나로
                  접으면 0원이 되어 아무 일도 없었던 것처럼 보인다. 서버가 이미 부호 있는
                  한 수로 답하므로 화면이 할 일은 그것을 접지 않는 것뿐이다.
                */}
                <dt className="text-fg-muted">{messages.quote.shippingAmount}</dt>
                <dd>{money(ready.quote.shippingAmount)}</dd>
                <dt className="text-fg-muted font-medium">{messages.quote.total}</dt>
                <dd className="font-medium">{money(ready.quote.total)}</dd>
              </dl>
              <p className="text-fg-subtle text-xs">
                {ready.refunded ? messages.quote.refundedNotice : messages.quote.pendingNotice}
              </p>
            </section>

            <section aria-label={messages.sections.fault} className="flex flex-col gap-2">
              <h2 className="text-fg text-lg font-medium">{messages.sections.fault}</h2>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                {ready.return === null ? null : (
                  <>
                    <dt className="text-fg-muted">{messages.fault.returnReason}</dt>
                    <dd>{vocabulary.returnReasonLabels[ready.return.reason]}</dd>
                  </>
                )}
                <dt className="text-fg-muted">{messages.fault.fault}</dt>
                <dd>{vocabulary.faultLabels[ready.claim.fault]}</dd>
                {ready.return === null ? null : (
                  <>
                    <dt className="text-fg-muted">{messages.fault.returnShippingDeduction}</dt>
                    <dd>{money(ready.return.returnShippingDeduction)}</dd>
                    <dt className="text-fg-muted">{messages.fault.originalShippingRefund}</dt>
                    <dd>{money(ready.return.originalShippingRefund)}</dd>
                  </>
                )}
              </dl>
              {/*
                **입력 컨트롤을 내지 않는다.** 판매자가 귀책을 바꾸는 서버 계약이 없고,
                낼 수 없는 컨트롤을 비활성으로 내는 것은 「언젠가 열린다」는 거짓말이다.
                대신 왜 여기서 바꿀 수 없는지를 적는다 (TASK-0114 의 「옵션 축은 수정에서
                바꾸지 않는다」와 같은 방식).
              */}
              <p className="text-fg-subtle text-xs">{messages.fault.readOnlyNotice}</p>
            </section>

            {ready.return === null ? null : (
              <section aria-label={messages.sections.shipments} className="flex flex-col gap-2">
                <h2 className="text-fg text-lg font-medium">{messages.sections.shipments}</h2>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                  <dt className="text-fg-muted">{messages.shipments.pickup}</dt>
                  <dd>{ready.return.pickupTrackingNumber ?? messages.shipments.none}</dd>
                  <dt className="text-fg-muted">{messages.shipments.sendBack}</dt>
                  <dd>{ready.return.sendBackTrackingNumber ?? messages.shipments.none}</dd>
                </dl>
              </section>
            )}

            <section className="flex flex-col gap-2">
              <h2 className="text-fg text-lg font-medium">{messages.sections.history}</h2>
              {ready.claim.history.length === 0 ? (
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
                      // **누가 판단했는가.** 분쟁에서 근거가 되는 것이 이 칸이다.
                      cell: (row) => messagesFor().orders.actorLabels[row.actor],
                    },
                    {
                      key: 'reason',
                      header: messages.history.reason,
                      cell: (row) => row.reason ?? messages.history.noReason,
                    },
                  ]}
                  rowKey={(row) => row.id}
                  rows={ready.claim.history}
                />
              )}
            </section>
          </div>
        )}
      </DataList>

      <Modal
        closeLabel={messages.closeLabel}
        description={messages.actions.confirmBody.replace(
          '{action}',
          pending === null ? '' : actionLabelOf(pending, vocabulary),
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
                if (pending !== null) confirm(pending)
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
        open={pending !== null}
        title={messages.actions.confirmTitle}
      >
        <div className="flex flex-col gap-3">
          {pendingField === null ? null : (
            <div className="flex flex-col gap-1">
              <label className="text-fg-muted text-sm" htmlFor={reasonId}>
                {pendingField === 'note'
                  ? messages.actions.noteLabel
                  : messages.actions.reasonLabel}
              </label>
              <Textarea
                aria-invalid={reasonError || undefined}
                id={reasonId}
                onChange={(event) => {
                  setReason(event.target.value)
                  setReasonError(false)
                }}
                placeholder={
                  pendingField === 'note'
                    ? messages.actions.notePlaceholder
                    : messages.actions.reasonPlaceholder
                }
                value={reason}
              />
              {reasonError ? (
                <p className="text-danger text-sm" role="alert">
                  {pendingField === 'note'
                    ? messages.actions.noteRequired
                    : messages.actions.reasonRequired}
                </p>
              ) : null}
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
        </div>
      </Modal>
    </div>
  )
}

/**
 * 이 걸음의 이름.
 *
 * **`to` 만으로는 정할 수 없다.** `RETURN_REJECTED` 는 두 곳에서 나온다 — 신청을
 * 거절하는 것과 검수에서 떨어뜨리는 것이고, 둘은 같은 상태로 가지만 다른 일이다.
 * 가르는 것은 `route` 이고, 상태 하나에 문장 하나인 표로는 그 둘을 가를 수 없다.
 */
function actionLabelOf(action: ClaimAction, vocabulary: ClaimVocabularyMessages): string {
  if (action.route !== 'inspection') return vocabulary.actionLabels[action.to]

  return action.to === 'RETURN_COMPLETED'
    ? vocabulary.inspectionLabels.passed
    : vocabulary.inspectionLabels.failed
}

/** 이 항목 줄로 돌려줄 금액. 견적에 줄이 없으면 0 이다 — 잡히지 않은 수량이다. */
function quoteAmountOf(detail: SellerClaimDetail | null, orderItemId: string): number {
  if (detail === null) return 0

  return detail.quote.lines.find((line) => line.orderItemId === orderItemId)?.amount ?? 0
}

/** 인용할 가치가 있을 때만 요청 번호를 붙인다. */
function requestIdProp(failure: ApiFailure): { readonly requestId?: string } {
  const requestId = quotableRequestId(failure)

  return requestId === null ? {} : { requestId }
}
