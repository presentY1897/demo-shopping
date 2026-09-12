import type {
  ApiFailure,
  CategoryTreeNode,
  ProductListQuery,
  ProductStatus,
} from '@shopping/shared'

/**
 * 상품 화면의 순수 판단 — **무엇을 묻고, 무엇을 내릴 수 있고, 거절을 어떻게 읽는가**
 * (TASK-0095).
 *
 * `lib/users/user-console.ts` 와 같은 자리에 같은 이유로 있다: 여기 있는 것들은 전부
 * **틀려도 조용하다.**
 *
 * | 무엇이 틀리면 | 화면은 |
 * | --- | --- |
 * | 필터 → 질의 | 「이 조건에 상품이 없어요」를 멀쩡히 그린다. 못 찾는 것이 아니라 **다른 스토어의 상품을 보여 준다** |
 * | 내릴 수 있는 상태 | 초안 옆에 「내리기」를 그리고, 눌린 그 버튼은 409 를 받는다 — 아니면 더 나쁘게, 되돌릴 수 없는 500 을 받는다 (4.2) |
 * | 거절 분류 | 데모 관리자의 403 이 「일시적인 문제가 생겼어요」가 되어 몇 번이고 다시 눌린다 (F8) |
 *
 * I/O 도 렌더도 없다 (QUALITY-GATES 순수 로직 — `vitest.config.mjs` 가 이 파일을
 * 분기 100% 로 잡고 있다).
 */

/* --------------------------------------------------------------- 필터 -- */

/**
 * 목록 필터가 들고 있는 것. 셋 다 `null` 이 「전체」다.
 *
 * 이름 검색은 `GET /products`의 q 계약을 사용한다.
 */
export interface ProductFilters {
  /**
   * 상품 이름의 일부 (TASK-0095 2장).
   *
   * **검색 엔진이 대신할 수 없어서** 목록이 직접 받는다 — 색인은 판매 중인 것만
   * 담으므로, 관리자가 정작 찾으려는 초안이나 강제로 내려진 상품은 거기 없다.
   */
  readonly q: string | null
  readonly sellerId: string | null
  readonly categoryId: number | null
  readonly status: ProductStatus | null
}

export const EMPTY_PRODUCT_FILTERS: ProductFilters = {
  q: null,
  sellerId: null,
  categoryId: null,
  status: null,
}

/** 하나라도 좁혔는가. 빈 목록이 「없다」인지 「이 조건에 없다」인지를 가른다. */
export function productsNarrowed(filters: ProductFilters): boolean {
  return (
    filters.q !== null ||
    filters.sellerId !== null ||
    filters.categoryId !== null ||
    filters.status !== null
  )
}

/**
 * 필터를 계약의 질의로. 커서와 개수는 부르는 쪽이 얹는다.
 *
 * 값이 없는 축은 **키 자체를 넣지 않는다.** `undefined` 를 실어 보내면
 * `URLSearchParams` 가 `status=undefined` 를 만들고, 서버는 그것을 잘못된 상태로 읽어
 * 400 으로 답한다.
 */
export function productQueryOf(filters: ProductFilters): ProductListQuery {
  return {
    ...(filters.q === null ? {} : { q: filters.q }),
    ...(filters.sellerId === null ? {} : { sellerId: filters.sellerId }),
    ...(filters.categoryId === null ? {} : { categoryId: filters.categoryId }),
    ...(filters.status === null ? {} : { status: filters.status }),
  }
}

/* ------------------------------------------------------------ 카테고리 -- */

export interface CategoryChoice {
  readonly id: number
  /** 조상까지 이어 붙인 이름 — `여성 › 아우터 › 코트`. */
  readonly label: string
}

/** 계층을 잇는 기호. 한국어가 아니므로 카탈로그의 것이 아니다 (`pageStatus` 의 `·` 와 같다). */
const CATEGORY_SEPARATOR = ' › '

