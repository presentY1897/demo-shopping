import { Inject, Injectable, Logger } from '@nestjs/common'

import type { AppConfig } from '../config/app-config.js'
import { APP_CONFIG } from '../config/app-config.js'
import type { ProductDocument } from './search-document.js'
import { PRODUCTS_INDEX, PRODUCTS_PRIMARY_KEY } from './search-index-settings.js'

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
}

/** Meilisearch's own error body, as far as anything here cares. */
function messageOf(status: number, body: string): string {
  return `검색 엔진이 ${String(status)} 로 거절했습니다: ${body.slice(0, 300)}`
}

@Injectable()
export class MeilisearchIndex implements SearchIndex {
  private readonly logger = new Logger(MeilisearchIndex.name)

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async configure(settings: Record<string, unknown>): Promise<void> {
    await this.send('PATCH', `/indexes/${PRODUCTS_INDEX}/settings`, settings, {
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
      `/indexes/${PRODUCTS_INDEX}/documents?primaryKey=${PRODUCTS_PRIMARY_KEY}`,
      documents,
    )
  }

  async remove(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return

    await this.send('POST', `/indexes/${PRODUCTS_INDEX}/documents/delete-batch`, ids)
  }

  async size(): Promise<number | null> {
    try {
      const stats = await this.send('GET', `/indexes/${PRODUCTS_INDEX}/stats`, undefined)

      if (typeof stats === 'object' && stats !== null && 'numberOfDocuments' in stats) {
        return Number(stats.numberOfDocuments)
      }

      return 0
    } catch (error) {
      // An engine that cannot be reached has an *unknown* size, not an empty
      // one — answering 0 would make the auto-reindex fire against a healthy
      // index every time the network hiccups (R5).
      this.logger.warn(`인덱스 크기를 읽지 못했습니다: ${String(error)}`)

      return null
    }
  }

  async clear(): Promise<void> {
    await this.send('DELETE', `/indexes/${PRODUCTS_INDEX}/documents`, undefined)
  }

  private async ensureIndex(): Promise<void> {
    await this.request('POST', '/indexes', {
      uid: PRODUCTS_INDEX,
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

    if (!response.ok) throw new Error(messageOf(response.status, await response.text()))

    return response.json()
  }
}
