import { randomUUID } from 'node:crypto'

import type { PoolClient } from 'pg'
import { beforeAll, describe, expect, it } from 'vitest'

import { barrier, concurrently, fulfilled, rejected } from '../support/concurrently.js'
import { useDatabase } from '../support/database.js'

/**
 * Gate A7 for the Google identity, and the negative control that says why the
 * index is what does the work.
 *
 * **What races.** Two callbacks for the same brand-new Google account. Each
 * looks for a live `User` with that `googleSub`, each finds nothing, and each
 * inserts. Nothing here is a balance or a stock level — what is at stake is
 * **idempotency**: one Google identity has to mean one account, and the first
 * sign-in is the only moment that can be violated.
 *
 * **Why an index rather than a lock.** There is no row to lock — the row is what
 * is being created. `User_googleSub_active_key` is a *partial* unique index
 * (`WHERE "deletedAt" IS NULL`), which lets a withdrawn account release its
 * identity so the same person can sign up again (`erd.md` 2장) while still
 * refusing a second live one.
 *
 * **Why the interleaving is arranged and not hoped for.** Both readers must see
 * "no such user" before either writes; otherwise the second one simply finds the
 * first one's row and the spec proves nothing. {@link barrier} pins that down —
 * the assertion "only one account exists" is worthless when the two calls never
 * actually overlapped (QUALITY-GATES A7).
 *
 * `GoogleAuthService` is what recovers from the losing insert; that half is
 * proved over HTTP in `test/api/google-auth.integration.spec.ts` (F7). This file
 * proves the thing that recovery depends on.
 */

const db = useDatabase()

/** Postgres unique violation. */
const UNIQUE_VIOLATION = '23505'

function aSub(): string {
  return `sub-${randomUUID()}`
}

/** The read the service does before it decides to create anything. */
async function findLive(connection: PoolClient, sub: string): Promise<string | null> {
  const { rows } = await connection.query<{ id: string }>(
    'SELECT "id" FROM "User" WHERE "googleSub" = $1 AND "deletedAt" IS NULL',
    [sub],
  )

  return rows[0]?.id ?? null
}

async function insertUser(connection: PoolClient, sub: string): Promise<string> {
  const { rows } = await connection.query<{ id: string }>(
    `INSERT INTO "User" ("id", "googleSub", "email", "name", "updatedAt")
     VALUES ($1, $2, $3, '테스트 사용자', now())
     RETURNING "id"`,
    [randomUUID(), sub, `${sub}@example.com`],
  )

  return rows[0]?.id ?? ''
}

function liveCount(sub: string): Promise<number> {
  return db
    .one<{ count: number }>(
      'SELECT count(*)::int AS count FROM "User" WHERE "googleSub" = $1 AND "deletedAt" IS NULL',
      [sub],
    )
    .then((row) => row.count)
}

describe('A7 — 같은 Google 신원으로 동시 최초 로그인', () => {
  it('둘이 동시에 만들면 하나만 남고 나머지는 23505 로 거절된다', async () => {
    const sub = aSub()
    const gate = barrier(2)

    const results = await concurrently(2, async () =>
      db.withConnection(async (connection) => {
        // Everyone reads first…
        expect(await findLive(connection, sub)).toBeNull()
        // …and nobody writes until both have read.
        await gate.arrive()

        return insertUser(connection, sub)
      }),
    )

    expect(fulfilled(results)).toHaveLength(1)
    expect(rejected(results)).toHaveLength(1)
    expect((rejected(results)[0] as { code?: string }).code).toBe(UNIQUE_VIOLATION)
    expect(await liveCount(sub)).toBe(1)
  })

  it('다섯이 동시에 와도 하나만 남는다', async () => {
    const sub = aSub()
    const gate = barrier(5)

    const results = await concurrently(5, async () =>
      db.withConnection(async (connection) => {
        expect(await findLive(connection, sub)).toBeNull()
        await gate.arrive()

        return insertUser(connection, sub)
      }),
    )

    expect(fulfilled(results)).toHaveLength(1)
    expect(await liveCount(sub)).toBe(1)
  })

  it('탈퇴한 계정은 신원을 붙잡지 않는다', async () => {
    // The reason the index is partial. A plain unique constraint would let a
    // withdrawn row hold a Google account hostage forever, and the person could
    // never sign up again (`erd.md` 2장).
    const sub = aSub()

    const first = await db.withConnection((connection) => insertUser(connection, sub))
    await db.query('UPDATE "User" SET "deletedAt" = now() WHERE "id" = $1', [first])

    await expect(db.withConnection((connection) => insertUser(connection, sub))).resolves.toEqual(
      expect.any(String),
    )
    expect(await liveCount(sub)).toBe(1)
  })
})

/**
 * The negative control: the same choreography with no partial unique index.
 *
 * A scratch table rather than the shipped one, for the reason TASK-0028 needed
 * one — the damage here *is* the missing constraint, so it cannot be reproduced
 * on a table that has it. What this shows is that check-then-insert, which is
 * what the service does on the happy path, is not by itself a defence: both
 * writers pass their check and both rows land.
 *
 * If this control ever went green, the positive case above would be proving
 * nothing about the index and everything about two calls that failed to overlap.
 */
describe('A7 — 음성 대조군 (부분 유니크 인덱스 없음)', () => {
  beforeAll(async () => {
    await db.query('DROP TABLE IF EXISTS "unindexed_identity"')
    await db.query(
      `CREATE TABLE "unindexed_identity" (
         "id" uuid PRIMARY KEY,
         "googleSub" text NOT NULL,
         "deletedAt" timestamp(3)
       )`,
    )
  })

  it('확인 후 생성만으로는 한 사람에게 계정이 둘 생긴다', async () => {
    const sub = aSub()
    const gate = barrier(2)

    const results = await concurrently(2, async () =>
      db.withConnection(async (connection) => {
        const { rows } = await connection.query(
          'SELECT "id" FROM "unindexed_identity" WHERE "googleSub" = $1 AND "deletedAt" IS NULL',
          [sub],
        )
        expect(rows).toHaveLength(0)
        await gate.arrive()

        await connection.query(
          'INSERT INTO "unindexed_identity" ("id", "googleSub") VALUES ($1, $2)',
          [randomUUID(), sub],
        )
      }),
    )

    expect(rejected(results)).toHaveLength(0)

    const { count } = await db.one<{ count: number }>(
      'SELECT count(*)::int AS count FROM "unindexed_identity" WHERE "googleSub" = $1',
      [sub],
    )
    // Two accounts, one person. The second one owns an empty order history and
    // nothing will ever notice.
    expect(count).toBe(2)
  })
})
