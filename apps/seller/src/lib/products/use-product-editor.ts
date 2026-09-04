'use client'

import type {
  ApiFailure,
  CreateProductRequest,
  Product,
  ProductPublishRequest,
  UpdateProductRequest,
} from '@shopping/shared'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiFailure } from '@shopping/shared'

import { getApiClient } from '@/lib/api'

/**
 * Loading a listing and writing it back (TASK-0114 4장).
 *
 * **The four states are the read's own** — `loading`, `missing`, `error` and
 * `ready` — and `missing` is not folded into `error`: a 404 on
 * `/products/:id/edit` is an ordinary thing (a stale bookmark, a listing that
 * was retired) and it needs a different sentence and a different next action
 * from "the request did not get through".
 *
 * **A write answers with a result rather than throwing.** The form has to keep
 * rendering with the text the seller typed, and a conflict has to carry the row
 * as it now stands so that reloading is an option they can take rather than a
 * suggestion (DECISIONS 4 — 덮어쓰기 없음).
 *
 * Nothing is awaited during the server render (TASK-0101 4.3).
 */

export type ProductEditorState =
  | { readonly status: 'loading' }
  /** Creating: there is nothing to load, and the form starts empty. */
  | { readonly status: 'blank' }
  /** The id in the URL names no listing this seller can open. */
  | { readonly status: 'missing' }
  | { readonly status: 'ready'; readonly product: Product }
  | { readonly status: 'error'; readonly failure: ApiFailure }

/**
 * What a write answers with.
 *
 * `conflict` carries the listing as the server now holds it — for **showing**,
 * not for saving. Nothing on screen is overwritten by it.
 */
export type ProductWriteResult =
  | { readonly ok: true; readonly product: Product }
  | { readonly ok: false; readonly failure: ApiFailure; readonly conflict?: Product }

export interface ProductEditorController {
  readonly state: ProductEditorState
  readonly reload: () => void
  readonly create: (body: CreateProductRequest) => Promise<ProductWriteResult>
  readonly save: (id: string, body: UpdateProductRequest) => Promise<ProductWriteResult>
  readonly publish: (id: string, body: ProductPublishRequest) => Promise<ProductWriteResult>
  readonly unpublish: (id: string, body: ProductPublishRequest) => Promise<ProductWriteResult>
}

/** A 404 about the listing itself, which is a state rather than a failure. */
function isMissing(failure: ApiFailure): boolean {
  return failure.kind === 'http' && failure.status === 404
}

/** A lost optimistic lock, which is the one refusal re-reading resolves. */
function isConflict(failure: ApiFailure): boolean {
  return failure.kind === 'http' && failure.code === 'PRODUCT_VERSION_CONFLICT'
}

/** An answer, together with the request it answers. */
interface Answer {
  readonly key: string
  readonly state: ProductEditorState
}

const LOADING = { status: 'loading' } as const
const BLANK = { status: 'blank' } as const

export function useProductEditor(productId: string | null): ProductEditorController {
  const [answer, setAnswer] = useState<Answer | null>(null)
  const [token, setToken] = useState(0)
  const key = `${productId ?? ''}:${String(token)}`

  /**
   * Whether this hook is still mounted.
   *
   * A write's `setState` cannot be cancelled by an `AbortController` the way
   * the read's can — the request has already been sent and its result matters —
   * so the guard is a flag rather than a signal.
   */
  const live = useRef(true)

  useEffect(() => {
    live.current = true

    if (productId === null) {
      return () => {
        live.current = false
      }
    }

    const controller = new AbortController()

    async function read(id: string): Promise<void> {
      try {
        const { product } = await getApiClient().getProduct(id, { signal: controller.signal })
        if (!controller.signal.aborted) setAnswer({ key, state: { status: 'ready', product } })
      } catch (error) {
        if (controller.signal.aborted) return

        const failure = apiFailure(error)

        setAnswer({
          key,
          state: isMissing(failure) ? { status: 'missing' } : { status: 'error', failure },
        })
      }
    }

    void read(productId)

    return () => {
      live.current = false
      controller.abort()
    }
  }, [key, productId])

  const reload = useCallback(() => {
    setToken((previous) => previous + 1)
  }, [])

  /**
   * Adopts what a successful write answered with. One round trip, not two.
   *
   * Stored against the **current** request key, so the write's answer is the
   * one the derived state below hands back rather than being overwritten by a
   * read that is no longer running.
   */
  const adopt = useCallback(
    (product: Product): ProductWriteResult => {
      if (live.current) setAnswer({ key, state: { status: 'ready', product } })

      return { ok: true, product }
    },
    [key],
  )

  /**
   * A write, with the one refusal that is worth a second request.
   *
   * On a version conflict the listing is read again so the banner can offer
   * both 「최신 내용 불러오기」 and 「그대로 저장」 — the second needs the
   * server's current `version` and nothing else. Every other refusal is handed
   * back as it arrived, because the screen already knows where to draw it
   * (`product-failures.ts`).
   */
  const write = useCallback(
    async (id: string | null, call: () => Promise<{ product: Product }>) => {
      try {
        return adopt((await call()).product)
      } catch (error) {
        const failure = apiFailure(error)

        if (id === null || !isConflict(failure)) return { ok: false as const, failure }

        const latest = await getApiClient()
          .getProduct(id)
          .then(
            ({ product }) => product,
            () => undefined,
          )

        return latest === undefined
          ? { ok: false as const, failure }
          : { ok: false as const, failure, conflict: latest }
      }
    },
    [adopt],
  )

  /**
   * The waiting state, derived rather than assigned.
   *
   * Anything not answered under the current key is by definition still in
   * flight. Setting it from inside the effect would be a cascading render for
   * every load, which React's own lint refuses.
   */
  const state: ProductEditorState =
    productId === null ? BLANK : answer?.key === key ? answer.state : LOADING

  return useMemo<ProductEditorController>(
    () => ({
      state,
      reload,
      create: (body) => write(null, () => getApiClient().createProduct(body)),
      save: (id, body) => write(id, () => getApiClient().updateProduct(id, body)),
      publish: (id, body) => write(id, () => getApiClient().publishProduct(id, body)),
      unpublish: (id, body) => write(id, () => getApiClient().unpublishProduct(id, body)),
    }),
    [state, reload, write],
  )
}
