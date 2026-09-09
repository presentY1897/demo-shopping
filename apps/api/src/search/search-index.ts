import { Inject, Injectable, Logger } from '@nestjs/common'

import type { AppConfig } from '../config/app-config.js'
import { APP_CONFIG } from '../config/app-config.js'
import type { ProductDocument } from './search-document.js'
import { PRODUCTS_PRIMARY_KEY } from './search-index-settings.js'

/**
 * The search engine, behind an interface (TASK-0038 8장).
 *
 * **A port, for the reason `ObjectStorage` is one.** The worker's retry
 * behaviour, the document mapper and the "index is empty, rebuild it" path all
 * have to be testable **without a running Meilisearch**, and F4 asks explicitly
 * what happens when the engine is down — a question a live engine cannot be
 * asked reliably. A double behind this interface answers all of it.
 *
 * **Written against the REST API rather than the official client.** The health
 * indicator already talks to Meilisearch with `fetch`, and this repository
 * hand-wrote AWS SigV4 rather than take `@aws-sdk`. Against that, four HTTP
 * calls are not a dependency's worth of surface — and the client would still
 * need this interface on top of it.
 */
export const SEARCH_INDEX = Symbol('SEARCH_INDEX')

/** What the engine answers one search with. */
export interface SearchAnswer {
  readonly hits: readonly Record<string, unknown>[]
  readonly total: number
  readonly facets: Readonly<Record<string, Readonly<Record<string, number>>>>
}

export interface SearchIndex {
  /** Applies the index settings. Idempotent — Meilisearch diffs them itself. */
  configure: (settings: Record<string, unknown>) => Promise<void>
  /** Adds or replaces documents, keyed by `id`. */
  upsert: (documents: readonly ProductDocument[]) => Promise<void>
  /** Removes documents by id. Missing ids are not an error. */
  remove: (ids: readonly string[]) => Promise<void>
  /** How many documents the index holds. `null` when the engine cannot answer. */
  size: () => Promise<number | null>
  /** Empties the index without dropping its settings. */
  clear: () => Promise<void>
  /** Runs one query. */
  search: (request: {
    readonly q: string
    readonly filter: string | null
    readonly sort: readonly string[]
    readonly offset: number
    readonly limit: number
    readonly facets: readonly string[]
  }) => Promise<SearchAnswer>
}

/** Meilisearch's code for a query aimed at an index that does not exist. */
const INDEX_NOT_FOUND = 'index_not_found'

/** An absent index and an empty one hold the same number of documents: none. */
const EMPTY_ANSWER: SearchAnswer = { hits: [], total: 0, facets: {} }

/**
 * A refusal from the engine, carrying the engine's own error code.
 *
 * **The code is the part that matters**, because the status cannot tell the
 * cases apart: Meilisearch answers 404 both for `index_not_found` and for a
 * mistyped route, and 403 for a key mismatch. Treating every 404 as "no index
 * yet" would turn a wrong host or a bad path into a silent empty page — the
 * same failure this task exists to remove, one layer down (TASK-0119 4.3 · F2).
 */
export class SearchEngineError extends Error {
  constructor(
    readonly status: number,
    /** Meilisearch's `code` field, or `null` when the body carries none. */
    readonly code: string | null,
    body: string,
  ) {
    super(`검색 엔진이 ${String(status)} 로 거절했습니다: ${body.slice(0, 300)}`)
    this.name = 'SearchEngineError'
  }
}

/**
 * Meilisearch answers every error as JSON with a stable `code`. Anything in
 * front of it — a proxy, a platform error page — answers HTML, and HTML has no
 * code to read. A body without a code is never `index_not_found`.
 */
function codeOf(body: string): string | null {
  try {
    const parsed: unknown = JSON.parse(body)

    if (typeof parsed !== 'object' || parsed === null || !('code' in parsed)) return null

    const code: unknown = (parsed as { readonly code: unknown }).code

    return typeof code === 'string' ? code : null
  } catch {
    return null
  }
}

@Injectable()
export class MeilisearchIndex implements SearchIndex {
  private readonly logger = new Logger(MeilisearchIndex.name)

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  /** The index this deployment reads and writes. One value in production. */
  private get index(): string {
    return this.config.search.productsIndex
  }

  async configure(settings: Record<string, unknown>): Promise<void> {
    await this.send('PATCH', `/indexes/${this.index}/settings`, settings, {
      // The index may not exist on a cold engine. Creating it first is one more
      // round trip that Meilisearch does for us on any write, so the settings
      // call is preceded by the cheapest write there is.
      ensureIndex: true,
    })
  }

  async upsert(documents: readonly ProductDocument[]): Promise<void> {
    if (documents.length === 0) return

    await this.send(
      'PUT',
      `/indexes/${this.index}/documents?primaryKey=${PRODUCTS_PRIMARY_KEY}`,
      documents,
    )
  }

