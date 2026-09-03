import { z } from 'zod'

import { roleSchema } from '../auth/roles.js'

/** Body of `POST /api/v1/admin/users/:userId/roles`. */
export const grantRoleRequestSchema = z.object({
  role: roleSchema,
})

export type GrantRoleRequest = z.infer<typeof grantRoleRequestSchema>

/**
 * What every role endpoint answers with: the account's roles after the call.
 *
 * Returning the whole set rather than the one that changed means a console can
 * render the result without a second request, and makes granting a role the
 * caller already has visibly a no-op instead of a duplicate row.
 */
export const userRolesResponseSchema = z.object({
  userId: z.uuid(),
  roles: z.array(roleSchema),
})

export type UserRolesResponse = z.infer<typeof userRolesResponseSchema>
