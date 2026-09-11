'use client'

import { ProductThumbnail } from '@shopping/ui/components'

import type { ApiFailure, ClaimableItem, ClaimableResponse, ReturnReason } from '@shopping/shared'
import { CLAIM_REASON_MAX_LENGTH } from '@shopping/shared'
import {
  Button,
  Checkbox,
  EmptyState,
  ErrorState,
  Input,
  linkClassName,
  Select,
  Skeleton,
  Textarea,
} from '@shopping/ui/components'
import NextLink from 'next/link'
import { useCallback, useId, useState } from 'react'

import { Field, fieldAria, fieldHintId } from '@/form'
import { RETURN_FAULT } from '@/lib/claims/claim-console'
import type {
  DefectReturnDraft,
  DefectReturnIssue,
  DefectReturnTarget,
} from '@/lib/claims/defect-return'
import {
  claimableTargets,
  DEFECT_RETURN_REASONS,
  defectQuantityChoices,
  defectReturnBlockOf,
  defectReturnIssues,
  defectReturnLines,
  defectReturnRequestOf,
  defectReturnTargetOf,
  EMPTY_DEFECT_RETURN_DRAFT,
  withDefectQuantity,
  withDefectTarget,
} from '@/lib/claims/defect-return'
import { useDefectReturn } from '@/lib/claims/use-defect-return'
import { useReturnPhotos } from '@/lib/claims/use-return-photos'
import type { AdminClaimMessages, ErrorNoticeMessages } from '@/messages'

import { DefectReturnDialog } from './defect-return-dialog'
import { ReturnPhotoField } from './return-photo-field'

/**
 * 「확정 후 하자 반품」 탭 — **주문에서 시작하는 유일한 자리** (TASK-0071 F4).
 *
 * ## 왜 `/claims` 안의 탭인가
 *
 * 이 개입의 진입점은 원래 관리자 주문 화면(`/orders`)이어야 하고 그쪽이 열리면
 * 거기서 이리로 오게 된다. 그런데 그 화면은 아직 껍데기이고(TASK-0092), 그것을
 * 기다리는 동안 **서버는 있는데 그것을 시작할 화면이 없는** 상태가 남는다 — 라우트를
 * 새로 파는 대신 콘솔 안에서 완결시키는 이유가 그것이다. `pages.md` 도 관리자
 * 클레임을 `/claims` 하나로 적어 두었다.
 *
 * ## 세 걸음이 한 화면에 있다
 *
 * 찾고 · 고르고 · 확인한다. 앞의 둘이 탭 본문이고 마지막만 대화상자다 — 폼이
 * 길어서이고(항목·수량·사유·사진·개입 사유), 그 이유는 `defect-return-dialog.tsx` 에
 * 적혀 있다.
 *
 * ## 「처리할 수 없다」는 문장이지 회색 버튼이 아니다
 *
 * 이 콘솔의 규칙이고(TASK-0063 4.1), 여기서는 그 문장이 특히 중요하다. 확정 전
 * 주문에 반품 폼을 그려 놓고 서버가 거절하게 두면 운영자는 **정상 경로가 있다는
 * 사실 자체를 모른 채** 실패를 반복한다.
 */

export interface DefectReturnPanelProps {
  readonly messages: AdminClaimMessages
  readonly notice: ErrorNoticeMessages
  /** 실패를 이 화면의 문장으로. 목록 탭과 **같은 함수**를 받는다. */
  readonly describe: (failure: ApiFailure) => string
}

