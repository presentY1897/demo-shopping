'use client'

import type { ApiFailure, ProductModeration, ProductSummary } from '@shopping/shared'
import { apiFailure } from '@shopping/shared'
import type { CursorPagination } from '@shopping/ui/components'
import { useCursorPagination } from '@shopping/ui/components'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { getApiClient } from '@/lib/api'

import { fetchProducts, hideProduct, unhideProduct } from './console-api'
import type { CategoryChoice, ProductFilters } from './product-console'
import {
  categoryChoices,
  EMPTY_PRODUCT_FILTERS,
  productQueryOf,
  productsNarrowed,
} from './product-console'

/**
 * 상품 한 페이지, 그리고 **내리기와 올리기** (TASK-0095).
 *
 * 뼈대는 `use-users.ts` · `use-reports.ts` 와 같다: 서버 렌더에서 아무것도 기다리지
 * 않고, 커서는 `useCursorPagination` 이 들며, 필터가 바뀌면 첫 페이지로 돌아간다.
 * **닮은 훅을 새 규약으로 쓰지 않는 것**이 이 파일의 첫 번째 규칙이다.
 *
 * ## 내린 뒤에는 목록을 **조용히** 다시 읽는다
 *
 * 답은 `{ productId, hidden, moderatedAt, moderationReason }` 하나뿐이라
 * (`productModerationSchema`) 목록의 줄을 그것으로 갈아 끼울 수 없다 — 줄이 들고 있는
 * 것은 `status` 이고, 그 둘을 화면이 직접 이어 붙이면 「내렸다고 표시되는데 상태는
 * 판매 중」인 줄이 생길 수 있다. 서버가 말하게 두는 편이 언제나 맞다.
 *
 * 뼈대부터 다시 그리지 않는 이유는 방금 무엇을 했는지가 화면에서 사라지기 때문이다.
 */

export type ProductsState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly failure: ApiFailure }
  | {
      readonly status: 'ready'
      readonly products: readonly ProductSummary[]
      readonly nextCursor: string | null
    }

/**
 * 쓰기 하나의 결말.
 *
 * **`null` 이 세 번째 답이다** — 「아무것도 보내지 않았다」. 두 번 눌린 두 번째 클릭이
 * 그 자리이고, 그것을 실패로 돌려주면 화면은 방금 시작된 요청 위에 오류를 그린다
 * (`use-users.ts` 와 같은 규약).
 */
export type ProductWrite =
  | { readonly ok: true; readonly value: ProductModeration }
  | { readonly ok: false; readonly failure: ApiFailure }

export interface ProductsController {
  readonly state: ProductsState
  readonly filters: ProductFilters
  readonly setFilters: (filters: ProductFilters) => void
  readonly narrowed: boolean
  readonly pagination: CursorPagination
  readonly reload: () => void
  /** 쓰기가 도는 중. 두 번째 클릭이 두 번째 요청이 되지 않게 한다 (U3). */
  readonly busy: boolean
  /** 내린다 — **사유와 함께** (F2 · F3). */
  readonly hide: (productId: string, reason: string) => Promise<ProductWrite | null>
  /** 다시 올린다. 사유가 없는 것이 계약이다. */
  readonly restore: (productId: string) => Promise<ProductWrite | null>
}

