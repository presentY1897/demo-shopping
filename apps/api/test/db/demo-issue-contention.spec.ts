import { APP_ID_HEADER, DEMO_ISSUE_LIMIT } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import { DEMO_ISSUE_LOCK_CLASS } from '../../src/demo/demo-rate-limit.js'
import { useApiApp } from '../support/api-app.js'
import { concurrently, fulfilled } from '../support/concurrently.js'
import { useDatabase } from '../support/database.js'

/**
 * Gate A7 for demo issuing: the limit holds when the requests actually compete.
 *
 * Counting and then inserting is a read followed by a write. Ten requests that
 * happen to arrive one at a time will pass any implementation; ten that overlap
 * pass only if something serialises the decision, which is what the advisory
 * lock in `demo-rate-limit.ts` is for.
 *
 * **Two halves, because the first one alone can pass for the wrong reason.**
 * Firing ten requests proves the outcome; it does not prove the requests
 * overlapped. So the second half holds the lock from a connection of its own and
 * shows the API *waiting for it* in `pg_locks` — the arrangement `awaitBlocked`
 * exists for elsewhere (`docs/HANDOFF.md` 5장), applied to an advisory lock
 * rather than a row lock.
 */

const db = useDatabase()
const api = useApiApp({ database: db })

function issue(ip: string): Promise<Response> {
  return fetch(`${api.baseUrl}/api/v1/auth/demo`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [APP_ID_HEADER]: 'shop',
      'x-forwarded-for': ip,
    },
    body: JSON.stringify({ role: 'BUYER' }),
  })
}

/** Waits until some backend is queued behind this task's advisory lock class. */
async function awaitBlockedOnIssueLock(): Promise<void> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const [row] = await db.query<{ waiting: number }>(
      `SELECT count(*)::int AS waiting FROM pg_locks
        WHERE "locktype" = 'advisory' AND NOT "granted" AND "classid" = $1`,
      [DEMO_ISSUE_LOCK_CLASS],
    )

    if ((row?.waiting ?? 0) > 0) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }

  throw new Error('발급 요청이 어드바이저리 락을 기다리는 상태가 되지 않았습니다.')
}

describe('동시에 들어온 발급', () => {
  it('한 주소에서 겹쳐 들어와도 한도를 넘기지 못한다', async () => {
    const attempts = DEMO_ISSUE_LIMIT + 5
    const results = await concurrently(attempts, () => issue('198.51.100.10'))
    const statuses = fulfilled(results).map((response) => response.status)

    await Promise.all(fulfilled(results).map((response) => response.text()))

    expect(statuses.filter((status) => status === 200)).toHaveLength(DEMO_ISSUE_LIMIT)
    expect(statuses.filter((status) => status === 429)).toHaveLength(attempts - DEMO_ISSUE_LIMIT)

    // The rows are the real assertion: a limit that answered 429 while still
    // inserting would satisfy the statuses above and be worth nothing.
    const users = await db.query('SELECT 1 FROM "User"')
    const sessions = await db.query('SELECT 1 FROM "RefreshToken"')

    expect(users).toHaveLength(DEMO_ISSUE_LIMIT)
    expect(sessions).toHaveLength(DEMO_ISSUE_LIMIT)
  })

  it('같은 주소의 발급은 앞의 것이 커밋될 때까지 실제로 기다린다', async () => {
    await db.withConnection(async (holder) => {
      await holder.query('BEGIN')
      await holder.query('SELECT pg_advisory_xact_lock($1::int4, hashtext($2)::int4)', [
        DEMO_ISSUE_LOCK_CLASS,
        '198.51.100.11',
      ])

      // Caught at the moment it is created: a promise left un-awaited while the
      // test does something else becomes an unhandled rejection, which only
      // shows up under CI timing (`docs/HANDOFF.md` 5장).
      const blocked = issue('198.51.100.11').then(
        (response) => response,
        (error: unknown) => error,
      )

      await awaitBlockedOnIssueLock()

      // A different address takes a different key, so it must not be waiting on
      // anything — this is what makes the lock per-visitor rather than global.
      const other = await issue('198.51.100.12')

      expect(other.status).toBe(200)
      await other.text()

      await holder.query('ROLLBACK')

      const response = await blocked

      expect(response).toBeInstanceOf(Response)
      expect((response as Response).status).toBe(200)
      await (response as Response).text()
    })
  })
})
