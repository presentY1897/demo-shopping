'use client'

import type {
  ApiFailure,
  AttributeDefinition,
  EffectiveAttribute,
  ErrorMessages,
} from '@shopping/shared'
import {
  attributeTypeHasOptions,
  errorMessage,
  failureMessage,
  hasCode,
  quotableRequestId,
} from '@shopping/shared'
import {
  Button,
  DataList,
  EmptyState,
  ErrorNotice,
  ErrorState,
  Skeleton,
  useToast,
} from '@shopping/ui/components'
import type { ValidationErrors } from '@shopping/ui/form'
import { NO_ERRORS, serverFieldErrors } from '@shopping/ui/form'
import { useCallback, useMemo, useState } from 'react'

import { choiceById, choiceName } from '@/lib/attributes/categories'
import type { AttributeFormValues } from '@/lib/attributes/form-schema'
import type { MoveDirection } from '@/lib/attributes/order'
import type { AttributeDraft } from '@/lib/attributes/preview'
import { previewAttributes } from '@/lib/attributes/preview'
import { useAttributeConsole } from '@/lib/attributes/use-attributes'
import { useAuthorization } from '@/lib/auth/authorization'
import type { AttributeMessages, ErrorNoticeMessages } from '@/messages'

import { AttributeCategoryPicker } from './attribute-category-picker'
import { AttributeConflictDialog } from './attribute-conflict-dialog'
import type { AttributeFormOutcome } from './attribute-form-panel'
import { AttributeFormPanel } from './attribute-form-panel'
import { AttributeList } from './attribute-list'
import { AttributePreview } from './attribute-preview'
import { AttributeRetireDialog } from './attribute-retire-dialog'

/** The inputs this screen's form owns. Nothing outside the list is ever placed. */
const FORM_FIELDS = ['key', 'label', 'type', 'options', 'isRequired', 'isFilterable'] as const

/**
 * Codes that name no field of their own but still belong on one.
 *
 * `ATTRIBUTE_KEY_TAKEN` arrives with `details[].field === 'key'` today, so this
 * is the belt to that braces: an endpoint that sent the code without the entry
 * would still put the message where it belongs (`serverFieldErrors` shape 3).
 *
 * `ATTRIBUTE_VERSION_CONFLICT` is deliberately absent. Its `field` is `version`,
 * which is not an input anybody typed into — the recovery is a dialog, and it is
 * chosen by code before this map is ever consulted (TASK-0031 4.8).
 */
const CODE_FIELDS: Readonly<Record<string, string>> = { ATTRIBUTE_KEY_TAKEN: 'key' }

type Panel =
  | { readonly kind: 'none' }
  | { readonly kind: 'create'; readonly formKey: number }
  | { readonly kind: 'edit'; readonly id: number; readonly formKey: number }

type Dialog =
  | { readonly kind: 'none' }
  | { readonly kind: 'retire'; readonly id: number; readonly blocked: boolean }
  | {
      readonly kind: 'conflict'
      readonly id: number
      readonly latest: AttributeDefinition
      readonly mine: AttributeFormValues
    }

interface AttributeWorkspaceProps {
  readonly messages: AttributeMessages
  /** `code` → sentence, for everything the API answers (TASK-0117 4.2). */
  readonly errors: ErrorMessages
  /** Copy for a failure nobody on this screen can fix (4.4). */
  readonly notice: ErrorNoticeMessages
}

/**
 * The attribute console: a category, its effective definitions, the editor and
 * the preview the editor feeds.
 *
 * The split from `AttributeManager` is only the toast provider — `useToast` has
 * to be called under it, and a component that provided a context and consumed it
 * in the same render would be a hook-order accident waiting to happen.
 */
