import { z } from 'zod'

/**
 * The five roles an account can hold, mirroring the Prisma `Role` enum.
 *
 * They live here rather than being imported from the generated Prisma client
 * because the three front-ends need them too and must not depend on the API's
 * database layer. `apps/api/src/auth/role-parity.spec.ts` fails if the two lists
 * ever diverge.
 *
 * `DEMO_BUYER` and `DEMO_SELLER` do not exist: a demo buyer is a buyer whose
 * grants are already limited to their own rows, so a separate role would carry
 * no extra restriction (TASK-0105 4).
 */
export const roles = [
  'BUYER',
  'SELLER_OWNER',
  'ADMIN_OPERATOR',
  'ADMIN_SUPER',
  'DEMO_ADMIN',
] as const

export type Role = (typeof roles)[number]

export const roleSchema = z.enum(roles)

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (roles as readonly string[]).includes(value)
}
