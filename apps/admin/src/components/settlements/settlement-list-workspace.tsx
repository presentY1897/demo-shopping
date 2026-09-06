'use client'

import type { ApiFailure, BulkApproveSettlementsResponse, ErrorMessages } from '@shopping/shared'
import { failureMessage, platformOwnership, SETTLEMENT_BULK_APPROVE_MAX } from '@shopping/shared'
import type { TableColumn } from '@shopping/ui/components'
import {
  Badge,
  Button,
  DataList,
  EmptyState,
  ErrorState,
  GuardedButton,
  linkClassName,
  Pagination,
  Skeleton,
  Table,
  ToastProvider,
  useToast,
} from '@shopping/ui/components'
import { ConfirmDialog, useConfirm } from '@shopping/ui/form'
import NextLink from 'next/link'
import { useCallback, useState } from 'react'

import { useAuthorization } from '@/lib/auth/authorization'
import { exportFileName, settlementsToCsv } from '@/lib/settlements/csv'
import { settlementDay, settlementMoney } from '@/lib/settlements/format'
import { settlementHref } from '@/lib/settlements/settlement-console'
import { useSettlements } from '@/lib/settlements/use-settlements'
import type { SettlementMessages } from '@/messages'

import { SettlementFilters } from './settlement-filters'
import { SettlementTable } from './settlement-table'

/**
 * `/settlements` — 이번 회차에 얼마가 나가는지 보고, 골라서 승인한다 (TASK-0081).
 *
 * ## 볼 수 있는 자격과 처리할 수 있는 자격이 다르다 (F7)
 *
 * 읽기는 `settlement.read`, 승인은 `settlement.approve`, 지급은 `settlement.pay`
 * 이고 뒤의 둘은 **최고 관리자만** 갖는다. 그 거절은 여기서 조건문으로 만들어지지
 * 않는다 — 권한 목록의 빈자리가 만들고(`role-permissions.ts`), 화면은 서버가 묻는
 * 것과 같은 표에 물어 같은 답을 받는다(`useAuthorization`). 데모 관리자는
 * 운영자에서 파생되므로 둘 다 없다.
 *
 * **가드가 묻는 것이 서버가 묻는 것과 같아야 한다.** 판매자를 지정하지 않은 목록
 * 조회는 **플랫폼 전체**를 보는 일이고, 서버는 그것을 `platformOwnership` 에 대한
 * `settlement.read` 로 판정한다(`SettlementConsoleService.assertMayRead`).
 * `settlement.read:own` 은 모든 판매자가 갖고 있으므로, 그것으로 열면 판매자가
 * 「불러오지 못했어요 · 다시 시도」를 아무리 눌러도 되지 않는 403 으로 받는다
 * (`claim-list-workspace.tsx` 가 같은 이유로 같은 모양이다).
 *
 * ## 총액은 **필터의 합**이다
 *
 * 서버가 페이지가 아니라 조건 전체를 집계해 보낸다(`settlementListResponseSchema`).
 * 그 사실을 화면이 문장으로 말하지 않으면, 스무 줄짜리 표 위의 200건 합계는 틀린
 * 숫자로 보인다 — 그리고 그 숫자를 보고 지급을 결정하는 사람이 그것을 세어 본다.
 */

export interface SettlementListWorkspaceProps {
  readonly messages: SettlementMessages
  /** `code` → sentence, for everything the API answers (TASK-0117 4.2). */
  readonly errors: ErrorMessages
}

export function SettlementListWorkspace({ messages, errors }: SettlementListWorkspaceProps) {
  const { ready, canOn, reasonOn } = useAuthorization()

  // 아직 묻는 중이다. 여기서 거절을 그리면 부팅 갱신이 도는 동안 모든 운영자에게
  // 「볼 수 없어요」가 한 번씩 스친다 (`auth-context.tsx`).
  if (!ready) return <Skeleton label={messages.list.loadingLabel} lines={6} />

  if (!canOn('settlement.read', platformOwnership)) {
    return (
      <EmptyState
        description={reasonOn('settlement.read', platformOwnership)}
        title={messages.forbiddenTitle}
      />
    )
  }

  return (
    <ToastProvider closeLabel={messages.toast.closeLabel} regionLabel={messages.toast.regionLabel}>
      <SettlementQueue errors={errors} messages={messages} />
    </ToastProvider>
  )
}

