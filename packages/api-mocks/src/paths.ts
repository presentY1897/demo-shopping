import { API_PATH_PREFIX } from '@shopping/shared'

/**
 * Request patterns the handlers match on.
 *
 * The host is a wildcard on purpose: shop, seller and admin each resolve their
 * own `NEXT_PUBLIC_API_URL`, and a handler pinned to one origin would silently
 * stop matching in the other two apps. The version prefix comes from
 * `@shopping/shared` so that `/api/v2` is a one line change here.
 */
/**
 * Where the mock's presigned uploads point.
 *
 * `.invalid` is reserved and unroutable (RFC 6761), so a PUT that escaped msw
 * would fail at the resolver rather than reach whatever is listening — the same
 * reasoning as the `api.test.invalid` base URL the vitest preset sets.
 */
export const MOCK_STORAGE_ORIGIN = 'https://storage.test.invalid'

/** The public read domain, which is a different deployment from the bucket. */
export const MOCK_STORAGE_PUBLIC_ORIGIN = 'https://cdn.test.invalid'

export const mockPaths = {
  health: `*${API_PATH_PREFIX}/health`,
  /**
   * `POST` to exchange the refresh cookie for an access token (TASK-0022).
   *
   * Every app calls it once on boot, so it is in `defaultHandlers` rather than
   * something a spec opts into — a screen that had to declare it would be a
   * screen whose sign-in state is decided by whoever remembered.
   */
  authRefresh: `*${API_PATH_PREFIX}/auth/refresh`,
  /** `POST` to end this app's session. The other two keep theirs (D-218). */
  authLogout: `*${API_PATH_PREFIX}/auth/logout`,
  userRoles: `*${API_PATH_PREFIX}/users/:userId/roles`,
  /** `GET` the tree, `POST` a new node. */
  categories: `*${API_PATH_PREFIX}/categories`,
  /** `PATCH` the fields a person types, `DELETE` to retire. */
  category: `*${API_PATH_PREFIX}/categories/:id`,
  categoryMove: `*${API_PATH_PREFIX}/categories/:id/move`,
  /**
   * Must be registered **before** {@link mockPaths.category}: msw takes the
   * first handler that matches, and `:id` would happily read `reorder` as one.
   */
  categoryReorder: `*${API_PATH_PREFIX}/categories/reorder`,
  /** `GET` the definitions that apply to a category, `POST` a new one. */
  attributes: `*${API_PATH_PREFIX}/attributes`,
  /** `PATCH` the editable fields, `DELETE` to retire. */
  attribute: `*${API_PATH_PREFIX}/attributes/:id`,
  /** `POST` a request for one presigned upload (TASK-0011). */
  uploadPresign: `*${API_PATH_PREFIX}/uploads/presign`,
  /**
   * The bucket itself — **not our API**.
   *
   * A presigned upload goes straight from the browser to object storage, so a
   * front-end spec that only mocked our own origin would let a real cross-origin
   * PUT out of the process. It is listed here so that `onUnhandledRequest:
   * 'error'` covers it like everything else.
   */
  storageObject: `${MOCK_STORAGE_ORIGIN}/*`,
} as const

export type MockPath = (typeof mockPaths)[keyof typeof mockPaths]

/**
 * The verbs the helpers can build a handler for.
 *
 * Named here rather than in `failures.ts` because both the failure helpers and
 * the waking helpers need it, and neither should have to import the other.
 */
export const mockMethods = ['get', 'post', 'patch', 'put', 'delete'] as const

export type MockMethod = (typeof mockMethods)[number]
