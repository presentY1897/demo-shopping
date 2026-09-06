'use client'

import type { ApiFailure, ErrorMessages, Settlement } from '@shopping/shared'
import { failureMessage, platformOwnership } from '@shopping/shared'
import {
  Badge,
  DataList,
  EmptyState,
  ErrorState,
  linkClassName,
  Skeleton,
  ToastProvider,
  useToast,
} from '@shopping/ui/components'
import { ConfirmDialog } from '@shopping/ui/form'
import NextLink from 'next/link'
import { useCallback, useState } from 'react'

import { useAuthorization } from '@/lib/auth/authorization'
import { settlementDateTime, settlementMoney, settlementPeriod } from '@/lib/settlements/format'
import type { SettlementAction } from '@/lib/settlements/transitions'
import { permissionFor, statusVariant } from '@/lib/settlements/transitions'
import { useSettlement } from '@/lib/settlements/use-settlement'
import type { SettlementMessages } from '@/messages'

import { SettlementActions } from './settlement-actions'
import { SettlementCalculation } from './settlement-calculation'
import { SettlementHoldDialog } from './settlement-hold-dialog'
import { SettlementItemsTable } from './settlement-items-table'

/**
 * `/settlements/[id]` — 정산서 한 장과, 관리자가 그것에 대해 할 수 있는 일.
 *
 * ## 확인을 두 번 묻지 않고, 한 번은 반드시 묻는다 (R1)
 *
 * 승인과 지급 확정에는 확인 다이얼로그가 붙고 **그 안에 금액이 다시 적힌다.**
 * 되돌아가는 화살표가 없기 때문이다(`transitions.ts`) — 잘못 지급하면 다음 회차에서
 * 조정하는 수밖에 없고, 그것은 판매자에게 설명해야 하는 일이 된다.
 *
 * 보류는 확인 다이얼로그가 아니라 **폼**이다. 물어야 하는 것이 「예/아니오」가
 * 아니라 문장 하나이고, 그 문장이 없으면 보류 자체가 성립하지 않는다 (F4).
 *
 * ## 거절은 배너로 남는다
 *
 * 409(`SETTLEMENT_WRONG_STATUS`)가 이 화면에서 실제로 일어난다 — 목록을 열어 둔
 * 채 남이 같은 정산서를 승인하면 그렇다. 그때 필요한 것은 토스트가 아니라 **버튼
 * 옆에 남는 문장**이고, 그 문장을 읽은 사람이 다시 읽기를 누르면 상태가 갱신되면서
 * 버튼도 바뀐다.
 */

export interface SettlementDetailWorkspaceProps {
  readonly settlementId: string
  readonly messages: SettlementMessages
  /** `code` → sentence, for everything the API answers (TASK-0117 4.2). */
  readonly errors: ErrorMessages
}

export function SettlementDetailWorkspace(props: SettlementDetailWorkspaceProps) {
  const { messages } = props

  return (
    <ToastProvider closeLabel={messages.toast.closeLabel} regionLabel={messages.toast.regionLabel}>
      <SettlementDetailScreen {...props} />
    </ToastProvider>
  )
}

