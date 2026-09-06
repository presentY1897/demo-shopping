'use client'

import type { ApiFailure, Claim, ClaimFault, ReturnReason } from '@shopping/shared'
import { CLAIM_REASON_MAX_LENGTH, claimFaults, returnReasons } from '@shopping/shared'
import type { TableColumn } from '@shopping/ui/components'
import { Button, ErrorNotice, Modal, Select, Table, Textarea } from '@shopping/ui/components'
import { useId, useState } from 'react'

import type { ForceInput } from '@/lib/claims/claim-console'
import { EMPTY_FORCE_INPUT, faultOf, forceIssues, forcePhotoRule } from '@/lib/claims/claim-console'
import { useReturnPhotos } from '@/lib/claims/use-return-photos'
import { Field, fieldAria, fieldHintId } from '@/form'
import type {
  AdminClaimDetailMessages,
  ClaimForceMessages,
  ClaimVocabularyMessages,
  ErrorNoticeMessages,
  ReturnPhotoMessages,
} from '@/messages'

import { ReturnPhotoField } from './return-photo-field'

/**
 * 강제 처리의 확인 단계 — **무엇이 일어나는지 먼저 말한다.**
 *
 * 이 버튼 하나가 **판매자의 재고와 구매자의 돈을 함께** 바꾼다. 그래서 확인 문구가 한
 * 문단이 아니라 네 문장이다 — 새 클레임이 선다는 것, 두 사람의 것이 움직인다는 것,
 * 이의가 함께 닫힌다는 것, 되돌릴 수 없다는 것. 구매확정 다이얼로그(TASK-0063)가
 * 같은 이유로 같은 모양이고, 한 문단으로 접으면 아무도 읽지 않는다.
 *
 * **귀책을 여기서 다시 판정한다.** 취소는 귀책을 직접 고르고 반품은 사유를 고르는데,
 * 반품의 귀책은 사유에서 파생되므로 고른 순간 그 결과를 미리 보여 준다 — 고르는 것과
 * 바뀌는 것이 다른 값일 때 사람은 자기가 무엇을 정했는지 모른다.
 *
 * **금액은 이 화면에 없다.** 판매자 상세는 승인 전에 환불 예정액을 받지만
 * (`sellerClaimDetailSchema.quote`), 관리자에게는 그 계약이 아직 없다. 빈칸이나 0원
 * 대신 **없다는 사실을 문장으로** 적는다 — 0원은 「0원을 돌려준다」로 읽힌다.
 *
 * ## 사진 칸은 **사유가 부른다**
 *
 * 반품 거절을 하자·오배송으로 뒤집는 것은 판매자에게 돈을 물리는 일이라 서버가 사진을
 * **필수**로 요구한다(`returnPhotoDecision`). 그 칸이 없던 동안 이 대화상자는 언제나
 * 400 `RETURN_PHOTO_REQUIRED` 로 끝나는 폼이었다 — 대역이 그 판정을 지나지 않아
 * 프론트에서는 아무것도 실패하지 않았다.
 *
 * 갈래가 셋이고 화면이 셋 다 다르게 그린다.
 *
 * | 뒤집는 것 | 사진 칸 |
 * | --- | --- |
 * | 취소 거절 | **없다.** 계약이 `return` 을 싣지 않는다(둘 중 하나다) |
 * | 반품 거절 · 하자 · 오배송 | **필수.** 없으면 보내지 않고 무엇이 빠졌는지 말한다 |
 * | 반품 거절 · 단순 변심 | **없다.** 붙이면 서버가 `RETURN_PHOTO_NOT_ALLOWED` 로 거절한다 |
 *
 * 마지막 줄이 사유를 바꿀 때 붙어 있던 사진을 버리는 이유이기도 하다 — 칸만 감추면
 * 열쇠는 상태에 남고, 그 요청은 거절된다.
 *
 * **못 누르는 것을 회색 버튼으로 말하지 않는다** (TASK-0063 4.1 · 이 콘솔의 다른
 * 자리와 같은 규칙). 버튼은 살아 있고, 누르면 무엇이 남았는지 문장으로 답한다.
 */

