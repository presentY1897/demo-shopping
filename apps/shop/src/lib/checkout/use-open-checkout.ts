'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useState } from 'react'

import { openCheckout } from './checkout-api'

/**
 * 장바구니의 「주문하기」 (TASK-0050 4.1).
 *
 * **누르는 순간 재고가 잡힌다.** 그래서 링크가 아니라 요청이다 — 링크로 두면 새
 * 탭마다 예약이 한 벌씩 잡히고, 그 예약들은 아무도 쓰지 않은 채 15분을 버틴다.
 *
 * 실패는 대부분 **그 사이에 품절된 것**이다. 화면은 장바구니에 그대로 머문다:
 * 사람이 할 일은 무엇이 없어졌는지 보고 빼는 것이고, 그것은 여기서 할 수 있다.
 */
export interface OpenCheckout {
  readonly opening: boolean
  readonly failed: boolean
  readonly open: (itemIds: readonly string[]) => void
}

export function useOpenCheckout(): OpenCheckout {
  const router = useRouter()
  const [opening, setOpening] = useState(false)
  const [failed, setFailed] = useState(false)

  const open = useCallback(
    (itemIds: readonly string[]) => {
      if (itemIds.length === 0) return

      setOpening(true)
      setFailed(false)

      async function send(): Promise<void> {
        try {
          const { checkout } = await openCheckout(itemIds)

          // 열린 주문서를 id 로 연다. 화면이 진입과 동시에 여는 대신 이 순서인
          // 이유는 새로고침 때문이다 — 그쪽이면 새로고침 한 번에 한 벌 더 잡힌다.
          router.push(`/checkout/${checkout.id}`)
        } catch {
          setFailed(true)
          setOpening(false)
        }
      }

      void send()
    },
    [router],
  )

  return { opening, failed, open }
}
