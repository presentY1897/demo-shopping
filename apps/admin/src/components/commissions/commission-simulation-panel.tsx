'use client'

import type { ApiFailure } from '@shopping/shared'
import { COMMISSION_SIMULATION_DAYS } from '@shopping/shared'

import { commissionMoney } from '@/lib/commissions/format'
import type { CommissionSimulationState } from '@/lib/commissions/use-commissions'
import type { CommissionSimulationMessages } from '@/messages'

/**
 * 「바꾸면 얼마가 달라지나」 — **저장 버튼 옆에서** (F6).
 *
 * ## 가장 중요한 갈래는 숫자가 없는 쪽이다
 *
 * 돌아본 기간에 팔린 것이 없으면 서버는 세 금액을 전부 0으로 보낸다. 그것을 그대로
 * 그리면 「지금 요율이면 0원 · 새 요율이면 0원」이 되고, 그 문장은 **「영향이
 * 없다」로 읽힌다.** 실제로 일어난 일은 「비교할 근거가 없다」이고, 요율을 두 배로
 * 올리려는 사람에게 그 둘은 정반대의 뜻이다. 그래서 `sellerOrderCount` 가 0이면
 * 숫자를 지우고 그 사실을 적는다 — 판정은 서버가 보낸 그 수 하나로 끝난다.
 *
 * ## 이 값이 예측이 아니라는 사실도 함께 적는다
 *
 * 과거 주문에는 아무 영향이 없다 — 주문 시점의 요율이 항목에 박혀 있다(F4). 그래서
 * 이 미리보기가 답하는 것은 「앞으로 이만큼 달라진다」이고, 그 추정의 근거로 지난
 * 30일의 실제 판매를 쓴다. 그 근거를 적지 않으면 읽는 사람은 이 숫자를 확정된
 * 금액으로 받는다.
 */

export interface CommissionSimulationPanelProps {
  readonly state: CommissionSimulationState
  readonly messages: CommissionSimulationMessages
  /** 실패 하나를 이 화면의 문장으로. 부르는 쪽이 카탈로그를 들고 있다. */
  readonly describe: (failure: ApiFailure) => string
}

const DAYS = String(COMMISSION_SIMULATION_DAYS)

export function CommissionSimulationPanel({
  state,
  messages,
  describe,
}: CommissionSimulationPanelProps) {
  return (
    <section
      aria-label={messages.title}
      className="border-border bg-surface-muted flex flex-col gap-2 rounded-md border p-3"
    >
      {/*
        `h3` 다. 이 절은 폼(`h2`) 안에 있고, 한 단계를 건너뛴 제목은 화면을 제목으로
        훑는 사람에게 **없는 절**을 만든다 (axe `heading-order`).
      */}
      <h3 className="text-fg text-sm font-medium">{messages.title}</h3>

      {state.status === 'idle' ? <p className="text-fg-muted text-sm">{messages.idle}</p> : null}

      {state.status === 'loading' ? (
        <p className="text-fg-muted text-sm">{messages.loadingLabel}</p>
      ) : null}

      {state.status === 'error' ? (
        <div className="flex flex-col gap-1">
          <p className="text-fg text-sm font-medium">{messages.errorTitle}</p>
          <p className="text-fg-muted text-sm">{describe(state.failure)}</p>
        </div>
      ) : null}

      {state.status === 'ready' && state.result.sellerOrderCount === 0 ? (
        <div className="flex flex-col gap-1">
          <p className="text-fg text-sm font-medium">{messages.nothingTitle}</p>
          <p className="text-fg-muted text-sm">
            {messages.nothingDescription.replace('{days}', DAYS)}
          </p>
        </div>
      ) : null}

      {state.status === 'ready' && state.result.sellerOrderCount > 0 ? (
        <div className="flex flex-col gap-1">
          <p className="text-fg text-sm">
            {messages.summary
              .replace('{days}', DAYS)
              .replace('{sales}', commissionMoney(state.result.salesAmount))
              .replace('{current}', commissionMoney(state.result.currentAmount))
              .replace('{proposed}', commissionMoney(state.result.proposedAmount))}
          </p>
          <p className="text-fg-subtle text-xs">
            {messages.orderCount.replace('{count}', String(state.result.sellerOrderCount))}
          </p>
          <p className="text-fg-subtle text-xs">{messages.caveat.replace('{days}', DAYS)}</p>
        </div>
      ) : null}
    </section>
  )
}
