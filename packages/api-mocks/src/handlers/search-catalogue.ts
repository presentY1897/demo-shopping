import type { CategoryTreeNode, SearchFilter, SearchHit } from '@shopping/shared'
import { searchFilterSchema, searchHitSchema } from '@shopping/shared'

import { defineFixture } from '../define'
import { storefrontCategoryTree } from '../fixtures/categories'
import { storefrontSeller } from '../fixtures/sellers'

/**
 * The catalogue the search double answers from (TASK-0041).
 *
 * **Two categories with different filters**, because F2 is exactly that: change
 * the category and the panel's contents change. And **one option with no
 * matches**, because F5 asks that a value which would return nothing be greyed
 * out — a fixture where every option has hits cannot show that.
 */

/**
 * The catalogue's own ids, looked up rather than invented.
 *
 * They used to be 31 and 32, which belonged to nothing: the category fixture is
 * a 40-node tree and the search double answered about two numbers outside it. A
 * screen that reads both — the category page reads the tree for its lineage and
 * the search for its list — would have been given two worlds that never met.
 */
function every(nodes: readonly CategoryTreeNode[]): readonly CategoryTreeNode[] {
  return nodes.flatMap((node) => [node, ...every(node.children)])
}

const BY_SLUG = new Map(every(storefrontCategoryTree.nodes).map((node) => [node.slug, node]))

function idOf(slug: string): number {
  const node = BY_SLUG.get(slug)

  if (node === undefined) throw new Error(`검색 목 카탈로그가 없는 카테고리를 가리킵니다: ${slug}`)

  return node.id
}

export const SEARCH_COAT_CATEGORY = idOf('women-outer-coat')
export const SEARCH_SHOE_CATEGORY = idOf('shoes-sneakers')

/**
 * Every category a listing hangs under, its own included.
 *
 * The API indexes exactly this (`ProductDocument.categoryIds`, TASK-0042 4.1)
 * and filters against it, so a double that matched the scalar would answer
 * nothing for a parent category — and a screen tested against it would pass
 * while the real one showed an empty catalogue.
 */
export function categoryLineageIds(categoryId: number): readonly number[] {
  const node = [...BY_SLUG.values()].find((entry) => entry.id === categoryId)

  return node === undefined
    ? [categoryId]
    : node.path
        .split('/')
        .filter((part) => part !== '')
        .map(Number)
}

/** `key → label`, and every option a panel may draw. */
const FILTERS: Readonly<Record<number, readonly SearchFilter[]>> = {
  [SEARCH_COAT_CATEGORY]: [
    defineFixture(searchFilterSchema, {
      key: 'fit',
      label: '핏',
      type: 'SELECT',
      // `루즈` is declared and matched by nothing — the greyed-out case (F5).
      options: ['오버사이즈', '슬림', '루즈'],
    }),
    defineFixture(searchFilterSchema, {
      key: 'material',
      label: '주 소재',
      type: 'SELECT',
      options: ['울', '캐시미어'],
    }),
  ],
  [SEARCH_SHOE_CATEGORY]: [
    defineFixture(searchFilterSchema, {
      key: 'width',
      label: '발볼',
      type: 'SELECT',
      options: ['좁음', '보통'],
    }),
  ],
}

export function searchFilters(categoryId: number): readonly SearchFilter[] {
  return FILTERS[categoryId] ?? []
}

interface CatalogueEntry {
  readonly hit: SearchHit
  readonly attributes: Readonly<Record<string, string>>
}

/**
 * Which store the whole catalogue belongs to (TASK-0044 4.2).
 *
 * `searchHitSchema` carries no `sellerId` — a card does not draw one — so the
 * double keeps it here beside the attributes, the same way it keeps the values a
 * facet filters on. Every listing is 루미에르's, which is what a brand page needs
 * to be checkable: asking for that store returns them all and asking for any
 * other returns none.
 */
export const SEARCH_CATALOGUE_SELLER_ID = storefrontSeller.seller.id

function entry(
  index: number,
  overrides: Partial<SearchHit> & { readonly attributes: Readonly<Record<string, string>> },
): CatalogueEntry {
  const { attributes, ...hit } = overrides

  return {
    attributes,
    hit: defineFixture(searchHitSchema, {
      id: `019596d0-1f1c-7c2e-9a0e-${String(index).padStart(12, '0')}`,
      name: `상품 ${String(index)}`,
      brandName: storefrontSeller.seller.brandName,
      sellerId: SEARCH_CATALOGUE_SELLER_ID,
      categoryId: SEARCH_COAT_CATEGORY,
      price: 100_000,
      inStock: true,
      thumbnailUrl: null,
      ratingAvg: 400,
      ratingCount: 10,
      salesCount: 50,
      ...hit,
    }),
  }
}

export const SEARCH_CATALOGUE: readonly CatalogueEntry[] = [
  entry(1, {
    name: '오버핏 싱글 코트',
    price: 189_900,
    salesCount: 120,
    ratingAvg: 470,
    attributes: { fit: '오버사이즈', material: '울' },
  }),
  entry(2, {
    name: '슬림 더블 코트',
    price: 259_900,
    salesCount: 40,
    ratingAvg: 430,
    attributes: { fit: '슬림', material: '캐시미어' },
  }),
  entry(3, {
    name: '경량 발마칸 코트',
    price: 99_900,
    inStock: false,
    salesCount: 15,
    ratingAvg: 410,
    attributes: { fit: '오버사이즈', material: '울' },
  }),
  entry(4, {
    name: '레트로 러너',
    categoryId: SEARCH_SHOE_CATEGORY,
    price: 79_900,
    salesCount: 200,
    ratingAvg: 460,
    attributes: { width: '보통' },
  }),
  entry(5, {
    name: '첼시 부츠',
    categoryId: SEARCH_SHOE_CATEGORY,
    price: 149_900,
    salesCount: 30,
    ratingAvg: 420,
    attributes: { width: '좁음' },
  }),
]