/**
 * 트리를 셀렉트가 읽을 수 있는 한 줄짜리 목록으로.
 *
 * ## 이름만으로는 부족하다
 *
 * 카테고리 이름은 가지마다 겹칠 수 있다 — 「여성 › 아우터」와 「남성 › 아우터」가
 * 그렇다. 셀렉트에 「아우터」가 두 줄 서면 고르는 사람은 둘 중 어느 것인지 알 수 없고,
 * **찍어서 고른 그 조건이 목록을 조용히 다른 것으로 바꾼다.** 그래서 조상까지 이어
 * 붙인다.
 *
 * ## 잎만 남기지 않는다
 *
 * 계약이 **어느 깊이의 카테고리로도** 좁힐 수 있게 두었다 — 서버는 조상 경로가 아니라
 * `categoryId` 로 정확히 찾는다(`product.service.ts`). 중간 노드를 목록에서 빼면
 * 「여성 전체」를 보려던 사람에게 그것이 안 된다는 사실을 말할 자리가 없다.
 */
export function categoryChoices(
  nodes: readonly CategoryTreeNode[],
  prefix = '',
): readonly CategoryChoice[] {
  return nodes.flatMap((node) => {
    const label = `${prefix}${node.name}`

    return [
      { id: node.id, label },
      ...categoryChoices(node.children, `${label}${CATEGORY_SEPARATOR}`),
    ]
  })
}

/* ----------------------------------------------------------- 강제 숨김 -- */

/**
 * 이 상품에 지금 할 수 있는 일 (4.2).
 *
 * **판매 중인 것만 내리고 내려진 것만 올린다.** 서버도 같은 판정을 하고 아니면 409 로
 * 답하지만(`PRODUCT_NOT_MODERATABLE`), 화면이 같은 표를 들고 있어야 하는 이유는 **눌러
 * 봐야만 알 수 있는 버튼을 내밀지 않기** 위해서다.
 *
 * `apps/api` 의 판정을 비추는 거울이라(`admin-catalog.service.ts` 의 `moderate`), 닿지
 * 않은 분기 하나는 「초안 옆의 내리기 버튼」이고 그 버튼은 눌려도 아무 일이 안 일어난다.
 */
export const moderationActions = ['hide', 'restore'] as const

export type ModerationAction = (typeof moderationActions)[number]

export function moderationActionFor(status: ProductStatus): ModerationAction | null {
  switch (status) {
    case 'ACTIVE':
      return 'hide'
    case 'SUSPENDED':
      return 'restore'
    // 초안과 판매중지는 **이미 진열되어 있지 않다.** 내릴 것이 없고, 올린다면 값이
    // 없는 상품이 판매 중이 되어 `Product_active_price_check` 에 걸린다 — 그리고 그
    // 500 은 관리자에게 아무 뜻도 없다 (4.2).
    case 'DRAFT':
    case 'INACTIVE':
      return null
  }
}

/**
 * 쓰기가 거절됐을 때, **이 화면이 따로 할 말이 있는** 두 가지.
 *
 * `forbidden` — 데모 관리자는 `catalog.write` 가 `demo` 로 좁혀져 있어 **실계정의
 * 상품을 내리지 못한다** (F8 · D-058). 그런데 그 판정에 필요한 것 — 이 상품의 주인이
 * 데모 계정인가 — 은 목록의 줄에 없다(`productSummarySchema` 에 `ownerIsDemo` 가
 * 없다). 그래서 버튼을 미리 죽일 수 없고, 오는 거절을 문장으로 받는 것이 화면이 할 수
 * 있는 전부다. 카탈로그의 `FORBIDDEN` 은 「권한이 없어요」 한 줄이라 **어느 자격이
 * 어떻게 좁혀져 있는지**를 말하지 못한다.
 *
 * `stale` — 상품이 그 사이에 지워졌다. 다음 행동은 **다시 읽는 것**이지 다시 누르는
 * 것이 아니다.
 *
 * `null` 이 「보통의 실패」다. 그리고 그 자리에 가장 자주 오는 것이 409
 * `PRODUCT_NOT_MODERATABLE` 인데, **그것에는 카탈로그가 이미 문장을 갖고 있다** —
 * 여기서 되풀이하면 같은 거절에 두 벌의 한국어가 생긴다 (`ko.ts` 의 `errors`).
 */
export const productRefusals = ['forbidden', 'stale'] as const

export type ProductRefusal = (typeof productRefusals)[number]

export function productRefusalOf(failure: ApiFailure): ProductRefusal | null {
  if (failure.kind !== 'http') return null
  if (failure.status === 403) return 'forbidden'

  return failure.status === 404 ? 'stale' : null
}
