'use client'

import type { CreateCategoryRequest, UpdateCategoryRequest } from '@shopping/shared'
import { useCallback, useEffect, useRef, useState } from 'react'

import { getApiClient } from '@/lib/api'

import type { CategoryFailure } from './errors'
import { categoryFailure } from './errors'
import type { CategoryRow, MoveDirection } from './tree'
import { applyPlan, mergeRows, planMove, toRows } from './tree'

export type CategoryTreeState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly failure: CategoryFailure }
  | { readonly status: 'ready'; readonly rows: readonly CategoryRow[] }

/**
 * What a mutation answers with.
 *
 * A result rather than a thrown error: every caller here is a dialog or a
 * keystroke that has to keep rendering, and `conflict` carries the one thing a
 * 409 on an edit leaves the screen needing — the row as it now stands, so the
 * operator can see what they would be overwriting.
 */
export type CategoryMutationResult =
  | { readonly ok: true }
  | {
      readonly ok: false
      readonly failure: CategoryFailure
      /** Present only when the 409 was the optimistic lock, not a taken slug. */
      readonly conflict?: CategoryRow
    }

export interface CategoryTreeController {
  readonly state: CategoryTreeState
  readonly reload: () => void
  readonly create: (input: CreateCategoryRequest) => Promise<CategoryMutationResult>
  readonly update: (id: number, input: UpdateCategoryRequest) => Promise<CategoryMutationResult>
  /** Optimistic. Drawn before the API answers, undone if it refuses. */
  readonly move: (id: number, direction: MoveDirection) => Promise<CategoryMutationResult>
  readonly remove: (id: number) => Promise<CategoryMutationResult>
}

const SUCCESS: CategoryMutationResult = { ok: true }

/**
 * The category tree, and the six things the console does to it.
 *
 * **Nothing is awaited during the server render.** The load runs in an effect,
 * so the page's markup — heading, toolbar, skeleton — is produced and sent while
 * the API may still be booting (TASK-0101 4.3). That is also what gives the
 * screen its four states rather than two.
 *
 * **Moves are drawn first and asked afterwards** (DECISIONS 4장: 즉시 반영,
 * 실패 시 원위치). The snapshot taken before the optimistic frame is what the
 * failure path restores, so a refused move leaves the tree byte-identical to
 * what it was — not merely re-fetched, which would also hide the bug where the
 * optimistic frame was wrong in the first place.
 */
