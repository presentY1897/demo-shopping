import { PRODUCTS_INDEX } from '../search/search-index-settings.js'

/**
 * Injection token for the list of Meilisearch indexes the API expects to be
 * query-ready. The value is a plain array, so there is no class to key on.
 */
export const SEARCH_INDEXES = Symbol('SEARCH_INDEXES')

/**
 * Indexes that must hold documents before search is usable.
 *
 * **Empty until TASK-0119, and that emptiness was the bug.** With no expected
 * index the readiness loop is vacuous, so the probe reported engine liveness
 * alone and answered `search: "ok"` — while every query returned 500 against an
 * index that did not exist. A deployment with no catalogue looked exactly like a
 * healthy one, which is how it stayed that way (TASK-0119 4.4).
 *
 * TASK-0101 4.7 left it empty on purpose: the indexing pipeline did not exist
 * yet, and filling it in would have made TASK-0009 F3 (`search: "ok"`)
 * permanently unreachable. It handed the one line to TASK-0038 (R6). TASK-0038
 * shipped the pipeline and the line was never added; this is it.
 *
 * **The name comes from `PRODUCTS_INDEX` rather than a literal.** The probe has
 * to ask about the index this deployment actually reads — a second spelling here
 * would report `degraded` forever the day the index is renamed, and the report
 * would be wrong in the direction nobody checks.
 */
export const EXPECTED_SEARCH_INDEXES: readonly string[] = [PRODUCTS_INDEX]
