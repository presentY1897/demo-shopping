'use client'

import type {
  ApiFailure,
  BulkIssueResponse,
  BulkIssueTarget,
  CouponListEntry,
  CreateCouponRequest,
  ErrorMessages,
} from '@shopping/shared'
import { failureMessage, grantedScopes, platformOwnership } from '@shopping/shared'
import {
  DataList,
  EmptyState,
  ErrorState,
  Pagination,
  Skeleton,
  Tabs,
  ToastProvider,
  useToast,
} from '@shopping/ui/components'
import type { ReactNode } from 'react'
import { useCallback, useMemo, useState } from 'react'

import { useAuth } from '@/lib/auth/auth-context'
import { useAuthorization } from '@/lib/auth/authorization'
import { categoryChoices } from '@/lib/attributes/categories'
import { useCategoryTree } from '@/lib/categories/use-category-tree'
import { usePlatformCoupons } from '@/lib/coupons/use-platform-coupons'
import type { PlatformCouponMessages } from '@/messages'

import { BulkIssueDialog } from './bulk-issue-dialog'
import { CouponFilters } from './coupon-filters'
import { CouponTotals } from './coupon-totals'
import { CouponIssueForm } from './coupon-issue-form'
import { CouponTable } from './coupon-table'

/**
 * `/coupons` — 플랫폼이 부담하는 쿠폰을 내고, 그것이 무엇을 만들었는지 본다.
 *
 * ## 탭 둘, 그리고 둘 다 「플랫폼 부담」을 말한다 (F2)
 *
 * 목록과 발행은 운영자의 머릿속에서 다른 일이라 한 화면에 쌓지 않고 나눴다. 부담
 * 주체만 두 곳에 **같은 문장**으로 선다 — 그것이 이 화면의 존재 이유이고, 한쪽에만
 * 있으면 다른 쪽을 보고 있는 사람은 판매자가 무는 줄 안다.
 *
 * ## 볼 수 있는 자격과 낼 수 있는 자격이 다르다 (F7 · D-224)
 *
 * 목록은 **주인이 아무도 아닌 데이터**를 읽는 일이라 `coupon.read` 를 `any` 로 가진
 * 계정만 지나간다(`CouponConsoleService.assertMayList` 가 같은 것을 묻는다). 발행은
 * 다른 퍼미션이다 — `coupon.platform` 이 없으면 판매자는 남의 돈으로 하는 할인을 낼
 * 수 없고, 데모 관리자는 그것을 `demo` 스코프로 갖는다.
 *
 * **그 스코프를 화면이 판정하지는 않는다.** 「이 쿠폰의 주인이 데모인가」는 계정이
 * 아니라 행에 대한 질문이고, 브라우저의 `AuthorizationSubject` 에는 「내가 데모인가」가
 * 없다(일부러 없다 — `authorize.ts`). 그래서 이 화면은 **계정에 대해 참인 문장**을
 * 세워 두고(`scope.demoNotice`), 한 건에 대한 답은 서버가 거절한 뒤에 말한다. 비활성
 * 버튼과 툴팁을 쓰지 않는 이유는 TASK-0063 4.1 에 있다.
 */

const TABS = ['list', 'issue'] as const

type CouponTab = (typeof TABS)[number]

export interface PlatformCouponWorkspaceProps {
  readonly messages: PlatformCouponMessages
  /** `code` → sentence, for everything the API answers (TASK-0117 4.2). */
  readonly errors: ErrorMessages
}

export function PlatformCouponWorkspace({ messages, errors }: PlatformCouponWorkspaceProps) {
  const { ready, canOn, reasonOn } = useAuthorization()

  // 아직 묻는 중이다. 여기서 거절을 그리면 부팅 갱신이 도는 동안 모든 운영자에게
  // 「볼 수 없어요」가 한 번씩 스친다 (`auth-context.tsx`).
  if (!ready) return <Skeleton label={messages.list.loadingLabel} lines={6} />

  /*
   * **가드가 묻는 것이 서버가 묻는 것과 같아야 한다.**
   *
   * 플랫폼 목록이 요구하는 것은 `coupon.read` 를 가졌는가가 아니라 **`any` 로**
   * 가졌는가다. 구매자와 판매자도 자기 쿠폰에 대해 그 퍼미션을 갖고 있고, 그것으로
   * 열면 403 이 「불러오지 못했어요 · 다시 시도」로 도착한다 — 아무리 눌러도 되지
   * 않는 재시도다. 그 질문을 `platformOwnership` 이 그대로 말한다.
   */
  if (!canOn('coupon.read', platformOwnership)) {
    return (
      <EmptyState
        description={reasonOn('coupon.read', platformOwnership)}
        title={messages.forbiddenTitle}
      />
    )
  }

  return (
    <ToastProvider closeLabel={messages.toast.closeLabel} regionLabel={messages.toast.regionLabel}>
      <CouponConsole errors={errors} messages={messages} />
    </ToastProvider>
  )
}

