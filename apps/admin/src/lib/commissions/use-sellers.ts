'use client'

import { SELLER_REVIEW_LIST_MAX_LIMIT } from '@shopping/shared'
import { useEffect, useState } from 'react'

import { fetchSellerReviews } from '@/lib/sellers/api'

/**
 * 요율을 걸 수 있는 스토어들 — 고르는 목록이자 **id 를 이름으로 바꾸는 표**.
 *
 * ## 심사 큐를 다시 쓴다
 *
 * `GET /admin/sellers` 는 TASK-0110 이 만든 심사 큐이고, 이 화면이 필요한 것은 그
 * 큐가 아니라 「스토어의 이름」이다. 그래도 같은 문을 쓰는 이유는 **콘솔에 스토어를
 * 빠짐없이 답하는 다른 엔드포인트가 없기** 때문이다 — 목록을 하나 더 만드는 것은 이
 * TASK 가 지어낼 것이 아니다 (CLAUDE.md 병행 작업 규칙).
 *
 * ## 그래서 첫 페이지뿐이다
 *
 * 한 번에 {@link SELLER_REVIEW_LIST_MAX_LIMIT} 곳까지다. 커서를 따라가며 전부 모으면
 * 스토어가 늘어날수록 이 화면이 열리는 데 걸리는 시간이 함께 늘고, 그 값은 셀렉트
 * 하나를 채우는 데 쓰인다. **찾기가 필요해지는 지점**이 이 화면의 다음 숙제이고,
 * 지금은 목록이 잘렸다는 사실을 화면이 문장으로 말한다(`editor.sellerNotice`).
 *
 * 실패해도 화면은 서지 않는다. 요율 목록은 스토어 이름 없이도 읽히고
 * (id 가 그 자리에 남는다), 전역·카테고리 요율은 이 목록과 아무 상관이 없다.
 */

export interface SellerChoice {
  readonly id: string
  readonly name: string
}

export type SellerChoicesState =
  | { readonly status: 'loading' }
  /** 목록을 못 받았다. 왜인지는 말하지 않는다 — 이 화면의 본 일이 아니다. */
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly choices: readonly SellerChoice[] }

export function useSellerChoices(): SellerChoicesState {
  const [state, setState] = useState<SellerChoicesState>({ status: 'loading' })

  useEffect(() => {
    const controller = new AbortController()

    async function load(): Promise<void> {
      try {
        const page = await fetchSellerReviews(
          { limit: SELLER_REVIEW_LIST_MAX_LIMIT },
          { signal: controller.signal },
        )

        if (controller.signal.aborted) return

        setState({
          // 큐는 신청이 늦은 순이다. 고르는 사람이 찾는 것은 이름이므로 이름순으로
          // 세운다 — 심사 화면의 순서를 여기까지 가져오면 아무 뜻이 없다.
          choices: page.sellers
            .map((seller) => ({ id: seller.id, name: seller.brandName }))
            .sort((left, right) => left.name.localeCompare(right.name, 'ko-KR')),
          status: 'ready',
        })
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
