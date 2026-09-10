'use client'

import { checkoutResponseSchema } from '@shopping/shared'
import { useRouter } from 'next/navigation'
import { useCallback, useRef, useState } from 'react'
import { getApiClient } from '@/lib/api'

export function useBuyNow() {
  const router = useRouter()
  const busy = useRef(false)
  const [opening, setOpening] = useState(false)
  const [failed, setFailed] = useState(false)
  const buy = useCallback(
    (variantId: string, quantity: number) => {
      if (busy.current) return
      busy.current = true
      setOpening(true)
      setFailed(false)
      void getApiClient()
        .request({
          path: '/checkouts',
          method: 'POST',
          body: { items: [{ variantId, quantity }] },
          schema: checkoutResponseSchema,
        })
        .then(({ checkout }) => router.push(`/checkout/${checkout.id}`))
        .catch(() => {
          setFailed(true)
          setOpening(false)
          busy.current = false
        })
    },
    [router],
  )
  return { opening, failed, buy }
}
