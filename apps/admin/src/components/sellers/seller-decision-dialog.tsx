'use client'

import type { ApiFailure, ErrorMessages, Seller } from '@shopping/shared'
import { errorMessage, failureMessage, sellerStatusReasonSchema } from '@shopping/shared'
import { Button, Modal, ModalClose, Textarea } from '@shopping/ui/components'
import type { ValidationErrors } from '@shopping/ui/form'
import { Form, FormField, serverFieldErrors, useForm } from '@shopping/ui/form'
import { useMemo } from 'react'
import { z } from 'zod'

import type { SellerDecision } from '@/lib/sellers/decisions'
import { needsReason } from '@/lib/sellers/decisions'
import type { SellerReviewMessages } from '@/messages'

/**
 * The question in front of a decision, and the reason two of them require.
 *
 * **One dialog for all four**, because the difference between them is one field:
 * 반려 and 정지 are answers the seller has to be able to act on, so the contract
 * makes their `reason` mandatory (`sellerReasonedDecisionRequestSchema`), while
 * 승인 and 해제 are confirmations. Four dialogs would be four places for the
 * submit guard, the focus trap and the failure display to drift apart.
 *
 * **The rule is the contract's, the sentence is this app's.** `useForm`
 * validates with one zod schema and the server's schema cannot be that schema —
 * its messages are zod's English. So the *predicate* is
 * `sellerStatusReasonSchema` and only the wording is here, exactly as
 * `attributeFormSchema` does it (TASK-0031 4.5, TASK-0110 4장).
 *
 * **The confirm button is never the initially focused control.** Radix puts
 * focus on the close control in the header, so a stray Enter dismisses rather
 * than approves — the convention `ConfirmDialog` states, borrowed rather than
 * reimplemented. This is not `ConfirmDialog` itself only because half of these
 * dialogs carry a validated field, which that component has no room for.
 */

/** The one input this dialog owns. Nothing outside the list is ever placed. */
const FORM_FIELDS = ['reason'] as const

/**
 * What the screen behind the dialog answers with.
 *
 * Three outcomes rather than a boolean, because "it failed" is not one thing
 * here. `handled` is the case the dialog must not draw: a 409 has already been
 * explained beside the row that changed, and a 5xx has already been put in the
 * notice with its reference number — repeating either inside a dialog that is
 * about to close would be the same failure said twice, in the wrong place.
 */
export type SellerDecisionOutcome =
  | { readonly kind: 'done' }
  | { readonly kind: 'handled' }
  | { readonly kind: 'refused'; readonly failure: ApiFailure }

interface SellerDecisionDialogProps {
  readonly decision: SellerDecision
  /** What is being decided. Its name is shown; its `version` is the caller's. */
  readonly seller: Seller
  readonly messages: SellerReviewMessages
  /** `code` → sentence, for everything the API answers (TASK-0117 4.2). */
  readonly errors: ErrorMessages
  readonly onCancel: () => void
  /** Resolves with what the API said. Rejecting is not part of the contract. */
  readonly onConfirm: (reason?: string) => Promise<SellerDecisionOutcome>
}

export function SellerDecisionDialog({
  decision,
  seller,
  messages,
  errors,
  onCancel,
  onConfirm,
}: SellerDecisionDialogProps) {
  const copy = messages.dialog
  const reasoned = needsReason(decision)

  /**
   * The schema, rebuilt only when the copy changes.
   *
   * `reason` is present on both branches so the values object has one shape: a
   * form whose field set changes between renders would lose what was typed the
   * moment the dialog re-rendered for any other reason.
   */
  const schema = useMemo(
    () =>
      z.object({
        reason: reasoned
          ? z
              .string()
              .trim()
              .min(1, copy.errors.reasonRequired)
              .refine(
                (value) => sellerStatusReasonSchema.safeParse(value).success,
                copy.errors.reasonTooLong,
              )
          : z.string(),
      }),
    [reasoned, copy.errors.reasonRequired, copy.errors.reasonTooLong],
  )

  /** The catalog's sentence for a failure. Never the server's, if we have one. */
  const describe = (failure: ApiFailure): string =>
    failureMessage(failure, { errors, failures: messages.failures })

  /**
   * Turns a refused decision into messages under the input it is about.
   *
   * The server's own refusal for an empty reason arrives as
   * `details[].field = 'reason'`, so it lands under the textarea even though the
   * schema above should have caught it first. Belt and braces on purpose: the
   * two rules are the same rule, and if they ever disagree the server wins
   * visibly rather than silently.
   */
  const placedErrors = (failure: ApiFailure): ValidationErrors =>
    serverFieldErrors(failure.kind === 'http' ? failure.details : [], {
      fields: FORM_FIELDS,
      code: failure.kind === 'http' ? failure.code : null,
      messageForCode: (code, params) => errorMessage(errors, code, params),
      fallbackMessage: describe(failure),
    })

  const form = useForm({
    schema,
    initialValues: { reason: '' },
    submitErrorMessage: copy.submitError,
    mapError: (error: unknown) =>
      error instanceof DecisionRefused ? placedErrors(error.failure) : undefined,
    onSubmit: async (values) => {
      const trimmed = values.reason.trim()
      const outcome = await onConfirm(reasoned || trimmed !== '' ? trimmed : undefined)

      if (outcome.kind === 'refused') throw new DecisionRefused(outcome.failure)
      // `done` closes because the screen has already dropped the pending
      // decision; `handled` closes because the failure is being shown outside.
      if (outcome.kind === 'handled') onCancel()
    },
  })

  return (
    <Modal
      closeLabel={copy.closeLabel}
      description={copy.descriptions[decision]}
      footer={
        <>
          <ModalClose>
            <Button variant="outline">{copy.cancel}</Button>
          </ModalClose>
          <Button
            loading={form.submitting}
            onClick={form.submit}
            variant={reasoned ? 'danger' : 'primary'}
          >
            {copy.confirms[decision]}
          </Button>
        </>
      }
      onOpenChange={(next) => {
        if (!next) onCancel()
      }}
      open
      title={copy.titles[decision]}
    >
      <Form aria-label={copy.titles[decision]} form={form}>
        {/* The store's name on its own line rather than inside a sentence: a
            placeholder is one more thing that can render as `{brandName}`. */}
        <p className="text-fg font-medium">{seller.brandName}</p>
        <p className="text-fg-muted text-sm">{seller.slug}</p>

        {reasoned ? (
          <FormField
            form={form}
            hint={copy.reasonHint}
            label={copy.reasonLabel}
            name="reason"
            required
          >
            <Textarea
              placeholder={copy.reasonPlaceholder}
              rows={4}
              {...form.text('reason')}
              // `useForm` binds value and validity; the id and the description
              // are `FormField`'s, so the label and the error cannot disagree.
            />
          </FormField>
        ) : null}

        {form.formErrors.length === 0 ? null : (
          <p className="text-danger text-sm" role="alert">
            {form.formErrors[0]}
          </p>
        )}
      </Form>
    </Modal>
  )
}

/**
 * What a refused decision is thrown as, so `useForm.mapError` can recognise it.
 *
 * `useForm` only learns that a submit failed by the promise rejecting, and the
 * hooks answer with a result value rather than throwing — deliberately, because
 * every other caller has to keep rendering. This wrapper is the one place the
 * two conventions meet.
 */
class DecisionRefused extends Error {
  override readonly name = 'DecisionRefused'

  constructor(readonly failure: ApiFailure) {
    super('the API refused the decision')
  }
}