function SettlementDetailScreen({
  settlementId,
  messages,
  errors,
}: SettlementDetailWorkspaceProps) {
  const settlement = useSettlement(settlementId)
  const { ready, can, canOn, reason, reasonOn } = useAuthorization()
  const { toast } = useToast()

  /** 지금 열려 있는 대화상자. 둘이 동시에 열릴 일은 없다. */
  const [pending, setPending] = useState<SettlementAction | null>(null)
  const [failure, setFailure] = useState<ApiFailure | null>(null)

  const describe = useCallback(
    (value: ApiFailure): string => failureMessage(value, { errors, failures: messages.failures }),
    [errors, messages.failures],
  )

  const { detail } = messages

  // 아직 묻는 중이다. 여기서 거절을 그리면 부팅 갱신이 도는 동안 모든 운영자에게
  // 「볼 수 없어요」가 한 번씩 스친다 (`auth-context.tsx`).
  if (!ready) return <Skeleton label={detail.loadingLabel} lines={8} />

  /*
   * 한 장을 읽는 것도 **판매자를 지정하지 않은 조회**와 같은 자격을 요구한다 —
   * 서버는 정산서의 `sellerId` 로 소유를 판정하므로 판매자는 자기 것을 읽을 수
   * 있지만, 관리자 콘솔이 여기 오는 길은 언제나 플랫폼 전체 목록이다. 목록이 물은
   * 것과 같은 것을 묻지 않으면, 목록을 열지 못한 계정에게 상세만 열리는 화면이
   * 된다.
   */
  if (!canOn('settlement.read', platformOwnership)) {
    return (
      <EmptyState
        description={reasonOn('settlement.read', platformOwnership)}
        title={messages.forbiddenTitle}
      />
    )
  }

  const current = settlement.state.status === 'ready' ? settlement.state.settlement : null

  async function act(action: SettlementAction, holdReason: string): Promise<ApiFailure | null> {
    const result = await settlement.run(action, holdReason)

    // 아무것도 보내지 않았다 — 이미 도는 중인 요청 위에 두 번째 클릭이 온 것이다.
    if (result === null) return null

    if (!result.ok) {
      setFailure(result.failure)

      return result.failure
    }

    setFailure(null)
    setPending(null)
    toast({ title: messages.toast[TOAST_OF[action]], variant: 'success' })

    return null
  }

  const period =
    current === null
      ? ''
      : settlementPeriod(current.periodStart, current.periodEnd, messages.list.period)

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-col gap-1">
          <NextLink className={linkClassName()} href="/settlements">
            {detail.backLabel}
          </NextLink>
          <h1 className="text-fg text-2xl font-bold">{detail.title}</h1>
          {current === null ? null : (
            <p className="text-fg-muted text-sm">
              {detail.subtitle.replace('{brand}', current.brandName).replace('{period}', period)}
            </p>
          )}
        </div>
        {current === null ? null : (
          <Badge variant={statusVariant(current.status)}>
            {messages.statusLabels[current.status]}
          </Badge>
        )}
      </header>

      <DataList
        empty={<EmptyState description={detail.notFoundDescription} title={detail.notFoundTitle} />}
        error={
          <ErrorState
            description={
              settlement.state.status === 'error' ? describe(settlement.state.failure) : undefined
            }
            onRetry={settlement.reload}
            retryLabel={detail.retryLabel}
            title={detail.errorTitle}
          />
        }
        loading={<Skeleton label={detail.loadingLabel} lines={8} />}
        state={
          settlement.state.status === 'missing'
            ? 'empty'
            : settlement.state.status === 'ready'
              ? 'ready'
              : settlement.state.status
        }
      >
        {settlement.state.status !== 'ready' ? null : (
          <div className="flex flex-col gap-6">
            <section aria-label={detail.sections.actions} className="flex flex-col gap-2">
              <h2 className="text-fg text-lg font-medium">{detail.sections.actions}</h2>

              <SettlementActions
                busy={settlement.busy}
                can={(action) => can(permissionFor(action))}
                denial={(action) => reason(permissionFor(action))}
                messages={messages.actions}
                onSelect={(action) => {
                  setFailure(null)
                  setPending(action)
                }}
                status={settlement.state.settlement.status}
              />

              {failure === null ? null : (
                <div
                  className="border-danger bg-danger-surface text-fg flex flex-col gap-1 rounded-md border p-3 text-sm"
                  role="alert"
                >
                  <p className="font-medium">{messages.actions.failedTitle}</p>
                  <p>{describe(failure)}</p>
                </div>
              )}
            </section>

            <SettlementSummary
              messages={messages}
              period={period}
              settlement={settlement.state.settlement}
            />

            <SettlementCalculation messages={detail} settlement={settlement.state.settlement} />

            <SettlementItemsTable items={settlement.state.items} messages={messages} />
          </div>
        )}
      </DataList>

      {/*
        확인 다이얼로그는 승인과 지급 확정 둘뿐이고, **둘 다 금액을 다시 적는다**
        (R1). 보류는 아래의 폼이 대신한다.
      */}
      {current !== null && (pending === 'approve' || pending === 'pay') ? (
        <ConfirmDialog
          cancelLabel={messages.actions.confirm[pending].cancel}
          closeLabel={messages.actions.confirm[pending].closeLabel}
          confirmLabel={messages.actions.confirm[pending].confirm}
          description={messages.actions.confirm[pending].description
            .replace('{brand}', current.brandName)
            .replace('{period}', period)
            .replace('{amount}', settlementMoney(current.payoutAmount))}
          destructive={pending === 'pay'}
          onConfirm={async () => {
            const rejected = await act(pending, '')

            // 던지면 대화상자가 열린 채 남는다(`ConfirmDialog`). 사람이 다시
            // 시도하거나 물러날 수 있어야 하고, 무엇이 잘못됐는지는 이미 버튼 옆
            // 배너에 문장으로 서 있으므로 이 오류는 아무 데도 나타나지 않는다.
            if (rejected !== null) throw new Error('settlement action rejected')
          }}
          onOpenChange={(open) => {
            if (!open) setPending(null)
          }}
          open
          size="md"
          title={messages.actions.confirm[pending].title}
        />
      ) : null}

      {pending === 'hold' ? (
        <SettlementHoldDialog
          describe={describe}
          errors={errors}
          messages={messages.actions}
          onCancel={() => {
            setPending(null)
            setFailure(null)
          }}
          onConfirm={(holdReason) => act('hold', holdReason)}
        />
      ) : null}
    </div>
  )
}

