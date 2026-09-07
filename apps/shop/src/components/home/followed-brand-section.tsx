'use client'

import { ProductSection } from '@/components/home/product-section'
import { useFollowedSellers } from '@/lib/collections/use-followed-sellers'
import { writeSearchParams } from '@/lib/search/search-params'
import type { HomeMessages } from '@/messages'

/**
 * 홈의 「팔로우한 브랜드의 신상품」 (TASK-0089 F6 · 4.5).
 *
 * ## 이것도 검색이다
 *
 * `pages.md` 의 「홈 섹션은 검색 API 다」가 홈 전용 엔드포인트를 막는다 — 만들면 같은
 * 질의를 두 이름으로 부르게 되고 「신상품」의 정의가 두 군데가 된다. 그래서 이 줄은
 * `?sort=newest&sellerIds=…` 이고, 그리는 일은 다른 두 줄과 **같은 컴포넌트**가 한다.
 *
 * ## 로그인하지 않았거나 팔로우한 곳이 없으면 **줄 자체가 없다**
 *
 * 빈 격자도, 영원히 안 차는 스켈레톤도 그리지 않는다. 이 줄은 조건이 맞는 사람에게만
 * 있는 줄이고, 조건이 맞지 않는 사람의 홈에 빈 상자를 하나 더 두는 것보다 없는 편이
 * 낫다 — 「최근 본 상품」 스트립이 같은 이유로 같은 일을 한다.
 *
 * 답을 **기다리는 동안에도** 그리지 않는다. 팔로우한 곳이 없는 사람에게 스켈레톤을
 * 먼저 보여 준 뒤 지우면 홈이 한 번 흔들리고, 그 흔들림은 아무것도 알려 주지 않는다.
 *
 * ## 홈은 여전히 아무것도 기다리지 않는다
 *
 * TASK-0101 F4 는 `HomePage()` 가 Promise 를 반환하지 않고 호출해도 요청이 나가지
 * 않는다는 **구조적** 기준이다. 이 줄은 클라이언트 컴포넌트이고 팔로우 목록도 상품도
 * **마운트 뒤에** 읽으므로 그 기준은 그대로다.
 */
export function FollowedBrandSection({ messages }: { readonly messages: HomeMessages }) {
  const sellerIds = useFollowedSellers()

  if (sellerIds === null || sellerIds.length === 0) return null

  return (
    <ProductSection
      // 같은 검색을, 끝까지. 가게가 주소에 실려 있으므로 이 링크는 남에게 보내도
      // 같은 줄을 연다 — 「내가 팔로우한」이 아니라 「이 가게들의」이기 때문이다.
      href={`/search?${writeSearchParams({ sort: 'newest', sellerIds })}`}
      messages={messages}
      sellerIds={sellerIds}
      sort="newest"
      title={messages.followedTitle}
    />
  )
}
