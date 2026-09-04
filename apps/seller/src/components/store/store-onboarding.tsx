'use client'

import type { ApiFailure, Seller } from '@shopping/shared'
import { Button, EmptyState, ErrorNotice, Link, Skeleton } from '@shopping/ui/components'
import { PageHeader } from '@shopping/ui/console'
import { Form, FormError, serverFieldErrors, useForm } from '@shopping/ui/form'
import type { ValidationErrors } from '@shopping/ui/form'
import { useCallback, useId, useMemo, useState } from 'react'
import { apiFailure, errorMessage, failureMessage, quotableRequestId } from '@shopping/shared'

import type { StoreFormValues } from '@/lib/sellers/store-form'
import {
  applicationFormSchema,
  STORE_FORM_FIELDS,
  storeFormValues,
  storeUpdateFormSchema,
} from '@/lib/sellers/store-form'
import { canApply } from '@/lib/sellers/store-status'
import type { OwnStoreController } from '@/lib/sellers/use-own-store'
import { useOwnStore } from '@/lib/sellers/use-own-store'
import { useBrandNameAvailability } from '@/lib/sellers/use-brand-name-availability'
import type { Messages } from '@/messages'
import { messagesFor } from '@/messages'

import { StoreConflictNotice } from './store-conflict-notice'
import { StoreProfileFields } from './store-profile-fields'
import { StoreStatusNotice } from './store-status-notice'

/**
 * 입점 신청 and 스토어 설정 — one screen with five faces (TASK-0109 4장).
 *
 * The face is decided by `GET /sellers/me`, never by the session: the session
 * carries no `Seller.status`, and `user.sellerId` only says whether an
 * application was ever made. The four branches below are the read's own states,
 * and `absent` — the 404 an account that never applied gets — is deliberately
 * not one of the errors.
 *
 * **`surface` changes two things and nothing else.** The heading, and what
 * happens when there is no store: `/apply` offers the form, `/settings` points
 * at `/apply`, because `/settings` is behind the console guard and a seller who
 * reached it without a store is in a state the guard should have caught.
 */

export type StoreSurface = 'apply' | 'settings'

/** Where the seller applies. One place, so a copy edit cannot split them. */
const APPLY_HREF = '/apply'

export function StoreOnboarding({
  surface,
  title,
}: {
  readonly surface: StoreSurface
  /** The page's own heading — `/settings` takes it from the sidebar entry. */
  readonly title: string
}) {
  const messages = messagesFor()
  const copy = messages.store
  const controller = useOwnStore()
  const { state } = controller

  /**
   * What the last write did, held **here** rather than inside the form.
   *
   * The form is remounted whenever the stored row moves on, which is exactly
   * what a successful save does — so a notice owned by the form would be thrown
   * away by the very thing it is announcing. The read's own states are the same
   * story: applying takes the screen from `absent` to `ready`, and that is a
   * different branch, not a re-render.
   */
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'idle' })

  const reload = useCallback(() => {
    setOutcome({ kind: 'idle' })
    controller.reload()
  }, [controller])

  const description = surface === 'apply' ? copy.applyDescription : copy.settingsDescription

  return (
    <>
      <PageHeader description={description} title={title} />

      {state.status === 'loading' ? <StoreLoading label={copy.loadingLabel} /> : null}

      {state.status === 'error' ? (
        <StoreReadFailure failure={state.failure} messages={messages} onRetry={controller.reload} />
      ) : null}

      {state.status === 'absent' && surface === 'settings' ? (
        <EmptyState
          action={
            <Link href={APPLY_HREF} variant="default">
              {copy.absent.applyLabel}
            </Link>
          }
          description={copy.absent.body}
          title={copy.absent.title}
        />
      ) : null}

      {state.status === 'absent' && surface === 'apply' ? (
        <StoreEditor
          controller={controller}
          messages={messages}
          onOutcome={setOutcome}
          onReload={reload}
          outcome={outcome}
          seller={null}
          title={title}
        />
      ) : null}

      {state.status === 'ready' ? (
        <StoreEditor
          controller={controller}
          // Remounted when the stored row moves on, so the form always starts
          // from what the server holds. A conflict does **not** change the row
          // here, which is exactly why the reader's text survives one.
          key={`${state.seller.id}-${String(state.seller.version)}`}
          messages={messages}
          onOutcome={setOutcome}
          onReload={reload}
          outcome={outcome}
          seller={state.seller}
          title={title}
        />
      ) : null}
    </>
  )
}