/** 판단 하나가 성공했을 때 뜨는 토스트의 열쇠. */
const TOAST_OF: Readonly<Record<SettlementAction, 'approved' | 'held' | 'paid'>> = {
  approve: 'approved',
  hold: 'held',
  pay: 'paid',
}

/**
 * 이 정산서에 대해 **언제 무슨 일이 있었나.**
 *
 * 일어나지 않은 일은 빈칸이 아니라 `—` 다. 빈칸은 「아직 아니다」와 「못 읽었다」를
 * 같은 모양으로 만들고, 지급 시각이 비어 있는 것은 이 화면에서 가장 중요한 사실
 * 중 하나다.
 *
 * **보류 사유는 해소된 뒤에도 남는다** (`settlementSchema`). 승인된 정산서에도
 * 그 줄이 서 있는 이유는, 판매자가 묻는 것이 대개 지급 뒤이기 때문이다.
 */
function SettlementSummary({
  settlement,
  period,
  messages,
}: {
  readonly settlement: Settlement
  readonly period: string
  readonly messages: SettlementMessages
}) {
  const copy = messages.detail.summary
  const when = (value: string | null): string =>
    value === null ? copy.none : settlementDateTime(value)

  return (
    <section aria-label={messages.detail.sections.summary} className="flex flex-col gap-2">
      <h2 className="text-fg text-lg font-medium">{messages.detail.sections.summary}</h2>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-fg-muted">{copy.brandName}</dt>
        <dd>{settlement.brandName}</dd>
        <dt className="text-fg-muted">{copy.period}</dt>
        <dd>{period}</dd>
        <dt className="text-fg-muted">{copy.status}</dt>
        <dd>{messages.statusLabels[settlement.status]}</dd>
        <dt className="text-fg-muted">{copy.createdAt}</dt>
        <dd>{when(settlement.createdAt)}</dd>
        <dt className="text-fg-muted">{copy.heldAt}</dt>
        <dd>{when(settlement.heldAt)}</dd>
        <dt className="text-fg-muted">{copy.holdReason}</dt>
        <dd className="whitespace-pre-wrap">{settlement.holdReason ?? copy.none}</dd>
        <dt className="text-fg-muted">{copy.approvedAt}</dt>
        <dd>{when(settlement.approvedAt)}</dd>
        <dt className="text-fg-muted">{copy.paidAt}</dt>
        <dd>{when(settlement.paidAt)}</dd>
      </dl>
    </section>
  )
}