/** 지금 열려 있는 대화상자와, 그것이 들고 있는 답. */
interface BulkDialog {
  readonly entry: CouponListEntry
  readonly result: BulkIssueResponse | null
  readonly failure: string | null
}

function CouponConsole({ messages, errors }: PlatformCouponWorkspaceProps) {
  const coupons = usePlatformCoupons()
  const { subject } = useAuth()
  const { toast } = useToast()
  const [tab, setTab] = useState<CouponTab>('list')
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [dialog, setDialog] = useState<BulkDialog | null>(null)

  /**
   * 카테고리 범위를 고를 목록.
   *
   * 트리를 다시 만들지 않는다 — 속성 콘솔이 같은 목록을 같은 순서로 쓰고
   * (`lib/attributes/categories.ts`), 순서에 대한 답이 두 개면 두 화면이 다른 것을
   * 보여 준다. 발행 탭을 열지 않은 사람에게도 한 번은 요청이 나가지만, 그 답은
   * 목록 화면에서도 캐시처럼 쓰인다.
   */
  const tree = useCategoryTree()
  const categories = useMemo(
    () => (tree.state.status === 'ready' ? categoryChoices(tree.state.rows) : []),
    [tree.state],
  )

  /**
   * 이 계정의 `coupon.platform` 이 **전부 데모 스코프인가** — 곧 `DEMO_ADMIN` 이다.
   *
   * 계정에 대한 질문이라 답할 수 있다. 줄에 대한 같은 질문은 답할 수 없고, 그것이 이
   * 파일 머리 주석의 요지다.
   */
  const platformScopes = subject === null ? [] : grantedScopes(subject, 'coupon.platform')
  const demoScoped = platformScopes.length > 0 && platformScopes.every((scope) => scope === 'demo')

  const describe = useCallback(
    (failure: ApiFailure): string => {
      /*
       * 데모 관리자가 받은 403 은 **한 가지 뜻**이다: 그 쿠폰의 주인이 데모가 아니다.
       * 「권한이 없어요」로 답하면 자기 등급 전체가 막힌 줄 알게 되는데, 실제로는
       * 자기가 낸 쿠폰에는 같은 버튼이 그대로 동작한다.
       */
      if (demoScoped && failure.kind === 'http' && failure.status === 403) {
        return messages.scope.outOfScope
      }

      return failureMessage(failure, { errors, failures: messages.failures })
    },
    [demoScoped, errors, messages.failures, messages.scope.outOfScope],
  )

  const { state, pagination, filters } = coupons
  const entries = state.status === 'ready' ? state.entries : []

  async function toggleSuspended(entry: CouponListEntry): Promise<void> {
    // 같은 줄을 두 번 누르는 것을 막는다 (U3). 다른 줄은 그대로 살아 있다 — 서로 다른
    // 쿠폰이고, 하나가 느리다고 나머지가 잠길 이유가 없다.
    if (pendingId !== null) return

    const suspending = entry.coupon.suspendedAt === null

    setPendingId(entry.coupon.id)

    const result = await coupons.setSuspended(entry.coupon.id, suspending)

    setPendingId(null)

    if (result.ok) {
      toast({
        description: suspending ? messages.toast.suspended : messages.toast.resumed,
        title: entry.coupon.name,
        variant: 'success',
      })

      return
    }

    toast({
      description: describe(result.failure),
      title: messages.toast.failedTitle,
      variant: 'danger',
    })
  }

  async function bulkIssue(target: BulkIssueTarget): Promise<void> {
    if (dialog === null || pendingId !== null) return

    const { entry } = dialog

    setPendingId(entry.coupon.id)

    const result = await coupons.bulkIssue(entry.coupon.id, target)

    setPendingId(null)

    // 대화상자는 열린 채로 답을 받는다. 세 숫자 중 하나가 **다음 행동을 요구하기**
    // 때문이고, 그 문장을 읽는 도중에 사라지는 알림으로는 그것을 말할 수 없다.
    setDialog({
      entry,
      failure: result.ok ? null : describe(result.failure),
      result: result.ok ? result.value : null,
    })
  }

  async function create(request: CreateCouponRequest): Promise<ApiFailure | null> {
    const result = await coupons.create(request)

    if (!result.ok) return result.failure

    toast({
      description: messages.toast.created.replace('{name}', request.name),
      title: messages.form.title,
      variant: 'success',
    })
    // 방금 만든 것이 목록의 맨 앞에 있다. 발행 폼에 그대로 머무르면 그 사실을 확인할
    // 길이 없고, 같은 내용을 한 번 더 보내기도 쉽다.
    setTab('list')

    return null
  }

  const listTab = (
    <div className="flex flex-col gap-4">
      {/* 목록과 폼이 같은 문장을 쓴다 (F2). */}
      <p
        className="border-border bg-surface-muted text-fg-muted rounded-md border p-3 text-sm"
        role="note"
      >
        {messages.burden.listNotice}
      </p>

      {/*
        누계는 목록 **위**에 선다. 조건을 바꿔도 흔들리지 않는 수라서, 표 안에 넣으면
        그 표의 합계로 읽힌다 — 그리고 그것은 틀린 읽기다.
      */}
      {state.status === 'ready' ? (
        <CouponTotals messages={messages.list.totals} totals={state.totals} />
      ) : null}

      <CouponFilters
        disabled={state.status === 'loading'}
        lifecycleLabels={messages.lifecycleLabels}
        messages={messages.list}
        onChange={coupons.setFilters}
        value={filters}
      />

      <DataList
        empty={
          coupons.narrowed ? (
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
            onRetry={coupons.reload}
            retryLabel={messages.list.retryLabel}
            title={messages.list.errorTitle}
          />
        }
        loading={<Skeleton label={messages.list.loadingLabel} lines={6} />}
        state={state.status === 'ready' ? (entries.length === 0 ? 'empty' : 'ready') : state.status}
      >
        <CouponTable
          caption={messages.list.listLabel}
          messages={messages}
          onBulkIssue={(entry) => {
            setDialog({ entry, failure: null, result: null })
          }}
          onToggleSuspended={(entry) => {
            void toggleSuspended(entry)
          }}
          pendingId={pendingId}
          rows={entries}
        />

        <Pagination
          hasNext={pagination.hasNext}
          hasPrevious={pagination.hasPrevious}
          label={messages.list.pagination.label}
          nextLabel={messages.list.pagination.next}
          onNext={pagination.goNext}
          onPrevious={pagination.goPrevious}
          previousLabel={messages.list.pagination.previous}
          status={pageStatus(messages, pagination.pageIndex, entries.length)}
        />
      </DataList>
    </div>
  )

  /**
   * 발행 폼 — **앞에 두 번째 관문을 두지 않는다.**
   *
   * 「발행할 수 있는가」는 다른 퍼미션이지만(`coupon.platform`), 오늘의 역할 표에서
   * 그것을 갖지 않은 계정은 위의 목록 관문을 이미 지나지 못한다: `coupon.read:any` 를
   * 가진 등급 셋이 모두 `coupon.platform` 을 함께 갖는다(`role-permissions.ts`).
   * 여기에 관문을 하나 더 두면 **아무 계정도 닿지 못하는 갈래**가 생기고, 그것은
   * 검사도 지나지 않은 채 화면에 남는다. 표가 바뀌어 그런 등급이 생기면 서버가
   * 여전히 거절하고, 그 거절은 폼 위의 문장이 된다 (`describe`).
   */
  const issueTab = (
    <CouponIssueForm
      categories={categories}
      categoriesLoading={tree.state.status === 'loading'}
      describe={describe}
      errors={errors}
      messages={messages}
      onSubmit={create}
    />
  )

  const panels: Readonly<Record<CouponTab, ReactNode>> = { issue: issueTab, list: listTab }

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
        aria-label={messages.tabs.label}
        items={TABS.map((name) => ({
          value: name,
          label: name === 'list' ? messages.tabs.list : messages.tabs.issue,
          // 활성 탭에만 내용을 준다. 두 벌을 만들면 폼이 늘 살아 있어, 목록을 보는
          // 동안에도 카테고리를 물어보고 초점 관리가 두 곳에서 겹친다.
          content: name === tab ? panels[name] : null,
        }))}
        onValueChange={(value) => {
          setTab(value as CouponTab)
        }}
        value={tab}
      />

      {dialog === null ? null : (
        <BulkIssueDialog
          busy={pendingId === dialog.entry.coupon.id}
          entry={dialog.entry}
          failure={dialog.failure}
          messages={messages.bulk}
          onClose={() => {
            setDialog(null)
          }}
          onConfirm={(target) => {
            void bulkIssue(target)
          }}
          result={dialog.result}
        />
      )}
    </div>
  )
}

/**
 * `2 페이지 · 20건`.
 *
 * 카탈로그의 조각을 이어 붙인다. 자리 표시자는 사람에게 `{page}` 로 그려질 수 있는
 * 것이 하나 더 생기는 일이고, 여기 숫자에는 문법이 필요 없다 (클레임 목록과 같은 방식).
 */
function pageStatus(messages: PlatformCouponMessages, index: number, count: number): string {
  const { pageUnit, countUnit } = messages.list.pagination

  return `${String(index + 1)}${pageUnit} · ${String(count)}${countUnit}`
}
