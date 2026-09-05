'use client'

import type { ProductDetailResponse } from '@shopping/shared'
import { useEffect, useState } from 'react'

import { fetchProductDetail } from './detail-api'

/**
 * ISR 이 남긴 시차를 화면에서 메운다 (TASK-0102 R2).
 *
 * The detail page is served from a cache that can be up to a minute old
 * (`revalidate = 60`), which is the right trade for the page as a whole — a
 * shopper never waits out a cold start to read a description. But **price and
 * stock are the two things a minute is long enough to be wrong about**, and they
 * are the two a person acts on.
 *
 * So the screen asks again after mount and swaps in what comes back. The first
 * paint is the cached copy — complete, immediate, and almost always right — and
 * the correction lands before anybody has finished choosing a size.
 *
 * A failed re-read keeps the cached copy. It is a minute old, not wrong, and
 * replacing a working page with an error because a refresh failed would trade a
 * small inaccuracy for a dead end.
 */
export function useFreshDetail(initial: ProductDetailResponse): ProductDetailResponse {
  const [detail, setDetail] = useState(initial)
  const id = initial.product.id

  useEffect(() => {
    const controller = new AbortController()

    async function refresh(): Promise<void> {
      try {
        const fresh = await fetchProductDetail(id, { signal: controller.signal })

        if (!controller.signal.aborted) setDetail(fresh)
      } catch {
        // The cached copy stands. See the note above.
      }
    }

    void refresh()

    return () => {
      controller.abort()
    }
  }, [id])

  return detail
}
