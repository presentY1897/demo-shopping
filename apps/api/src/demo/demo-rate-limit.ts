import { DEMO_ISSUE_LIMIT, DEMO_ISSUE_WINDOW_SECONDS } from '@shopping/shared'

/**
 * How many accounts one address may be issued, and how that is counted
 * (TASK-0024 4.4).
 *
 * **There is no rate limiting library in this repository, and this does not add
 * one.** `@nestjs/throttler` keeps its counters in process memory, so a restart
 * clears the limit and a second instance doubles it; fixing that needs Redis,
 * which is infrastructure this project does not have. Both alternatives were
 * weighed in the task document, and the one chosen needs neither: the row that
 * proves an issue happened is a row this path already writes.
 *
 * ### What is counted
 *
 * **Accounts, not tokens.** A refresh token row is also written every fifteen
 * minutes by an ordinary renewal, so counting tokens would refuse a visitor who
 * left three tabs open and issued nothing.
 *
 * **The expiry column, not the boolean beside it.** `User_demo_expiry_check` makes
 * the two columns imply each other — the schema's own comment says the question
 * has one answer whichever column a query looks at — and reading the expiry is
 * what keeps the containment allow list down to `demo-account.ts` alone.
 *
 * ### Why a lock
 *
 * Counting and then inserting is a read followed by a write, and two requests
 * from one address can both read four and both insert. The lock is the same
 * device the category tree uses (D-201, `catalog/category-lock.ts`) and is taken
 * for the same reason: what must not interleave is a decision and the write it
 * was based on, and no row exists yet to lock instead.
 */

/** First half of the lock key. `0xDE0` reads as "de(mo)" in a lock dump. */
export const DEMO_ISSUE_LOCK_CLASS = 0xde0

/**
 * `pg_advisory_xact_lock`, not the session-scoped variant.
 *
 * COMMIT and ROLLBACK release it — including the rollback nobody wrote — so a
 * request that dies mid-flight cannot leave one address locked out forever.
 *
 * `hashtext` rather than a hash computed here: the second half of an advisory
 * key is an `int4`, and letting the database fold the string means the key is a
 * property of the address rather than of this process's hash function.
 */
export const DEMO_ISSUE_LOCK_SQL = 'SELECT pg_advisory_xact_lock($1::int4, hashtext($2)::int4)'

/**
 * Demo accounts issued to one address inside the window.
 *
 * The `EXISTS` is what ties an account to an address: `User` has no address
 * column and this task adds no migration, so the join is through the session the
 * issue created — which is written in the same transaction precisely so that a
 * concurrent counter can see it (TASK-0024 4.3).
 */
export const DEMO_ISSUE_COUNT_SQL = `
  SELECT count(*)::int AS issued
    FROM "User" u
   WHERE u."demoExpiresAt" IS NOT NULL
     AND u."createdAt" > $1
     AND EXISTS (
           SELECT 1 FROM "RefreshToken" t
            WHERE t."userId" = u."id" AND t."ipAddress" = $2
         )`

/**
 * The bucket a request with no usable address falls into.
 *
 * Everything unaddressable shares one limit, which is the safer mistake: giving
 * such requests *no* limit would leave the whole defence behind a missing
 * header.
 */
export const UNKNOWN_ADDRESS = 'unknown'

export function issueAddress(address: string | undefined): string {
  const trimmed = address?.trim() ?? ''

  return trimmed === '' ? UNKNOWN_ADDRESS : trimmed
}

/** The oldest issue that still counts against the limit. */
export function windowStart(now: Date): Date {
  return new Date(now.getTime() - DEMO_ISSUE_WINDOW_SECONDS * 1000)
}

/** Whether one more issue is allowed, given how many the window already holds. */
export function withinLimit(issued: number): boolean {
  return issued < DEMO_ISSUE_LIMIT
}
