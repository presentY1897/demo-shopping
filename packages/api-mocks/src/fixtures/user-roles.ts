import { userRolesResponseSchema } from '@shopping/shared'

import { defineFixture } from '../define'

/** UUIDv7, the id format every account row uses. */
const USER_ID = '019596d0-1f1c-7c2e-9a0e-4a5a3a2f0001'

/** What `GET /api/v1/users/:userId/roles` answers for a plain shopper. */
export const userRolesBuyer = defineFixture(userRolesResponseSchema, {
  userId: USER_ID,
  roles: ['BUYER'],
})

/** The same account after `POST .../roles` granted a seller role. */
export const userRolesSeller = defineFixture(userRolesResponseSchema, {
  userId: USER_ID,
  roles: ['BUYER', 'SELLER_OWNER'],
})
