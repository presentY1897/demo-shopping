#!/usr/bin/env node

/**
 * Lighthouse 가 잴 여섯 화면의 URL 을 **살아 있는 API 에게 물어서** 만든다
 * (TASK-0097 F1 · F2).
 *
 * ## 왜 물어보나
 *
 * 상품 id 와 카테고리 slug 를 워크플로에 적어 두면 시드가 바뀌는 날 조용히 404 를
 * 재게 된다 — 그리고 **404 는 아주 빠르다.** LCP 예산은 그대로 통과하고, 아무도
 * 그것이 빈 화면이었다는 것을 모른다.
 *
 * ## 왜 이 여섯인가
 *
 * 로그인 없이 열리는 화면 전부다. 콘솔 세 앱은 로그인 뒤에 있어 Lighthouse 가 그냥
 * 로그인 화면을 재게 되고, 그 수치는 「관리자 화면이 빠른가」에 답하지 않는다.
 *
 * 여섯은 성격이 다 다르다 — 정적 프리렌더(홈), 질의 결과(검색), 눌러 둔 검색
 * (카테고리·브랜드관), 한 행의 상세(상품), 브라우저 상태만 읽는 화면(장바구니).
 * 한 종류만 재면 나머지의 회귀를 못 본다.
 */

const apiBase = process.env.API_BASE ?? 'http://127.0.0.1:4000/api/v1'
const shopBase = process.env.SHOP_BASE ?? 'http://127.0.0.1:3000'

async function ask(path) {
  const response = await fetch(`${apiBase}${path}`)

  if (!response.ok) {
    throw new Error(`${path} 가 ${String(response.status)} 로 답했습니다.`)
  }

  return response.json()
}

/** 어느 하나라도 못 찾으면 **던진다.** 빈 화면을 재느니 워크플로가 빨간 것이 낫다. */
function firstOrThrow(items, what) {
  const [first] = items

  if (first === undefined) throw new Error(`${what} 를 하나도 찾지 못했습니다.`)

  return first
}

// `/categories` 가 아니라 `/categories/tree` 다 — 저쪽은 콘솔의 문이라 로그인을
// 요구하고, 여기서 재는 것은 **로그인하지 않은 사람이 보는 화면**이다.
const [tree, hits] = await Promise.all([
  ask('/categories/tree'),
  ask('/search?limit=1&sort=newest'),
])

/** 잎만 골라 평평하게 편다. */
function leaves(nodes) {
  return nodes.flatMap((node) =>
    (node.children ?? []).length === 0 ? [node] : leaves(node.children),
  )
}

// **상품이 있는 잎**을 고른다. 빈 카테고리는 아주 빠르게 그려지고, 그 수치는
// 「카테고리 화면이 빠른가」에 답하지 않는다.
const leaf = firstOrThrow(
  leaves(tree.nodes ?? []).filter((category) => category.productCount > 0),
  '상품이 있는 잎 카테고리',
)
const product = firstOrThrow(hits.items ?? [], '판매 중인 상품')

const urls = [
  `${shopBase}/`,
  `${shopBase}/search?q=${encodeURIComponent('코트')}`,
  `${shopBase}/categories/${leaf.slug}`,
  `${shopBase}/products/${product.id}`,
  `${shopBase}/brands/${product.sellerId}`,
  `${shopBase}/cart`,
]

process.stdout.write(`${urls.join('\n')}\n`)
