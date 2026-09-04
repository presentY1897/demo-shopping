import { Inject, Injectable, Logger } from '@nestjs/common'
import type {
  FacetCounts,
  SearchFilter,
  SearchHit,
  SearchQuery,
  SearchResponse,
} from '@shopping/shared'
import { SEARCH_SUGGEST_LIMIT } from '@shopping/shared'

import { PrismaService } from '../prisma/prisma.service.js'
import { ATTRIBUTE_FACET_PREFIX } from './search-document.js'
import type { SearchIndex } from './search-index.js'
import { SEARCH_INDEX } from './search-index.js'
import { SearchIndexerService } from './search-indexer.service.js'
import { nextCursorFor, toSearchRequest } from './search-query.js'

/** Facet fields that are not attributes. */
const BASE_FACETS: readonly string[] = ['categoryId', 'inStock']

/**
 * 검색 · 필터 · 패싯 (TASK-0039).
 *
 * **The filters are the catalogue's, not this file's.** Which attributes a
 * category offers comes from `AttributeDefinition.isFilterable`, so an operator
 * turning a switch on in the admin console adds a filter to the storefront with
 * no code change — D-005, reached through search.
 *
 * **Facets are counted after the other filters.** `{ 면: 12 }` beside a fit that
 * is already chosen has to mean "12 more if you click this", not "12 in the
 * whole catalogue". Meilisearch counts them against the same filtered set, which
 * is the behaviour that makes a facet list worth showing.
 */
@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name)

  constructor(
    private readonly prisma: PrismaService,
    @Inject(SEARCH_INDEX) private readonly index: SearchIndex,
    private readonly indexer: SearchIndexerService,
  ) {}

  async search(query: SearchQuery): Promise<SearchResponse> {
    const facets = await this.facetFields(query.categoryId ?? null)
    const request = toSearchRequest(query, facets)
    const answer = await this.index.search(request)

    // A search that found nothing may mean the index is empty rather than the
    // catalogue is (TASK-0038 F5b) — a restart leaves the engine blank. Asking
    // is cheap and guarded; rebuilding is not, and only happens when the index
    // really has nothing in it.
    if (answer.total === 0) void this.indexer.ensurePopulated()

    await this.log(query.q, answer.total)

    return {
      items: answer.hits.map(toHit),
      facets: stripFacetPrefix(answer.facets),
      total: answer.total,
      nextCursor: nextCursorFor(request, answer.total),
    }
  }

  /**
   * The filters one category offers.
   *
   * Ancestors included: an attribute declared on 여성 applies to every listing
   * under it, so a filter that only read the leaf would hide 색상 on every
   * screen (`attribute-inheritance.ts` is the same rule for the editor).
   */
  async filtersFor(categoryId: number): Promise<readonly SearchFilter[]> {
    const rows = await this.prisma.$queryRaw<
      readonly { key: string; label: string; type: string; options: string[]; depth: number }[]
    >`
      SELECT d."key", d."label", d."type"::text AS "type", d."options",
             length(a."path") AS "depth"
        FROM "Category" c
        JOIN "Category" a ON c."path" LIKE a."path" || '%'
        JOIN "AttributeDefinition" d ON d."categoryId" = a."id"
       WHERE c."id" = ${categoryId}
         AND d."deletedAt" IS NULL
         AND d."isFilterable"
       ORDER BY length(a."path") DESC, d."sortOrder" ASC, d."key" ASC
    `

    // Nearest ancestor wins, the same rule the editor resolves attributes by.
    const byKey = new Map<string, SearchFilter>()

    for (const row of rows) {
      if (byKey.has(row.key)) continue

      byKey.set(row.key, {
        key: row.key,
        label: row.label,
        type: row.type,
        options: row.options,
      })
    }

    return [...byKey.values()]
  }

  /**
   * Names that begin with what was typed (F3).
   *
   * Meilisearch prefix-matches the **last word** of a query on its own, so this
   * is an ordinary search whose answer is reduced to distinct names. A separate
   * suggestion index would be a second thing to keep in step with the first.
   */
  async suggest(term: string): Promise<readonly string[]> {
    if (term.trim() === '') return []

    const answer = await this.index.search({
      q: term,
      filter: 'inStock = true',
      sort: [],
      offset: 0,
      limit: SEARCH_SUGGEST_LIMIT * 4,
      facets: [],
    })

    const names = new Set<string>()

    for (const hit of answer.hits) {
      const name = typeof hit.name === 'string' ? hit.name : ''

      if (name !== '') names.add(name)
      if (names.size >= SEARCH_SUGGEST_LIMIT) break
    }

    return [...names]
  }

  /** Which fields to count, for the category being looked at. */
  private async facetFields(categoryId: number | null): Promise<readonly string[]> {
    if (categoryId === null) return BASE_FACETS

    const filters = await this.filtersFor(categoryId)

    return [...BASE_FACETS, ...filters.map((filter) => `${ATTRIBUTE_FACET_PREFIX}${filter.key}`)]
  }

  /**
   * Records the term, and never fails the search for it.
   *
   * A logging table that could break search would be a worse trade than not
   * having the data: the row is for a report nobody is waiting on, and the
   * search is what somebody is looking at.
   */
  private async log(term: string | undefined, resultCount: number): Promise<void> {
    const normalised = (term ?? '').trim().toLowerCase()

    if (normalised === '') return

    try {
      await this.prisma.searchLog.create({ data: { term: normalised, resultCount } })
    } catch (error) {
      this.logger.warn(`검색어를 기록하지 못했습니다: ${String(error)}`)
    }
  }
}

/** One engine hit, as the API answers it. */
function toHit(hit: Record<string, unknown>): SearchHit {
  return {
    id: String(hit.id),
    name: String(hit.name),
    brandName: String(hit.brandName),
    categoryId: Number(hit.categoryId),
    price: Number(hit.price),
    inStock: hit.inStock === true,
    thumbnailUrl: typeof hit.thumbnailUrl === 'string' ? hit.thumbnailUrl : null,
    ratingAvg: Number(hit.ratingAvg ?? 0),
    ratingCount: Number(hit.ratingCount ?? 0),
    salesCount: Number(hit.salesCount ?? 0),
  }
}

/**
 * `attr_material` → `material` on the way out.
 *
 * The prefix exists so a facet cannot collide with a document field; a screen
 * asked for `material` and should get `material` back, or every consumer would
 * have to know about a naming scheme that is this module's business.
 */
function stripFacetPrefix(
  facets: Readonly<Record<string, Readonly<Record<string, number>>>>,
): FacetCounts {
  return Object.fromEntries(
    Object.entries(facets).map(([field, counts]) => [
      field.startsWith(ATTRIBUTE_FACET_PREFIX) ? field.slice(ATTRIBUTE_FACET_PREFIX.length) : field,
      counts,
    ]),
  )
}
