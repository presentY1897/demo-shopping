import { http, HttpResponse } from 'msw'

import { userRolesBuyer } from '../fixtures/user-roles'
import { mockPaths } from '../paths'

/** `GET /api/v1/users/:userId/roles` — the roles of a plain shopper. */
export const userRolesHandlers = [
  http.get(mockPaths.userRoles, () => HttpResponse.json(userRolesBuyer)),
]
