import type { IncomingMessage } from 'node:http'

import { Injectable } from '@nestjs/common'
import type { Role } from '@shopping/shared'
import { isRole } from '@shopping/shared'

import type { PrincipalResolver } from '../../src/auth/principal-resolver.js'
import type { RequestPrincipal } from '../../src/auth/request-principal.js'

/**
 * Who an integration test is calling as.
 *
 * Authentication does not exist yet (TASK-0021/0022): the application binds
 * `AnonymousPrincipalResolver`, so every guarded endpoint answers 401 and gate
 * A3 — "권한 없는 역할로 호출하면 403" — could not be verified at all. This
 * resolver occupies the same seam the JWT one will, reading the caller from a
 * header instead of a token, and nothing else in the application changes.
 *
 * It is the harness half of what `src/auth/authorization.integration.spec.ts`
 * does with a fixture controller; lifting it here means every M05 spec can call
 * a real endpoint as a real role instead of building its own module.
 */
export const TEST_USER_HEADER = 'x-test-user'
export const TEST_ROLES_HEADER = 'x-test-roles'
export const TEST_SELLER_HEADER = 'x-test-seller'

export interface TestCaller {
  readonly userId: string
  readonly roles: readonly Role[]
  /** The store this caller owns, for `own`-scoped seller permissions. */
  readonly sellerId?: string
}

function headerOf(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name]

  return Array.isArray(value) ? value[0] : value
}

@Injectable()
export class HeaderPrincipalResolver implements PrincipalResolver {
  resolve(request: IncomingMessage): Promise<RequestPrincipal | null> {
    const userId = headerOf(request, TEST_USER_HEADER)

    // No header at all means an anonymous caller, exactly as a missing token
    // will: that is what keeps A4 (401) testable through the same harness.
    if (userId === undefined) return Promise.resolve(null)

    return Promise.resolve({
      userId,
      roles: (headerOf(request, TEST_ROLES_HEADER) ?? '').split(',').filter(isRole),
      sellerId: headerOf(request, TEST_SELLER_HEADER) ?? null,
      app: 'admin',
    })
  }
}

/** Headers that make a request arrive as `caller`. */
export function callerHeaders(caller: TestCaller): Record<string, string> {
  return {
    [TEST_USER_HEADER]: caller.userId,
    [TEST_ROLES_HEADER]: caller.roles.join(','),
    ...(caller.sellerId === undefined ? {} : { [TEST_SELLER_HEADER]: caller.sellerId }),
  }
}

/**
 * The five roles, with ids fixed per role.
 *
 * Fixed because nothing in these specs looks the caller up in the database —
 * the ids only have to be distinguishable UUIDs — and a stable value makes a
 * failure message say which role was calling.
 */
export const callers = {
  buyer: { userId: '0192f0c1-0000-7000-8000-0000000c0001', roles: ['BUYER'] },
  seller: {
    userId: '0192f0c1-0000-7000-8000-0000000c0002',
    roles: ['SELLER_OWNER'],
    sellerId: 'store-1',
  },
  operator: { userId: '0192f0c1-0000-7000-8000-0000000c0003', roles: ['ADMIN_OPERATOR'] },
  superAdmin: { userId: '0192f0c1-0000-7000-8000-0000000c0004', roles: ['ADMIN_SUPER'] },
  demoAdmin: { userId: '0192f0c1-0000-7000-8000-0000000c0005', roles: ['DEMO_ADMIN'] },
} satisfies Record<string, TestCaller>
