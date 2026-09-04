/**
 * How the `products` index is configured (TASK-0038 4장, 5장 1).
 *
 * **Settings are code, not a console click.** A deployment starts with an empty
 * Meilisearch — the free plan has no persistent disk (TASK-0009) — so an index
 * configured by hand is an index that is misconfigured after every restart. The
 * indexer applies this on boot and after every full reindex.
 */

export const PRODUCTS_INDEX = 'products'

/** The document field Meilisearch keys on. */
export const PRODUCTS_PRIMARY_KEY = 'id'

/**
 * What a query matches against, **in priority order**.
 *
 * Order is the point: Meilisearch ranks a hit in an earlier attribute above one
 * in a later attribute, so a listing *named* 「린넨 셔츠」 beats one that merely
 * mentions linen in its description. Putting `description` first would bury
 * every exact name match under whatever paragraph happened to say the word.
 */
export const SEARCHABLE_ATTRIBUTES: readonly string[] = [
  'name',
  'brandName',
  'categoryLabel',
  'hangul',
  'description',
]

/**
 * What can be filtered and counted.
 *
 * `attr_*` cannot be listed here — Meilisearch wants concrete names — so the
 * indexer appends the attribute keys it finds (`attributeFacetFields`). That is
 * what makes D-005 true for search as well: a new attribute definition becomes a
 * new facet without an edit here.
 */
export const FILTERABLE_ATTRIBUTES: readonly string[] = [
  'categoryId',
  'sellerId',
  'price',
  'inStock',
  'ratingAvg',
]

/**
 * What the storefront may sort by.
 *
 * `createdAt` is epoch seconds for this reason: Meilisearch sorts a number, and
 * an ISO string would sort lexicographically — which happens to be right for
 * UTC and silently wrong the day a value carries an offset.
 */
export const SORTABLE_ATTRIBUTES: readonly string[] = [
  'price',
  'salesCount',
  'ratingAvg',
  'createdAt',
]

/**
 * Ranking rules, with one change from the default.
 *
 * `sort` is moved **above** `typo`: when a shopper has asked for 「낮은 가격순」
 * they mean it, and the default order lets a closer-spelled match outrank a
 * cheaper one — which reads as the sort being broken.
 */
export const RANKING_RULES: readonly string[] = [
  'words',
  'typo',
  'sort',
  'proximity',
  'attribute',
  'exactness',
]

/**
 * 동의어 (F6).
 *
 * Two-way, and short on purpose. A synonym list is a place where somebody's
 * guess becomes the product's behaviour, so it holds only pairs that are the
 * *same garment under two names* — not "related items", which is what a
 * recommendation engine is for. R1 says to measure against the real 800 and
 * extend from what actually fails, not from what sounds plausible.
 */
export const SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  니트: ['스웨터'],
  스웨터: ['니트'],
  맨투맨: ['스웨트셔츠'],
  스웨트셔츠: ['맨투맨'],
  바지: ['팬츠'],
  팬츠: ['바지'],
  운동화: ['스니커즈'],
  스니커즈: ['운동화'],
  겉옷: ['아우터'],
  아우터: ['겉옷'],
}

/** The full settings body, given the attribute facets that exist today. */
export function productsIndexSettings(attributeFacets: readonly string[]): Record<string, unknown> {
  return {
    searchableAttributes: [...SEARCHABLE_ATTRIBUTES],
    // Sorted so that two deployments with the same attributes send byte-identical
    // settings — Meilisearch treats a settings write as a task either way, and a
    // list whose order wanders would re-index the whole thing on every boot.
    filterableAttributes: [...FILTERABLE_ATTRIBUTES, ...[...attributeFacets].sort()],
    sortableAttributes: [...SORTABLE_ATTRIBUTES],
    rankingRules: [...RANKING_RULES],
    synonyms: SYNONYMS,
  }
}