export function DefectReturnPanel({ messages, notice, describe }: DefectReturnPanelProps) {
  const copy = messages.defectReturn
  const controller = useDefectReturn()
  const photos = useReturnPhotos()

  const [text, setText] = useState('')
  const [lookupError, setLookupError] = useState<string | undefined>(undefined)
  const [draft, setDraft] = useState<DefectReturnDraft>(EMPTY_DEFECT_RETURN_DRAFT)
  /**
   * 눌러 보기 전에는 남은 문제를 그리지 않는다.
   *
   * 아무것도 고르지 않은 채 탭에 들어온 사람에게 「항목을 골라주세요」를 먼저 보이면,
   * 그것은 안내가 아니라 **아직 하지 않은 일에 대한 지적**이다.
   */
  const [attempted, setAttempted] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [failure, setFailure] = useState<ApiFailure | null>(null)
  const [filed, setFiled] = useState<string | null>(null)

  const inputId = useId()

  function find(): void {
    const target: DefectReturnTarget = defectReturnTargetOf(text)

    if (target !== 'seller_order_id') {
      setLookupError(copy.lookup.errors[target])

      return
    }

    setLookupError(undefined)
    setDraft(EMPTY_DEFECT_RETURN_DRAFT)
    setAttempted(false)
    setFailure(null)
    setFiled(null)
    photos.clear()
    void controller.find(text.trim())
  }

  function restart(): void {
    setText('')
    setLookupError(undefined)
    setDraft(EMPTY_DEFECT_RETURN_DRAFT)
    setAttempted(false)
    setFailure(null)
    setFiled(null)
    photos.clear()
    controller.reset()
  }

  // 사진은 훅이 들고 있고 초안은 상태가 들고 있다. 「보낼 수 있는가」는 둘을 함께
  // 봐야 답이 나오므로, 판정 직전에 한 값으로 합친다.
  const current: DefectReturnDraft = {
    ...draft,
    photoKeys: photos.keys,
    uploading: photos.uploading,
  }
  const issues = defectReturnIssues(current)

  async function submit(claimable: ClaimableResponse): Promise<void> {
    const result = await controller.file(
      defectReturnRequestOf(claimable.sellerOrderId, claimable.items, current),
    )

    if (result === null) return

    if (result.ok) {
      setConfirming(false)
      setFailure(null)
      setFiled(result.claim.id)

      return
    }

    setFailure(result.failure)
  }

  return (
    <div className="flex flex-col gap-4">
      <section aria-label={copy.title} className="flex flex-col gap-2">
        <h2 className="text-fg text-lg font-medium">{copy.title}</h2>
        <p className="text-fg-muted text-sm">{copy.description}</p>
      </section>

      <form
        className="border-border bg-surface-muted flex flex-col gap-3 rounded-md border p-3"
        onSubmit={(event) => {
          event.preventDefault()
          find()
        }}
        role="search"
      >
        <fieldset className="flex flex-col gap-3">
          <legend className="sr-only">{copy.lookup.legend}</legend>

          {/*
            **주문번호로 찾을 수 없다는 사실이 화면에 상주한다.** 오류로만 말하면 그
            문장은 주문번호를 한 번 넣어 본 사람에게만 도착하고, 그 사람은 이미 한
            번 실패한 뒤다.
          */}
          <p className="text-fg-muted text-sm" role="note">
            {copy.lookup.unavailableNotice}
          </p>

          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-72 flex-1">
              <Field
                error={lookupError}
                fieldId={inputId}
                hint={copy.lookup.hint}
                label={copy.lookup.label}
                required
              >
                <Input
                  {...fieldAria(inputId, { error: lookupError, hint: copy.lookup.hint })}
                  onChange={(event) => {
                    setText(event.target.value)
                    setLookupError(undefined)
                  }}
                  placeholder={copy.lookup.placeholder}
                  value={text}
                />
              </Field>
            </div>

            <Button type="submit" variant="outline">
              {copy.lookup.submit}
            </Button>
          </div>
        </fieldset>
      </form>

      {controller.lookup.status === 'loading' ? (
        <Skeleton label={copy.lookup.loadingLabel} lines={4} />
      ) : null}

      {controller.lookup.status === 'error' ? (
        <ErrorState
          description={describe(controller.lookup.failure)}
          onRetry={() => {
            void controller.find(text.trim())
          }}
          retryLabel={copy.lookup.retryLabel}
          title={copy.lookup.errorTitle}
        />
      ) : null}

      {controller.lookup.status === 'missing' ? (
        <EmptyState
          description={copy.lookup.notFoundDescription}
          title={copy.lookup.notFoundTitle}
        />
      ) : null}

      {controller.lookup.status === 'ready' && filed === null ? (
        <Target
          attempted={attempted}
          claimable={controller.lookup.claimable}
          describe={describe}
          draft={draft}
          issues={issues}
          messages={messages}
          onAttempt={() => {
            setAttempted(true)
            if (issues.length === 0) setConfirming(true)
          }}
          onDraft={setDraft}
          photos={photos}
        />
      ) : null}

      {filed === null ? null : (
        <div
          className="border-border bg-surface-muted flex flex-col gap-2 rounded-md border p-3 text-sm"
          role="status"
        >
          <p className="text-fg font-medium">{copy.done.title}</p>
          <p className="text-fg-muted">{copy.done.body}</p>
          <div className="flex flex-wrap items-center gap-3">
            <NextLink className={linkClassName()} href={`/claims/${filed}`}>
              {copy.done.open}
            </NextLink>
            <Button onClick={restart} size="sm" type="button" variant="ghost">
              {copy.done.again}
            </Button>
          </div>
        </div>
      )}

      {confirming && controller.lookup.status === 'ready' ? (
        <DefectReturnDialog
          busy={controller.busy}
          describe={describe}
          detail={messages.detail}
          failure={failure}
          items={controller.lookup.claimable.items}
          lines={defectReturnLines(draft.selection, controller.lookup.claimable.items)}
          messages={copy}
          notice={notice}
          onCancel={() => {
            setConfirming(false)
            setFailure(null)
          }}
          onConfirm={() => {
            if (controller.lookup.status === 'ready') void submit(controller.lookup.claimable)
          }}
        />
      ) : null}
    </div>
  )
}

