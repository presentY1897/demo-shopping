'use client'

import type { CartResponse, OrderItem } from '@shopping/shared'
import { cartResponseSchema } from '@shopping/shared'
import { useCallback, useState } from 'react'

import { getApiClient } from '@/lib/api'
import { publishCartCount } from '@/lib/cart/cart-count'

/**
 * 재구매 — 주문한 것을 장바구니에 다시 담는다 (TASK-0063 F7).
 *
 * ## 담기는 줄마다 따로 성공한다
 *
 * `POST /cart/items` 는 한 번에 한 줄이고, 묶음 배치로 담는 라우트는 계약에 없다.
 * 그래서 이 훅은 줄 수만큼 부르고 **줄마다의 결과를 모은다** — 그것이 F7 이 요구하는
 * 「품절 항목 안내」의 전부다: 세 줄 중 하나가 단종됐으면 두 줄은 담기고 한 줄의
 * 이름이 남아야 한다. 전부 실패로 처리하면 살 수 있는 것까지 못 사고, 전부 성공으로
 * 처리하면 장바구니에 없는 물건을 있다고 말한다.
 *
 * **순서대로 부른다.** 같은 장바구니를 고치는 요청들이라 병렬로 던지면 마지막
 * 응답이 이긴다 — 화면이 읽는 개수(`itemCount`)가 몇 줄을 놓친 값이 될 수 있다.
 * 한 주문의 줄은 많아야 몇 개이므로 줄 세우는 값이 싸다.
 *
 * ## 왜 `useAddToCart` 를 다시 쓰지 않나
 *
 * 그쪽은 **한 줄의 결과**를 상태로 들고 있다 (`idle` · `adding` · `added` ·
 * `failed`). 여러 줄을 담아야 하는 이 화면이 그것을 반복해 부르면 마지막 줄의
 * 결과만 남고, 「어느 줄이 안 됐나」가 사라진다.
 */

export interface RepurchaseOutcome {
  /** 실제로 담긴 줄 수. */
  readonly added: number
  /** 담지 못한 줄의 상품명. 품절·단종·수량 상한이 전부 여기로 온다. */
  readonly rejected: readonly string[]
}

export interface Repurchase {
  /** 담는 중인 묶음의 id. 중복 클릭을 막는 값이다 (U3). */
  readonly busyId: string | null
  readonly run: (key: string, items: readonly OrderItem[]) => Promise<RepurchaseOutcome>
}

export function useRepurchase(): Repurchase {
  const [busyId, setBusyId] = useState<string | null>(null)

  const run = useCallback(
    async (key: string, items: readonly OrderItem[]): Promise<RepurchaseOutcome> => {
      setBusyId(key)

      let added = 0
      const rejected: string[] = []
      let latest: CartResponse | null = null

      for (const item of items) {
        try {
          latest = await getApiClient().request({
            path: '/cart/items',
            method: 'POST',
            body: { variantId: item.variantId, quantity: item.quantity },
            schema: cartResponseSchema,
          })
          added += 1
        } catch {
          // 왜 거절됐는지를 줄마다 다르게 말하지 않는다. 품절이든 단종이든 상한이든
          // 사람이 할 일은 같다 — 그 줄만 빼고 장바구니로 가는 것이다.
          rejected.push(item.snapshot.productName)
        }
      }

      // 헤더의 배지가 이 숫자를 읽는다. 담자마자 움직이지 않으면 사람은 담겼는지
      // 확신하지 못하고 한 번 더 누른다.
      if (latest !== null) publishCartCount(latest.itemCount)
      setBusyId(null)

      return { added, rejected }
    },
    [],
  )

  return { busyId, run }
}
