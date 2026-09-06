'use client'

import type { ApiFailure, ClaimableItem, ClaimItemInput } from '@shopping/shared'
import type { TableColumn } from '@shopping/ui/components'
import { Button, ErrorNotice, Modal, Table } from '@shopping/ui/components'

import type {
  AdminClaimDetailMessages,
  DefectReturnMessages,
  ErrorNoticeMessages,
} from '@/messages'

/**
 * 확정을 되돌리기 **직전**의 확인 — 무엇이 일어나는지 먼저 말한다.
 *
 * 폼은 이 대화상자 밖에 있다. 항목·수량·사유·사진·개입 사유가 한 모달에 들어가면
 * 360px 에서 **스크롤 안의 스크롤**이 되고 그 안에서 초점 덫이 함께 돈다 — 구매자의
 * 신청서가 다이얼로그가 아니라 라우트인 것과 같은 판단이고, 여기서는 라우트 대신
 * **탭의 본문**이 그 자리를 맡는다.
 *
 * 그래서 이 모달이 하는 일은 하나다: **네 문장을 읽게 하는 것.** 구매확정
 * 다이얼로그(`apps/shop` 의 `confirm`)가 톤의 본보기이고, 한 문단으로 접으면 아무도
 * 읽지 않는다. 넷 중 셋째가 이 화면에만 있는 사실이다 — 정산이 이미 나갔으면 그
 * 돈을 회수해야 하고, 회수 절차는 아직 없다 (TASK-0071 4.0 이 M12 로 넘긴 항목).
 *
 * 항목 표를 한 번 더 그리는 것은 **고른 것이 맞는지 마지막으로 보라는 뜻**이다.
 * 수량을 잘못 고른 반품은 물건이 돌아온 뒤에야 드러난다.
 */

export interface DefectReturnDialogProps {
  readonly messages: DefectReturnMessages
  /** 항목 표의 열 이름. 상세와 **같은 말**이어야 한다 — 같은 표를 두 번 그린다. */
  readonly detail: AdminClaimDetailMessages
  readonly notice: ErrorNoticeMessages
  /** 고른 줄들과, 그 줄이 가리키는 항목. 이름을 그리려면 둘 다 필요하다. */
  readonly lines: readonly ClaimItemInput[]
  readonly items: readonly ClaimableItem[]
  readonly busy: boolean
  readonly failure: ApiFailure | null
  readonly describe: (failure: ApiFailure) => string
  readonly onConfirm: () => void
  readonly onCancel: () => void
}

export function DefectReturnDialog({
  messages,
  detail,
  notice,
  lines,
  items,
  busy,
  failure,
  describe,
  onConfirm,
  onCancel,
}: DefectReturnDialogProps) {
  const copy = messages.confirm

  const rows = lines.map((line) => {
    const item = items.find((entry) => entry.orderItemId === line.orderItemId)

    return {
      orderItemId: line.orderItemId,
      quantity: line.quantity,
      productName: item?.snapshot.productName ?? '',
      optionLabel: item?.snapshot.optionLabel ?? '',
    }
  })

  const columns: readonly TableColumn<(typeof rows)[number]>[] = [
    { key: 'product', header: detail.items.product, cell: (row) => row.productName },
    {
      key: 'option',
      header: detail.items.option,
      cell: (row) => (row.optionLabel === '' ? detail.items.noOption : row.optionLabel),
    },
    {
      key: 'quantity',
      header: detail.items.quantity,
      numeric: true,
      cell: (row) => row.quantity,
    },
  ]

  return (
    <Modal
      closeLabel={copy.closeLabel}
      description={copy.description}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onCancel} type="button" variant="ghost">
            {copy.cancel}
          </Button>
          <Button disabled={busy} onClick={onConfirm} type="button" variant="danger">
            {copy.confirm}
          </Button>
        </div>
      }
      onOpenChange={(next) => {
        if (!next) onCancel()
      }}
      open
      title={copy.title}
    >
      <div className="flex flex-col gap-4">
        <ul className="text-fg flex list-disc flex-col gap-1 ps-5 text-sm">
          <li>{messages.consequences.reopens}</li>
          <li>{messages.consequences.money}</li>
          <li>{messages.consequences.settlement}</li>
          <li className="text-danger">{messages.consequences.irreversible}</li>
        </ul>

        <Table
          caption={copy.itemsCaption}
          columns={columns}
          rowKey={(row) => row.orderItemId}
          rows={rows}
          sort={null}
        />

        {failure === null ? null : (
          <ErrorNotice
            copiedLabel={notice.copiedLabel}
            copyLabel={notice.copyLabel}
            description={describe(failure)}
            requestIdHint={notice.requestIdHint}
            requestIdLabel={notice.requestIdLabel}
            title={messages.failureTitle}
          />
        )}
      </div>
    </Modal>
  )
}
