'use client'

import {
  Button,
  DataList,
  EmptyState,
  ErrorState,
  Skeleton,
  useToast,
} from '@shopping/ui/components'
import { useMemo, useState } from 'react'

import type { CategoryFailure } from '@/lib/categories/errors'
import type { CategoryRow, MoveDirection } from '@/lib/categories/tree'
import { branchIds, hasChildren, rowById, visibleRows } from '@/lib/categories/tree'
import { useCategoryTree } from '@/lib/categories/use-category-tree'
import type { CategoryMessages } from '@/messages'

import { CategoryConflictDialog } from './category-conflict-dialog'
import type { CategoryFormOutcome, CategoryFormValues } from './category-form-dialog'
import { CategoryFormDialog } from './category-form-dialog'
import type { RetireIntent } from './category-retire-dialog'
import { CategoryRetireDialog } from './category-retire-dialog'
import { CategoryTree } from './category-tree'
import { CategoryToolbar } from './category-toolbar'

const EMPTY_VALUES: CategoryFormValues = { name: '', slug: '' }

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
}

/**
 * The category console: tree, toolbar, three dialogs, and the four states the
 * data can be in (U1).
 *
 * The split from `CategoryManager` is only the toast provider — `useToast` has
 * to be called under it, and a screen that provided its own context and consumed
 * it in the same component would be a hook order accident waiting to happen.
 */
export function CategoryWorkspace({ messages }: CategoryWorkspaceProps) {
  const { state, reload, create, update, move, remove } = useCategoryTree()
  const { toast } = useToast()

  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [dialog, setDialog] = useState<Dialog>({ kind: 'none' })
  const [pending, setPending] = useState(false)
  const [formKey, setFormKey] = useState(0)

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

  function describe(failure: CategoryFailure): string {
    const line = messages.failures[failure.reason]

    return failure.detail === undefined ? line : `${line} ${failure.detail}`
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

    if (!result.ok) {
      // The tree has already jumped back to where it was; say so, or the
      // operator is left wondering whether the move happened.
      toast({
        title: messages.toast.moveFailed,
        description: `${describe(result.failure)} ${messages.toast.restored}`,
        variant: 'danger',
      })
    }
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

  async function submitForm(values: CategoryFormValues): Promise<CategoryFormOutcome> {
    if (dialog.kind === 'create') {
      const result = await create({ parentId: dialog.parentId, ...values })

      if (result.ok) {
        setDialog({ kind: 'none' })
        toast({ title: messages.toast.created, variant: 'success' })

        return 'saved'
      }
      if (result.failure.reason === 'conflict') return 'slug-taken'

      toast({
        title: messages.toast.saveFailed,
        description: describe(result.failure),
        variant: 'danger',
      })

      return 'failed'
    }

    if (dialog.kind !== 'edit') return 'failed'

    const result = await update(dialog.id, { version: dialog.version, ...values })

    if (result.ok) {
      setDialog({ kind: 'none' })
      toast({ title: messages.toast.updated, variant: 'success' })

      return 'saved'
    }

    // A conflict with a row attached is somebody else's edit; without one it is
    // the slug, which belongs on the field rather than in a dialog.
    if (result.conflict !== undefined) {
      setDialog({ kind: 'conflict', id: dialog.id, latest: result.conflict, mine: values })

      return 'failed'
    }
    if (result.failure.reason === 'conflict') return 'slug-taken'

    toast({
      title: messages.toast.saveFailed,
      description: describe(result.failure),
      variant: 'danger',
    })

    return 'failed'
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

    // The server refused the delete — most often because something still points
    // at the category. The dialog turns into the explanation rather than closing.
    if (dialog.intent === 'remove' && result.failure.reason === 'conflict') {
      setDialog({ kind: 'retire', id: dialog.id, intent: 'remove-blocked' })

      return
    }

    toast({
      title: messages.toast.saveFailed,
      description: describe(result.failure),
      variant: 'danger',
    })
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

    toast({
      title: messages.toast.saveFailed,
      description: describe(result.failure),
      variant: 'danger',
    })
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

  return (
    <div className="flex flex-col gap-4">
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
          <ErrorState
            action={
              <Button onClick={reload} variant="primary">
                {messages.retryLabel}
              </Button>
            }
            description={state.status === 'error' ? describe(state.failure) : undefined}
            title={messages.errorTitle}
          />
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

          <div className="lg:w-96 lg:shrink-0">
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
