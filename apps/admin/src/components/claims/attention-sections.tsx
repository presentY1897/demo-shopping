'use client'

import type { ApiFailure } from '@shopping/shared'
import { DataList, EmptyState, ErrorState, Skeleton } from '@shopping/ui/components'

import type { FailedRefundState, OverdueState } from '@/lib/claims/use-claim-attention'
import type {
  AdminClaimListMessages,
  ClaimVocabularyMessages,
  FailedRefundMessages,
  OverdueClaimMessages,
} from '@/messages'

import { ClaimTable } from './claim-table'
import { FailedRefundTable } from './failed-refund-table'

/**
 * 지연과 실패한 환불, **두 자리에서 같은 모양으로** (F7).
 *
 * 클레임 화면의 탭과 대시보드의 패널이 같은 컴포넌트를 쓴다. 대시보드가 숫자만 들고
 * 목록은 저쪽에만 두면 「3건」을 본 사람이 무엇이 밀렸는지 알려면 화면을 옮겨야 하고,
 * 두 벌로 그리면 한쪽에만 `truncated` 경고가 붙는 날이 온다.
 *
 * 다른 것은 **몇 줄까지 읽는가**뿐이고, 그것은 부르는 쪽이 정한다.
 */

interface SectionProps {
  /** 실패를 이 화면의 문장으로. 부르는 쪽의 카탈로그를 지난 값이다. */
  readonly describe: (failure: ApiFailure) => string
  readonly onRetry: () => void
  readonly vocabulary: ClaimVocabularyMessages
}

export interface OverdueSectionProps extends SectionProps {
  readonly state: OverdueState
  readonly messages: OverdueClaimMessages
  /** 줄을 그리는 표의 열 이름들. 전체 목록과 **같은 표**를 쓴다. */
  readonly list: AdminClaimListMessages
}

export function OverdueSection({
  state,
  messages,
  list,
  vocabulary,
  describe,
  onRetry,
}: OverdueSectionProps) {
  const claims = state.status === 'ready' ? state.claims : []

  return (
    <DataList
      empty={<EmptyState description={messages.emptyDescription} title={messages.emptyTitle} />}
      error={
        <ErrorState
          description={state.status === 'error' ? describe(state.failure) : undefined}
          onRetry={onRetry}
          retryLabel={list.retryLabel}
          title={messages.errorTitle}
        />
      }
      loading={<Skeleton label={messages.loadingLabel} lines={4} />}
      state={state.status === 'ready' ? (claims.length === 0 ? 'empty' : 'ready') : state.status}
    >
      {/*
        훑기 상한에 닿았다는 것은 목록이 아니라 **사고**다. 이 문장을 숨기면 화면은
        스무 줄만 보여 주면서 그것이 전부인 것처럼 말한다.
      */}
      {state.status === 'ready' && state.truncated ? (
        <p
          className="border-danger bg-danger-surface text-fg rounded-md border p-3 text-sm"
          role="alert"
        >
          {messages.truncatedNotice}
        </p>
      ) : null}

      <ClaimTable
        caption={messages.listLabel}
        messages={list}
        rows={claims}
        vocabulary={vocabulary}
      />
    </DataList>
  )
}

export interface FailedRefundSectionProps extends SectionProps {
  readonly state: FailedRefundState
  readonly messages: FailedRefundMessages
  readonly retryLabel: string
}

export function FailedRefundSection({
  state,
  messages,
  vocabulary,
  describe,
  onRetry,
  retryLabel,
}: FailedRefundSectionProps) {
  const refunds = state.status === 'ready' ? state.refunds : []

  return (
    <DataList
      empty={<EmptyState description={messages.emptyDescription} title={messages.emptyTitle} />}
      error={
        <ErrorState
          description={state.status === 'error' ? describe(state.failure) : undefined}
          onRetry={onRetry}
          retryLabel={retryLabel}
          title={messages.errorTitle}
        />
      }
      loading={<Skeleton label={messages.loadingLabel} lines={4} />}
      state={state.status === 'ready' ? (refunds.length === 0 ? 'empty' : 'ready') : state.status}
    >
      {state.status === 'ready' && state.hasMore ? (
        <p
          className="border-danger bg-danger-surface text-fg rounded-md border p-3 text-sm"
          role="alert"
        >
          {messages.hasMoreNotice}
        </p>
      ) : null}

      <FailedRefundTable
        caption={messages.listLabel}
        messages={messages}
        rows={refunds}
        vocabulary={vocabulary}
      />
    </DataList>
  )
}