/** The wait for `GET /sellers/me`, announced rather than merely drawn (P5). */
function StoreLoading({ label }: { readonly label: string }) {
  return (
    <div aria-busy="true" aria-label={label} role="status">
      <Skeleton className="h-64 w-full" />
    </div>
  )
}

/**
 * The read never answered — not a refusal about the store.
 *
 * The request id is offered only for a 5xx (`quotableRequestId`): a number
 * beside "로그인이 필요해요" is noise, and a dead network produced no id at all.
 */
function StoreReadFailure({
  failure,
  messages,
  onRetry,
}: {
  readonly failure: ApiFailure
  readonly messages: Messages
  readonly onRetry: () => void
}) {
  const { failure: copy } = messages.store
  const requestId = quotableRequestId(failure)

  return (
    <ErrorNotice
      action={
        <div>
          <Button onClick={onRetry} variant="outline">
            {copy.retryLabel}
          </Button>
        </div>
      }
      copiedLabel={copy.copiedLabel}
      copyLabel={copy.copyLabel}
      description={failureMessage(failure, {
        errors: messages.errors,
        failures: messages.apiFailures,
      })}
      requestIdHint={copy.requestIdHint}
      requestIdLabel={copy.requestIdLabel}
      title={copy.title}
      {...(requestId === null ? {} : { requestId })}
    />
  )
}

/** A refused write, carried to `mapError` as a value it can read. */
class StoreWriteRejection extends Error {
  override readonly name = 'StoreWriteRejection'

  constructor(readonly failure: ApiFailure) {
    super('the store write was refused')
  }
}

/**
 * The brand name the availability check reported as taken, refused before the
 * request goes out.
 *
 * Thrown rather than checked beside the button, so that Enter pressed in a text
 * field meets the same guard a click does — there is one door (TASK-0017 4.2).
 */
class BrandNameTakenError extends Error {
  override readonly name = 'BrandNameTakenError'

  constructor() {
    super('the brand name is already taken')
  }
}

type Outcome =
  | { readonly kind: 'idle' }
  | { readonly kind: 'applied' }
  | { readonly kind: 'saved' }
  /** Somebody saved first. `latest` is for showing and for its `version`. */
  | { readonly kind: 'conflict'; readonly latest: Seller }

/**
 * The form itself — the same four fields whichever face is showing.
 *
 * `seller === null` is the first application: no banner, an empty form, and
 * `POST /sellers/applications`. Everything else edits an existing store, and the
 * only thing its status changes is the banner above and the verb on the button
 * — `REJECTED` applies again, the other three save. Nothing is disabled by
 * status, because `state-machines.md` 6장 keeps store editing open in all of
 * them and `SellerService.updateStore` never looks at one.
 */
