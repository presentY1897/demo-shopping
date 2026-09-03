import { Injectable } from '@nestjs/common'

import type { PrincipalResolver } from './principal-resolver.js'

/**
 * The resolver until authentication exists: every request is anonymous.
 *
 * With it in place the API is deny-by-default in the strongest sense — every
 * endpoint that declares a permission answers 401, and every endpoint that
 * declares nothing answers 403. TASK-0022 replaces this provider with one that
 * verifies the access token and fills in the principal; no other file changes.
 */
@Injectable()
export class AnonymousPrincipalResolver implements PrincipalResolver {
  resolve(): Promise<null> {
    return Promise.resolve(null)
  }
}