export interface ClaimForceDialogProps {
  readonly claim: Claim
  readonly messages: ClaimForceMessages
  /**
   * 사진 칸의 문구 — **확정 후 하자 반품 탭과 같은 한 벌**.
   *
   * 두 화면이 같은 칸을 그리고 서버가 둘에 같은 것을 요구하므로 문구도 한 벌이다
   * (`ReturnPhotoMessages`). 여기에만 있는 사본을 두면 「사진이 왜 필요한가」가 두
   * 곳에서 다른 말을 하게 된다.
   */
  readonly photoMessages: ReturnPhotoMessages
  readonly detail: AdminClaimDetailMessages
  readonly vocabulary: ClaimVocabularyMessages
  readonly notice: ErrorNoticeMessages
  readonly busy: boolean
  readonly failure: ApiFailure | null
  /** 실패를 이 화면의 문장으로. */
  readonly describe: (failure: ApiFailure) => string
  readonly onConfirm: (input: ForceInput) => void
  readonly onCancel: () => void
}

export function ClaimForceDialog({
  claim,
  messages,
  photoMessages,
  detail,
  vocabulary,
  notice,
  busy,
  failure,
  describe,
  onConfirm,
  onCancel,
}: ClaimForceDialogProps) {
  const reasonId = useId()
  const faultId = useId()
  const returnReasonId = useId()
  const issuesId = useId()
  const [input, setInput] = useState<ForceInput>(EMPTY_FORCE_INPUT)
  const [reasonError, setReasonError] = useState<string | undefined>(undefined)
  /**
   * 눌러 보기 전에는 남은 문제를 그리지 않는다.
   *
   * 대화상자를 연 사람에게 「사진을 첨부해 주세요」를 먼저 보이면, 그것은 안내가
   * 아니라 **아직 하지 않은 일에 대한 지적**이다 (확정 후 하자 반품 탭과 같은 규칙).
   */
  const [attempted, setAttempted] = useState(false)

  /**
   * 사진은 훅이 들고 있다. **대화상자와 함께 태어나고 함께 사라진다** — 닫으면
   * 붙인 것이 없어지는 것이 맞고, 올라간 객체는 어느 신청서에도 매달리지 않는다
   * (`use-return-photos.ts`).
   */
  const photos = useReturnPhotos()

  const cancelling = claim.type === 'CANCEL'
  const recordedFault = faultOf(claim.type, input)
  // 「보낼 수 있는가」는 초안과 사진을 함께 봐야 답이 나온다. 판정 직전에 한 값으로 합친다.
  const current: ForceInput = { ...input, photoKeys: photos.keys, uploading: photos.uploading }
  const photographed = forcePhotoRule(claim.type, input.returnReason) === 'required'
  const issues = forceIssues(claim.type, current)

  const itemColumns: readonly TableColumn<Claim['items'][number]>[] = [
    { key: 'product', header: detail.items.product, cell: (row) => row.snapshot.productName },
    {
      key: 'option',
      header: detail.items.option,
      cell: (row) =>
        row.snapshot.optionLabel === '' ? detail.items.noOption : row.snapshot.optionLabel,
    },
    { key: 'quantity', header: detail.items.quantity, numeric: true, cell: (row) => row.quantity },
  ]

  function submit(): void {
    const written = input.reason.trim()

    // U2: 오류를 **그 필드에** 붙인다. 대화상자 위의 문장 하나로는 어느 칸이 문제인지
    // 말하지 못한다. 규칙 자체는 계약의 것이고(`claimReasonSchema`) 여기 있는 것은
    // 문구뿐이다.
    const problem =
      written === ''
        ? messages.errors.reasonRequired
        : written.length > CLAIM_REASON_MAX_LENGTH
          ? messages.errors.reasonTooLong
          : undefined

    setAttempted(true)
    setReasonError(problem)

    // **둘을 함께 말한다.** 사유만 먼저 거절하면 사람은 그것을 채우고 나서야 사진이
    // 필요하다는 것을 알게 된다 (확정 후 하자 반품 탭이 같은 이유로 목록을 낸다).
    if (problem !== undefined || issues.length > 0) return

    onConfirm({ ...current, reason: written })
  }

  return (
    <Modal
      closeLabel={messages.closeLabel}
      description={messages.description}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onCancel} type="button" variant="ghost">
            {messages.cancel}
          </Button>
          <Button
            aria-describedby={attempted && issues.length > 0 ? issuesId : undefined}
            disabled={busy}
            onClick={submit}
            type="button"
            variant="danger"
          >
            {messages.confirm}
          </Button>
        </div>
      }
      onOpenChange={(next) => {
        if (!next) onCancel()
      }}
      open
      title={messages.title}
    >
      <div className="flex flex-col gap-4">
        <ul className="text-fg flex list-disc flex-col gap-1 ps-5 text-sm">
          <li>{messages.consequences.newClaim}</li>
          <li>{messages.consequences.money}</li>
          <li>{messages.consequences.appeal}</li>
          <li className="text-danger">{messages.consequences.irreversible}</li>
        </ul>

        <section className="flex flex-col gap-2">
          <h3 className="text-fg text-sm font-medium">{messages.itemsLabel}</h3>
          <Table
            caption={messages.itemsCaption}
            columns={itemColumns}
            rowKey={(row) => row.id}
            rows={claim.items}
            sort={null}
          />
        </section>

        {cancelling ? (
          <Field fieldId={faultId} hint={messages.faultHint} label={messages.faultLabel} required>
            <Select
              // `fieldAria` 를 쓰지 않는다 — 그것은 `aria-invalid` 도 함께 내는데
              // `Select` 는 그 속성을 받지 않아, 여기서는 붙지 않는 값을 붙이는 셈이 된다.
              aria-describedby={fieldHintId(faultId)}
              id={faultId}
              onValueChange={(next) => {
                setInput({ ...input, fault: next as ClaimFault })
              }}
              options={claimFaults.map((fault) => ({
                value: fault,
                label: vocabulary.faultLabels[fault],
              }))}
              value={input.fault}
            />
          </Field>
        ) : (
          <Field
            fieldId={returnReasonId}
            hint={messages.returnReasonHint}
            label={messages.returnReasonLabel}
            required
          >
            <Select
              aria-describedby={fieldHintId(returnReasonId)}
              id={returnReasonId}
              onValueChange={(next) => {
                const chosen = next as ReturnReason

                setInput({ ...input, returnReason: chosen })

                // 단순 변심으로 옮기면 붙인 사진을 **버린다.** 칸만 감추면 열쇠가
                // 상태에 남고, 서버는 그 요청을 `RETURN_PHOTO_NOT_ALLOWED` 로 거절한다.
                if (forcePhotoRule(claim.type, chosen) === 'forbidden') photos.clear()
              }}
              options={returnReasons.map((value) => ({
                value,
                label: vocabulary.returnReasonLabels[value],
              }))}
              value={input.returnReason}
            />
          </Field>
        )}

        {/* 고르는 것은 사유인데 바뀌는 것은 귀책이다. 그 결과를 누르기 전에 말한다. */}
        <p className="text-fg-muted text-sm">
          {messages.faultPreview.replace('{fault}', vocabulary.faultLabels[recordedFault])}
        </p>

        {photographed ? (
          <ReturnPhotoField describe={describe} messages={photoMessages} photos={photos} />
        ) : null}

        <Field
          error={reasonError}
          fieldId={reasonId}
          hint={messages.reasonHint}
          label={messages.reasonLabel}
          required
        >
          <Textarea
            {...fieldAria(reasonId, { error: reasonError, hint: messages.reasonHint })}
            maxLength={CLAIM_REASON_MAX_LENGTH}
            onChange={(event) => {
              setInput({ ...input, reason: event.target.value })
              setReasonError(undefined)
            }}
            placeholder={messages.reasonPlaceholder}
            value={input.reason}
          />
        </Field>

        <p className="text-fg-subtle text-xs">{messages.amountNotice}</p>

        {attempted && issues.length > 0 ? (
          <div
            className="border-danger bg-danger-surface flex flex-col gap-1 rounded-md border p-3 text-sm"
            id={issuesId}
            role="alert"
          >
            <p className="text-fg font-medium">{photoMessages.issuesLabel}</p>
            <ul className="text-fg flex list-disc flex-col gap-1 ps-5">
              {issues.map((issue) => (
                <li key={issue}>{photoMessages.issues[issue]}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {failure === null ? null : (
          <ErrorNotice
            copiedLabel={notice.copiedLabel}
            copyLabel={notice.copyLabel}
            description={describe(failure)}
            requestIdHint={notice.requestIdHint}
            requestIdLabel={notice.requestIdLabel}
            title={detail.failureTitle}
          />
        )}
      </div>
    </Modal>
  )
}