/** 찾아낸 몫 — 시작할 수 있으면 폼, 아니면 **왜 여기가 아닌지**. */
function Target({
  claimable,
  messages,
  draft,
  onDraft,
  photos,
  issues,
  attempted,
  onAttempt,
  describe,
}: {
  readonly claimable: ClaimableResponse
  readonly messages: AdminClaimMessages
  readonly draft: DefectReturnDraft
  readonly onDraft: (next: DefectReturnDraft) => void
  readonly photos: ReturnType<typeof useReturnPhotos>
  readonly issues: readonly DefectReturnIssue[]
  readonly attempted: boolean
  readonly onAttempt: () => void
  readonly describe: (failure: ApiFailure) => string
}) {
  const copy = messages.defectReturn
  const block = defectReturnBlockOf(claimable)

  if (block !== null) {
    return (
      <div
        className="border-border bg-surface-muted flex flex-col gap-1 rounded-md border p-3 text-sm"
        role="note"
      >
        <p className="text-fg font-medium">{copy.blocked.title}</p>
        <p className="text-fg-muted">{copy.blocked.state[block]}</p>
      </div>
    )
  }

  return (
    <DefectReturnForm
      attempted={attempted}
      describe={describe}
      draft={draft}
      issues={issues}
      items={claimableTargets(claimable)}
      messages={messages}
      onAttempt={onAttempt}
      onDraft={onDraft}
      photos={photos}
    />
  )
}

