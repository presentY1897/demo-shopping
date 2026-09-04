'use client'

import { useCallback } from 'react'

import { useAuthorization } from '@/lib/auth/authorization'
import type { SellerReviewMessages } from '@/messages'

import type { SellerDecision } from './decisions'
import { permissionFor } from './decisions'

/**
 * Why this operator may not take a decision, or `undefined` when they may.
 *
 * **The judgment is TASK-0023's and is not repeated here.** `reason(permission)`
 * runs `authorizePermission` from `@shopping/shared` — the same function
 * `PermissionGuard` calls on the server — so a disabled button and a 403 can
 * never disagree about *whether*.
 *
 * What this adds is *which*. The hook's sentence is "이 역할로는 할 수 없는
 * 작업입니다.", which is true of every refusal on the screen and therefore tells
 * an operator nothing about the two-level split this console exists to show. So
 * the capability's own line is appended, keyed by the permission rather than by
 * the decision because 승인·반려 share one and 정지·해제 share the other
 * (TASK-0110 4장).
 */
export function useDecisionDenial(
  messages: SellerReviewMessages,
): (decision: SellerDecision) => string | undefined {
  const { reason } = useAuthorization()
  const { denials } = messages

  return useCallback(
    (decision: SellerDecision): string | undefined => {
      const permission = permissionFor(decision)
      const why = reason(permission)

      if (why === undefined) return undefined

      return `${why} ${permission === 'seller.suspend' ? denials.suspend : denials.approve}`
    },
    [reason, denials],
  )
}