export function useCategoryTree(): CategoryTreeController {
  const [state, setState] = useState<CategoryTreeState>({ status: 'loading' })
  const [reloadToken, setReloadToken] = useState(0)

  /**
   * The rows as they are *now*, readable outside a render.
   *
   * A mutation needs the current tree to plan against and to roll back to, and
   * reading it from `state` would capture whatever the closure was created
   * with — one move behind, every time.
   */
  const rowsRef = useRef<readonly CategoryRow[] | null>(null)

  const setRows = useCallback((rows: readonly CategoryRow[]) => {
    rowsRef.current = rows
    setState({ status: 'ready', rows })
  }, [])

  useEffect(() => {
    const controller = new AbortController()

    async function load(): Promise<void> {
      try {
        // Inactive branches are the console's business: an operator who cannot
        // see a retired category cannot bring it back.
        const { nodes } = await getApiClient().getCategoryTree(
          { includeInactive: true },
          { signal: controller.signal },
        )
        if (!controller.signal.aborted) setRows(toRows(nodes))
      } catch (error) {
        if (controller.signal.aborted) return
        rowsRef.current = null
        setState({ status: 'error', failure: categoryFailure(error) })
      }
    }

    void load()

    return () => {
      controller.abort()
    }
  }, [reloadToken, setRows])

  /**
   * Back to the loading state and round again.
   *
   * The state change belongs here rather than at the top of the effect: an
   * effect that sets state as its first act renders twice for every load, and
   * every caller of `reload` is already an event.
   */
  const reload = useCallback(() => {
    rowsRef.current = null
    setState({ status: 'loading' })
    setReloadToken((previous) => previous + 1)
  }, [])

  /** Reads the tree again and answers with the row `id` now has, if it is still there. */
  const refetch = useCallback(
    async (id: number): Promise<CategoryRow | undefined> => {
      const { nodes } = await getApiClient().getCategoryTree({ includeInactive: true })
      const rows = toRows(nodes)
      setRows(rows)

      return rows.find((row) => row.id === id)
    },
    [setRows],
  )

  const create = useCallback(
    async (input: CreateCategoryRequest): Promise<CategoryMutationResult> => {
      const rows = rowsRef.current
      if (rows === null) return { ok: false, failure: { reason: 'unknown' } }

      try {
        const { category } = await getApiClient().createCategory(input)
        const { path: _path, depth: _depth, ...row } = category
        setRows([...rows, row])

        return SUCCESS
      } catch (error) {
        return { ok: false, failure: categoryFailure(error) }
      }
    },
    [setRows],
  )

  /**
   * Saves the fields a person typed, and works out what a 409 meant.
   *
   * The API answers both a stale version and a taken slug with `CONFLICT`, and
   * the sentence that separates them is Korean prose no screen should match on
   * (TASK-0029 4장). So the tree is read again and the versions compared: a
   * version that moved on is somebody else's edit, and a version that did not is
   * the slug. The re-read is not wasted either way — it puts the other editor's
   * change on screen at the moment the operator is told about it.
   */
  const update = useCallback(
    async (id: number, input: UpdateCategoryRequest): Promise<CategoryMutationResult> => {
      try {
        const { category } = await getApiClient().updateCategory(id, input)
        const { path: _path, depth: _depth, ...row } = category
        setRows(mergeRows(rowsRef.current ?? [], [row]))

        return SUCCESS
      } catch (error) {
        const failure = categoryFailure(error)
        if (failure.reason !== 'conflict') return { ok: false, failure }

        const latest = await refetch(id).catch(() => undefined)
        if (latest === undefined || latest.version === input.version) {
          return { ok: false, failure }
        }

        return { ok: false, failure, conflict: latest }
      }
    },
    [refetch, setRows],
  )

  const move = useCallback(
    async (id: number, direction: MoveDirection): Promise<CategoryMutationResult> => {
      const snapshot = rowsRef.current
      if (snapshot === null) return { ok: false, failure: { reason: 'unknown' } }

      const plan = planMove(snapshot, id, direction)
      // Nothing to do — the toolbar disables these, and a keystroke can still
      // ask for one. Answering "done" keeps the caller from toasting a failure
      // for a move that was never possible.
      if (plan === null) return SUCCESS

      setRows(applyPlan(snapshot, plan))

      try {
        const client = getApiClient()
        const updated =
          plan.kind === 'reorder'
            ? (
                await client.reorderCategories({
                  parentId: plan.parentId,
                  orderedIds: plan.orderedIds,
                })
              ).categories
            : [(await client.moveCategory(plan.id, { parentId: plan.parentId })).category]

        setRows(
          mergeRows(
            rowsRef.current ?? [],
            updated.map(({ path: _path, depth: _depth, ...row }) => row),
          ),
        )

        return SUCCESS
      } catch (error) {
        // 원위치. The tree goes back to the exact rows the plan was made from.
        setRows(snapshot)

        return { ok: false, failure: categoryFailure(error) }
      }
    },
    [setRows],
  )

  const remove = useCallback(
    async (id: number): Promise<CategoryMutationResult> => {
      try {
        await getApiClient().deleteCategory(id)
        setRows((rowsRef.current ?? []).filter((row) => row.id !== id))

        return SUCCESS
      } catch (error) {
        return { ok: false, failure: categoryFailure(error) }
      }
    },
    [setRows],
  )

  return { state, reload, create, update, move, remove }
}
