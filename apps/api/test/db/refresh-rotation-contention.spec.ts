import { randomUUID } from 'node:crypto'

import type { PoolClient } from 'pg'
import { describe, expect, it } from 'vitest'

import { barrier, concurrently, fulfilled } from '../support/concurrently.js'
import { useDatabase } from '../support/database.js'
import { createUser } from '../support/factories.js'

/**
 * Gate A7 for refresh rotation, and the negative control that says why the
 * conditional update is there.
 *
 * **What races.** Two tabs renew at the same moment with the same token. Both
 * read a row that is still live, both decide they are the one rotating it, and
 * both revoke it and issue a successor. Nothing here is a balance — what is at
 * stake is **whose revocation counts**, because the loser's `revokedAt`
 * overwrites the winner's and the grace window is measured from it
 * (`session.service.ts`).
 *
 * **What protects it.** `UPDATE … WHERE id = ? AND "revokedAt" IS NULL`. Only
 * one statement matches; the other affects zero rows and takes the retry path,
 * where the window is measured from the revocation that actually happened.
 *
 * **Why a barrier.** Both readers must see the row live before either writes,
 * or the second simply finds it revoked and the spec proves nothing —
 * QUALITY-GATES A7 calls that out by name.
 */

const db = useDatabase()

function aTokenHash(): string {
  return randomUUID().replace(/-/g, '').padEnd(64, '0')
}

async function seedLiveToken(): Promise<{ id: string; userId: string }> {
  const user = await createUser(db)
  const row = await db.one<{ id: string }>(
    `INSERT INTO "RefreshToken" ("id", "userId", app, "tokenHash", "expiresAt")
     VALUES ($1, $2, 'SHOP', $3, now() + interval '14 days')
     RETURNING "id"`,
    [randomUUID(), user.id, aTokenHash()],
  )

  return { id: row.id, userId: user.id }
}

/** The rotation exactly as the service issues it — conditional on still being live. */
async function rotateConditionally(
  connection: PoolClient,
  id: string,
  revokedAt: Date,
): Promise<number> {
  const { rowCount } = await connection.query(
    'UPDATE "RefreshToken" SET "revokedAt" = $2 WHERE "id" = $1 AND "revokedAt" IS NULL',
    [id, revokedAt],
  )

  return rowCount ?? 0
}

function revokedAtOf(id: string): Promise<Date | null> {
  return db
    .one<{ revokedAt: Date | null }>('SELECT "revokedAt" FROM "RefreshToken" WHERE "id" = $1', [id])
    .then((row) => row.revokedAt)
}

describe('A7 — 같은 refresh 토큰으로 동시 갱신', () => {
  it('조건부 갱신이라 한쪽만 회전에 성공한다', async () => {
    const { id } = await seedLiveToken()
    const gate = barrier(2)
    const instants = [new Date('2026-09-04T00:00:00.000Z'), new Date('2026-09-04T00:00:30.000Z')]

    const results = await concurrently(2, async (index) =>
      db.withConnection(async (connection) => {
        const { rows } = await connection.query<{ revokedAt: Date | null }>(
          'SELECT "revokedAt" FROM "RefreshToken" WHERE "id" = $1',
          [id],
        )
        expect(rows[0]?.revokedAt).toBeNull()
        await gate.arrive()

        return rotateConditionally(connection, id, instants[index] ?? instants[0]!)
      }),
    )

    const affected = fulfilled(results)

    // One statement matched, the other found nothing to update.
    expect(affected.filter((count) => count === 1)).toHaveLength(1)
    expect(affected.filter((count) => count === 0)).toHaveLength(1)
  })

  it('진 쪽이 이긴 쪽의 폐기 시각을 덮지 않는다', async () => {
    // The grace window is measured from this value. If the loser overwrote it,
    // every later attempt would restart the window and a replay could hold it
    // open indefinitely.
    const { id } = await seedLiveToken()
    const gate = barrier(2)
    const winner = new Date('2026-09-04T00:00:00.000Z')
    const loser = new Date('2026-09-04T00:05:00.000Z')

    await concurrently(2, async (index) =>
      db.withConnection(async (connection) => {
        await gate.arrive()
        return rotateConditionally(connection, id, index === 0 ? winner : loser)
      }),
    )

    const revokedAt = await revokedAtOf(id)

    expect(revokedAt).not.toBeNull()
    // Whichever went first, the value is one of the two — never the later one
    // written over the earlier.
    expect([winner.getTime(), loser.getTime()]).toContain(revokedAt?.getTime())

    // And a second, unconditional write would have changed it. This is the
    // assertion the negative control below makes fail.
    const again = await db.withConnection((connection) =>
      rotateConditionally(connection, id, new Date('2026-09-04T01:00:00.000Z')),
    )
    expect(again).toBe(0)
    expect((await revokedAtOf(id))?.getTime()).toBe(revokedAt?.getTime())
  })
})

/**
 * The negative control: the same rotation without the `revokedAt IS NULL` guard.
 *
 * Written as raw SQL against the **real** table, because the damage is not a
 * missing constraint — no constraint could state "only the first revocation
 * counts" — but a missing condition in the statement. If this ever stopped
 * reproducing, the test above would be proving that two writes happen to be
 * ordered rather than that the guard works.
 */
describe('A7 — 음성 대조군 (조건 없는 갱신)', () => {
  it('조건이 없으면 나중 것이 폐기 시각을 덮어쓴다', async () => {
    const { id } = await seedLiveToken()
    const first = new Date('2026-09-04T00:00:00.000Z')
    const second = new Date('2026-09-04T00:05:00.000Z')

    await db.withConnection((connection) =>
      connection.query('UPDATE "RefreshToken" SET "revokedAt" = $2 WHERE "id" = $1', [id, first]),
    )
    await db.withConnection((connection) =>
      connection.query('UPDATE "RefreshToken" SET "revokedAt" = $2 WHERE "id" = $1', [id, second]),
    )

    // Five minutes later than the revocation that actually happened. With a
    // ten-second grace window, a replay arriving now would be treated as a
    // retry — the session would survive its own theft detection.
    expect((await revokedAtOf(id))?.getTime()).toBe(second.getTime())
  })
})
