/**
 * The advisory lock that serialises every structural change to the tree.
 *
 * DECISIONS 4 assigns tree moves an advisory lock rather than optimistic
 * locking or row locks, and the reason is the shape of the operation: a move
 * reads two nodes and a subtree, decides from them whether the result is legal,
 * and then rewrites a range of rows. Row locks would only cover the rows a
 * transaction happens to touch, and the rows it must *not* find — a new child
 * appearing under the node being moved — are exactly the ones it never locks.
 *
 * One lock for the whole tree, not one per node. A move relates two subtrees
 * that can be anywhere, so a per-node lock would have to be taken in a
 * deadlock-free global order and would still miss nodes created mid-flight.
 * Moves are rare by nature (TASK-0028 4장), so the contention this costs is
 * theoretical while the correctness it buys is not.
 *
 * `pg_advisory_xact_lock` and not the session-scoped variant: the lock is then
 * released by COMMIT or ROLLBACK, including the rollback nobody wrote — a
 * crashed request cannot leave the category tree locked for the next deploy.
 */

/** First half of the lock key. `0xCA7` reads as "cat(alogue)" in a lock dump. */
export const CATEGORY_TREE_LOCK_CLASS = 0xca7

/** Second half. Reserved for a future per-tree split; there is one tree today. */
export const CATEGORY_TREE_LOCK_KEY = 0

/**
 * The isolation level matters here and is deliberately the default.
 *
 * Under `READ COMMITTED` every statement takes a fresh snapshot, so the reads
 * that follow the lock acquisition see whatever the previous holder committed.
 * Under `REPEATABLE READ` the snapshot would be taken by the *locking*
 * statement itself — before the wait — and the transaction would go on to
 * validate its move against a tree that no longer exists.
 */
export const CATEGORY_TREE_LOCK_SQL = 'SELECT pg_advisory_xact_lock($1::int4, $2::int4)'
