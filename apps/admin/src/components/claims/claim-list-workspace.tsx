'use client'

import type { AdminClaimListItem, ApiFailure, ErrorMessages } from '@shopping/shared'
import { failureMessage, grantedScopes, platformOwnership } from '@shopping/shared'
import {
  Badge,
  Button,
  DataList,
  EmptyState,
  ErrorState,
  Pagination,
  Skeleton,
  Tabs,
} from '@shopping/ui/components'
import type { ReactNode } from 'react'
import { useCallback, useState } from 'react'

import { useAuth } from '@/lib/auth/auth-context'
import { useAuthorization } from '@/lib/auth/authorization'
import { shortId } from '@/lib/claims/format'
import { useAdminClaims } from '@/lib/claims/use-admin-claims'
import { useClaimAttention } from '@/lib/claims/use-claim-attention'
import type { AdminClaimMessages, ErrorNoticeMessages } from '@/messages'

import { FailedRefundSection, OverdueSection } from './attention-sections'
import { ClaimFilters } from './claim-filters'
import { ClaimTable } from './claim-table'
import { DefectReturnPanel } from './defect-return-panel'

/**
 * `/claims` — 플랫폼 전체의 클레임, 그리고 **지금 손봐야 할 것** 둘.
 *
 * ## 왜 한 화면에 탭 넷인가
 *
 * 앞의 세 목록이 답하는 질문이 하나다 — 「지금 개입이 필요한가」. 지연과 실패한 환불은
 * 전체 목록의 필터로 만들 수 없다(둘 다 다른 라우트이고, 지연은 영업일로 세므로
 * SQL 이 계산하지 못한다). 화면을 셋으로 나누면 사이드바에 클레임 항목이 셋 생기고,
 * 그중 둘은 대개 비어 있다.
 *
 * **넷째는 목록이 아니다.** 확정 후 하자 반품(F4)은 원본 거절이 없는 개입이라 어느
 * 목록에도 줄이 없고, 그래서 시작하려면 **주문에서** 출발해야 한다. 그 진입점이 될
 * 관리자 주문 화면은 아직 껍데기이므로(TASK-0092), 기다리는 대신 콘솔 안에서
 * 완결시킨다 — 자세한 것은 `defect-return-panel.tsx` 에 있다.
 *
 * ## 「처리할 수 없다」를 버튼이 아니라 문장으로 말한다
 *
 * 데모 관리자는 **플랫폼 전체를 조회하되 데모가 만든 것만 바꾼다**(D-058). 그런데 이
 * 목록의 어느 줄이 데모 계정의 것인지는 **응답에 없다** — `adminClaimListItemSchema`
 * 에 소유자 표시가 없고, 그것을 화면이 추측하면 실계정 건을 처리 가능한 것처럼
 * 보이거나 데모 건을 잠근다. 그래서 이 화면은 **계정에 대해 참인 문장**을 세워 두고
 * (`scope.demoNotice`), 한 건에 대한 답은 서버가 거절한 뒤에 상세가 말한다. 비활성
 * 버튼과 툴팁을 쓰지 않는 이유는 TASK-0063 4.1 에 있다.
 */

/** 지연·실패 목록이 한 번에 읽는 줄 수. 탭의 숫자도 이 요청이 답한다. */
const ATTENTION_LIMIT = 20

const TABS = ['all', 'overdue', 'failedRefunds', 'defectReturn'] as const

type ClaimTab = (typeof TABS)[number]

export interface ClaimListWorkspaceProps {
  readonly messages: AdminClaimMessages
  /** `code` → sentence, for everything the API answers (TASK-0117 4.2). */
  readonly errors: ErrorMessages
  /** 오류 배너가 요청 id 를 내밀 때 쓰는 문구. 넷째 탭이 쓰기를 하나 갖는다. */
  readonly notice: ErrorNoticeMessages
}