export function useProducts(): ProductsController {
  const [state, setState] = useState<ProductsState>({ status: 'loading' })
  const [filters, setFiltersState] = useState<ProductFilters>(EMPTY_PRODUCT_FILTERS)
  const [token, setToken] = useState(0)
  const [busy, setBusy] = useState(false)

  /**
   * 이번 다시 읽기가 **조용한 것인가.**
   *
   * 상태가 아니라 참조인 이유는 이 값이 **한 번의 실행**에만 해당하기 때문이다.
   * 상태로 두면 조용히 한 번 읽은 뒤에 「다시 시도」를 누른 사람에게도 「불러오는
   * 중」이 영영 나타나지 않는다 (`use-users.ts` 와 같은 판단).
   */
  const quiet = useRef(false)

  /** 쓰기가 도는 중인지를 **ref 로도** 든다. 두 번째 클릭은 다시 그리기 전에 도착한다. */
  const inFlight = useRef(false)

  const pagination = useCursorPagination({
    nextCursor: state.status === 'ready' ? state.nextCursor : null,
  })
  const { cursor, reset } = pagination

  useEffect(() => {
    const controller = new AbortController()
    const silent = quiet.current

    quiet.current = false

    async function load(): Promise<void> {
      if (!silent) setState({ status: 'loading' })

      try {
        const page = await fetchProducts(
          { ...productQueryOf(filters), ...(cursor === null ? {} : { cursor }) },
          { signal: controller.signal },
        )

        if (controller.signal.aborted) return

        setState({ nextCursor: page.nextCursor, products: page.products, status: 'ready' })
      } catch (error) {
        if (controller.signal.aborted) return

        setState({ failure: apiFailure(error), status: 'error' })
      }
    }

    void load()

    return () => {
      controller.abort()
    }
  }, [filters, cursor, token])

  const setFilters = useCallback(
    (next: ProductFilters) => {
      setFiltersState(next)
      reset()
    },
    [reset],
  )

  const reload = useCallback(() => {
    setToken((previous) => previous + 1)
  }, [])

  const refresh = useCallback(() => {
    quiet.current = true
    setToken((previous) => previous + 1)
  }, [])

  /** 한 번의 요청. 도는 중이면 `null` — 실패가 아니라 무행동이다. */
  const run = useCallback(
    async (call: () => Promise<{ readonly product: ProductModeration }>) => {
      if (inFlight.current) return null

      inFlight.current = true
      setBusy(true)

      try {
        const { product } = await call()

        // 줄의 상태는 **서버가 말한다.** 답이 싣는 것은 숨김 여부뿐이라, 목록을
        // 조용히 다시 읽는 것이 화면과 서버를 어긋나지 않게 하는 유일한 방법이다.
        refresh()

        return { ok: true as const, value: product }
      } catch (error) {
        return { failure: apiFailure(error), ok: false as const }
      } finally {
        inFlight.current = false
        setBusy(false)
      }
    },
    [refresh],
  )

  const hide = useCallback(
    (productId: string, reason: string) => run(() => hideProduct(productId, reason)),
    [run],
  )

  const restore = useCallback((productId: string) => run(() => unhideProduct(productId)), [run])

  const narrowed = useMemo(() => productsNarrowed(filters), [filters])

  return { busy, filters, hide, narrowed, pagination, reload, restore, setFilters, state }
}

/* ------------------------------------------------------------ 카테고리 -- */

export type CategoryChoicesState =
  | { readonly status: 'loading' }
  /** 트리를 못 받았다. 왜인지는 말하지 않는다 — 이 화면의 본 일이 아니다. */
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly choices: readonly CategoryChoice[] }

/**
 * 좁힐 수 있는 카테고리들 — 그리고 **id 를 이름으로 바꾸는 표.**
 *
 * `GET /categories` 는 `catalog.read` 이고 관리자는 그것을 갖는다. 비활성 카테고리도
 * 함께 받는다: 비활성으로 내려간 카테고리에 상품이 남아 있을 수 있고, 그 상품을
 * 찾으러 온 사람에게 「그 카테고리는 목록에 없습니다」는 답이 되지 않는다.
 *
 * 실패해도 화면은 서지 않는다. 상품 목록은 카테고리 이름 없이도 읽히고, 그때 그
 * 자리에 남는 것은 id 다.
 */
export function useCategoryChoices(): CategoryChoicesState {
  const [state, setState] = useState<CategoryChoicesState>({ status: 'loading' })

  useEffect(() => {
    const controller = new AbortController()

    async function load(): Promise<void> {
      try {
        const tree = await getApiClient().getCategoryTree(
          { includeInactive: true },
          { signal: controller.signal },
        )

        if (controller.signal.aborted) return

        setState({ choices: categoryChoices(tree.nodes), status: 'ready' })
      } catch {
        if (controller.signal.aborted) return

        setState({ status: 'error' })
      }
    }

    void load()

    return () => {
      controller.abort()
    }
  }, [])

  return state
}