function SettlementQueue({ messages, errors }: SettlementListWorkspaceProps) {
  const settlements = useSettlements()
  const { can, reason } = useAuthorization()
  const { toast } = useToast()
  const gate = useConfirm()

  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<ApiFailure | null>(null)
  /** 마지막 일괄 승인의 답. **실패가 남아 있는 동안 화면에서 사라지지 않는다.** */
  const [outcome, setOutcome] = useState<BulkOutcome | null>(null)

  const describe = useCallback(
    (value: ApiFailure): string => failureMessage(value, { errors, failures: messages.failures }),
    [errors, messages.failures],
  )

  const { state, pagination, filters, selected } = settlements
  const rows = state.status === 'ready' ? state.settlements : []
  const mayApprove = can('settlement.approve')
  const approveDenial = reason('settlement.approve')

  /**
   * 고른 것들의 지급액 합 — 확인 다이얼로그가 보여 주는 숫자다.
   *
   * 고른 줄을 **정산서 그대로** 들고 있으므로(`useSettlements`) 페이지를 넘겨 가며
   * 고른 것도 전부 세어진다. 화면에 있는 줄만 더하면 「3건 · ₩0」 같은 확인 문구가
   * 나오고, 그것은 확인이 아니다.
   */
  const selectedPayout = [...selected.values()].reduce((sum, row) => sum + row.payoutAmount, 0)
  const tooMany = selected.size > SETTLEMENT_BULK_APPROVE_MAX

  async function approveSelected(): Promise<void> {
    if (busy) return
    if (!(await gate.request())) return

    setBusy(true)
    setFailure(null)

    // 이름을 **보내기 전에** 붙잡아 둔다. 승인된 줄은 답이 온 뒤 선택에서 빠지고,
    // 필터가 상태를 좁혀 두었으면 목록에서도 사라진다 — 그러면 실패 목록이 부를 수
    // 있는 것이 uuid 뿐이 된다.
    const names = new Map([...settlements.selected].map(([id, row]) => [id, row.brandName]))
    const result = await settlements.approveSelected()

    setBusy(false)

    if (!result.ok) {
      setFailure(result.failure)

      return
    }

    setOutcome({ names, result: result.value })
    toast({
      title: messages.toast.bulkApproved.replace('{count}', String(result.value.approved.length)),
      variant: result.value.failed.length === 0 ? 'success' : 'warning',
    })
  }

  /**
   * 지금 필터가 고른 **전부**를 파일로 (F8).
   *
   * 화면의 한 페이지가 아니다. 커서를 끝까지 따라가는 것은 훅의 일이고, 여기서는
   * 그 목록을 문자열로 바꿔 내려보낸다 — 만드는 규칙은 `lib/settlements/csv.ts` 에
   * 있고 단위 검사가 그것을 잰다.
   */
  async function exportAll(): Promise<void> {
    if (busy) return

    setBusy(true)
    setFailure(null)

    const collected = await settlements.collectAll()

    setBusy(false)

    if (!collected.ok) {
      setFailure(collected.failure)

      return
    }

    if (collected.value.length === 0) {
      toast({ title: messages.export.empty, variant: 'neutral' })

      return
    }

    download(
      settlementsToCsv(collected.value, {
        columns: messages.export.columns,
        emptyHoldReason: messages.export.emptyHoldReason,
        formatDay: settlementDay,
        statusLabels: messages.statusLabels,
      }),
      exportFileName(messages.export.filePrefix, new Date()),
    )
    toast({
      title: messages.export.done.replace('{count}', String(collected.value.length)),
      variant: 'success',
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <SettlementFilters
        disabled={state.status === 'loading'}
        messages={messages.list}
        onChange={settlements.setFilters}
        statusLabels={messages.statusLabels}
        value={filters}
      />

      {/*
        고른 판매자는 **지울 수 있는 칩**으로 남는다. 필터 바에 없는 조건이 목록을
        좁히고 있는데 화면에 그 사실이 없으면, 비어 있는 목록이 「없다」로 읽힌다.
      */}
      {filters.sellerId === null ? null : (
        <ul className="flex flex-wrap items-center gap-2">
          <li className="flex items-center gap-1">
            <Badge variant="neutral">
              {messages.list.narrow.activeSeller.replace('{name}', filters.sellerName ?? '')}
            </Badge>
            <Button
              onClick={() => {
                settlements.setFilters({ ...filters, sellerId: null, sellerName: null })
              }}
              size="sm"
              variant="ghost"
            >
              {messages.list.narrow.clear}
            </Button>
          </li>
        </ul>
      )}

      <TotalsPanel messages={messages} state={state} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {selected.size === 0 ? null : (
            <>
              <span className="text-fg text-sm font-medium">
                {messages.bulk.selected.replace('{count}', String(selected.size))}
              </span>
              {mayApprove ? (
                <Button
                  disabled={busy || tooMany}
                  onClick={() => void approveSelected()}
                  size="sm"
                  type="button"
                  variant="primary"
                >
                  {busy ? messages.bulk.approving : messages.bulk.approve}
                </Button>
              ) : (
                <GuardedButton
                  blocked
                  reason={approveDenial ?? messages.forbiddenTitle}
                  size="sm"
                  variant="primary"
                >
                  {messages.bulk.approve}
                </GuardedButton>
              )}
              <Button onClick={settlements.clearSelection} size="sm" type="button" variant="ghost">
                {messages.bulk.clear}
              </Button>
            </>
          )}
        </div>

        <div className="flex flex-col items-end gap-1">
          <Button
            disabled={busy}
            onClick={() => void exportAll()}
            size="sm"
            type="button"
            variant="outline"
          >
            {busy ? messages.export.exporting : messages.export.label}
          </Button>
          <p className="text-fg-subtle text-xs">{messages.export.note}</p>
        </div>
      </div>

      {tooMany ? (
        <p className="text-danger text-sm" role="alert">
          {messages.bulk.tooMany.replace('{max}', String(SETTLEMENT_BULK_APPROVE_MAX))}
        </p>
      ) : null}

      {failure === null ? null : (
        <div
          className="border-danger bg-danger-surface text-fg flex flex-col gap-1 rounded-md border p-3 text-sm"
          role="alert"
        >
          <p className="font-medium">{messages.toast.failedTitle}</p>
          <p>{describe(failure)}</p>
        </div>
      )}

      {outcome === null ? null : (
        <BulkOutcomePanel
          messages={messages}
          onDismiss={() => {
            setOutcome(null)
          }}
          outcome={outcome}
        />
      )}

      <DataList
        empty={
          settlements.narrowed ? (
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
            onRetry={settlements.reload}
            retryLabel={messages.list.retryLabel}
            title={messages.list.errorTitle}
          />
        }
        loading={<Skeleton label={messages.list.loadingLabel} lines={6} />}
        state={state.status === 'ready' ? (rows.length === 0 ? 'empty' : 'ready') : state.status}
      >
        <SettlementTable
          messages={messages}
          onNarrowSeller={(row) => {
            settlements.setFilters({
              ...filters,
              sellerId: row.sellerId,
              sellerName: row.brandName,
            })
          }}
          onToggle={settlements.toggle}
          onTogglePage={settlements.togglePage}
          rows={rows}
          selected={selected}
        />

        <Pagination
          hasNext={pagination.hasNext}
          hasPrevious={pagination.hasPrevious}
          label={messages.list.pagination.label}
          nextLabel={messages.list.pagination.next}
          onNext={pagination.goNext}
          onPrevious={pagination.goPrevious}
          previousLabel={messages.list.pagination.previous}
          status={pageStatus(messages, pagination.pageIndex, rows.length)}
        />
      </DataList>

      <ConfirmDialog
        cancelLabel={messages.bulk.confirm.cancel}
        closeLabel={messages.bulk.confirm.closeLabel}
        confirmLabel={messages.bulk.confirm.confirm}
        description={messages.bulk.confirm.description
          .replace('{count}', String(selected.size))
          .replace('{amount}', settlementMoney(selectedPayout))}
        onConfirm={gate.confirm}
        onOpenChange={gate.onOpenChange}
        open={gate.open}
        title={messages.bulk.confirm.title}
      />
    </div>
  )
}

/**
 * 이 조건의 지급 예정 총액.
 *
 * 값이 아직 없으면 자리만 남긴다 — `0` 을 그리면 「이번 회차에 나갈 돈이 없다」가
 * 화면에 잠깐 나타나고, 그 문장은 이 화면에서 가장 나쁜 거짓말이다.
 */
function TotalsPanel({
  messages,
  state,
}: {
  readonly messages: SettlementMessages
  readonly state: ReturnType<typeof useSettlements>['state']
}) {
  const copy = messages.list.totals

  if (state.status !== 'ready') return null

  return (
    <section
      aria-label={copy.title}
      className="border-border bg-surface-muted flex flex-col gap-1 rounded-md border p-3"
    >
      <h2 className="text-fg text-sm font-medium">{copy.title}</h2>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-fg-muted">{copy.payoutLabel}</dt>
        <dd className="text-fg text-base font-medium tabular-nums">
          {settlementMoney(state.totals.payoutAmount)}
        </dd>
        <dt className="text-fg-muted">{copy.countLabel}</dt>
        <dd className="text-fg tabular-nums">
          {copy.countValue.replace('{count}', String(state.totals.count))}
        </dd>
      </dl>
      <p className="text-fg-subtle text-xs">{copy.scopeNotice}</p>
    </section>
  )
}

/** 일괄 승인 한 번의 답과, 보내기 전에 붙잡아 둔 이름들. */
interface BulkOutcome {
  readonly result: BulkApproveSettlementsResponse
  readonly names: ReadonlyMap<string, string>
}

/** 일괄 승인의 실패 한 줄. 표가 이 모양으로 그린다. */
interface FailedRow {
  readonly id: string
  readonly reason: BulkApproveSettlementsResponse['failed'][number]['reason']
  /** 보내기 전에 붙잡아 둔 이름. 어떤 경로로도 못 찾으면 `null` 이다. */
  readonly brandName: string | null
}

/**
 * 일괄 승인의 결과 — **실패한 것을 조용히 빼지 않는다** (F6).
 *
 * 승인된 수는 한 줄이면 되지만 실패는 표다. 각 줄이 어느 정산서였는지와 왜
 * 안 됐는지를 말하고, 열어 볼 수 있는 링크를 함께 준다 — 「8건 승인됐다」만 남으면
 * 남은 2건은 아무도 다시 보지 않는다.
 *
 * 이름은 **보내기 전에** 붙잡아 둔 것이다. 답이 온 뒤에 목록에서 찾으면, 필터가
 * 상태를 좁혀 두었을 때 방금 승인된 줄이 이미 사라져 있다. 그래도 못 찾는 id 는
 * 그대로 그린다 — 빈칸으로 두면 그 정산서를 다시 찾을 방법이 없다.
 */
function BulkOutcomePanel({
  outcome,
  messages,
  onDismiss,
}: {
  readonly outcome: BulkOutcome
  readonly messages: SettlementMessages
  readonly onDismiss: () => void
}) {
  const copy = messages.bulk.result
  const failed: readonly FailedRow[] = outcome.result.failed.map((entry) => ({
    id: entry.id,
    reason: entry.reason,
    brandName: outcome.names.get(entry.id) ?? null,
  }))

  const columns: readonly TableColumn<FailedRow>[] = [
    {
      key: 'settlement',
      header: copy.columns.settlement,
      cell: (row) => (
        <NextLink className={linkClassName()} href={settlementHref(row.id)}>
          {row.brandName ?? row.id}
        </NextLink>
      ),
    },
    { key: 'reason', header: copy.columns.reason, cell: (row) => copy.reasons[row.reason] },
  ]

  return (
    <section
      aria-label={copy.title}
      className="border-border flex flex-col gap-2 rounded-md border p-3"
    >
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-fg text-sm font-medium">{copy.title}</h2>
        <Button onClick={onDismiss} size="sm" type="button" variant="ghost">
          {copy.dismiss}
        </Button>
      </div>

      <p className="text-fg-muted text-sm">
        {copy.approved.replace('{count}', String(outcome.result.approved.length))}
      </p>

      {failed.length === 0 ? null : (
        <div className="flex flex-col gap-2">
          <p className="text-fg text-sm font-medium">{copy.failedTitle}</p>
          <p className="text-fg-muted text-sm">{copy.failedDescription}</p>
          <Table
            caption={copy.listLabel}
            columns={columns}
            rowKey={(row) => row.id}
            rows={failed}
            sort={null}
          />
        </div>
      )}
    </section>
  )
}

/**
 * `2 페이지 · 20건`.
 *
 * 카탈로그의 조각을 이어 붙인다. 자리 표시자는 사람에게 `{page}` 로 그려질 수 있는
 * 것이 하나 더 생기는 일이고, 여기 숫자에는 문법이 필요 없다 (`claims` 화면과 같은
 * 방식).
 */
function pageStatus(messages: SettlementMessages, index: number, count: number): string {
  const { pageUnit, countUnit } = messages.list.pagination

  return `${String(index + 1)}${pageUnit} · ${String(count)}${countUnit}`
}

/**
 * 만들어진 문자열을 파일로 내려보낸다.
 *
 * `Blob` 과 임시 URL 을 쓰는 이유는 `data:` URL 에 길이 제한이 있고 한글이 인코딩을
 * 한 번 더 지나기 때문이다. 다 쓴 URL 을 되돌려주지 않으면 탭이 살아 있는 동안 그
 * 메모리가 남는다 (`apps/seller` 의 주문 내보내기와 같은 함수다).
 */
function download(content: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a')

  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}
