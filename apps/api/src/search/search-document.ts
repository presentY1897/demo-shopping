import type { AttributeValue } from '@shopping/shared'

/**
 * A listing, as the search index holds it (TASK-0038 4장).
 *
 * **The document is built from the row as it is now, never from what changed.**
 * That is why the outbox has two verbs rather than five: a price change, a stock
 * change and a rename all end here, rebuilding the same document, and an event
 * that carried *which* of them happened would carry something nothing reads.
 *
 * **Attributes are flattened into `attr_*`.** Meilisearch filters on paths, and
 * a JSONB column arrives as one opaque value — `attributes.material` is not a
 * filterable field unless something makes it one. Flattening at index time is
 * what turns "소재: 린넨" from a string in a blob into a facet the storefront can
 * count (D-005: 코드 수정 없이 속성을 추가한다 — a new attribute becomes a new
 * facet without a line of code here changing).
 */

/** What the indexer reads out of the database for one listing. */
export interface ProductSource {
  readonly id: string
  readonly name: string
  readonly description: string | null
  readonly status: string
  readonly sellerId: string
  readonly brandName: string
  readonly categoryId: number
  /** Root first: `['여성', '상의', '티셔츠']`. */
  readonly categoryPath: readonly string[]
  /** The same lineage as ids, root first: `[1, 5, 12]`. */
  readonly categoryIds: readonly number[]
  readonly minPrice: number | null
  readonly ratingAvg: number
  readonly ratingCount: number
  readonly salesCount: number
  readonly attributes: Readonly<Record<string, AttributeValue>>
  /** Summed over live, active combinations. */
  readonly totalStock: number
  readonly thumbnailUrl: string | null
  readonly createdAt: Date
}

/** One document in the `products` index. */
export interface ProductDocument {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly brandName: string
  readonly categoryId: number
  /**
   * Every category this listing hangs under, its own included (TASK-0042 4.1).
   *
   * **This is what `categoryId` filters against**, not the scalar above.
   * Meilisearch reads `categoryIds = 3` as membership, so one equality answers
   * 「3번 가지 아래 전부」 — and a leaf still matches only itself, because a leaf
   * is nobody's ancestor. Filtering the scalar instead would make a top-level
   * category show the handful of listings hung directly on it and nothing else,
   * which reads as the catalogue being empty.
   *
   * The scalar stays: it is what a hit reports as *its own* category, and the
   * screen needs that to link to one page rather than to three.
   */
  readonly categoryIds: readonly number[]
  readonly categoryPath: readonly string[]
  /** `'여성 > 상의 > 티셔츠'` — one searchable string for the whole lineage. */
  readonly categoryLabel: string
  readonly sellerId: string
  readonly price: number
  readonly ratingAvg: number
  readonly ratingCount: number
  readonly salesCount: number
  readonly inStock: boolean
  readonly thumbnailUrl: string | null
  /** Epoch seconds. Meilisearch sorts numbers, not ISO strings. */
  readonly createdAt: number
  /** Placeholder for TASK-0103. Empty until the 자모 · 초성 fields are filled. */
  readonly hangul: readonly string[]
  /** `attr_material`, `attr_color`, … — see the class comment. */
  readonly [facet: `attr_${string}`]: unknown
}

/** The prefix every flattened attribute carries. */
export const ATTRIBUTE_FACET_PREFIX = 'attr_'

/**
 * The shape of {@link ProductDocument}, as a number to compare against.
 *
 * **Bump it whenever a field is added, removed or given a new meaning.**
 * `SearchIndexerService` reads the value it last wrote and rebuilds the whole
 * index when it differs, which is what makes a document change safe to deploy.
 *
 * Without it the failure is silent and total: the engine keeps answering, the
 * documents it holds simply lack the new field, and every filter on that field
 * matches nothing. Nothing logs, `/health` stays green, and the catalogue looks
 * empty to anyone who clicks a category. That is worse than an outage, because
 * an outage is noticed.
 *
 * | # | 무엇이 바뀌었나 |
 * | --- | --- |
 * | 1 | TASK-0038 최초 문서 |
 * | 2 | `categoryIds` — 조상 사슬. 카테고리 필터가 이것을 본다 (TASK-0042 4.1) |
 */
export const DOCUMENT_VERSION = 2

/**
 * Only `ACTIVE` listings belong in the index.
 *
 * A draft is not for sale and a suspended one has been taken down; both would
 * otherwise be findable, which is the failure F3 describes. Deciding it here
 * rather than in the query means the *worker* can be handed any product and will
 * do the right thing — including the one whose status just changed, which is
 * exactly the event that has to remove it.
 */
export function isIndexable(source: Pick<ProductSource, 'status'>): boolean {
  return source.status === 'ACTIVE'
}

/**
 * Turns one attribute value into something Meilisearch can filter on.
 *
 * Arrays stay arrays (a listing in three colours is filtered by any of them),
 * booleans and numbers pass through, and everything else becomes a string —
 * a facet whose values are of two types filters as neither.
 */
function facetValue(value: AttributeValue): unknown {
  if (Array.isArray(value)) return value.map((entry) => String(entry))
  if (typeof value === 'boolean' || typeof value === 'number') return value

  return String(value)
}

/** `{ material: '린넨' }` → `{ attr_material: '린넨' }`. */
export function attributeFacets(
  attributes: Readonly<Record<string, AttributeValue>>,
): Readonly<Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(attributes).map(([key, value]) => [
      `${ATTRIBUTE_FACET_PREFIX}${key}`,
      facetValue(value),
    ]),
  )
}

/**
 * One listing as one document.
 *
 * `price` falls back to 0 rather than `null` because a sortable field that is
 * sometimes absent sorts unpredictably — and a listing with no live combination
 * has no price *and* no stock, so it sorts to the bottom either way.
 */
export function toDocument(source: ProductSource): ProductDocument {
  return {
    ...attributeFacets(source.attributes),
    id: source.id,
    name: source.name,
    // The empty string rather than `null`: Meilisearch treats a missing
    // searchable field and an empty one the same, and a `null` in a searchable
    // field is a value that can be matched by searching for "null".
    description: source.description ?? '',
    brandName: source.brandName,
    categoryId: source.categoryId,
    categoryIds: [...source.categoryIds],
    categoryPath: [...source.categoryPath],
    categoryLabel: source.categoryPath.join(' > '),
    sellerId: source.sellerId,
    price: source.minPrice ?? 0,
    ratingAvg: source.ratingAvg,
    ratingCount: source.ratingCount,
    salesCount: source.salesCount,
    // R3: stock is indexed as a boolean, so a sale that leaves 41 of 42 does not
    // produce an event at all — only crossing zero changes the document.
    inStock: source.totalStock > 0,
    thumbnailUrl: source.thumbnailUrl,
    createdAt: Math.floor(source.createdAt.getTime() / 1000),
    hangul: [],
  }
}
