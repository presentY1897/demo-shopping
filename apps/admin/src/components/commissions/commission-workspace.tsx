'use client'

import type { ApiFailure, CommissionRate, ErrorMessages } from '@shopping/shared'
import { failureMessage } from '@shopping/shared'
import { EmptyState, ErrorState, Skeleton, ToastProvider, useToast } from '@shopping/ui/components'
import { useCallback, useMemo } from 'react'

import { categoryChoices } from '@/lib/attributes/categories'
import { useAuthorization } from '@/lib/auth/authorization'
import { useCategoryTree } from '@/lib/categories/use-category-tree'
import { commissionPercent } from '@/lib/commissions/format'
import { groupOpenRates } from '@/lib/commissions/scopes'
import { useCommissionRates } from '@/lib/commissions/use-commissions'
import { useSellerChoices } from '@/lib/commissions/use-sellers'
import type { CommissionMessages } from '@/messages'

import { CommissionOpenRates } from './commission-open-rates'
import { CommissionScopePanel } from './commission-scope-panel'

/**
 * `/commissions` — 플랫폼이 몇 퍼센트를 떼는지 보고, 바꾼다 (TASK-0079).
 *
 * ## 볼 수 있는 자격과 바꿀 수 있는 자격이 다르다 (F7)
 *
 * 읽기는 `commission.read` 이고 쓰기는 `commission.write` 이며, 운영자와 데모
 * 관리자는 앞엣것만 갖는다. **그 거절은 여기서 조건문으로 만들어지지 않는다** —
 * 권한 목록의 빈자리가 만들고(`role-permissions.ts`), 화면은 서버가 묻는 것과 같은
 * 표에 물어 같은 답을 받는다(`useAuthorization`). 화면이 따로 판정하면 두 판정이
 * 언젠가 갈라지고, 그때 살아 있어 보이는 버튼이 403 을 답한다.
 *
 * 읽기 자격이 없으면 화면 전체가 한 문장으로 대체되고, 쓰기 자격만 없으면 저장
 * 버튼만 막힌다. 「보여 주되 못 누르게 한다」가 이 콘솔의 규칙이다 — 감추면 콘솔이
 * 실제보다 적은 기능을 가진 것처럼 보인다.
 *
 * ## 목록에 「비었다」가 없다
 *
 * 그래서 `DataList` 를 쓰지 않는다. 요율이 한 줄도 없는 플랫폼에도 **폴백 요율은
 * 있고**(`fallbackRateBp`), 그 사실을 그리는 것이 이 절이 하는 가장 중요한
 * 일이다 (F3). 빈 상태를 만들어 두면 그 자리에 「설정된 요율이 없습니다」가 서고,
 * 그것은 「수수료를 받지 않는다」로 읽힌다.
 */

/** 목록이 아직 오지 않았을 때의 요율들. 참조가 고정이라 메모가 유지된다. */
const EMPTY_RATES: readonly CommissionRate[] = []

export interface CommissionWorkspaceProps {
  readonly messages: CommissionMessages
  /** `code` → sentence, for everything the API answers (TASK-0117 4.2). */
  readonly errors: ErrorMessages
}

export function CommissionWorkspace({ messages, errors }: CommissionWorkspaceProps) {
  const { ready, can, reason } = useAuthorization()

  // 아직 묻는 중이다. 여기서 거절을 그리면 부팅 갱신이 도는 동안 모든 운영자에게
  // 「볼 수 없어요」가 한 번씩 스친다 (`auth-context.tsx`).
  if (!ready) return <Skeleton label={messages.open.loadingLabel} lines={8} />

  if (!can('commission.read')) {
    return <EmptyState description={reason('commission.read')} title={messages.forbiddenTitle} />
  }

  return (
    <ToastProvider closeLabel={messages.toast.closeLabel} regionLabel={messages.toast.regionLabel}>
      <CommissionConsole errors={errors} messages={messages} />
    </ToastProvider>
  )
}

function CommissionConsole({ messages, errors }: CommissionWorkspaceProps) {
  const commissions = useCommissionRates()
  const sellers = useSellerChoices()
  const { reason } = useAuthorization()
  const { toast } = useToast()

  /**
   * 카테고리 범위를 고를 목록.
   *
   * 트리를 다시 만들지 않는다 — 속성 콘솔과 쿠폰 콘솔이 같은 목록을 같은 순서로
   * 쓰고(`lib/attributes/categories.ts`), 순서에 대한 답이 두 개면 두 화면이 다른
   * 것을 보여 준다. 요율이 걸린 카테고리의 **이름**도 여기서 나온다.
   */
  const tree = useCategoryTree()
  const categories = useMemo(
    () => (tree.state.status === 'ready' ? categoryChoices(tree.state.rows) : []),
    [tree.state],
  )

  const describe = useCallback(
    (failure: ApiFailure): string =>
      failureMessage(failure, { errors, failures: messages.failures }),
    [errors, messages.failures],
  )

  const { state } = commissions
  /** 아직 모른다. `0` 으로 접으면 「수수료를 받지 않는다」가 화면에 잠깐 나타난다. */
  const fallbackRateBp = state.status === 'ready' ? state.fallbackRateBp : null

  // 목록이 오기 전에는 빈 배열이고, 그 빈 배열은 **매 렌더 같은 것**이어야 한다.
  // 조건식이 새 배열을 만들면 그것을 의존성으로 쓰는 `useMemo` 가 아무것도 기억하지
  // 못한다.
  const rates = useMemo(() => (state.status === 'ready' ? state.rates : EMPTY_RATES), [state])
  const grouped = useMemo(() => groupOpenRates(rates), [rates])

  function announce(scopeName: string, rateBp: number): void {
    toast({
      description: messages.toast.saved
        .replace('{scope}', scopeName)
        .replace('{rate}', commissionPercent(rateBp)),
      title: messages.editor.title,
      variant: 'success',
    })
  }

  return (
    <div className="flex flex-col gap-8">
      {state.status === 'loading' ? (
        <Skeleton label={messages.open.loadingLabel} lines={6} />
      ) : null}

      {state.status === 'error' ? (
        <ErrorState
          description={describe(state.failure)}
          onRetry={commissions.reload}
          retryLabel={messages.open.retryLabel}
          title={messages.open.errorTitle}
        />
      ) : null}

      {state.status === 'ready' ? (
        <CommissionOpenRates
          categories={categories}
          fallbackRateBp={state.fallbackRateBp}
          messages={messages}
          rates={grouped}
          sellers={sellers.status === 'ready' ? sellers.choices : []}
        />
      ) : null}

      {/*
        목록이 아직 오지 않았어도 폼은 선다. 「지금 요율」한 줄만 비어 있을 뿐,
        범위를 고르고 미리보기를 보는 데는 목록이 필요하지 않다 (TASK-0101 4.3).
      */}
      <CommissionScopePanel
        categories={categories}
        categoriesLoading={tree.state.status === 'loading'}
        describe={describe}
        errors={errors}
        fallbackRateBp={fallbackRateBp}
        messages={messages}
        onSave={commissions.save}
        onSaved={announce}
        rates={rates}
        sellers={sellers}
        writeDenial={reason('commission.write')}
      />
    </div>
  )
}
