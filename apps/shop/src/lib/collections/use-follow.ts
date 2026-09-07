'use client'

import { useCallback, useEffect, useState } from 'react'

import { useAuth } from '@/lib/auth/auth-context'

import { toggleFollow } from './collections-api'
import type { FollowFacts } from './follow-state'
import { ensureFollowsKnown, forgetFollows, publishFollow, useFollowFacts } from './follow-state'

/**
 * 팔로우 버튼 하나의 상태 (TASK-0089 F1 · F2 · F3).
 *
 * ## 상태는 낙관적으로, 수는 절대 아니다
 *
 * 누르는 순간 「팔로우함」으로 바뀌는 것은 F1 이 요구하는 즉시 반영이다. 하지만
 * **팔로워 수는 답이 올 때까지 움직이지 않는다** — 화면이 ±1 을 하면 두 탭에서 누른
 * 사람의 화면이 서로 다른 수를 그리고, 어느 쪽도 맞지 않는다. 계약이 수를 답에
 * 실어 보내는 이유가 정확히 그것이다 (`followResultSchema`).
 *
 * 그래서 누른 직후의 한순간은 「팔로우함 · 팔로워 12」처럼 보인다. 그것은 틀린
 * 화면이 아니라 **아직 세지 않은 화면**이고, 답이 오면 13이 된다.
 *
 * ## 중복 방지는 서버의 일이다
 *
 * 같은 브랜드를 두 번 팔로우해도 행은 하나다(F2). 화면은 그것을 막지 않고 `pending`
 * 으로 **연달아 누르는 것만** 막는다 — 토글이라 두 번 나가면 팔로우가 취소된다.
 */

export interface FollowToggle {
  /** `null` 이면 아직 모른다 — 팔로우 여부도, 팔로워 수도. */
  readonly facts: FollowFacts | null
  readonly pending: boolean
  readonly failed: boolean
  readonly toggle: () => void
}

export function useFollow(sellerId: string): FollowToggle {
  const { state } = useAuth()
  const signedIn = state.status === 'signedIn'
  const facts = useFollowFacts(sellerId)
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (signedIn) ensureFollowsKnown()
    else forgetFollows()
  }, [signedIn])

  const toggle = useCallback(() => {
    if (!signedIn || pending) return

    const wanted = facts?.active !== true

    setFailed(false)
    setPending(true)
    // 수는 그대로 두고 상태만 미리 바꾼다. 모르는 수를 지어내지 않는다.
    publishFollow(sellerId, { active: wanted, followerCount: facts?.followerCount ?? null })

    async function send(previous: FollowFacts | null): Promise<void> {
      try {
        const answer = await toggleFollow(sellerId)

        publishFollow(sellerId, { active: answer.active, followerCount: answer.followerCount })
      } catch {
        if (previous === null) reask()
        else publishFollow(sellerId, previous)

        setFailed(true)
      } finally {
        setPending(false)
      }
    }

    /** 「모른다」로 되돌린다. 표에서 한 칸만 지우는 함수는 두지 않는다 (찜과 같다). */
    function reask(): void {
      forgetFollows()
      if (signedIn) ensureFollowsKnown()
    }

    void send(facts)
  }, [facts, pending, sellerId, signedIn])

  return { facts, failed, pending, toggle }
}
