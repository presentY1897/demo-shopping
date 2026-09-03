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
} as const

export type MockPath = (typeof mockPaths)[keyof typeof mockPaths]
