'use client'

import {
  Button,
  DataList,
  EmptyState,
  ErrorNotice,
  ErrorState,
  Skeleton,
  useToast,
} from '@shopping/ui/components'
import { serverFieldErrors } from '@shopping/ui/form'
import { useMemo, useState } from 'react'

import type { ApiFailure } from '@/lib/api-failure'
import { failureMessage, hasCode, quotableRequestId } from '@/lib/api-failure'
import type { CategoryRow, MoveDirection } from '@/lib/categories/tree'
import { branchIds, hasChildren, rowById, visibleRows } from '@/lib/categories/tree'
import { useCategoryTree } from '@/lib/categories/use-category-tree'
import type { ErrorMessages } from '@/lib/errors'
import { errorMessage } from '@/lib/errors'
import type { CategoryMessages, ErrorNoticeMessages } from '@/messages'

import { CategoryConflictDialog } from './category-conflict-dialog'
import type { CategoryFormOutcome, CategoryFormValues } from './category-form-dialog'
import { CategoryFormDialog } from './category-form-dialog'
import type { RetireIntent } from './category-retire-dialog'
import { CategoryRetireDialog } from './category-retire-dialog'
import { CategoryTree } from './category-tree'
import { CategoryToolbar } from './category-toolbar'

const EMPTY_VALUES: CategoryFormValues = { name: '', slug: '' }

/** The inputs this screen's form owns. Nothing outside it is ever placed. */
const FORM_FIELDS = ['name', 'slug'] as const

/**
 * Codes that name no field of their own but still belong on one.
 *
 * `CATEGORY_SLUG_TAKEN` arrives with `details[].field === 'slug'` today, so this
 * is the belt to that braces: an endpoint that sends the code without the entry
 * still places the message where it belongs (`serverFieldErrors` shape 3).
 */
const CODE_FIELDS: Readonly<Record<string, string>> = { CATEGORY_SLUG_TAKEN: 'slug' }

type Dialog =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'create'
      readonly parentId: number | null
      readonly values: CategoryFormValues
      readonly formKey: number
    }
  | {
      readonly kind: 'edit'
      readonly id: number
      readonly version: number
      readonly values: CategoryFormValues
      readonly formKey: number
    }
  | { readonly kind: 'retire'; readonly id: number; readonly intent: RetireIntent }
  | {
      readonly kind: 'conflict'
      readonly id: number
      readonly latest: CategoryRow
      readonly mine: CategoryFormValues
    }

interface CategoryWorkspaceProps {
  readonly messages: CategoryMessages
  /** `code` → sentence, for everything the API answers (TASK-0117 4.2). */
  readonly errors: ErrorMessages
  /** Copy for a failure nobody on this screen can fix (4.4). */
  readonly notice: ErrorNoticeMessages
}

/**
 * The category console: tree, toolbar, three dialogs, and the four states the
 * data can be in (U1).
 *
 * The split from `CategoryManager` is only the toast provider — `useToast` has
 * to be called under it, and a screen that provided its own context and consumed
 * it in the same component would be a hook order accident waiting to happen.
 */
