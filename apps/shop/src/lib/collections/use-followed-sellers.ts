'use client'

import { useEffect, useMemo } from 'react'

import { useAuth } from '@/lib/auth/auth-context'
import { capSellerIds } from '@/lib/search/seller-ids'

import { ensureFollowsKnown, forgetFollows, useFollowedSellerIds } from './follow-state'

/**
 * 홈의 줄이 물어보는 것: **어느 가게를 팔로우했나** (TASK-0089 F6 · 4.5).
 *
 * 답을 `follow-state` 에서 가져오므로 요청이 **하나 더 나가지 않는다** — 팔로우
 * 버튼들이 이미 그 표를 채우고 있고, 그 표를 채우는 답이 곧 순서 있는 id 목록이다.
 *
 * 계약이 받는 만큼만 넘긴다(`capSellerIds`). 51곳을 팔로우한 사람의 홈에서 그 상한을
 * 넘기면 서버가 400 으로 거절하고, 그 거절은 **빈 줄**로만 보인다 — 「아직 신상품이
 * 없나 보다」로 읽히고 아무도 오류를 보지 못한다.
 *
 * `null` 은 「아직 모른다 · 로그인하지 않았다」이고 `[]` 는 「한 곳도 없다」다. 홈은
 * 둘 다에 **아무것도 그리지 않지만**, 그것은 이 훅이 아니라 화면의 판단이다.
 */
export function useFollowedSellers(): string[] | null {
  const { state } = useAuth()
  const signedIn = state.status === 'signedIn'
  const followed = useFollowedSellerIds()

  useEffect(() => {
    // 로그인한 사람에게만 묻는다. 익명에게 물으면 401 이 온다.
    if (signedIn) ensureFollowsKnown()
    else forgetFollows()
  }, [signedIn])

  return useMemo(() => (followed === null ? null : capSellerIds(followed)), [followed])
}
