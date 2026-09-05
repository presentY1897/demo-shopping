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
/**
 * 순서가 곧 가중치다 (TASK-0103 F5).
 *
 * Meilisearch's `attribute` ranking rule prefers a match in an earlier field, so
 * this list *is* 「완성형 매칭 > 자모 매칭 > 초성 매칭」 — the weighting the task
 * asks for, expressed as an order rather than as a score nobody can read.
 *
 * `chosung` sits last of the three because it is the widest: two consonants match
 * a great many names, and a chosung hit should never outrank somebody who typed
 * the word out.
 */
export const SEARCHABLE_ATTRIBUTES: readonly string[] = [
  'name',
  'brandName',
  'categoryLabel',
  'hangul',
  'chosung',
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
  // The lineage, which is what a category filter actually matches — see
  // `ProductDocument.categoryIds`. `categoryId` stays filterable because the
  // facet counts are keyed on it.
  'categoryIds',
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

/**
 * 오타 허용 기준 (F2).
 *
 * **The default is written for English and is nearly inert in Korean.**
 * Meilisearch allows one typo from five characters and two from nine, counted in
 * characters — and Korean packs a syllable into one, so a three-syllable word is
 * three characters and gets no tolerance at all.
 *
 * Measured against the fixture, one syllable substituted in each:
 *
 * | 질의 | 기본 (5 / 9) | 여기 (2 / 5) |
 * | --- | --- | --- |
 * | 레트루 → 레트로 | **0건** | 1건 |
 * | 러니 → 러너 | **0건** | 1건 |
 * | 발마간 → 발마칸 | 1건 | 1건 |
 * | 더불 → 더블 | 1건 | 1건 |
 *
 * So the change is load-bearing: two of the four only work once the floor comes
 * down. `1` was tried too and measured **identical** to `2` on every pair, so
 * the more conservative number is kept — at one character every word is one edit
 * from every other word, and nothing was gained by paying that.
 *
 * **`코투` → `코트` is not forgiven at any threshold**, which is the example
 * TASK-0039 F2 happens to name. The task's 6장 records the measurement rather
 * than the wish.
 */
export const TYPO_TOLERANCE = {
  enabled: true,
  minWordSizeForTypos: { oneTypo: 2, twoTypos: 5 },
  /**
   * 자모·초성 필드에서는 오타 보정을 끈다 (TASK-0103 R1).
   *
   * 그 필드에 든 것은 사람이 친 낱말이 아니라 **펴 놓은 글자열**이다. 거기서의
   * 「오타 한 개」는 뜻이 없고, 후보만 넓힌다 — 초성 `ㅋㅌ` 가 `ㄹㅋㅌ` 에 붙는 것이
   * 그 예다. 실제로 그렇게 붙는 것을 보고 껐다: 「롱코트」가 `ㅋㅌ` 로 나오는 것이
   * 반가워 보이지만, 그것은 초성이 맞아서가 아니라 한 글자 차이라서이고 — 같은
   * 이유로 아무 상관 없는 이름도 함께 나온다.
   *
   * 완성형 이름(`name`·`brandName`)의 오타 보정은 그대로다. 「레트루 → 레트로」는
   * TASK-0039 가 실측해서 남긴 기능이다.
   */
  disableOnAttributes: ['hangul', 'chosung'],
} as const

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
    typoTolerance: {
      ...TYPO_TOLERANCE,
      minWordSizeForTypos: { ...TYPO_TOLERANCE.minWordSizeForTypos },
      disableOnAttributes: [...TYPO_TOLERANCE.disableOnAttributes],
    },
  }
}
