'use client'

import type { CartResponse } from '@shopping/shared'
import { cartResponseSchema } from '@shopping/shared'
import { useCallback, useState } from 'react'

import { getApiClient } from '@/lib/api'

import { publishCartCount } from './cart-count'

/**
 * 담기 (TASK-0046 4.5).
 *
 * `purchase-controls.tsx` 가 「M07 owns the basket」이라고 적어 둔 버튼을 여기서
 * 잇는다. 장바구니 화면만 만들고 담을 방법을 두지 않으면, 그 화면에 무언가를
 * 넣는 길이 시드밖에 없다.
 *
 * 결과가 세 가지다 — 아직 안 눌렀거나, 담겼거나, 거절당했거나. 하나의 불리언으로
 * 뭉치면 「담김」과 「아직」이 같은 화면이 된다.
 */

export type AddToCartState =
  | { readonly status: 'idle' }
  | { readonly status: 'adding' }
  | { readonly status: 'added' }
  | { readonly status: 'failed' }

export interface AddToCart {
  readonly state: AddToCartState
  readonly add: (variantId: string, quantity: number) => void
}

export function useAddToCart(): AddToCart {
  const [state, setState] = useState<AddToCartState>({ status: 'idle' })

  const add = useCallback((variantId: string, quantity: number) => {
    setState({ status: 'adding' })

    async function send(): Promise<void> {
      try {
        const cart: CartResponse = await getApiClient().request({
          path: '/cart/items',
          method: 'POST',
          body: { variantId, quantity },
          schema: cartResponseSchema,
        })

        // 헤더의 배지가 이 숫자를 읽는다. 담자마자 움직이지 않으면 사람은 담겼는지
        // 확신하지 못하고 한 번 더 누른다.
        publishCartCount(cart.itemCount)
        setState({ status: 'added' })
      } catch {
        setState({ status: 'failed' })
      }
    }

    void send()
  }, [])

  return { state, add }
}