function StoreEditor({
  seller,
  controller,
  messages,
  outcome,
  onOutcome,
  onReload,
  title,
}: {
  readonly seller: Seller | null
  readonly controller: OwnStoreController
  readonly messages: Messages
  /** Owned by the caller, because a save remounts this component. */
  readonly outcome: Outcome
  readonly onOutcome: (outcome: Outcome) => void
  readonly onReload: () => void
  /** Names the form for a screen reader, so it is not an unlabelled region. */
  readonly title: string
}) {
  const copy = messages.store
  const bannerId = useId()

  const applying = canApply(seller?.status ?? null)
  const initialValues = useMemo<StoreFormValues>(() => storeFormValues(seller), [seller])

  /**
   * The version a save is written against.
   *
   * The conflict's `latest` wins once there has been one: 그대로 저장 means
   * "write mine on top of what is there now", and re-sending the version that
   * was already refused would only be refused again.
   */
  const version = outcome.kind === 'conflict' ? outcome.latest.version : (seller?.version ?? 0)

  const mapError = useCallback(
    (error: unknown): ValidationErrors | undefined => {
      if (error instanceof BrandNameTakenError) {
        return { fieldErrors: { brandName: copy.form.errors.brandNameTaken }, formErrors: [] }
      }

      const failure = error instanceof StoreWriteRejection ? error.failure : apiFailure(error)
      const fallback = failureMessage(failure, {
        errors: messages.errors,
        failures: messages.apiFailures,
      })

      if (failure.kind !== 'http') return { fieldErrors: {}, formErrors: [fallback] }

      return serverFieldErrors(failure.details, {
        code: failure.code,
        fallbackMessage: fallback,
        fields: [...STORE_FORM_FIELDS],
        // `INVALID` is the only code these endpoints send (TASK-0108 4장 —
        // 도메인 오류 코드는 늘리지 않았다), so it says nothing the status does
        // not, while the sentence beside it says which name is taken. Answering
        // it from the catalog would replace "이미 쓰고 있는 브랜드명이에요." with
        // a generic line — a catalog lookup that loses information.
        messageForCode: (code) =>
          code === 'INVALID' ? undefined : errorMessage(messages.errors, code),
      })
    },
    [copy.form.errors.brandNameTaken, messages.apiFailures, messages.errors],
  )

  const schema = useMemo(
    () =>
      applying
        ? applicationFormSchema({ messages: copy.form.errors })
        : storeUpdateFormSchema(version, { messages: copy.form.errors }),
    [copy.form.errors, applying, version],
  )

  const form = useForm({
    schema,
    initialValues,
    mapError,
    submitErrorMessage: copy.form.submitFailed,
    onSubmit: async (submission) => {
      // Read here rather than beside the button so that the keyboard's implicit
      // submission meets it too. `availability` is declared below and this runs
      // on an event, long after that binding exists.
      if (availability.status === 'taken') throw new BrandNameTakenError()

      const result =
        submission.kind === 'apply'
          ? await controller.apply(submission.request)
          : await controller.save(submission.request)

      if (result.ok) {
        onOutcome({ kind: submission.kind === 'apply' ? 'applied' : 'saved' })
        return
      }
      // A lost optimistic lock is not a field error: `version` is not an input,
      // and the answer is a choice rather than a correction (F6).
      if (result.conflict !== undefined) {
        onOutcome({ kind: 'conflict', latest: result.conflict })
        return
      }

      throw new StoreWriteRejection(result.failure)
    },
  })

  const typedBrandName = typeof form.values.brandName === 'string' ? form.values.brandName : ''
  const availability = useBrandNameAvailability(typedBrandName, {
    current: seller?.brandName ?? null,
  })

  const submitLabel = !applying
    ? copy.form.saveLabel
    : seller === null
      ? copy.form.applyLabel
      : copy.form.reapplyLabel

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      {seller === null ? null : (
        <StoreStatusNotice headingId={bannerId} messages={copy.status} seller={seller} />
      )}

      {outcome.kind === 'conflict' ? (
        <StoreConflictNotice
          messages={copy.conflict}
          onOverwrite={form.submit}
          onReload={onReload}
          pending={form.submitting}
        />
      ) : null}

      {outcome.kind === 'applied' || outcome.kind === 'saved' ? (
        <p
          className="border-success bg-success-surface text-fg rounded-lg border px-4 py-3 text-sm"
          role="status"
        >
          {outcome.kind === 'applied' ? copy.form.appliedNotice : copy.form.savedNotice}
        </p>
      ) : null}

      <Form aria-label={title} form={form}>
        <FormError errors={form.formErrors} title={copy.form.errorTitle} />

        <StoreProfileFields
          availability={availability}
          availabilityMessages={copy.availability}
          form={form}
          messages={copy.form}
          slugLocked={seller !== null}
        />

        <div className="flex flex-wrap gap-2">
          {/*
            Not `disabled` when the name is taken, and that is a decision rather
            than an omission. A natively disabled submit button blocks the
            browser's *implicit* submission too, so Enter in a text field would
            do nothing at all and say nothing about why — the dead end TASK-0018
            4.5 refuses. Pressing it instead meets the guard in `onSubmit`, which
            puts the reason under the input it is about, which is where the
            server's own 409 about the same name lands (R2). TASK-0109 9장.
          */}
          <Button loading={form.submitting} type="submit" variant="primary">
            {submitLabel}
          </Button>
        </div>
      </Form>
    </div>
  )
}