export function AttributeWorkspace({ messages, errors, notice }: AttributeWorkspaceProps) {
  const console_ = useAttributeConsole()
  const { toast } = useToast()

  /**
   * Why this account may not retire a definition, or `undefined` when it may.
   *
   * Same table the API's guard reads — `catalog.delete`, which the operator and
   * demo roles do not hold (TASK-0023 4장).
   */
  const { reason } = useAuthorization()
  const removeDenial = reason('catalog.delete')

  const [panel, setPanel] = useState<Panel>({ kind: 'none' })
  const [dialog, setDialog] = useState<Dialog>({ kind: 'none' })
  const [pending, setPending] = useState(false)
  const [formKey, setFormKey] = useState(0)
  const [draft, setDraft] = useState<AttributeDraft | null>(null)

  /**
   * A failure the operator cannot act on, held until they dismiss it.
   *
   * A toast is the wrong home for a correlation id: it disappears, and the one
   * thing the reader is being asked to do with the number is copy it somewhere
   * else (TASK-0117 4.4).
   */
  const [reported, setReported] = useState<ApiFailure | null>(null)

  const { state, categories, categoryId } = console_
  const attributes = useMemo(() => (state.status === 'ready' ? state.attributes : []), [state])

  const selected = choiceById(categories, categoryId)
  const categoryName = useCallback(
    (id: number): string => {
      const choice = choiceById(categories, id)

      return choice === undefined ? '' : choiceName(choice)
    },
    [categories],
  )

  const editing: EffectiveAttribute | undefined =
    panel.kind === 'edit' ? attributes.find((row) => row.id === panel.id) : undefined

  /** The catalog's sentence for this failure. Never the server's, if we have one. */
  const describe = useCallback(
    (failure: ApiFailure): string =>
      failureMessage(failure, { errors, failures: messages.failures }),
    [errors, messages.failures],
  )

  /**
   * Says what went wrong, in the form the failure deserves.
   *
   * A failure with a quotable reference gets the persistent notice; everything
   * else — including a dead network, which produced no number — keeps the toast,
   * because its answer is already on screen.
   */
  const report = useCallback(
    (title: string, failure: ApiFailure): void => {
      if (quotableRequestId(failure) !== null) {
        setReported(failure)
        return
      }

      toast({ title, description: describe(failure), variant: 'danger' })
    },
    [describe, toast],
  )

  /** `{ requestId }` when there is one worth quoting, `{}` otherwise. */
  function requestIdProp(failure: ApiFailure): { requestId?: string } {
    const id = quotableRequestId(failure)

    return id === null ? {} : { requestId: id }
  }

  /**
   * Turns a refused save into messages under the inputs they are about.
   *
   * This is the whole of TASK-0117 on this screen: `details[].field` says which
   * input, `code` says which sentence, and neither is read out of Korean prose.
   * Anything the server refused that names no input this form owns still gets
   * shown — at form level, where being unplaced is honest.
   */
  const placedErrors = useCallback(
    (failure: ApiFailure): ValidationErrors =>
      serverFieldErrors(failure.kind === 'http' ? failure.details : [], {
        fields: FORM_FIELDS,
        code: failure.kind === 'http' ? failure.code : null,
        codeFields: CODE_FIELDS,
        messageForCode: (code, params) => errorMessage(errors, code, params),
        fallbackMessage: describe(failure),
      }),
    [describe, errors],
  )

  const onDraftChange = useCallback((next: AttributeDraft | null) => {
    setDraft(next)
  }, [])

  function closePanel(): void {
    setPanel({ kind: 'none' })
    setDraft(null)
  }

  function openCreate(): void {
    setFormKey((key) => key + 1)
    setPanel({ kind: 'create', formKey: formKey + 1 })
  }

  function openEdit(id: number): void {
    setFormKey((key) => key + 1)
    setPanel({ kind: 'edit', id, formKey: formKey + 1 })
  }

  /**
   * Chooses the recovery this failure calls for.
   *
   * Three answers, each picked by a code rather than inferred: somebody else's
   * save opens the comparison dialog, a failure nobody here can fix goes to the
   * notice with its reference, and everything else is placed on the inputs it is
   * about.
   */
  function rejectSave(
    failure: ApiFailure,
    values: AttributeFormValues,
    latest?: AttributeDefinition,
  ): AttributeFormOutcome {
    // `latest` is absent when the re-read failed. The dialog would have nothing
    // to show on its "지금 저장된 값" side, so the placed message is all that is
    // left — and it is still the right message, because the code said so.
    if (hasCode(failure, 'ATTRIBUTE_VERSION_CONFLICT') && panel.kind === 'edit') {
      if (latest !== undefined) {
        setDialog({ kind: 'conflict', id: panel.id, latest, mine: values })

        return { kind: 'rejected', errors: NO_ERRORS }
      }
    }

    if (quotableRequestId(failure) !== null) {
      setReported(failure)

      return { kind: 'rejected', errors: NO_ERRORS }
    }

    return { kind: 'rejected', errors: placedErrors(failure) }
  }

  async function submitForm(values: AttributeFormValues): Promise<AttributeFormOutcome> {
    const options = attributeTypeHasOptions(values.type) ? [...values.options] : undefined

    if (panel.kind === 'create') {
      const result = await console_.create({
        key: values.key,
        label: values.label,
        type: values.type,
        isRequired: values.isRequired,
        isFilterable: values.isFilterable,
        ...(options === undefined ? {} : { options }),
      })

      if (result.ok) {
        closePanel()
        toast({ title: messages.toast.created, variant: 'success' })

        return { kind: 'saved' }
      }

      return rejectSave(result.failure, values)
    }

    if (panel.kind !== 'edit' || editing === undefined) {
      return { kind: 'rejected', errors: NO_ERRORS }
    }

    const result = await console_.save(editing.id, {
      version: editing.version,
      label: values.label,
      isRequired: values.isRequired,
      isFilterable: values.isFilterable,
      ...(options === undefined ? {} : { options }),
    })

    if (result.ok) {
      closePanel()
      toast({ title: messages.toast.updated, variant: 'success' })

      return { kind: 'saved' }
    }

    return rejectSave(result.failure, values, result.conflict)
  }

  async function handleMove(id: number, direction: MoveDirection): Promise<void> {
    const result = await console_.move(id, direction)

    if (result.ok) return

    // The list has already been re-read; say so, or the operator is left
    // wondering whether the move happened (TASK-0031 4.6).
    if (quotableRequestId(result.failure) !== null) {
      setReported(result.failure)
      return
    }

    toast({
      title: messages.toast.moveFailed,
      description: `${describe(result.failure)} ${messages.toast.reloaded}`,
      variant: 'danger',
    })
  }

  async function handleToggleFilterable(id: number): Promise<void> {
    const before = attributes.find((row) => row.id === id)
    const result = await console_.toggleFilterable(id)

    if (result.ok) {
      toast({
        title:
          before?.isFilterable === true
            ? messages.toast.filterableOff
            : messages.toast.filterableOn,
        variant: 'success',
      })

      return
    }

    report(messages.toast.saveFailed, result.failure)
  }

  async function confirmRetire(): Promise<void> {
    if (dialog.kind !== 'retire') return

    setPending(true)
    const result = await console_.remove(dialog.id)
    setPending(false)

    if (result.ok) {
      setDialog({ kind: 'none' })
      if (panel.kind === 'edit' && panel.id === dialog.id) closePanel()
      toast({ title: messages.toast.removed, variant: 'success' })

      return
    }

    // A refused delete turns the dialog into the explanation rather than
    // closing. `CONFLICT` is the envelope's code for a 409 the domain has not
    // named yet — which is exactly the state "이 속성을 쓰고 있는 상품이 있다"
    // is in until TASK-0032 adds `Product` and a code for it (TASK-0031 4.7).
    if (hasCode(result.failure, 'CONFLICT')) {
      setDialog({ kind: 'retire', id: dialog.id, blocked: true })

      return
    }

    report(messages.toast.saveFailed, result.failure)
  }

  async function overwrite(): Promise<void> {
    if (dialog.kind !== 'conflict') return

    const { mine, latest } = dialog
    const options = attributeTypeHasOptions(latest.type) ? [...mine.options] : undefined

    setPending(true)
    const result = await console_.save(dialog.id, {
      version: latest.version,
      label: mine.label,
      isRequired: mine.isRequired,
      isFilterable: mine.isFilterable,
      ...(options === undefined ? {} : { options }),
    })
    setPending(false)

    if (result.ok) {
      setDialog({ kind: 'none' })
      closePanel()
      toast({ title: messages.toast.updated, variant: 'success' })

      return
    }

    report(messages.toast.saveFailed, result.failure)
  }

  /**
   * Drops this edit and starts again from what the server holds.
   *
   * There is nothing to fetch: the hook re-read the list on the way to
   * discovering the conflict, so the row behind the panel is already the current
   * one. Bumping the key is what makes the panel take it.
   */
  function reloadIntoForm(): void {
    if (dialog.kind !== 'conflict') return

    setDialog({ kind: 'none' })
    openEdit(dialog.id)
  }

  const retiring =
    dialog.kind === 'retire' ? attributes.find((row) => row.id === dialog.id) : undefined
  const loadFailure = state.status === 'error' ? state.failure : null
  const preview = previewAttributes(attributes, draft)

  return (
    <div className="flex flex-col gap-4">
      {reported === null ? null : (
        <ErrorNotice
          action={
            <Button
              onClick={() => {
                setReported(null)
              }}
              size="sm"
              variant="ghost"
            >
              {notice.dismissLabel}
            </Button>
          }
          copiedLabel={notice.copiedLabel}
          copyLabel={notice.copyLabel}
          description={describe(reported)}
          requestIdHint={notice.requestIdHint}
          requestIdLabel={notice.requestIdLabel}
          title={notice.title}
          {...requestIdProp(reported)}
        />
      )}

      <div className="flex flex-wrap items-end justify-between gap-4">
        <AttributeCategoryPicker
          choices={categories}
          messages={messages}
          onChange={(next) => {
            closePanel()
            setDialog({ kind: 'none' })
            console_.select(next)
          }}
          value={categoryId}
        />

        <Button disabled={categoryId === null} onClick={openCreate} variant="primary">
          {messages.actions.add}
        </Button>
      </div>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="min-w-0 grow">
          <DataList
            empty={
              categories.length === 0 ? (
                <EmptyState
                  description={messages.noCategoryDescription}
                  title={messages.noCategoryTitle}
                />
              ) : (
                <EmptyState
                  action={
                    <Button onClick={openCreate} variant="primary">
                      {messages.actions.add}
                    </Button>
                  }
                  description={messages.emptyDescription}
                  title={messages.emptyTitle}
                />
              )
            }
            error={
              loadFailure !== null && quotableRequestId(loadFailure) !== null ? (
                <ErrorNotice
                  action={
                    <Button onClick={console_.reload} size="sm" variant="outline">
                      {messages.retryLabel}
                    </Button>
                  }
                  copiedLabel={notice.copiedLabel}
                  copyLabel={notice.copyLabel}
                  description={describe(loadFailure)}
                  requestIdHint={notice.requestIdHint}
                  requestIdLabel={notice.requestIdLabel}
                  title={messages.errorTitle}
                  {...requestIdProp(loadFailure)}
                />
              ) : (
                <ErrorState
                  description={loadFailure === null ? undefined : describe(loadFailure)}
                  onRetry={console_.reload}
                  retryLabel={messages.retryLabel}
                  title={messages.errorTitle}
                />
              )
            }
            loading={<Skeleton label={messages.loadingLabel} lines={6} />}
            state={
              state.status === 'ready'
                ? attributes.length === 0
                  ? 'empty'
                  : 'ready'
                : state.status
            }
          >
            <AttributeList
              attributes={attributes}
              categoryName={categoryName}
              messages={messages}
              onEdit={openEdit}
              onMove={(id, direction) => {
                void handleMove(id, direction)
              }}
              onOpenSource={(next) => {
                closePanel()
                console_.select(next)
              }}
              removeDenial={removeDenial}
              onRemove={(id) => {
                setDialog({ kind: 'retire', id, blocked: false })
              }}
              onToggleFilterable={(id) => {
                void handleToggleFilterable(id)
              }}
            />
          </DataList>
        </div>

        {/*
          Sticky on a wide screen, and beside the list rather than over it: an
          operator writes a definition and watches the form it produces, which is
          the whole argument of this screen (4.11). Below `lg` the two stack and
          the editor sits above the preview, which is the same reading order.
        */}
        <div className="flex flex-col gap-4 lg:sticky lg:top-8 lg:w-1/2 lg:shrink-0">
          {panel.kind === 'none' || selected === undefined ? null : (
            <AttributeFormPanel
              categoryName={choiceName(selected)}
              editing={editing}
              key={`${panel.kind}-${String(panel.formKey)}`}
              messages={messages}
              onCancel={closePanel}
              onDraftChange={onDraftChange}
              onSubmit={submitForm}
            />
          )}

          {state.status === 'ready' ? (
            <AttributePreview messages={messages.preview} rows={preview} />
          ) : null}
        </div>
      </div>

      {dialog.kind === 'retire' && retiring !== undefined ? (
        <AttributeRetireDialog
          attribute={retiring}
          intent={dialog.blocked ? 'blocked' : 'remove'}
          messages={messages}
          onCancel={() => {
            setDialog({ kind: 'none' })
          }}
          onConfirm={() => {
            void confirmRetire()
          }}
          open
          pending={pending}
        />
      ) : null}

      {dialog.kind === 'conflict' ? (
        <AttributeConflictDialog
          latest={dialog.latest}
          messages={messages}
          mine={dialog.mine}
          onCancel={() => {
            setDialog({ kind: 'none' })
          }}
          onOverwrite={() => {
            void overwrite()
          }}
          onReload={reloadIntoForm}
          open
          pending={pending}
        />
      ) : null}
    </div>
  )
}
