'use client'

import type { AdminClaimListItem } from '@shopping/shared'
import type { TableColumn } from '@shopping/ui/components'
import { Badge, Button, linkClassName, Table } from '@shopping/ui/components'
import NextLink from 'next/link'

import { claimDateTime, shortId } from '@/lib/claims/format'
import type { AdminClaimListMessages, ClaimVocabularyMessages } from '@/messages'

/**
 * 클레임 줄들, 한 벌의 열 정의로.
 *
 * **전체 목록과 지연 목록이 같은 표를 쓴다.** 둘은 같은 계약의 같은 줄이고
 * (`adminClaimListItemSchema`), 표를 두 벌 두면 「기한 초과」 뱃지가 한쪽에만 생기는
 * 날이 온다.
 *
 * **주문번호가 행 머리이고 상세로 가는 링크다.** `Table` 이 첫 열을 고정한 채 나머지를
 * 옆으로 굴리므로(TASK-0016 4장), 그 칸이 스크롤 밖으로 나가면 그 행은 무엇에 대한
 * 행인지 알 수 없게 된다. 읽는 순서와 이동하는 순서를 같게 두는 것이 그 다음이다.
 *
 * **지연·이의·개입을 색만으로 말하지 않는다.** 붉은 뱃지는 색을 구분하지 못하는
 * 사람에게 그냥 글씨이므로, 뱃지가 **문장을 들고** 있고 색은 그것을 거든다.
 */

export interface ClaimTableProps {
  readonly rows: readonly AdminClaimListItem[]
  readonly caption: string
  readonly messages: AdminClaimListMessages
  readonly vocabulary: ClaimVocabularyMessages
  /**
   * 이 가게·이 구매자만 보기.
   *
   * 없으면 이름과 id 가 **글자**로만 그려진다 — 지연 목록과 대시보드는 좁힐 필터가
   * 없는 자리이고, 거기서 버튼을 내면 아무 데도 닿지 않는 컨트롤이 열두 개 생긴다.
   */
  readonly onNarrowSeller?: (row: AdminClaimListItem) => void
  readonly onNarrowBuyer?: (row: AdminClaimListItem) => void
}

export function ClaimTable({
  rows,
  caption,
  messages,
  vocabulary,
  onNarrowSeller,
  onNarrowBuyer,
}: ClaimTableProps) {
  const columns: readonly TableColumn<AdminClaimListItem>[] = [
    {
      key: 'orderNumber',
      header: messages.columns.orderNumber,
      // `next/link` with the package's styling: `@shopping/ui` must not depend on
      // Next, and a plain anchor would make every row a full page load.
      cell: (row) => (
        <NextLink className={linkClassName()} href={`/claims/${row.id}`}>
          {row.orderNumber}
        </NextLink>
      ),
    },
    {
      key: 'seller',
      header: messages.columns.seller,
      cell: (row) =>
        onNarrowSeller === undefined ? (
          row.brandName
        ) : (
          <Button
            aria-label={messages.narrow.seller.replace('{name}', row.brandName)}
            onClick={() => {
              onNarrowSeller(row)
            }}
            size="sm"
            variant="ghost"
          >
            {row.brandName}
          </Button>
        ),
    },
    {
      key: 'buyer',
      header: messages.columns.buyer,
      cell: (row) =>
        onNarrowBuyer === undefined ? (
          <span title={row.buyerId}>{shortId(row.buyerId)}</span>
        ) : (
          <Button
            // 줄인 값은 눈을 위한 것이고, **전체 id 는 이름에 남는다** — 줄인 것만
            // 남기면 그것으로는 아무것도 조회할 수 없다.
            aria-label={messages.narrow.buyer.replace('{id}', row.buyerId)}
            onClick={() => {
              onNarrowBuyer(row)
            }}
            size="sm"
            variant="ghost"
          >
            {shortId(row.buyerId)}
          </Button>
        ),
    },
    {
      key: 'type',
      header: messages.columns.type,
      cell: (row) => vocabulary.typeLabels[row.type],
    },
    {
      key: 'status',
      header: messages.columns.status,
      cell: (row) => <Badge variant="neutral">{vocabulary.statusLabels[row.status]}</Badge>,
    },
    {
      key: 'stage',
      header: messages.columns.stage,
      // 대기만 눈에 띄게 한다. 셋 다 강조하면 아무것도 강조되지 않는다.
      cell: (row) => (
        <Badge variant={row.stage === 'WAITING' ? 'warning' : 'neutral'}>
          {vocabulary.stageLabels[row.stage]}
        </Badge>
      ),
    },
    {
      key: 'items',
      header: messages.columns.items,
      cell: (row) => messages.columns.quantity.replace('{count}', String(row.totalQuantity)),
    },
    {
      key: 'requestedAt',
      header: messages.columns.requestedAt,
      cell: (row) => claimDateTime(row.requestedAt),
    },
    {
      key: 'dueAt',
      header: messages.columns.dueAt,
      cell: (row) => claimDateTime(row.dueAt),
    },
    {
      key: 'flags',
      header: messages.columns.flags,
      cell: (row) => (
        <span className="flex flex-wrap gap-1">
          {row.overdue ? <Badge variant="danger">{messages.badges.overdue}</Badge> : null}
          {row.appealPending ? (
            <Badge variant="warning">{messages.badges.appealPending}</Badge>
          ) : null}
          {row.intervention ? (
            <Badge variant="primary">{messages.badges.intervention}</Badge>
          ) : null}
        </span>
      ),
    },
  ]

  return (
    <Table
      caption={caption}
      columns={columns}
      rowKey={(row) => row.id}
      rows={rows}
      // 정렬 축은 커서의 첫 칸이다. 화면이 스무 줄을 다시 정렬하면 그것은 「한
      // 페이지만의 정렬」이 되고, 정렬처럼 보이기 때문에 정렬이 없는 것보다 나쁘다.
      sort={null}
    />
  )
}
