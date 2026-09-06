'use client'

import type { ApiFailure, SellerProductListItem } from '@shopping/shared'
import { apiFailure, COUPON_SCOPE_MAX_IDS } from '@shopping/shared'
import { useEffect, useState } from 'react'

import { fetchSellerProducts } from '@/lib/products/console-api'

/**
 * 범위를 상품으로 좁힐 때 고를 수 있는 것들 (F1).
 *
 * **`GET /seller/products` 하나만 부른다.** 그 라우트가 답하는 것은 부르는 사람의
 * 스토어 상품뿐이므로(`SellerProductController`), 「남의 상품을 고를 수 없다」가
 * 화면의 필터가 아니라 **출처의 성질**이 된다. 목록을 넓게 받아 놓고 화면에서
 * 걸러내면 그 필터를 잘못 쓰는 날 남의 상품이 선택지에 나타나고, 그때 잘못은
 * 서버가 아니라 여기서 일어난다.
 *
 * **한 페이지만 읽는다.** 쿠폰 하나가 가리킬 수 있는 대상의 상한이
 * `COUPON_SCOPE_MAX_IDS` 라서, 그보다 많이 받아 봐야 고를 수 없다. 상품이 그보다
 * 많은 스토어에서는 이 목록이 전부가 아니고, 화면이 그 사실을 문장으로 말한다 —
 * **검색 칸을 여기 두지 않은 것**은 그것이 이 화면의 두 번째 목록이 되는 일이고,
 * 「상품을 고르는 법」이 상품 목록 화면과 여기 두 곳에 생기기 때문이다.
 *
 * 실패해도 폼 전체를 막지 않는다. 스토어 범위 쿠폰은 상품 목록 없이도 발행할 수
 * 있고, 목록을 못 읽었다고 발행 화면을 통째로 오류로 덮는 것은 할 수 있는 일까지
 * 뺏는 것이다.
 */

export type OwnProductOptionsState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly failure: ApiFailure }
  | {
      readonly status: 'ready'
      readonly items: readonly SellerProductListItem[]
      /** 상한에 걸려 잘렸다. 화면이 「전부가 아니다」를 말할 근거다. */
      readonly truncated: boolean
    }

export function useOwnProductOptions(): OwnProductOptionsState {
  const [state, setState] = useState<OwnProductOptionsState>({ status: 'loading' })

  useEffect(() => {
    const controller = new AbortController()

    async function load(): Promise<void> {
      try {
        const page = await fetchSellerProducts(
          { limit: COUPON_SCOPE_MAX_IDS },
          { signal: controller.signal },
        )

        if (controller.signal.aborted) return

        setState({
          status: 'ready',
          items: page.items,
          // 다음 커서가 있다는 것은 **더 있다**는 뜻이다. 개수를 세어 판단하면
          // 마지막 페이지가 정확히 상한과 같을 때 없는 다음을 약속하게 된다.
          truncated: page.nextCursor !== null,
        })
      } catch (error) {
        if (controller.signal.aborted) return

        setState({ status: 'error', failure: apiFailure(error) })
      }
    }

    void load()

    return () => {
      controller.abort()
    }
  }, [])

  return state
}
