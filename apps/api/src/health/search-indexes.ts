/**
 * Injection token for the list of Meilisearch indexes the API expects to be
 * query-ready. The value is a plain array, so there is no class to key on.
 */
export const SEARCH_INDEXES = Symbol('SEARCH_INDEXES')

/**
 * Indexes that must hold documents before search is usable.
 *
 * **Empty on purpose today.** The catalogue is not indexed yet — TASK-0038 owns
 * the indexing pipeline and the index names that come with it. An empty list
 * makes {@link SearchHealthIndicator} skip the readiness probe entirely and keep
 * reporting engine liveness alone.
 *
 * Filling it in before the pipeline exists would report `degraded` forever,
 * which would make TASK-0009 F3 (`search: "ok"`) permanently unreachable and
 * turn a real signal into background noise. TASK-0038 adds `products` here and
 * the readiness check switches on with no other change (TASK-0101 4.7, R6).
 */
export const EXPECTED_SEARCH_INDEXES: readonly string[] = []