/** 항목 · 수량 · 사유 · 사진 · 개입 사유. */
function DefectReturnForm({
  items,
  messages,
  draft,
  onDraft,
  photos,
  issues,
  attempted,
  onAttempt,
  describe,
}: {
  readonly items: readonly ClaimableItem[]
  readonly messages: AdminClaimMessages
  readonly draft: DefectReturnDraft
  readonly onDraft: (next: DefectReturnDraft) => void
  readonly photos: ReturnType<typeof useReturnPhotos>
  readonly issues: readonly DefectReturnIssue[]
  readonly attempted: boolean
  readonly onAttempt: () => void
  readonly describe: (failure: ApiFailure) => string
}) {
  const copy = messages.defectReturn
  const { form } = copy
  const reasonId = useId()
  const noteId = useId()
  const issuesId = useId()

  const nameOf = useCallback(
    (item: ClaimableItem): string =>
      form.itemLabel
        .replace('{product}', item.snapshot.productName)
        .replace(
          '{option}',
          item.snapshot.optionLabel === '' ? form.noOption : item.snapshot.optionLabel,
        ),
    [form.itemLabel, form.noOption],
  )

  return (
    <div className="flex flex-col gap-4">
      <p className="text-fg text-sm">{form.found}</p>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-fg text-sm font-medium">{form.itemsLegend}</legend>
        <p className="text-fg-subtle text-xs">{form.itemsHint}</p>

        <ul className="flex flex-col gap-2">
          {items.map((item) => {
            const chosen = draft.selection[item.orderItemId]

            return (
              <li
                className="border-border flex flex-wrap items-center gap-3 rounded-md border p-2"
                key={item.orderItemId}
              >
                <ProductThumbnail
                  src={item.snapshot.thumbnailUrl}
                  className="size-12 shrink-0 rounded"
                />
                <Checkbox
                  checked={chosen !== undefined}
                  description={form.remaining.replace('{count}', String(item.remainingQuantity))}
                  label={nameOf(item)}
                  onCheckedChange={(next) => {
                    onDraft({
                      ...draft,
                      selection: withDefectTarget(draft.selection, item.orderItemId, next === true),
                    })
                  }}
                />

                {chosen === undefined ? null : (
                  <Select
                    aria-label={form.quantityLabel.replace('{product}', item.snapshot.productName)}
                    onValueChange={(next) => {
                      onDraft({
                        ...draft,
                        selection: withDefectQuantity(
                          draft.selection,
                          item.orderItemId,
                          Number(next),
                        ),
                      })
                    }}
                    options={defectQuantityChoices(item).map((quantity) => ({
                      value: String(quantity),
                      label: String(quantity),
                    }))}
                    size="sm"
                    value={String(chosen)}
                  />
                )}
              </li>
            )
          })}
        </ul>
      </fieldset>

      {/*
        **단순 변심이 목록에 없는 것만으로는 왜 없는지 알 수 없다.** 목록과 문장이
        둘 다 그 제한을 말하고, 목록 자체는 귀책 표에서 파생된다.
      */}
      <Field fieldId={reasonId} hint={form.reasonHint} label={form.reasonLabel} required>
        <Select
          aria-describedby={fieldHintId(reasonId)}
          id={reasonId}
          onValueChange={(next) => {
            onDraft({ ...draft, returnReason: next as ReturnReason })
          }}
          options={DEFECT_RETURN_REASONS.map((reason) => ({
            value: reason,
            label: messages.vocabulary.returnReasonLabels[reason],
          }))}
          value={draft.returnReason}
        />
      </Field>

      <p className="text-fg-muted text-sm">
        {form.faultPreview.replace(
          '{fault}',
          messages.vocabulary.faultLabels[RETURN_FAULT[draft.returnReason]],
        )}
      </p>

      <ReturnPhotoField describe={describe} messages={form} photos={photos} />

      <Field fieldId={noteId} hint={form.noteHint} label={form.noteLabel} required>
        <Textarea
          {...fieldAria(noteId, { hint: form.noteHint })}
          maxLength={CLAIM_REASON_MAX_LENGTH}
          onChange={(event) => {
            onDraft({ ...draft, reason: event.target.value })
          }}
          placeholder={form.notePlaceholder}
          value={draft.reason}
        />
      </Field>

      {attempted && issues.length > 0 ? (
        <div
          className="border-danger bg-danger-surface flex flex-col gap-1 rounded-md border p-3 text-sm"
          id={issuesId}
          role="alert"
        >
          <p className="text-fg font-medium">{form.issuesLabel}</p>
          <ul className="text-fg flex list-disc flex-col gap-1 ps-5">
            {issues.map((issue) => (
              <li key={issue}>{form.issues[issue]}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div>
        <Button
          aria-describedby={attempted && issues.length > 0 ? issuesId : undefined}
          onClick={onAttempt}
          type="button"
          variant="danger"
        >
          {form.submit}
        </Button>
      </div>
    </div>
  )
}