  async remove(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return

    await this.send('POST', `/indexes/${this.index}/documents/delete-batch`, ids)
  }

  async size(): Promise<number | null> {
    try {
      const stats = await this.send('GET', `/indexes/${this.index}/stats`, undefined)

      if (typeof stats === 'object' && stats !== null && 'numberOfDocuments' in stats) {
        return Number(stats.numberOfDocuments)
      }

      return 0
    } catch (error) {
      // An index that does not exist holds nothing, and saying so is what lets
      // the indexer rebuild it: `ensurePopulated` treats `null` as "unknown" and
      // declines to act on it, so answering `null` here left a restarted engine
      // with no index and no path back to one (TASK-0119 4.7).
      if (error instanceof SearchEngineError && error.code === INDEX_NOT_FOUND) return 0

      // An engine that cannot be reached has an *unknown* size, not an empty
      // one — answering 0 would make the auto-reindex fire against a healthy
      // index every time the network hiccups (R5). That distinction is the whole
      // reason the branch above reads the engine's code and not the status.
      this.logger.warn(`인덱스 크기를 읽지 못했습니다: ${String(error)}`)

      return null
    }
  }

  async clear(): Promise<void> {
    await this.send('DELETE', `/indexes/${this.index}/documents`, undefined)
  }

  async search(request: {
    readonly q: string
    readonly filter: string | null
    readonly sort: readonly string[]
    readonly offset: number
    readonly limit: number
    readonly facets: readonly string[]
  }): Promise<SearchAnswer> {
    try {
      const body = await this.send('POST', `/indexes/${this.index}/search`, {
        q: request.q,
        offset: request.offset,
        limit: request.limit,
        ...(request.filter === null ? {} : { filter: request.filter }),
        ...(request.sort.length === 0 ? {} : { sort: [...request.sort] }),
        ...(request.facets.length === 0 ? {} : { facets: [...request.facets] }),
      })

      return readAnswer(body)
    } catch (error) {
      // The free-plan engine has no persistent disk, so a restart leaves no
      // index behind (TASK-0009) and the indexer refills it. A query that lands
      // in that window is looking at a catalogue that holds nothing yet — an
      // empty page, not a fault. 500 takes the whole screen down for it.
      if (error instanceof SearchEngineError && error.code === INDEX_NOT_FOUND) {
        this.logger.warn(`색인 '${this.index}' 이 아직 없어 빈 결과를 돌려줍니다.`)

        return EMPTY_ANSWER
      }

      throw error
    }
  }

  private async ensureIndex(): Promise<void> {
    await this.request('POST', '/indexes', {
      uid: this.index,
      primaryKey: PRODUCTS_PRIMARY_KEY,
    }).catch(() => {
      // Already there. Meilisearch answers 409 and there is nothing to do.
    })
  }

  private async send(
    method: string,
    path: string,
    body: unknown,
    options: { readonly ensureIndex?: boolean } = {},
  ): Promise<unknown> {
    if (options.ensureIndex === true) await this.ensureIndex()

    return this.request(method, path, body)
  }

  private async request(method: string, path: string, body: unknown): Promise<unknown> {
    const base = this.config.search.host.replace(/\/+$/, '')
    const response = await fetch(`${base}${path}`, {
      method,
      // Without a deadline a hung engine holds the worker's tick open until
      // something else times out, and the queue stops moving with no error to
      // point at.
      signal: AbortSignal.timeout(this.config.search.timeoutMs),
      headers: {
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(this.config.search.masterKey === ''
          ? {}
          : { authorization: `Bearer ${this.config.search.masterKey}` }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })

    if (!response.ok) {
      const body = await response.text()

      throw new SearchEngineError(response.status, codeOf(body), body)
    }

    return response.json()
  }
}

/** Reads the parts of Meilisearch's answer this API uses, defensively. */
function readAnswer(body: unknown): SearchAnswer {
  if (typeof body !== 'object' || body === null) return { hits: [], total: 0, facets: {} }

  const record = body as Record<string, unknown>
  const hits = Array.isArray(record.hits) ? (record.hits as Record<string, unknown>[]) : []
  // `estimatedTotalHits` is what a plain search answers; `totalHits` appears when
  // exhaustive counting is on. Whichever came, the caller wants a number.
  const total = Number(record.totalHits ?? record.estimatedTotalHits ?? hits.length)
  const facets =
    typeof record.facetDistribution === 'object' && record.facetDistribution !== null
      ? (record.facetDistribution as Readonly<Record<string, Readonly<Record<string, number>>>>)
      : {}

  return { hits, total: Number.isFinite(total) ? total : hits.length, facets }
}