export function ClaimListWorkspace({ messages, errors, notice }: ClaimListWorkspaceProps) {
  const { ready, canOn, reasonOn } = useAuthorization()

  // 아직 묻는 중이다. 여기서 거절을 그리면 부팅 갱신이 도는 동안 모든 운영자에게
  // 「볼 수 없어요」가 한 번씩 스친다 (`auth-context.tsx`).
  if (!ready) return <Skeleton label={messages.list.loadingLabel} lines={6} />

  /*
   * **가드가 묻는 것이 서버가 묻는 것과 같아야 한다.**
   *
   * 이 라우트가 요구하는 것은 `claim.read` 를 가졌는가가 아니라 **`any` 로
   * 가졌는가**다 (`AdminClaimService.assertPlatformRead`) — `claim.read:own` 은 모든
   * 구매자와 판매자가 갖고 있고, 그것으로 열면 「내 것만」을 묻는 사람이 플랫폼 전체
   * 목록의 403 을 「불러오지 못했어요 · 다시 시도」로 받는다. 아무리 눌러도 되지 않는
   * 재시도다.
   *
   * 그 질문을 `platformOwnership` 이 그대로 말한다 — 아무도 소유하지 않고 데모가
   * 만들지도 않은 행이라, `any` 만이 닿는다. 판정 함수는 서버가 부르는 바로 그것이다.
   */
  if (!canOn('claim.read', platformOwnership)) {
    return (
      <EmptyState
        description={reasonOn('claim.read', platformOwnership)}
        title={messages.forbiddenTitle}
      />
    )
  }

  return <ClaimQueue errors={errors} messages={messages} notice={notice} />
}

function ClaimQueue({ messages, errors, notice }: ClaimListWorkspaceProps) {
  const claims = useAdminClaims()
  const attention = useClaimAttention(ATTENTION_LIMIT)
  const { subject } = useAuth()
  const [tab, setTab] = useState<ClaimTab>('all')

  const describe = useCallback(
    (failure: ApiFailure): string =>
      failureMessage(failure, { errors, failures: messages.failures }),
    [errors, messages.failures],
  )

  const { state, pagination, filters } = claims
  const items = state.status === 'ready' ? state.items : []

  /**
   * 이 계정의 `claim.handle` 이 **전부 데모 스코프인가** — 곧 `DEMO_ADMIN` 이다.
   *
   * 계정에 대한 질문이라 답할 수 있다. 줄에 대한 같은 질문은 답할 수 없고, 그것이 위
   * 주석의 요지다.
   */
  const handleScopes = subject === null ? [] : grantedScopes(subject, 'claim.handle')
  const demoScoped = handleScopes.length > 0 && handleScopes.every((scope) => scope === 'demo')

  const narrowSeller = (row: AdminClaimListItem): void => {
    claims.setFilters({ ...filters, sellerId: row.sellerId, sellerName: row.brandName })
  }

  const narrowBuyer = (row: AdminClaimListItem): void => {
    claims.setFilters({ ...filters, buyerId: row.buyerId })
  }

  const allTab = (
    <div className="flex flex-col gap-4">
      <ClaimFilters
        disabled={state.status === 'loading'}
        messages={messages.list}
        onChange={claims.setFilters}
        value={filters}
        vocabulary={messages.vocabulary}
      />

      {/*
        고른 가게·구매자는 **지울 수 있는 칩**으로 남는다. 필터 바에 없는 조건이 목록을
        좁히고 있는데 화면에 그 사실이 없으면, 비어 있는 목록이 「없다」로 읽힌다.
      */}
      {filters.sellerId === null && filters.buyerId === null ? null : (
        <ul className="flex flex-wrap items-center gap-2">
          {filters.sellerId === null ? null : (
            <li className="flex items-center gap-1">
              <Badge variant="neutral">
                {messages.list.narrow.activeSeller.replace('{name}', filters.sellerName ?? '')}
              </Badge>
              <Button
                onClick={() => {
                  claims.setFilters({ ...filters, sellerId: null, sellerName: null })
                }}
                size="sm"
                variant="ghost"
              >
                {messages.list.narrow.clear}
              </Button>
            </li>
          )}
          {filters.buyerId === null ? null : (
            <li className="flex items-center gap-1">
              <Badge variant="neutral">
                {messages.list.narrow.activeBuyer.replace('{id}', shortId(filters.buyerId))}
              </Badge>
              <Button
                onClick={() => {
                  claims.setFilters({ ...filters, buyerId: null })
                }}
                size="sm"
                variant="ghost"
              >
                {messages.list.narrow.clear}
              </Button>
            </li>
          )}
        </ul>
      )}

      <DataList
        empty={
          claims.narrowed ? (
            <EmptyState
              description={messages.list.filteredEmptyDescription}
              title={messages.list.filteredEmptyTitle}
            />
          ) : (
            <EmptyState
              description={messages.list.emptyDescription}
              title={messages.list.emptyTitle}
            />
          )
        }
        error={
          <ErrorState
            description={state.status === 'error' ? describe(state.failure) : undefined}
            onRetry={claims.reload}
            retryLabel={messages.list.retryLabel}
            title={messages.list.errorTitle}
          />
        }
        loading={<Skeleton label={messages.list.loadingLabel} lines={6} />}
        state={state.status === 'ready' ? (items.length === 0 ? 'empty' : 'ready') : state.status}
      >
        <ClaimTable
          caption={messages.list.listLabel}
          messages={messages.list}
          onNarrowBuyer={narrowBuyer}
          onNarrowSeller={narrowSeller}
          rows={items}
          vocabulary={messages.vocabulary}
        />

        <Pagination
          hasNext={pagination.hasNext}
          hasPrevious={pagination.hasPrevious}
          label={messages.list.pagination.label}
          nextLabel={messages.list.pagination.next}
          onNext={pagination.goNext}
          onPrevious={pagination.goPrevious}
          previousLabel={messages.list.pagination.previous}
          status={pageStatus(messages, pagination.pageIndex, items.length)}
        />
      </DataList>
    </div>
  )

  const overdueTab = (
    <OverdueSection
      describe={describe}
      list={messages.list}
      messages={messages.overdue}
      onRetry={attention.reload}
      state={attention.overdue}
      vocabulary={messages.vocabulary}
    />
  )

  const refundTab = (
    <FailedRefundSection
      describe={describe}
      messages={messages.failedRefunds}
      onRetry={attention.reload}
      retryLabel={messages.list.retryLabel}
      state={attention.refunds}
      vocabulary={messages.vocabulary}
    />
  )

  /**
   * 넷째 탭은 목록이 아니라 **시작하는 자리**다 (TASK-0071 F4).
   *
   * 앞의 셋은 「지금 개입이 필요한가」에 답하고 이것은 「개입을 시작한다」이다. 그런데
   * 같은 자리에 있어야 하는 이유가 그 차이보다 크다 — 확정 후 하자 반품은 **원본
   * 거절이 없는 개입**이라 어느 목록에도 줄이 없고, 진입점이 될 관리자 주문 화면은
   * 아직 껍데기다(TASK-0092). 사이드바에 항목을 하나 더 만드는 대신 콘솔 안에서
   * 완결시킨다.
   */
  const panels: Readonly<Record<ClaimTab, ReactNode>> = {
    all: allTab,
    overdue: overdueTab,
    failedRefunds: refundTab,
    defectReturn: <DefectReturnPanel describe={describe} messages={messages} notice={notice} />,
  }

  return (
    <div className="flex flex-col gap-4">
      {demoScoped ? (
        <p
          className="border-border bg-surface-muted text-fg-muted rounded-md border p-3 text-sm"
          role="note"
        >
          {messages.scope.demoNotice}
        </p>
      ) : null}

      <Tabs
        aria-label={messages.list.tabs.label}
        items={TABS.map((name) => ({
          value: name,
          label: tabLabel(messages, name, attention),
          // 활성 탭에만 내용을 준다. 세 벌을 만들면 세 목록이 늘 함께 그려지고,
          // 라딕스가 하나만 보여 준다는 사실에 기대는 코드가 된다.
          content: name === tab ? panels[name] : null,
        }))}
        onValueChange={(value) => {
          setTab(value as ClaimTab)
        }}
        value={tab}
      />
    </div>
  )
}

