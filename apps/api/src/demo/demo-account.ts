import type { Prisma } from '@prisma/client'
import type { Role } from '@shopping/shared'

/**
 * The one place in `apps/api` that writes the demo columns (TASK-0024 4.5).
 *
 * `auth/demo-containment.spec.ts` fixes the list of files allowed to name
 * `isDemo`, and TASK-0105 F8 says why: the demo restriction is meant to be one
 * value in the permission table — the `demo` scope — not a condition every
 * service remembers to write. That guard also says what the exception is, and
 * this is it: **a task that genuinely needs the flag adds its file in the same
 * commit.**
 *
 * So the flag is confined to a function whose whole job is the INSERT. Nothing
 * else in this module reads it — the rate limit counts `demoExpiresAt`, the
 * status endpoint answers with `demoExpiresAt`, and the browser never learns the
 * boolean exists.
 *
 * **The two columns go in together, and they have to.** `User_demo_expiry_check`
 * requires a demo account to carry an expiry and a real one not to, so there is
 * no intermediate row to create and fill in afterwards — the same shape
 * `GoogleAuthService.upsertUser` is in with `googleSub`, and for the same
 * constraint-shaped reason. `User_google_identity_check` is satisfied by the
 * flag itself: a demo account has never been to Google and owes no identity.
 */

export interface DemoAccountInput {
  readonly email: string
  readonly name: string
  /** When the sweep (TASK-0025) deletes this account and everything it made. */
  readonly expiresAt: Date
  readonly roles: readonly Role[]
  readonly now: Date
}

/**
 * Creates one demo account with its roles, inside the caller's transaction.
 *
 * The roles are written here rather than by the caller for the reason
 * `GoogleAuthService` gives for doing the same: an account row with no role is a
 * person who can sign in and do nothing, and nothing would ever repair it.
 */
export async function createDemoAccount(
  tx: Prisma.TransactionClient,
  input: DemoAccountInput,
): Promise<string> {
  const created = await tx.user.create({
    data: {
      // Never through Google, so no identity — which is exactly the case
      // `User_google_identity_check` exempts by looking at the flag below.
      googleSub: null,
      email: input.email,
      name: input.name,
      isDemo: true,
      demoExpiresAt: input.expiresAt,
      lastLoginAt: input.now,
      createdAt: input.now,
      updatedAt: input.now,
    },
    select: { id: true },
  })

  if (input.roles.length > 0) {
    await tx.userRole.createMany({
      data: input.roles.map((role) => ({ userId: created.id, role, grantedAt: input.now })),
      // The same idempotence `SellerService.grantOwnerRole` uses: a role granted
      // twice is a no-op, not a 500 out of `UserRole_userId_role_key`.
      skipDuplicates: true,
    })
  }

  return created.id
}
