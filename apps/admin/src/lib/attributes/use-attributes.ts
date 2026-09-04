'use client'

import type {
  AttributeDefinition,
  CreateAttributeRequest,
  EffectiveAttribute,
  UpdateAttributeRequest,
} from '@shopping/shared'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { ApiFailure } from '@/lib/api-failure'
import { apiFailure, hasCode } from '@/lib/api-failure'
import { getApiClient } from '@/lib/api'
import { toRows } from '@/lib/categories/tree'

import type { CategoryChoice } from './categories'
import { categoryChoices } from './categories'
import type { MoveDirection } from './order'
import { applySwap, planSwap } from './order'

export type AttributeListState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly failure: ApiFailure }
  | { readonly status: 'ready'; readonly attributes: readonly EffectiveAttribute[] }

/**
 * What a mutation answers with.
 *
 * A result rather than a thrown error: every caller is a dialog or a click that
 * has to keep rendering. `conflict` carries the row as the server now holds it,
 * which is the one thing an `ATTRIBUTE_VERSION_CONFLICT` leaves the screen
 * needing — without it the comparison dialog has nothing on its "지금 저장된 값"
 * side.
 *
 * `reloaded` says the list was re-read as part of failing. The screen tells the
 * operator so, because the rows under their cursor have just changed on their
 * own (TASK-0031 4.6).
 */
export type AttributeMutationResult =
  | { readonly ok: true }
  | {
      readonly ok: false
      readonly failure: ApiFailure
      readonly conflict?: AttributeDefinition
      readonly reloaded?: boolean
    }

export interface AttributeConsole {
  /** Every category, depth first. Empty until the tree has arrived. */
  readonly categories: readonly CategoryChoice[]
  readonly categoryId: number | null
  readonly select: (categoryId: number) => void
  readonly state: AttributeListState
  readonly reload: () => void
  readonly create: (
    input: Omit<CreateAttributeRequest, 'categoryId'>,
  ) => Promise<AttributeMutationResult>
  readonly save: (id: number, input: UpdateAttributeRequest) => Promise<AttributeMutationResult>
  readonly remove: (id: number) => Promise<AttributeMutationResult>
  /** Optimistic. Drawn before the API answers; on failure the list is re-read. */
  readonly move: (id: number, direction: MoveDirection) => Promise<AttributeMutationResult>
  /** Optimistic, for the same reason: a switch that does not move reads as broken. */
  readonly toggleFilterable: (id: number) => Promise<AttributeMutationResult>
}

const SUCCESS: AttributeMutationResult = { ok: true }

/** Nothing has been loaded, so there is nothing to mutate against. */
const NOT_LOADED: AttributeMutationResult = {
  ok: false,
  failure: { kind: 'transport', reason: 'unknown' },
}

type TreeState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly failure: ApiFailure }
  | { readonly status: 'ready'; readonly choices: readonly CategoryChoice[] }

/** Puts updated definitions back into the list, keeping the display order. */
function mergeRows(
  rows: readonly EffectiveAttribute[],
  updated: readonly AttributeDefinition[],
): readonly EffectiveAttribute[] {
  const byId = new Map(updated.map((row) => [row.id, row]))
  const merged = rows.map((row) => {
    const next = byId.get(row.id)

    return next === undefined ? row : { ...next, inherited: row.inherited }
  })

  return [
    ...merged.filter((row) => row.inherited),
    ...merged
      .filter((row) => !row.inherited)
      .sort((left, right) => left.sortOrder - right.sortOrder || left.id - right.id),
  ]
}

/**
 * The attribute console: a category to look at, and the five things an
 * administrator does to its definitions.
 *
 * **Nothing is awaited during the server render.** Both loads run in effects, so
 * the page's markup — heading, picker, skeleton — is produced and sent while the
 * API may still be booting (TASK-0101 4.3). That is also what gives the screen
 * its four states rather than two.
 *
 * **Saves are not optimistic; moves and the filter switch are.** A save has a
 * dialog that can hold "저장 중" and a refusal that has to land under an input,
 * so drawing it early would only mean drawing it twice. A move is a single click
 * on a row, and a row that does not move until a round trip completes reads as a
 * dead button (DECISIONS 4장: 즉시 반영).
 *
 * **A failed move is not rolled back — the list is re-read.** There is no
 * atomic reorder endpoint for attributes, so a swap is two `PATCH`es and the
 * state after a half-failure is a real one. Restoring a snapshot would be
 * showing the operator something the server does not hold (TASK-0031 4.6).
 */
