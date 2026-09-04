import type { RequestHandler } from 'msw'

import { attributeHandlers } from './attributes'
import { categoryHandlers } from './categories'
import { healthHandlers } from './health'
import { uploadHandlers } from './uploads'
import { userRolesHandlers } from './user-roles'

/**
 * What every front-end test starts from: the success answer for each endpoint
 * we mock.
 *
 * Anything else — a 500, an unreachable API, a stale payload — is declared by
 * the one spec that wants it via `server.use(...)`, so a test that says nothing
 * about failures is a test of the happy path and cannot become one by accident.
 */
export const defaultHandlers: readonly RequestHandler[] = [
  ...healthHandlers,
  ...userRolesHandlers,
  ...categoryHandlers,
  ...attributeHandlers,
  ...uploadHandlers,
]

export { attributeHandlers, resetAttributeStore } from './attributes'
export { categoryHandlers, categoryRowsSnapshot, resetCategoryStore } from './categories'
export { resetUploadStore, uploadHandlers } from './uploads'
export { healthHandlers, userRolesHandlers }