/**
 * 탭의 이름, 숫자가 있으면 숫자와 함께.
 *
 * 지연과 실패는 **읽어 본 뒤에만** 숫자를 붙인다. 불러오는 중에 0을 그리면 그것은
 * 「없다」로 읽히고, 그 0 은 잠시 뒤 3으로 바뀐다.
 */
function tabLabel(
  messages: AdminClaimMessages,
  tab: ClaimTab,
  attention: ReturnType<typeof useClaimAttention>,
): string {
  const { tabs } = messages.list

  if (tab === 'all') return tabs.all
  // 숫자가 붙지 않는다 — 셀 목록이 없다.
  if (tab === 'defectReturn') return tabs.defectReturn

  const count =
    tab === 'overdue'
      ? attention.overdue.status === 'ready'
        ? attention.overdue.claims.length
        : null
      : attention.refunds.status === 'ready'
        ? attention.refunds.refunds.length
        : null

  const name = tab === 'overdue' ? tabs.overdue : tabs.failedRefunds

  return count === null
    ? name
    : tabs.countLabel.replace('{name}', name).replace('{count}', String(count))
}

/**
 * `2 페이지 · 20건`.
 *
 * 카탈로그의 조각을 이어 붙인다. 자리 표시자는 사람에게 `{page}` 로 그려질 수 있는 것이
 * 하나 더 생기는 일이고, 여기 숫자에는 문법이 필요 없다 (`sellers` 화면과 같은 방식).
 */
function pageStatus(messages: AdminClaimMessages, index: number, count: number): string {
  const { pageUnit, countUnit } = messages.list.pagination

  return `${String(index + 1)}${pageUnit} · ${String(count)}${countUnit}`
}
