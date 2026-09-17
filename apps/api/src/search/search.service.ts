import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common'
import type {
  FacetCounts,
  SearchFilter,
  SearchHit,
  SearchQuery,
  SearchResponse,
} from '@shopping/shared'
import { classifyHangulQuery, hangulQueryFor, SEARCH_SUGGEST_LIMIT } from '@shopping/shared'

import { domainFailure } from '../common/domain-failure.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { ATTRIBUTE_FACET_PREFIX } from './search-document.js'
import type { SearchAnswer, SearchIndex } from './search-index.js'
import { SEARCH_INDEX, SearchEngineUnreachableError } from './search-index.js'
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
    const answer = await this.ask(request)

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

    /**
     * 검색어를 색인과 같은 모양으로 바꾼다 (TASK-0103 F1 · F2 · F4).
     *
     * 「코ㅌ」는 완성형 `코` 뒤에 호환 자모 `ㅌ` 라 「코트」와 한 글자도 겹치지
     * 않는다. 색인에 자모를 펴 둔 것과 **같은 함수**로 검색어도 펴야 둘이 만난다 —
     * 그래서 그 함수는 `packages/shared` 에 있다.
     *
     * 판별에 실패하면 완성형으로 보낸다 (R3). 자모 필드에 완성형을 던지면 아무것도
     * 안 나오지만, 이름 필드에 완성형을 던지는 것은 그냥 평소의 검색이다.
     */
    const kind = classifyHangulQuery(term)

    const answer = await this.ask({
      q: hangulQueryFor(term, kind),
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

  /**
   * Asks the engine, and answers 503 when it could not be reached (TASK-0143 4.1).
   *
   * **Only that one error, and only here.** The engine sleeps and restarts on a
   * schedule of its own, so "not reached" is a state a screen can wait out —
   * `SEARCH_UNAVAILABLE` is what lets it tell that from a fault and keep the
   * failure notice back. Anything the engine *said* (a key mismatch, a filter it
   * rejects) stays the 500 it was: waiting does not fix it, and calling it
   * temporary would have a storefront retrying a broken deployment forever.
   *
   * The indexer holds the same port and is deliberately not behind this — it
   * already swallows the raw error and tries again on its next tick.
   *
   * **No wake-up request goes out from here** (4.2). The query that just failed
   * is the request that reached the platform's gateway, and that is what starts
   * the engine; one more would only blur `SearchWarmupService`'s "exactly once".
   */
  private async ask(request: Parameters<SearchIndex['search']>[0]): Promise<SearchAnswer> {
    try {
      return await this.index.search(request)
    } catch (error) {
      if (!(error instanceof SearchEngineUnreachableError)) throw error

      // One line and no stack: while the engine is down every visitor's query
      // lands here, and the reason is the same sentence each time.
      this.logger.warn(error.message)

      throw new ServiceUnavailableException(
        domainFailure('SEARCH_UNAVAILABLE', '검색을 준비하고 있어요. 잠시 후 다시 시도해 주세요.'),
        { cause: error },
      )
    }
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
    sellerId: String(hit.sellerId),
    price: Number(hit.price),
    inStock: hit.inStock === true,
    thumbnailUrl: typeof hit.thumbnailUrl === 'string' ? hit.thumbnailUrl : null,
    ...(typeof hit.cardImageUrl === 'string' ? { cardImageUrl: hit.cardImageUrl } : {}),
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
