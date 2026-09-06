'use client'

import type { BulkIssueResponse, BulkIssueTarget, CouponListEntry } from '@shopping/shared'
import { bulkIssueTargets } from '@shopping/shared'
import { Button, Modal, Select } from '@shopping/ui/components'
import { useId, useState } from 'react'

import { Field, fieldHintId } from '@/form'
import { couponCount } from '@/lib/coupons/format'
import { bulkIssueCountOf, bulkIssueOutcomeOf } from '@/lib/coupons/platform-coupons'
import type { CouponBulkIssueMessages } from '@/messages'

/**
 * 한꺼번에 지급하는 자리 (F4) — **무엇이 일어나는지 먼저, 무엇이 일어났는지 나중에.**
 *
 * 한 번의 확인으로 끝나지 않고 결과를 같은 자리에서 말한다. 답이 세 숫자이고
 * (나간 수 · 건너뛴 수 · 남은 수) 그중 하나는 **다음 행동을 요구하기** 때문이다:
 * 상한에 걸려 멈췄으면 다시 눌러야 이어서 나간다. 토스트로 흘려보내면 그 문장을
 * 읽는 도중에 사라지고, 사람은 자기가 몇 명에게 준 것인지 모른 채 다시 누른다.
 *
 * **「0장 나갔습니다」는 세 가지 다른 일이다.** 모두 이미 갖고 있거나, 준비한 수량이
 * 다 찼거나, 조건에 맞는 사람이 없거나 — 셋에 발행자가 할 일이 전부 다르므로 그 판정을
 * 순수 함수가 쥐고(`bulkIssueOutcomeOf`) 여기서는 문장을 고르기만 한다.
 *
 * **두 번 눌러도 두 장이 되지 않는다**는 사실을 설명에 적어 둔 이유도 같다. 그것을
 * 모르면 「남았다」를 읽고도 다시 누르기를 망설이게 된다.
 *
 * **취소가 확인만큼 쉬워야 한다.** `Modal` 이 Escape 와 바깥 클릭을 그대로 두고,
 * 초점은 라딕스가 머리의 닫기 버튼에 둔다 — 잘못 누른 Enter 가 지급이 아니라 닫기가
 * 되는 자리다 (`ConfirmDialog` 가 같은 이유로 같은 모양이다).
 */

export interface BulkIssueDialogProps {
  readonly entry: CouponListEntry
  readonly messages: CouponBulkIssueMessages
  readonly busy: boolean
  /** 서버가 답한 것, 또는 아직 묻지 않았으면 `null`. */
  readonly result: BulkIssueResponse | null
  /** 실패의 문장. 대화상자는 그것을 만들지 않고 받기만 한다. */
  readonly failure: string | null
  readonly onConfirm: (target: BulkIssueTarget) => void
  readonly onClose: () => void
}

export function BulkIssueDialog({
  entry,
  messages,
  busy,
  result,
  failure,
  onConfirm,
  onClose,
}: BulkIssueDialogProps) {
  const targetId = useId()
  const [target, setTarget] = useState<BulkIssueTarget>('ALL')

  return (
    <Modal
      closeLabel={messages.closeLabel}
      description={messages.description}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} type="button" variant="ghost">
            {result === null ? messages.cancel : messages.close}
          </Button>
          <Button
            loading={busy}
            onClick={() => {
              onConfirm(target)
            }}
            type="button"
            variant="primary"
          >
            {busy ? messages.submitting : messages.confirm}
          </Button>
        </div>
      }
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      open
      title={`${messages.title} · ${entry.coupon.name}`}
    >
      <div className="flex flex-col gap-4">
        <Field
          fieldId={targetId}
          hint={messages.targetHints[target]}
          label={messages.targetLabel}
          required
        >
          <Select
            // `fieldAria` 를 쓰지 않는다 — 그것은 `aria-invalid` 도 함께 내는데
            // `Select` 는 그 속성을 받지 않아, 여기서는 붙지 않는 값을 붙이는 셈이 된다.
            aria-describedby={fieldHintId(targetId)}
            disabled={busy}
            id={targetId}
            onValueChange={(next) => {
              setTarget(next as BulkIssueTarget)
            }}
            options={bulkIssueTargets.map((value) => ({
              value,
              label: messages.targetLabels[value],
            }))}
            value={target}
          />
        </Field>

        {result === null ? null : <BulkIssueResult messages={messages} result={result} />}

        {failure === null ? null : (
          <p
            className="border-danger bg-danger-surface text-fg rounded-md border p-3 text-sm"
            role="alert"
          >
            {failure}
          </p>
        )}
      </div>
    </Modal>
  )
}

/**
 * 서버가 답한 세 숫자를, 사람이 할 일로 옮긴 것.
 *
 * 건너뛴 수와 「더 남았다」는 **나간 지급에만** 딸린다. 한 장도 나가지 않았을 때
 * 그것들을 함께 그리면 같은 사실이 두 번 말해지고(「모두 갖고 있다」 + 「50명을
 * 건너뛰었다」), 수량이 다 찬 경우에는 「다시 누르면 이어서 나간다」가 **거짓말**이
 * 된다 — 다시 눌러도 나가지 않는다.
 */
function BulkIssueResult({
  result,
  messages,
}: {
  readonly result: BulkIssueResponse
  readonly messages: CouponBulkIssueMessages
}) {
  const outcome = bulkIssueOutcomeOf(result)
  const issued = outcome === 'issued'

  return (
    <section aria-label={messages.resultTitle} className="flex flex-col gap-1 text-sm">
      <h3 className="text-fg font-medium">{messages.resultTitle}</h3>

      <p className={issued ? 'text-fg' : 'text-fg-muted'}>
        {messages.outcomes[outcome].replace(
          '{count}',
          couponCount(bulkIssueCountOf(outcome, result)),
        )}
      </p>

      {issued && result.skipped > 0 ? (
        <p className="text-fg-muted">
          {messages.skipped.replace('{count}', couponCount(result.skipped))}
        </p>
      ) : null}

      {issued && result.remaining > 0 ? (
        <p className="text-fg-muted">{messages.remaining}</p>
      ) : null}
    </section>
  )
}
