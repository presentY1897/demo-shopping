import { API_PATH_PREFIX } from '@shopping/shared'

/**
 * Request patterns the handlers match on.
 *
 * The host is a wildcard on purpose: shop, seller and admin each resolve their
 * own `NEXT_PUBLIC_API_URL`, and a handler pinned to one origin would silently
 * stop matching in the other two apps. The version prefix comes from
 * `@shopping/shared` so that `/api/v2` is a one line change here.
 */
export const mockPaths = {
  health: `*${API_PATH_PREFIX}/health`,
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
