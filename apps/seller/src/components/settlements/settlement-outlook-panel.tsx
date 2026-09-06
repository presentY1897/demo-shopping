'use client'

import type { ApiFailure, SettlementOutlookStage } from '@shopping/shared'
import { failureMessage } from '@shopping/shared'
import { Skeleton } from '@shopping/ui/components'

import { count, money } from '@/lib/orders/format'
import type { SettlementOutlookState } from '@/lib/settlements/use-seller-settlements'
import type { Messages, SettlementOutlookMessages } from '@/messages'

/**
 * 정산 예정 금액 — **두 단계, 두 숫자** (TASK-0082 F4).
 *
 * ## 왜 더하지 않는가
 *
 * 「확정 대기」는 배송이 끝났지만 구매확정 전이라 **아직 반품될 수 있는 돈**이고,
 * 「정산 대기」는 구매확정돼서 다음 회차에 그대로 실릴 돈이다. 둘을 더해 한 줄로
 * 그리면 그 합이 「받기로 정해진 금액」으로 읽히고, 반품이 하나 들어온 날 판매자는
 * 자기가 본 숫자가 왜 줄었는지를 묻는다.
 *
 * 계약이 두 덩이로 나눠 보내는 이유가 그것이고(`settlementOutlookResponseSchema`),
 * 화면이 그것을 되돌리지 않는다. 아래 한 줄이 **왜 합계가 없는지**까지 적는다 —
 * 적지 않으면 판매자가 스스로 더한다.
 *
 * ## 실패해도 목록을 막지 않는다
 *
 * 예정액을 못 읽은 것이 정산 내역을 못 볼 이유는 아니다. 그래서 이 패널만 오류
 * 문장으로 바뀌고 아래 목록은 그대로 그려진다.
 */
export interface SettlementOutlookPanelProps {
  readonly state: SettlementOutlookState
  readonly messages: Messages
}

export function SettlementOutlookPanel({ state, messages }: SettlementOutlookPanelProps) {
  const copy = messages.settlementList.outlook

  return (
    <section
      aria-label={copy.regionLabel}
      className="border-border flex flex-col gap-3 rounded-md border p-4"
    >
      <h2 className="text-fg text-lg font-semibold">{copy.regionLabel}</h2>

      {state.status === 'loading' ? (
        <Skeleton label={messages.settlementList.loadingLabel} shape="text" />
      ) : null}

      {state.status === 'error' ? (
        <p className="text-danger text-sm" role="alert">
          {`${copy.errorTitle} ${describe(state.failure, messages)}`}
        </p>
      ) : null}

      {state.status === 'ready' ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Stage
              countValue={copy.countValue}
              hint={copy.awaitingConfirmationHint}
              label={copy.awaitingConfirmationLabel}
              stage={state.outlook.awaitingConfirmation}
            />
            <Stage
              countValue={copy.countValue}
              hint={copy.awaitingSettlementHint}
              label={copy.awaitingSettlementLabel}
              stage={state.outlook.awaitingSettlement}
            />
          </div>

          {/* 합계가 없는 이유. 이 줄이 없으면 두 숫자가 더해진다. */}
          <p className="text-fg-subtle text-xs">{copy.note}</p>
        </>
      ) : null}
    </section>
  )
}

/** 한 단계 — 이름 · 금액 · 건수 · 그리고 그 단계가 무슨 뜻인지. */
function Stage({
  label,
  hint,
  countValue,
  stage,
}: {
  readonly label: string
  readonly hint: string
  readonly countValue: SettlementOutlookMessages['countValue']
  readonly stage: SettlementOutlookStage
}) {
  return (
    <div className="border-border bg-surface-muted flex flex-col gap-1 rounded-md border p-3">
      <h3 className="text-fg-muted text-sm">{label}</h3>
      <p className="text-fg text-2xl font-bold">{money(stage.payoutAmount)}</p>
      <p className="text-fg-muted text-sm">
        {countValue.replace('{count}', count(stage.sellerOrderCount))}
      </p>
      {/* 「확정 대기」와 「정산 대기」는 이름만으로 구분되지 않는다. 뜻을 붙인다. */}
      <p className="text-fg-subtle text-xs">{hint}</p>
    </div>
  )
}

function describe(failure: ApiFailure, messages: Messages): string {
  return failureMessage(failure, { errors: messages.errors, failures: messages.apiFailures })
}
