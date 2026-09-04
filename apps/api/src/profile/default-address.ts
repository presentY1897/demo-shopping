/**
 * Which address is the default, as a decision with no I/O (TASK-0111 4장).
 *
 * `Address_userId_default_key` — a partial unique index `WHERE "isDefault"` —
 * states half of the invariant: there can never be **two** defaults, and it
 * states that to the database so two concurrent requests cannot both believe
 * they read zero (`erd.md` 1장). The other half is not something an index can
 * say: **while an account has any address at all, one of them has to be the
 * default.** Nothing enforces that, so it is decided here.
 *
 * It lives in its own module, and is held to 순수 로직's 분기 100% (QUALITY-GATES
 * Q5), because both of its rules fail silently. An account whose default was
 * deleted and never replaced has an address book that looks perfectly normal;
 * what breaks is checkout (M07), months later, on the one account it happened
 * to. And a branch nothing reaches here is a rule nothing checks.
 */

/** Just enough of a stored address for these rules to decide. */
export interface AddressPosition {
  readonly id: string
  readonly createdAt: Date
}

/**
 * Whether a newly saved address becomes the default.
 *
 * The caller's `isDefault` is a request, not a statement of fact: the **first**
 * address becomes the default whatever the request says. Leaving it up to the
 * client would let a form that simply never sends the flag produce an account
 * with addresses and no default — the exact state the index cannot forbid and
 * checkout cannot handle.
 */
export function defaultOnCreate(requested: boolean, existingCount: number): boolean {
  return requested || existingCount === 0
}

/**
 * Which of the remaining addresses is promoted when the default is deleted.
 *
 * **The most recently saved one**, and `null` when nothing remains — deleting
 * the last address leaves an empty book, where "exactly one default" is
 * vacuously "at most one".
 *
 * "The next one" was the whole of the original instruction (TASK-0111 R3), and
 * an unstated order is one that differs between the service, the screen and
 * whoever reads the table later. Newest first is also what the address book
 * shows below the default, so the row that moves to the top is the row that was
 * already there.
 *
 * Ties are broken by id rather than left to the database's row order. Ids are
 * UUIDv7, so the larger one really was created later inside the same
 * millisecond — the tie-break is the same rule as the comparison it settles,
 * not an arbitrary one.
 */
export function promotedAfterDelete(remaining: readonly AddressPosition[]): string | null {
  let winner: AddressPosition | null = null

  for (const candidate of remaining) {
    if (winner === null || isNewer(candidate, winner)) winner = candidate
  }

  return winner?.id ?? null
}

function isNewer(candidate: AddressPosition, incumbent: AddressPosition): boolean {
  const difference = candidate.createdAt.getTime() - incumbent.createdAt.getTime()

  if (difference !== 0) return difference > 0

  return candidate.id > incumbent.id
}