export function CategoryWorkspace({ messages, errors, notice }: CategoryWorkspaceProps) {
  const { state, reload, create, update, move, remove } = useCategoryTree()
  const { toast } = useToast()

  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [dialog, setDialog] = useState<Dialog>({ kind: 'none' })
  const [pending, setPending] = useState(false)
  const [formKey, setFormKey] = useState(0)

  /**
   * A failure the operator cannot act on, held until they dismiss it.
   *
   * A toast is the wrong home for a correlation id: it disappears, and the one
   * thing the reader is being asked to do with the number is copy it somewhere
   * else (TASK-0117 4.4). Failures they *can* act on keep the toast.
   */
  const [reported, setReported] = useState<ApiFailure | null>(null)

  /**
   * `null` means "nobody has folded anything yet", which is drawn fully
   * expanded — a console that opened on five collapsed roots would hide the
   * three-level structure this screen exists to show.
   */
  const [expanded, setExpanded] = useState<ReadonlySet<number> | null>(null)

  const rows = useMemo(() => (state.status === 'ready' ? state.rows : []), [state])
  const openBranches = useMemo(() => expanded ?? new Set(branchIds(rows)), [expanded, rows])
  const items = useMemo(() => visibleRows(rows, openBranches), [rows, openBranches])
  const selected = selectedId === null ? null : (rowById(rows, selectedId) ?? null)

  /** The catalog's sentence for this failure. Never the server's, if we have one. */
  function describe(failure: ApiFailure): string {
    return failureMessage(failure, { errors, failures: messages.failures })
  }

  /**
   * Says what went wrong, in the form the failure deserves.
   *
   * A failure with a quotable reference gets the persistent notice: the one
   * thing the reader is asked to do with the number is carry it somewhere else,
   * and a toast disappears while they are still reading it. Everything else —
   * including a dead network, which produced no number — keeps the toast,
   * because its answer is already on screen.
   */
  function report(title: string, failure: ApiFailure): void {
    if (quotableRequestId(failure) !== null) {
      setReported(failure)
      return
    }

    toast({ title, description: describe(failure), variant: 'danger' })
  }

  /**
   * Turns a refused save into messages under the inputs they are about.
   *
   * This is the whole of TASK-0117 on this screen: `details[].field` says which
   * input, `code` says which sentence, and neither is read out of Korean prose.
   */
  function fieldErrorsFor(failure: ApiFailure): Record<string, string> {
    const placed = serverFieldErrors(failure.kind === 'http' ? failure.details : [], {
      fields: FORM_FIELDS,
      code: failure.kind === 'http' ? failure.code : null,
      codeFields: CODE_FIELDS,
      messageForCode: (code, params) => errorMessage(errors, code, params),
    })

    return placed.fieldErrors
  }

  /**
   * `{ requestId }` when there is one worth quoting, `{}` otherwise.
   *
   * Spread rather than passed as `string | undefined` because
   * `exactOptionalPropertyTypes` treats "absent" and "present and undefined" as
   * different things — and here they mean different things too.
   */
  function requestIdProp(failure: ApiFailure): { requestId?: string } {
    const id = quotableRequestId(failure)

    return id === null ? {} : { requestId: id }
  }

  function toggle(id: number, force?: boolean): void {
    setExpanded((current) => {
      const next = new Set(current ?? branchIds(rows))
      const open = force ?? !next.has(id)

      if (open) next.add(id)
      else next.delete(id)

      return next
    })
  }

  async function handleMove(id: number, direction: MoveDirection): Promise<void> {
    const result = await move(id, direction)

    if (result.ok) return

    if (quotableRequestId(result.failure) !== null) {
      setReported(result.failure)
      return
    }

    // The tree has already jumped back to where it was; say so, or the
    // operator is left wondering whether the move happened.
    toast({
      title: messages.toast.moveFailed,
      description: `${describe(result.failure)} ${messages.toast.restored}`,
      variant: 'danger',
    })
  }

  function openCreate(parentId: number | null): void {
    if (parentId !== null) toggle(parentId, true)
    setDialog({ kind: 'create', parentId, values: EMPTY_VALUES, formKey })
  }

  function openEdit(id: number): void {
    const row = rowById(rows, id)
    if (row === undefined) return

    setSelectedId(id)
    setDialog({
      kind: 'edit',
      id,
      version: row.version,
      values: { name: row.name, slug: row.slug },
      formKey,
    })
  }

  function openRetire(id: number, intent: RetireIntent): void {
    setDialog({ kind: 'retire', id, intent })
  }

  /**
   * Chooses the recovery this failure calls for (F5).
   *
   * Three answers, and each is chosen by a code rather than inferred:
   * a taken address belongs under the field, somebody else's edit belongs in the
   * comparison dialog, and anything else is a message.
   */
  function rejectSave(
    failure: ApiFailure,
    values: CategoryFormValues,
    /** The row as the server holds it, when the failure was somebody else's edit. */
    latest?: CategoryRow,
  ): CategoryFormOutcome {
    // `latest` is absent when the re-read failed. The comparison dialog would
    // have nothing to show on its "지금 저장된 값" side, so the message is all
    // that is left — and it is still the right message, because the code said so.
    if (hasCode(failure, 'CATEGORY_VERSION_CONFLICT') && dialog.kind === 'edit') {
      if (latest !== undefined) {
        setDialog({ kind: 'conflict', id: dialog.id, latest, mine: values })

        return { kind: 'rejected', fieldErrors: {} }
      }
    }

    const fieldErrors = fieldErrorsFor(failure)

    if (Object.keys(fieldErrors).length > 0) return { kind: 'rejected', fieldErrors }

    report(messages.toast.saveFailed, failure)

    return { kind: 'rejected', fieldErrors: {} }
  }

  async function submitForm(values: CategoryFormValues): Promise<CategoryFormOutcome> {
    if (dialog.kind === 'create') {
      const result = await create({ parentId: dialog.parentId, ...values })

      if (result.ok) {
        setDialog({ kind: 'none' })
        toast({ title: messages.toast.created, variant: 'success' })

        return { kind: 'saved' }
      }

      return rejectSave(result.failure, values)
    }

    if (dialog.kind !== 'edit') return { kind: 'rejected', fieldErrors: {} }

    const result = await update(dialog.id, { version: dialog.version, ...values })

    if (result.ok) {
      setDialog({ kind: 'none' })
      toast({ title: messages.toast.updated, variant: 'success' })

      return { kind: 'saved' }
    }

    return rejectSave(result.failure, values, result.conflict)
  }

  async function confirmRetire(): Promise<void> {
    if (dialog.kind !== 'retire') return

    const row = rowById(rows, dialog.id)
    if (row === undefined) return

    setPending(true)
    const result =
      dialog.intent === 'remove'
        ? await remove(dialog.id)
        : await update(dialog.id, { version: row.version, isActive: dialog.intent === 'activate' })
    setPending(false)

    if (result.ok) {
      setDialog({ kind: 'none' })
      if (dialog.intent === 'remove') setSelectedId(null)

      toast({
        title:
          dialog.intent === 'remove'
            ? messages.toast.removed
            : dialog.intent === 'activate'
              ? messages.toast.activated
              : messages.toast.deactivated,
        variant: 'success',
      })

      return
    }

    // The server refused the delete because something is still under the
    // category. The dialog turns into the explanation rather than closing.
    if (hasCode(result.failure, 'CATEGORY_HAS_CHILDREN')) {
      setDialog({ kind: 'retire', id: dialog.id, intent: 'remove-blocked' })

      return
    }

    report(messages.toast.saveFailed, result.failure)
  }

  async function overwrite(): Promise<void> {
    if (dialog.kind !== 'conflict') return

    setPending(true)
    const result = await update(dialog.id, { version: dialog.latest.version, ...dialog.mine })
    setPending(false)

    if (result.ok) {
      setDialog({ kind: 'none' })
      toast({ title: messages.toast.updated, variant: 'success' })

      return
    }

    report(messages.toast.saveFailed, result.failure)
  }

  /** Puts the server's current values into the form, unsaved, on its version. */
  function reloadIntoForm(): void {
    if (dialog.kind !== 'conflict') return

    const next = formKey + 1
    setFormKey(next)
    setDialog({
      kind: 'edit',
      id: dialog.id,
      version: dialog.latest.version,
      values: { name: dialog.latest.name, slug: dialog.latest.slug },
      formKey: next,
    })
  }

  const retiring = dialog.kind === 'retire' ? rowById(rows, dialog.id) : undefined

  const parentName =
    dialog.kind === 'create' && dialog.parentId !== null
      ? (rowById(rows, dialog.parentId)?.name ?? messages.form.rootParent)
      : messages.form.rootParent

  const loadFailure = state.status === 'error' ? state.failure : null

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

      <DataList
        empty={
          <EmptyState
            action={
              <Button
                onClick={() => {
                  openCreate(null)
                }}
                variant="primary"
              >
                {messages.actions.addRoot}
              </Button>
            }
            description={messages.emptyDescription}
            title={messages.emptyTitle}
          />
        }
        error={
          loadFailure !== null && quotableRequestId(loadFailure) !== null ? (
            <ErrorNotice
              action={
                <Button onClick={reload} size="sm" variant="outline">
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
              onRetry={reload}
              retryLabel={messages.retryLabel}
              title={messages.errorTitle}
            />
          )
        }
        loading={<Skeleton label={messages.loadingLabel} lines={6} />}
        state={
          state.status === 'ready'
            ? rows.length === 0
              ? 'empty'
              : 'ready'
            : state.status === 'loading'
              ? 'loading'
              : 'error'
        }
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          <div className="min-w-0 grow">
            <CategoryTree
              items={items}
              messages={messages}
              onEdit={openEdit}
              onMove={(id, direction) => {
                void handleMove(id, direction)
              }}
              onSelect={setSelectedId}
              onToggle={toggle}
              selectedId={selectedId}
            />
            <p className="text-fg-subtle mt-2 text-sm">{messages.keyboardHint}</p>
          </div>

          {/*
            Sticky on a wide screen: forty rows is taller than a viewport, and a
            toolbar that scrolled away would mean scrolling back up to act on the
            row just chosen. Below `lg` the two stack and the toolbar sits under
            the tree, which is the console's documented mobile bar — it has to
            not break, not to be comfortable (`docs/design/pages.md` 콘솔 절).
          */}
          <div className="lg:sticky lg:top-8 lg:w-96 lg:shrink-0">
            <CategoryToolbar
              messages={messages}
              onAddChild={openCreate}
              onAddRoot={() => {
                openCreate(null)
              }}
              onCollapseAll={() => {
                setExpanded(new Set())
              }}
              onEdit={openEdit}
              onExpandAll={() => {
                setExpanded(new Set(branchIds(rows)))
              }}
              onMove={(id, direction) => {
                void handleMove(id, direction)
              }}
              onRemove={(id) => {
                openRetire(id, hasChildren(rows, id) ? 'remove-blocked' : 'remove')
              }}
              onToggleActive={(id) => {
                openRetire(id, rowById(rows, id)?.isActive === false ? 'activate' : 'deactivate')
              }}
              rows={rows}
              selected={selected}
            />
          </div>
        </div>
      </DataList>

      {dialog.kind === 'create' || dialog.kind === 'edit' ? (
        <CategoryFormDialog
          initial={dialog.values}
          key={`${dialog.kind}-${String(dialog.kind === 'edit' ? dialog.id : 'new')}-${String(dialog.formKey)}`}
          messages={messages}
          onCancel={() => {
            setDialog({ kind: 'none' })
          }}
          onSubmit={submitForm}
          open
          parent={dialog.kind === 'edit' ? messages.form.editTitle : parentName}
          title={
            dialog.kind === 'edit'
              ? messages.form.editTitle
              : dialog.parentId === null
                ? messages.form.addRootTitle
                : messages.form.addChildTitle
          }
        />
      ) : null}

      {dialog.kind === 'retire' && retiring !== undefined ? (
        <CategoryRetireDialog
          category={retiring}
          intent={dialog.intent}
          messages={messages}
          onCancel={() => {
            setDialog({ kind: 'none' })
          }}
          onConfirm={() => {
            void confirmRetire()
          }}
          onDeactivateInstead={() => {
            setDialog({ kind: 'retire', id: dialog.id, intent: 'deactivate' })
          }}
          open
          pending={pending}
        />
      ) : null}

      {dialog.kind === 'conflict' ? (
        <CategoryConflictDialog
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