export function useAttributeConsole(): AttributeConsole {
  const [tree, setTree] = useState<TreeState>({ status: 'loading' })
  const [categoryId, setCategoryId] = useState<number | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  /**
   * The answer, **together with the question it answers**.
   *
   * Keeping the category alongside the rows is what makes "a different category
   * is selected, so we are loading again" a *derivation* rather than a
   * `setState` at the top of an effect. The effect-first version renders twice
   * for every selection and is the cascading render `react-hooks/set-state-in-
   * effect` refuses; it also has a frame in which the new category is shown
   * above the previous one's definitions.
   */
  const [answered, setAnswered] = useState<{
    readonly categoryId: number | null
    readonly state: AttributeListState
  }>({ categoryId: null, state: { status: 'loading' } })

  /**
   * The rows as they are *now*, readable outside a render.
   *
   * A mutation needs the current list to plan a swap against and to merge an
   * answer into; reading it from `list` would capture whatever the closure was
   * created with — one move behind, every time.
   */
  const rowsRef = useRef<readonly EffectiveAttribute[] | null>(null)

  const setRows = useCallback(
    (attributes: readonly EffectiveAttribute[]) => {
      rowsRef.current = attributes
      setAnswered({ categoryId, state: { status: 'ready', attributes } })
    },
    [categoryId],
  )

  useEffect(() => {
    const controller = new AbortController()

    async function load(): Promise<void> {
      try {
        // Retired categories included: a definition on one is still live and
        // still inherited downwards, so hiding it would make it uneditable.
        const { nodes } = await getApiClient().getCategoryTree(
          { includeInactive: true },
          { signal: controller.signal },
        )
        if (controller.signal.aborted) return

        const choices = categoryChoices(toRows(nodes))
        setTree({ status: 'ready', choices })
        // Opening on nothing would be a console with nothing to show. The first
        // root is the one an operator reaches first in the tree screen too.
        setCategoryId((current) => current ?? choices[0]?.id ?? null)
      } catch (error) {
        if (controller.signal.aborted) return
        setTree({ status: 'error', failure: apiFailure(error) })
      }
    }

    void load()

    return () => {
      controller.abort()
    }
  }, [reloadToken])

  useEffect(() => {
    if (categoryId === null) return undefined

    const controller = new AbortController()
    rowsRef.current = null

    async function load(id: number): Promise<void> {
      try {
        const { attributes } = await getApiClient().getAttributes(
          { categoryId: id },
          { signal: controller.signal },
        )
        if (controller.signal.aborted) return
        rowsRef.current = attributes
        setAnswered({ categoryId: id, state: { status: 'ready', attributes } })
      } catch (error) {
        if (controller.signal.aborted) return
        setAnswered({ categoryId: id, state: { status: 'error', failure: apiFailure(error) } })
      }
    }

    void load(categoryId)

    return () => {
      controller.abort()
    }
  }, [categoryId, reloadToken])

  /** Reads the definitions again, outside the effect, after a mutation. */
  const refetch = useCallback(async (): Promise<readonly EffectiveAttribute[]> => {
    if (categoryId === null) return []

    const { attributes } = await getApiClient().getAttributes({ categoryId })
    setRows(attributes)

    return attributes
  }, [categoryId, setRows])

  const reload = useCallback(() => {
    rowsRef.current = null
    // Back to "no answer for any category", which the derivation reads as
    // loading. An event handler, so nothing cascades.
    setAnswered({ categoryId: null, state: { status: 'loading' } })
    setReloadToken((token) => token + 1)
  }, [])

  const select = useCallback((next: number) => {
    setCategoryId(next)
  }, [])

  /**
   * Re-reads after a mutation rather than splicing the answer in.
   *
   * A definition created on an ancestor changes what *this* category inherits,
   * and a deleted one frees a key — neither is expressible by editing one row of
   * the list the screen happens to be holding. One extra request buys an answer
   * that is the server's rather than the screen's guess at it.
   */
  const afterWrite = useCallback(async (): Promise<void> => {
    await refetch().catch(() => undefined)
  }, [refetch])

  const create = useCallback(
    async (input: Omit<CreateAttributeRequest, 'categoryId'>): Promise<AttributeMutationResult> => {
      if (categoryId === null) return NOT_LOADED

      try {
        await getApiClient().createAttribute({ ...input, categoryId })
        await afterWrite()

        return SUCCESS
      } catch (error) {
        return { ok: false, failure: apiFailure(error) }
      }
    },
    [afterWrite, categoryId],
  )

  const save = useCallback(
    async (id: number, input: UpdateAttributeRequest): Promise<AttributeMutationResult> => {
      try {
        await getApiClient().updateAttribute(id, input)
        await afterWrite()

        return SUCCESS
      } catch (error) {
        const failure = apiFailure(error)
        if (!hasCode(failure, 'ATTRIBUTE_VERSION_CONFLICT')) return { ok: false, failure }

        // The re-read is only for **showing** what would be overwritten. When it
        // fails the failure is still the conflict it is; only the comparison is
        // missing.
        const latest = await refetch().catch(() => [])
        const conflict = latest.find((row) => row.id === id)

        return conflict === undefined ? { ok: false, failure } : { ok: false, failure, conflict }
      }
    },
    [afterWrite, refetch],
  )

  const remove = useCallback(
    async (id: number): Promise<AttributeMutationResult> => {
      try {
        await getApiClient().deleteAttribute(id)
        await afterWrite()

        return SUCCESS
      } catch (error) {
        return { ok: false, failure: apiFailure(error) }
      }
    },
    [afterWrite],
  )

  const move = useCallback(
    async (id: number, direction: MoveDirection): Promise<AttributeMutationResult> => {
      const rows = rowsRef.current
      if (rows === null) return NOT_LOADED

      const plan = planSwap(rows, id, direction)
      // The buttons are disabled at the ends of the list and on inherited rows,
      // and a keystroke can still ask. Answering "done" keeps the caller from
      // reporting a failure for a move that was never possible.
      if (plan === null) return SUCCESS

      setRows(applySwap(rows, plan))

      try {
        const client = getApiClient()
        // Sequential, not parallel: the two rows are the same category's and the
        // second request has to be sent knowing the first was accepted, or a
        // refusal leaves a state neither request describes.
        const moved = await client.updateAttribute(plan.moved.id, {
          version: plan.moved.version,
          sortOrder: plan.displaced.sortOrder,
        })
        const displaced = await client.updateAttribute(plan.displaced.id, {
          version: plan.displaced.version,
          sortOrder: plan.moved.sortOrder,
        })

        setRows(mergeRows(rowsRef.current ?? [], [moved.attribute, displaced.attribute]))

        return SUCCESS
      } catch (error) {
        await afterWrite()

        return { ok: false, failure: apiFailure(error), reloaded: true }
      }
    },
    [afterWrite, setRows],
  )

  const toggleFilterable = useCallback(
    async (id: number): Promise<AttributeMutationResult> => {
      const rows = rowsRef.current
      const row = rows?.find((candidate) => candidate.id === id)

      if (rows === null || row === undefined) return NOT_LOADED

      const next = !row.isFilterable
      setRows(
        rows.map((candidate) =>
          candidate.id === id ? { ...candidate, isFilterable: next } : candidate,
        ),
      )

      try {
        const { attribute } = await getApiClient().updateAttribute(id, {
          version: row.version,
          isFilterable: next,
        })
        setRows(mergeRows(rowsRef.current ?? [], [attribute]))

        return SUCCESS
      } catch (error) {
        await afterWrite()

        return { ok: false, failure: apiFailure(error), reloaded: true }
      }
    },
    [afterWrite, setRows],
  )

  /**
   * One state for a screen that is waiting on two reads.
   *
   * The tree comes first — there is nothing to ask about until a category
   * exists — so its loading and its failure are the screen's. Once it is here,
   * the definitions answer, and an answer that belongs to a different category
   * than the one now selected is not an answer yet.
   */
  const state = useMemo<AttributeListState>(() => {
    if (tree.status === 'loading') return { status: 'loading' }
    if (tree.status === 'error') return { status: 'error', failure: tree.failure }

    return answered.categoryId === categoryId ? answered.state : { status: 'loading' }
  }, [answered, categoryId, tree])

  return {
    categories: tree.status === 'ready' ? tree.choices : [],
    categoryId,
    select,
    state,
    reload,
    create,
    save,
    remove,
    move,
    toggleFilterable,
  }
}
