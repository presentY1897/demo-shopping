'use client'

import type { AdminDemoAccount, ApiFailure } from '@shopping/shared'
import {
  Button,
  Checkbox,
  DataList,
  EmptyState,
  ErrorState,
  Pagination,
  Skeleton,
  useToast,
} from '@shopping/ui/components'
import { ConfirmDialog } from '@shopping/ui/form'
import { useId, useState } from 'react'

import { demoCount } from '@/lib/demo/format'
import type { DemoAccountsController } from '@/lib/demo/use-demo-console'
import type { DemoConsoleMessages } from '@/messages'

import { DemoAccountTable } from './demo-account-table'

/**
 * 데모 계정 목록과 그 위의 두 버튼 (F1 · F2 · F4 · F5).
 *
 * ## 강제 만료는 **지우지 않는다**
 *
 * 만료 시각을 지금으로 당길 뿐이고, 실제 삭제는 다음 정리가 한다 — 지우는 순서는 표
 * 하나에 데이터로 적혀 있고(`demo-cleanup-plan.ts`), 그 순서를 두 곳에서 쓰면
 * 외래키에 걸려 **절반만 지워진 계정**이 남는다 (4.1). 그래서 누른 직후에도 그 계정은
 * 목록에 그대로 있고, 화면이 그 사실을 말하지 않으면 운영자는 실패로 읽는다.
 *
 * ## 재시도는 「지금 한 번 돌린다」다
 *
 * 실패한 계정은 만료된 채로 남아 있으므로 다음 주기가 자동으로 다시 집는다
 * (`demo-cleanup.service.ts`). F5 의 「재시도」는 그 주기를 기다리지 않는 것이고,
 * 그래서 이 화면의 「지금 정리 실행」 버튼 **하나**가 그 일 전부다 (4.2).
 *
 * ## 실패 건만 보기는 필터이지 표가 아니다
 *
 * 실패는 그 계정의 지금 상태다. 별도의 「실패 목록」을 만들면 이미 정리된 계정의 옛
 * 실패가 영영 남고, 그것이 4.3 이 막으려던 것이다.
 */

export interface DemoAccountsPanelProps {
  readonly messages: DemoConsoleMessages
  readonly accounts: DemoAccountsController
  /** 만료를 재는 기준 시각. 검사가 고정된 값을 넣는다. */
  readonly now: number
  readonly describe: (failure: ApiFailure) => string
  /** 정리가 돌면 통계의 활성·실패 수도 달라진다. 그쪽을 다시 읽게 한다. */
  readonly onSwept: () => void
}

export function DemoAccountsPanel({
  messages,
  accounts,
  now,
  describe,
  onSwept,
}: DemoAccountsPanelProps) {
  const copy = messages.accounts
  const { toast } = useToast()
  const failedOnlyId = useId()

  /** 확인을 기다리는 계정. `null` 이면 대화상자가 닫혀 있다. */
  const [expiring, setExpiring] = useState<AdminDemoAccount | null>(null)

  const { state, pagination } = accounts
  const rows = state.status === 'ready' ? state.data.accounts : []

  async function expire(account: AdminDemoAccount): Promise<void> {
    const result = await accounts.expire(account.userId)

    if (result === null) return

    if (!result.ok) {
      toast({ title: describe(result.failure), variant: 'danger' })

      return
    }

    onSwept()
    toast({ title: messages.toast.expired, variant: 'success' })
  }

  async function sweep(): Promise<void> {
    const result = await accounts.sweep()

    if (result === null) return

    if (!result.ok) {
      toast({ title: describe(result.failure), variant: 'danger' })

      return
    }

    const { swept, failed } = result.value

    onSwept()
    toast({
      // 0을 둘 그리는 대신 한 문장으로 말한다 — 「아무 일도 없었다」는 좋은 소식이고,
      // 숫자 둘로 적으면 읽는 데 두 번 걸린다.
      title:
        swept === 0 && failed === 0
          ? messages.toast.sweptNothing
          : messages.toast.swept
              .replace('{swept}', demoCount(swept))
              .replace('{failed}', demoCount(failed)),
      variant: 'success',
    })
  }

  return (
    <section aria-label={copy.title} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-fg text-base font-medium">{copy.title}</h2>
        <p className="text-fg-muted text-sm">{copy.description}</p>
      </div>

      <div className="border-border bg-surface-muted flex flex-wrap items-center gap-3 rounded-md border p-3">
        <Checkbox
          checked={accounts.failedOnly}
          id={failedOnlyId}
          label={copy.failedOnlyLabel}
          onCheckedChange={(next) => {
            accounts.setFailedOnly(next === true)
          }}
        />

        <Button
          loading={accounts.busy}
          onClick={() => {
            void sweep()
          }}
          type="button"
          variant="outline"
        >
          {accounts.busy ? copy.sweeping : copy.sweepLabel}
        </Button>

        <p className="text-fg-subtle basis-full text-xs">{copy.sweepNotice}</p>
      </div>

      <DataList
        empty={
          accounts.failedOnly ? (
            <EmptyState
              description={copy.filteredEmptyDescription}
              title={copy.filteredEmptyTitle}
            />
          ) : (
            <EmptyState description={copy.emptyDescription} title={copy.emptyTitle} />
          )
        }
        error={
          <ErrorState
            description={state.status === 'error' ? describe(state.failure) : undefined}
            onRetry={accounts.reload}
            retryLabel={copy.retryLabel}
            title={copy.errorTitle}
          />
        }
        loading={<Skeleton label={copy.loadingLabel} lines={6} />}
        state={state.status === 'ready' ? (rows.length === 0 ? 'empty' : 'ready') : state.status}
      >
        <DemoAccountTable
          busy={accounts.busy}
          messages={copy}
          now={now}
          onExpire={setExpiring}
          rows={rows}
        />

        <Pagination
          hasNext={pagination.hasNext}
          hasPrevious={pagination.hasPrevious}
          label={copy.pagination.label}
          nextLabel={copy.pagination.next}
          onNext={pagination.goNext}
          onPrevious={pagination.goPrevious}
          previousLabel={copy.pagination.previous}
          status={pageStatus(messages, pagination.pageIndex, rows.length)}
        />
      </DataList>

      <p className="text-fg-muted text-xs">{copy.expireNotice}</p>
      <p className="text-fg-muted text-xs">{copy.cleanupNotice}</p>

      {expiring === null ? null : (
        <ConfirmDialog
          cancelLabel={copy.confirm.cancel}
          closeLabel={copy.confirm.closeLabel}
          confirmLabel={copy.confirm.confirm}
          description={copy.confirm.description}
          onConfirm={() => {
            const account = expiring

            setExpiring(null)
            void expire(account)
          }}
          onOpenChange={(next) => {
            if (!next) setExpiring(null)
          }}
          open
          title={copy.confirm.title}
        />
      )}
    </section>
  )
}

/** `2 페이지 · 20개`. 카탈로그의 조각을 이어 붙인다 (`reports` 화면과 같은 방식). */
function pageStatus(messages: DemoConsoleMessages, index: number, count: number): string {
  const { pageUnit, countUnit } = messages.accounts.pagination

  return `${String(index + 1)}${pageUnit} · ${String(count)}${countUnit}`
}
