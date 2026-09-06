'use client'

import type { Settlement } from '@shopping/shared'
import type { TableColumn } from '@shopping/ui/components'
import { Badge, Checkbox, linkClassName, Table } from '@shopping/ui/components'
import NextLink from 'next/link'

import { settlementMoney, settlementPeriod } from '@/lib/settlements/format'
import { settlementHref } from '@/lib/settlements/settlement-console'
import { canBulkApprove, statusVariant } from '@/lib/settlements/transitions'
import type { SettlementMessages } from '@/messages'

/**
 * 정산서 목록의 표 — 고르고, 열고, 판매자로 좁힌다.
 *
 * ## 고를 수 없는 줄이 있다 (F6)
 *
 * 일괄 승인이 옮길 수 있는 것은 승인으로 가는 화살표가 있는 상태뿐이다
 * (`canBulkApprove`). 이미 지급된 줄에 체크박스를 살려 두면 사람은 그것을 고르고,
 * 서버는 `wrong_status` 로 돌려주며, 화면은 「승인하지 못했습니다」를 그린다 — 아무도
 * 그것을 시도한 적이 없어야 했다. **그래도 실패는 온다**: 목록을 읽은 뒤 남이 같은
 * 정산서를 승인하면 그 줄은 여전히 거절되고, 그 답을 말하는 것이 결과 표의 일이다.
 *
 * 체크박스는 `disabled` 다. `GuardedButton` 이 쓰는 `aria-disabled` 규약과 다른
 * 이유는 이것이 **권한이 아니라 상태**이기 때문이다 — 읽어야 할 문장은 줄마다 다른
 * 것이 아니라 상태 뱃지에 이미 적혀 있고, 그 뱃지가 같은 행에 있다.
 *
 * ## 승인 자격이 없어도 고를 수는 있다 (F7)
 *
 * 선택 열을 자격에 따라 감추면 콘솔이 실제보다 적은 기능을 가진 것처럼 보이고,
 * 운영자는 무엇을 요청해야 하는지도 알 수 없다. 「보여 주되 못 누르게 한다」가 이
 * 콘솔의 규칙이라, 막히는 것은 **선택이 아니라 승인 버튼 하나**다
 * (`settlement-list-workspace.tsx` 의 `GuardedButton`).
 *
 * ## 판매자 이름이 곧 필터다
 *
 * 필터 바에 판매자 셀렉트가 없는 사정은 `settlement-filters.tsx` 에 적혀 있다.
 * 좁히는 길은 이 열의 버튼이고, 골라 온 이름은 목록 위의 칩으로 남는다.
 */

export interface SettlementTableProps {
  readonly rows: readonly Settlement[]
  readonly messages: SettlementMessages
  readonly selected: ReadonlyMap<string, Settlement>
  readonly onToggle: (settlement: Settlement, selected: boolean) => void
  readonly onTogglePage: (selected: boolean) => void
  readonly onNarrowSeller: (row: Settlement) => void
}

export function SettlementTable({
  rows,
  messages,
  selected,
  onToggle,
  onTogglePage,
  onNarrowSeller,
}: SettlementTableProps) {
  const copy = messages.list
  const approvable = rows.filter((row) => canBulkApprove(row.status))
  const chosen = approvable.filter((row) => selected.has(row.id)).length

  /**
   * 머리글의 체크박스 — **이 페이지에서 고를 수 있는 것 전부**에 대한 답이다.
   *
   * 고를 수 있는 줄이 하나도 없으면 눌러 봐야 아무 일도 일어나지 않으므로 막는다.
   * 셋 중 하나만 골랐을 때의 `indeterminate` 는 라딕스의 세 번째 상태이고, 그것이
   * 없으면 「일부만 골랐다」가 「아무것도 안 골랐다」로 보인다.
   */
  const pageState =
    chosen === 0 ? false : chosen === approvable.length ? true : ('indeterminate' as const)

  const columns: readonly TableColumn<Settlement>[] = [
    {
      key: 'select',
      header: (
        <Checkbox
          aria-label={copy.selectPage}
          checked={pageState}
          disabled={approvable.length === 0}
          onCheckedChange={(next) => {
            onTogglePage(next === true)
          }}
        />
      ),
      cell: (row) =>
        canBulkApprove(row.status) ? (
          <Checkbox
            aria-label={copy.selectRow.replace('{brand}', row.brandName)}
            checked={selected.has(row.id)}
            onCheckedChange={(next) => {
              onToggle(row, next === true)
            }}
          />
        ) : (
          // 왜 못 고르는지가 이름에 붙는다. 화면을 볼 수 없는 사람에게 회색은
          // 아무 말도 하지 않는다.
          <Checkbox
            aria-label={`${copy.selectRow.replace('{brand}', row.brandName)} ${copy.notSelectable}`}
            checked={false}
            disabled
          />
        ),
    },
    {
      key: 'period',
      header: copy.columns.period,
      cell: (row) => settlementPeriod(row.periodStart, row.periodEnd, copy.period),
    },
    {
      key: 'brandName',
      header: copy.columns.brandName,
      cell: (row) => (
        <button
          className={linkClassName('subtle')}
          onClick={() => {
            onNarrowSeller(row)
          }}
          type="button"
        >
          {row.brandName}
        </button>
      ),
    },
    {
      key: 'status',
      header: copy.columns.status,
      cell: (row) => (
        <Badge variant={statusVariant(row.status)}>{messages.statusLabels[row.status]}</Badge>
      ),
    },
    {
      key: 'salesAmount',
      header: copy.columns.salesAmount,
      numeric: true,
      cell: (row) => settlementMoney(row.salesAmount),
    },
    {
      key: 'payoutAmount',
      header: copy.columns.payoutAmount,
      numeric: true,
      // 지급액은 이 표에서 사람이 실제로 보는 숫자다. 음수일 수 있고, 그때도 굵다.
      cell: (row) => <span className="font-medium">{settlementMoney(row.payoutAmount)}</span>,
    },
    {
      key: 'holdReason',
      header: copy.columns.holdReason,
      // 보류가 아니면 빈칸이 아니라 `—` 다. 빈칸은 「없다」와 「못 읽었다」를 섞는다.
      cell: (row) => row.holdReason ?? messages.detail.summary.none,
    },
    {
      key: 'open',
      header: copy.columns.open,
      cell: (row) => (
        <NextLink className={linkClassName()} href={settlementHref(row.id)}>
          {copy.openLabel}
        </NextLink>
      ),
    },
  ]

  return (
    <Table
      caption={copy.listLabel}
      columns={columns}
      rowKey={(row) => row.id}
      rows={rows}
      sort={null}
    />
  )
}
