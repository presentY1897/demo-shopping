'use client'

import type { FollowedSeller } from '@shopping/shared'
import { useSyncExternalStore } from 'react'

import { fetchFollowIds } from './collections-api'

/**
 * 「이 브랜드를 팔로우했나」와 「어느 브랜드를 팔로우했나」 (TASK-0089 F1 · F6 · 4.4).
 *
 * ## 목록이 아니라 id 다
 *
 * 팔로우 버튼은 브랜드관에도 상품 상세에도 있고, 그 전부가 「내가 팔로우했나」를
 * 알아야 한다. 한때 이 표를 `GET /me/follows` 로 채웠는데, 목록은 한 쪽이 100개까지라
 * **한 쪽에 안 들어가는 사람의 화면이 조용히 틀렸다** — 찜이 같은 문제를 먼저
 * 만났고(`wishlist-state.ts`), 같은 모양으로 푼다: 페이지가 없는 답이면 「여기 없다」가
 * 곧 「팔로우하지 않았다」다.
 *
 * ## 순서가 계약의 일부다
 *
 * 답은 **최근에 팔로우한 순서**로 오고, 이 표는 그 순서를 그대로 들고 있는다. 홈의
 * 「팔로우한 브랜드의 신상품」이 이 목록을 앞에서부터 50곳으로 자르기 때문이고(4.6),
 * 순서가 없으면 그 줄이 새로고침할 때마다 다른 가게로 바뀐다.
 *
 * ## 팔로워 수는 이제 여기서 시작하지 않는다
 *
 * 브랜드관이 읽는 `storefrontSellerSchema` 가 그 수를 **언제나** 싣는다(4.3). 그래서
 * 이 표가 아는 수는 **토글의 답이 말해 준 것뿐**이고, 그것은 화면이 이미 그리고 있는
 * 수를 덮어쓰기 위한 것이다 — 누른 뒤에도 수가 그대로면 사람은 팔로우가 안 됐다고
 * 읽는다. 모르면 `null` 이고, 0 이 아니다.
 */

export interface FollowFacts {
  readonly active: boolean
  /** 토글의 답이 말해 준 지금 팔로워 수. **모르면 `null`** — 0 이 아니다. */
  readonly followerCount: number | null
}

let known = new Map<string, FollowFacts>()

/** 최근에 팔로우한 순서. `null` 은 **아직 모른다**이고, 빈 배열은 「없다」다. */
let followed: readonly string[] | null = null

let asked = false

const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

/**
 * 토글의 답이 부른다 — 상태와 **수를 함께**.
 *
 * 낙관적으로 ±1 을 하지 않는 이유가 여기 있다. 두 탭에서 누른 사람의 화면이 서로
 * 다른 수를 그리고 어느 쪽도 맞지 않는다 (`followResultSchema` 의 머리말).
 */
export function publishFollow(sellerId: string, facts: FollowFacts): void {
  const held = known.get(sellerId)
  const order = reordered(followed, sellerId, facts.active)

  if (
    held?.active === facts.active &&
    held.followerCount === facts.followerCount &&
    order === followed
  ) {
    return
  }

  known = new Map(known).set(sellerId, facts)
  followed = order
  emit()
}

/**
 * 순서 있는 목록을 토글에 맞춘다.
 *
 * 브랜드관에서 끊고 홈으로 돌아온 사람의 줄에 **방금 끊은 브랜드의 신상품**이 그대로
 * 남아 있으면 안 된다. 새로 이은 것은 맨 앞이다 — 목록이 「최근에 팔로우한 순서」이고,
 * 방금이 가장 최근이다.
 *
 * 바뀔 것이 없으면 **같은 참조를 돌려준다.** `useSyncExternalStore` 의 스냅샷이
 * 렌더마다 새 배열이면 React 는 값이 계속 바뀐다고 보고 무한히 다시 그린다.
 */
function reordered(
  order: readonly string[] | null,
  sellerId: string,
  active: boolean,
): readonly string[] | null {
  if (order === null) return null
  if (order.includes(sellerId) === active) return order

  return active ? [sellerId, ...order] : order.filter((id) => id !== sellerId)
}

/**
 * 팔로우 목록 화면이 받아 온 줄들.
 *
 * 순서와 완전함은 건드리지 않는다 — 이 목록에는 다음 장이 있을 수 있다. 부르는 이유는
 * 그 화면에서 브랜드관으로 넘어갔을 때 버튼이 「팔로우」라고 한 번 그려지는 것을
 * 막기 위해서다 (`use-wishlist.ts` 가 같은 이유로 같은 일을 한다).
 */
export function publishFollowPage(sellers: readonly FollowedSeller[]): void {
  if (sellers.length === 0) return

  const next = new Map(known)

  for (const seller of sellers) {
    next.set(seller.sellerId, { active: true, followerCount: seller.followerCount })
  }

  known = next
  emit()
}

/** 로그아웃처럼 「이제 모른다」로 돌아가는 순간. */
export function forgetFollows(): void {
  if (known.size === 0 && followed === null && !asked) return

  known = new Map()
  followed = null
  asked = false
  emit()
}

/**
 * 아직 묻지 않았으면 묻는다.
 *
 * 실패해도 다시 묻지 않는다 — 이 요청은 화면이 청한 것이 아니라 버튼이 자기
 * 상태를 알아보려는 것이고, 못 알아내면 「모른다」인 채로 여전히 눌린다. 홈의 줄도
 * 「모른다」이면 그려지지 않으므로, 실패한 홈에 영원히 안 차는 빈 자리가 생기지 않는다.
 */
export function ensureFollowsKnown(): void {
  if (asked) return

  asked = true

  void fetchFollowIds()
    .then(({ sellerIds }) => {
      const next = new Map<string, FollowFacts>()

      // 갈아치운다 — 답이 완전하므로. 답을 기다리는 사이에 누른 것은 토글의 답이
      // 곧 다시 적는다 (`wishlist-state.ts` 의 같은 자리).
      for (const sellerId of sellerIds) next.set(sellerId, { active: true, followerCount: null })

      known = next
      followed = sellerIds
      emit()
    })
    .catch(() => {
      // 「모른다」인 채로 둔다.
    })
}

/** 팔로우는 한 사람의 것이고 서버 렌더에는 그 사람이 없다. */
function serverSnapshot(): null {
  return null
}

/** 아는 것이 없으면 `null`. 있으면 상태와 (알면) 수. */
export function useFollowFacts(sellerId: string): FollowFacts | null {
  return useSyncExternalStore(
    subscribe,
    () => known.get(sellerId) ?? (followed === null ? null : NOT_FOLLOWING),
    serverSnapshot,
  )
}

/**
 * 팔로우한 가게들, 최근 순 (F6).
 *
 * `null` 은 **아직 모른다 · 로그인하지 않았다**이고 `[]` 는 「한 곳도 없다」다. 홈의
 * 줄이 그 둘을 같게 그린다 — 어느 쪽이든 줄 자체가 없다 — 지만 둘을 한 값으로 합치면
 * 아직 답을 기다리는 화면과 정말 없는 화면을 나중에 갈라 볼 수 없다.
 */
export function useFollowedSellerIds(): readonly string[] | null {
  return useSyncExternalStore(subscribe, () => followed, serverSnapshot)
}

/**
 * 「팔로우하지 않았다」의 한 벌.
 *
 * 상수인 것은 `useSyncExternalStore` 때문이다 — 스냅샷이 렌더마다 새 객체를
 * 돌려주면 React 는 값이 계속 바뀐다고 보고 무한히 다시 그린다.
 */
const NOT_FOLLOWING: FollowFacts = { active: false, followerCount: null }
