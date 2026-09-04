import { Controller, Get, Query } from '@nestjs/common'
import type {
  SearchFiltersResponse,
  SearchQuery,
  SearchResponse,
  SearchSuggestResponse,
} from '@shopping/shared'
import {
  categoryIdSchema,
  searchQuerySchema,
  searchTermSchema,
  SEARCH_QUERY_MAX_LENGTH,
} from '@shopping/shared'

import { PublicEndpoint } from '../auth/public-endpoint.decorator.js'
import { parseInput } from '../common/parse-input.js'
import { SearchService } from './search.service.js'

/**
 * 검색 (TASK-0039).
 *
 * **Public, all three.** A storefront's search is the first thing a visitor
 * touches and there is nothing here that depends on who is asking — the index
 * holds only listings that are on sale, which is the same set for everybody.
 */
@Controller({ path: 'search', version: '1' })
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  @PublicEndpoint()
  async run(@Query() raw: Record<string, string>): Promise<SearchResponse> {
    return this.search.search(parseInput(searchQuerySchema, readQuery(raw), 'query'))
  }

  @Get('filters')
  @PublicEndpoint()
  async filters(@Query('categoryId') categoryId: string): Promise<SearchFiltersResponse> {
    const id = parseInput(categoryIdSchema, Number(categoryId), 'categoryId')

    return { filters: [...(await this.search.filtersFor(id))] }
  }

  @Get('suggest')
  @PublicEndpoint()
  async suggest(@Query('q') q: string | undefined): Promise<SearchSuggestResponse> {
    const term = parseInput(searchTermSchema, q ?? '', 'q')

    return { suggestions: [...(await this.search.suggest(term))] }
  }
}

/**
 * The query string, as `searchQuerySchema` expects it.
 *
 * Everything arrives as a string, and two shapes need turning back into what
 * they mean: `attr.fit=오버,루즈` is a key with several values, and `inStock=true`
 * is a boolean. Doing it here rather than in the schema keeps the schema a
 * description of the *contract* rather than of a transport.
 */
function readQuery(raw: Record<string, string>): Partial<SearchQuery> {
  const attributes: Record<string, string[]> = {}

  for (const [key, value] of Object.entries(raw)) {
    if (!key.startsWith('attr.')) continue

    const name = key.slice('attr.'.length)
    const values = value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry !== '')

    if (name !== '' && values.length > 0) attributes[name] = values
  }

  return {
    ...(raw.q === undefined ? {} : { q: raw.q.slice(0, SEARCH_QUERY_MAX_LENGTH) }),
    ...(raw.categoryId === undefined ? {} : { categoryId: Number(raw.categoryId) }),
    ...(raw.priceMin === undefined ? {} : { priceMin: Number(raw.priceMin) }),
    ...(raw.priceMax === undefined ? {} : { priceMax: Number(raw.priceMax) }),
    ...(raw.inStock === undefined ? {} : { inStock: raw.inStock === 'true' }),
    ...(raw.sort === undefined ? {} : { sort: raw.sort as SearchQuery['sort'] }),
    ...(raw.limit === undefined ? {} : { limit: Number(raw.limit) }),
    ...(raw.cursor === undefined ? {} : { cursor: raw.cursor }),
    ...(Object.keys(attributes).length === 0 ? {} : { attributes }),
  }
}
