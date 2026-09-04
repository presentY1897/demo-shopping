'use client'

import type { ApiFailure, CategoryTreeNode, EffectiveAttribute } from '@shopping/shared'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiFailure } from '@shopping/shared'

import { getApiClient } from '@/lib/api'

/**
 * The two reads that decide what the editor asks for: the category tree, and
 * the definitions of whichever category is chosen (TASK-0114 4장).
 *
 * **Two hooks and not one**, because they fail and reload independently. The
 * tree is read once and the definitions are read again on every change of
 * category, and folding them together would mean a failed attribute read hiding
 * the picker that could recover from it.
 *
 * **The waiting state is derived, never assigned.** Each answer is stored with
 * the request it belongs to, and anything else is by definition still in
 * flight. Setting `loading` from inside the effect would be a cascading render
 * — a second pass for every category change — and React's own lint refuses it.
 *
 * Nothing is awaited during the server render. The read runs in an effect, so
 * the heading is produced and sent while the API may still be waking
 * (TASK-0101 4.3) — and that is also what gives the screen its loading state
 * rather than a blank first paint.
 */

/** One category as the editor's picker offers it. */
export interface CategoryChoice {
  readonly id: number
  /** The names from the root down. The separator is copy and belongs to the app. */
  readonly path: readonly string[]
  /** A leaf is where products live; a branch is a heading with children. */
  readonly isLeaf: boolean
}

/**
 * Every category, depth first, each carrying the names above it.
 *
 * Retired categories are **not** offered. The attribute console shows them
 * because a definition attached to one is still live and still inherited; a
 * seller choosing where to list a new product has no such reason, and a
 * category an operator has retired is one they have stopped selling into.
 */
export function categoryChoices(
  nodes: readonly CategoryTreeNode[],
  ancestors: readonly string[] = [],
): readonly CategoryChoice[] {
  return nodes
    .filter((node) => node.isActive)
    .flatMap((node) => {
      const path = [...ancestors, node.name]
      const children = categoryChoices(node.children, path)

      return [{ id: node.id, path, isLeaf: children.length === 0 }, ...children]
    })
}

export type TaxonomyState<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly data: T }
  | { readonly status: 'error'; readonly failure: ApiFailure }

/** An answer, together with the request it answers. */
interface Answer<T> {
  readonly key: string
  readonly state: TaxonomyState<T>
}

const LOADING = { status: 'loading' } as const

export interface CategoriesController {
  readonly state: TaxonomyState<readonly CategoryChoice[]>
  readonly reload: () => void
}

export function useCategories(): CategoriesController {
  const [answer, setAnswer] = useState<Answer<readonly CategoryChoice[]> | null>(null)
  const [token, setToken] = useState(0)
  const key = String(token)

  useEffect(() => {
    const controller = new AbortController()

    async function read(): Promise<void> {
      try {
        const { nodes } = await getApiClient().getCategoryTree({}, { signal: controller.signal })
        if (!controller.signal.aborted) {
          setAnswer({ key, state: { status: 'ready', data: categoryChoices(nodes) } })
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setAnswer({ key, state: { status: 'error', failure: apiFailure(error) } })
        }
      }
    }

    void read()

    return () => {
      controller.abort()
    }
  }, [key])

  const reload = useCallback(() => {
    setToken((previous) => previous + 1)
  }, [])

  const state = answer?.key === key ? answer.state : LOADING

  return useMemo(() => ({ state, reload }), [state, reload])
}

export interface AttributesController {
  readonly state: TaxonomyState<readonly EffectiveAttribute[]>
  readonly reload: () => void
}

const NO_ATTRIBUTES = { status: 'ready', data: [] } as const

/**
 * The definitions that apply to one category, inherited ones included.
 *
 * `categoryId` of `null` is "nothing chosen yet", which answers an empty list
 * rather than a loading state: the seller has not asked a question, so there is
 * nothing to wait for.
 *
 * **The answer's order is not re-sorted.** It arrives general → specific with
 * shadowing already resolved (TASK-0030 4.1), and a second opinion here would
 * make the attribute console's preview and this form ask the same questions in
 * a different order — which is exactly what TASK-0031's preview exists to rule
 * out.
 */
export function useCategoryAttributes(categoryId: number | null): AttributesController {
  const [answer, setAnswer] = useState<Answer<readonly EffectiveAttribute[]> | null>(null)
  const [token, setToken] = useState(0)
  const key = `${String(categoryId)}:${String(token)}`

  useEffect(() => {
    if (categoryId === null) return

    const controller = new AbortController()

    async function read(id: number): Promise<void> {
      try {
        const { attributes } = await getApiClient().getAttributes(
          { categoryId: id },
          { signal: controller.signal },
        )
        if (!controller.signal.aborted) {
          setAnswer({ key, state: { status: 'ready', data: attributes } })
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setAnswer({ key, state: { status: 'error', failure: apiFailure(error) } })
        }
      }
    }

    void read(categoryId)

    return () => {
      controller.abort()
    }
  }, [categoryId, key])

  const reload = useCallback(() => {
    setToken((previous) => previous + 1)
  }, [])

  const state = categoryId === null ? NO_ATTRIBUTES : answer?.key === key ? answer.state : LOADING

  return useMemo(() => ({ state, reload }), [state, reload])
}
