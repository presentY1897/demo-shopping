import { randomUUID } from 'node:crypto'

import type { SellerApplicationRequest, SellerResponse, SellerStatus } from '@shopping/shared'
import {
  ApiClientError,
  brandNameAvailabilityResponseSchema,
  sellerResponseSchema,
} from '@shopping/shared'
import type { PoolClient } from 'pg'
import { beforeAll, describe, expect, it } from 'vitest'

import { useApiApp } from '../support/api-app.js'
import { barrier, concurrently, fulfilled, rejected } from '../support/concurrently.js'
import { useDatabase } from '../support/database.js'
import { createUser } from '../support/factories.js'
import type { TestCaller } from '../support/principal.js'
import { callers } from '../support/principal.js'

/**
 * Gate A7 for onboarding, and the negative controls that say why each defence
 * is the one doing the work.
 *
 * **Three things race here, and they are refused by three different mechanisms.**
 *
 * - *Two operators approving one application.* The row exists, so the defence is
 *   a conditional `UPDATE` carrying the `version` and the `status` the operator
 *   was looking at. What is at stake is idempotency and a role grant: a second
 *   transition would raise `version` twice for one decision and, worse, would
 *   make "승인은 한 번 일어났다" a statement nothing in the system supports.
 * - *Two people applying with one brand name.* There is no row to lock — the row
 *   is what is being created — so the defence is `Seller_brandName_key`. The
 *   availability endpoint cannot help: both callers legitimately read
 *   `available: true`.
 * - *Two saves of one store from the same version.* The defence is the
 *   optimistic lock, and what it protects is not the database's consistency but
 *   the seller's work — last-write-wins would silently discard one of the two
 *   edits (DECISIONS 4).
 *
 * **Why the interleaving is arranged and not hoped for.** Every scenario below
 * pins the overlap down, either with {@link barrier} or by awaiting each step of
 * a two-connection choreography. "Only one succeeded" passes just as happily
 * when the two calls never overlapped, which is the worst kind of green.
 */

const db = useDatabase()
const api = useApiApp({ database: db, authenticate: true })

/** Postgres unique violation. */
const UNIQUE_VIOLATION = '23505'

/** Repeat count for every concurrent scenario. */
const ROUNDS = 10

let names = 0

function unique(prefix: string): string {
  names += 1
  return `${prefix}-${String(names)}-${String(process.env.VITEST_POOL_ID ?? '1')}`
}

async function applicant(): Promise<TestCaller> {
  const user = await createUser(db)

  return { userId: user.id, roles: ['BUYER'] }
}

function form(overrides: Partial<SellerApplicationRequest> = {}): SellerApplicationRequest {
  return {
    brandName: unique('브랜드'),
    slug: unique('store').toLowerCase(),
    ...overrides,
  }
}

function applyAs(caller: TestCaller, body: SellerApplicationRequest): Promise<SellerResponse> {
  return api.clientAs(caller).request({
    path: '/sellers/applications',
    method: 'POST',
    body,
    schema: sellerResponseSchema,
  })
}

function availability(caller: TestCaller, value: string): Promise<{ available: boolean }> {
  return api.clientAs(caller).request({
    path: `/sellers/brand-name-availability?value=${encodeURIComponent(value)}`,
    schema: brandNameAvailabilityResponseSchema,
  })
}

function approve(id: string, version: number): Promise<SellerResponse> {
  return api.clientAs(callers.operator).request({
    path: `/admin/sellers/${id}/approve`,
    method: 'POST',
    body: { version },
    schema: sellerResponseSchema,
  })
}

function editStore(caller: TestCaller, body: unknown): Promise<SellerResponse> {
  return api.clientAs(caller).request({
    path: '/sellers/me',
    method: 'PATCH',
    body,
    schema: sellerResponseSchema,
  })
}

function statusOf(reason: unknown): number {
  return reason instanceof ApiClientError ? (reason.status ?? 0) : 0
}

/** What a reader would see afterwards: the row, and how many roles it produced. */
async function stateOf(
  sellerId: string,
  userId: string,
): Promise<{
  status: SellerStatus
  version: number
  ownerRoles: number
}> {
  return db.one(
    `SELECT s."status"::text AS status,
            s."version",
            (SELECT count(*)::int FROM "UserRole" r
              WHERE r."userId" = $2 AND r."role" = 'SELLER_OWNER'::"Role") AS "ownerRoles"
       FROM "Seller" s WHERE s."id" = $1`,
    [sellerId, userId],
  )
}

describe('A7 · F13 — 같은 신청에 승인 2건이 동시에 온다', () => {
  it('transitions once, grants one role, and tells the loser', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const caller = await applicant()
      const { seller } = await applyAs(caller, form())

      const results = await concurrently(2, () => approve(seller.id, seller.version))
      const state = await stateOf(seller.id, caller.userId)

      // `expect.soft` so a broken implementation reports how many of the forty
      // observations it fails rather than stopping at the first round — the
      // number that says whether the conditional update is doing anything.
      expect.soft(fulfilled(results)).toHaveLength(1)
      // The loser is told the row moved (409) or that the move is no longer
      // available from where it now stands (400). Either is actionable; what
      // must never happen is two successes.
      expect
        .soft(
          rejected(results)
            .map(statusOf)
            .every((code) => code === 409 || code === 400),
        )
        .toBe(true)
      expect.soft(state.status).toBe('ACTIVE')
      // One decision, one version bump. Two would mean the row moved twice.
      expect.soft(state.version).toBe(seller.version + 1)
      expect.soft(state.ownerRoles).toBe(1)
    }
  })

  it('grants exactly one role even when five approvals arrive at once', async () => {
    const caller = await applicant()
    const { seller } = await applyAs(caller, form())

    const results = await concurrently(5, () => approve(seller.id, seller.version))
    const state = await stateOf(seller.id, caller.userId)

    expect(fulfilled(results)).toHaveLength(1)
    expect(state.version).toBe(1)
    expect(state.ownerRoles).toBe(1)
  })
})

describe('A7 · F6 — 같은 브랜드명으로 동시에 신청한다', () => {
  it('stores one of them and refuses the other with a 409', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const brandName = unique('경합브랜드')
      const first = await applicant()
      const second = await applicant()
      const gate = barrier(2)

      const results = await concurrently(2, async (index) => {
        const caller = index === 0 ? first : second

        // Both callers legitimately see the name as free — which is exactly why
        // the availability endpoint cannot be the thing that prevents this.
        expect.soft((await availability(caller, brandName)).available).toBe(true)
        await gate.arrive()

        return applyAs(caller, form({ brandName }))
      })

      expect.soft(fulfilled(results)).toHaveLength(1)
      expect.soft(rejected(results).map(statusOf)).toEqual([409])

      const { count } = await db.one<{ count: number }>(
        'SELECT count(*)::int AS count FROM "Seller" WHERE "brandName" = $1',
        [brandName],
      )

      expect.soft(count).toBe(1)
    }
  })

  it('names the field the loser has to change', async () => {
    const brandName = unique('경합브랜드')
    const gate = barrier(2)
    const first = await applicant()
    const second = await applicant()

    const results = await concurrently(2, async (index) => {
      await gate.arrive()

      return applyAs(index === 0 ? first : second, form({ brandName }))
    })

    const [reason] = rejected(results)
    const details = reason instanceof ApiClientError ? (reason.body?.error.details ?? []) : []

    expect(details).toEqual([expect.objectContaining({ field: 'brandName' })])
  })
})

describe('A7 · F9 — 같은 version 으로 스토어를 동시에 고친다', () => {
  it('applies one edit and refuses the other', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const caller = await applicant()
      const { seller } = await applyAs(caller, form())
      const names = [unique('가'), unique('나')]

      const results = await concurrently(2, (index) =>
        editStore(caller, { brandName: names[index], version: seller.version }),
      )

      expect.soft(fulfilled(results)).toHaveLength(1)
      expect.soft(rejected(results).map(statusOf)).toEqual([409])

      const row = await db.one<{ brandName: string; version: number }>(
        'SELECT "brandName", "version" FROM "Seller" WHERE "id" = $1',
        [seller.id],
      )

      // One save, one version. The stored name is whichever edit won — never a
      // blend, and never the loser's.
      expect.soft(names).toContain(row.brandName)
      expect.soft(row.version).toBe(seller.version + 1)
    }
  })
})

/**
 * The negative control for the brand name: the same choreography with no unique
 * index.
 *
 * A scratch table rather than the shipped one, for the reason TASK-0028 needed
 * one — the damage here *is* the missing constraint, so it cannot be reproduced
 * on a table that has it. What this shows is that check-then-insert, which is
 * what the availability endpoint invites a form to do, is not by itself a
 * defence.
 *
 * If this control ever went green, the positive case above would be proving
 * nothing about the index and everything about two calls that failed to
 * overlap.
 */
describe('A7 — 음성 대조군 (브랜드명 유니크 인덱스 없음)', () => {
  beforeAll(async () => {
    await db.query('DROP TABLE IF EXISTS "unindexed_brand"')
    await db.query(
      `CREATE TABLE "unindexed_brand" ("id" uuid PRIMARY KEY, "brandName" text NOT NULL)`,
    )
  })

  it('lets two stores end up with one brand name', async () => {
    const brandName = unique('대조군브랜드')
    const gate = barrier(2)

    const results = await concurrently(2, async () =>
      db.withConnection(async (connection) => {
        const { rows } = await connection.query(
          'SELECT "id" FROM "unindexed_brand" WHERE "brandName" = $1',
          [brandName],
        )

        expect(rows).toHaveLength(0)
        await gate.arrive()

        await connection.query(
          'INSERT INTO "unindexed_brand" ("id", "brandName") VALUES ($1, $2)',
          [randomUUID(), brandName],
        )
      }),
    )

    expect(rejected(results)).toHaveLength(0)

    const { count } = await db.one<{ count: number }>(
      'SELECT count(*)::int AS count FROM "unindexed_brand" WHERE "brandName" = $1',
      [brandName],
    )

    // Two stores, one brand. Every storefront link now resolves to whichever
    // row the planner returned first.
    expect(count).toBe(2)
  })

  it('is the same fixture the indexed table refuses', async () => {
    const brandName = unique('대조군브랜드')
    const gate = barrier(2)
    const first = await applicant()
    const second = await applicant()

    const results = await concurrently(2, async (index) => {
      await gate.arrive()

      return applyAs(index === 0 ? first : second, form({ brandName }))
    })

    expect(rejected(results).map(statusOf)).toEqual([409])
    expect(
      (
        await db.one<{ count: number }>(
          'SELECT count(*)::int AS count FROM "Seller" WHERE "brandName" = $1',
          [brandName],
        )
      ).count,
    ).toBe(1)
  })
})

/**
 * The negative control for the approval: the same two transitions with the
 * guard removed.
 *
 * Written as raw SQL on two connections rather than by editing the service, and
 * against the **real** table — there is no constraint to drop here, because
 * "this row may only leave PENDING once" is a statement about a transition and
 * not about a value, which is exactly why a CHECK cannot make it and the
 * conditional `WHERE` has to.
 *
 * The interleaving is awaited step by step, which pins the exact sequence an
 * unguarded implementation permits.
 */
describe('A7 — 음성 대조군 (전이 조건 없는 갱신)', () => {
  async function pendingStore(): Promise<{ id: string; userId: string }> {
    const caller = await applicant()
    const { seller } = await applyAs(caller, form())

    return { id: seller.id, userId: caller.userId }
  }

  /** The update the service issues — minus `AND "status"` and `AND "version"`. */
  function unguarded(connection: PoolClient, id: string): Promise<unknown> {
    return connection.query(
      `UPDATE "Seller"
          SET "status" = 'ACTIVE'::"SellerStatus",
              "version" = "version" + 1,
              "statusChangedAt" = now(),
              "updatedAt" = now()
        WHERE "id" = $1`,
      [id],
    )
  }

  it('lets both operators believe they approved, and moves the row twice', async () => {
    let doubled = 0

    for (let round = 0; round < ROUNDS; round += 1) {
      const store = await pendingStore()

      await db.withConnection(async (first) =>
        db.withConnection(async (second) => {
          await first.query('BEGIN')
          await second.query('BEGIN')

          // Both read the same version and both believe they may proceed, which
          // is all an optimistic lock promises on its own.
          const seen = await Promise.all(
            [first, second].map(async (connection) => {
              const { rows } = await connection.query<{ version: number }>(
                'SELECT "version" FROM "Seller" WHERE "id" = $1',
                [store.id],
              )

              return rows[0]?.version ?? -1
            }),
          )

          expect(seen[0]).toBe(seen[1])

          await unguarded(first, store.id)
          await first.query('COMMIT')
          // The second one no longer has anything to decide — and without the
          // guard it does not notice.
          await unguarded(second, store.id)
          await second.query('COMMIT')
        }),
      )

      const state = await stateOf(store.id, store.userId)

      if (state.version === 2) doubled += 1
    }

    // Ten rounds, ten rows that moved twice for one decision. Nothing failed,
    // nothing was refused, and no constraint was violated — the audit trail
    // simply says the store was approved by two people, and the second
    // operator's console showed success.
    expect(doubled).toBe(ROUNDS)
  })

  it('is the same fixture the guarded implementation gets right', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const store = await pendingStore()

      await concurrently(2, () =>
        approve(store.id, 0).then(
          () => null,
          () => null,
        ),
      )

      const state = await stateOf(store.id, store.userId)

      expect.soft(state.version).toBe(1)
      expect.soft(state.ownerRoles).toBe(1)
    }
  })
})

describe('A7 — 유니크 위반의 SQLSTATE', () => {
  it('is the database’s own 23505 that the service turns into a 409', async () => {
    // The service maps a violation onto a field-naming 409, and the mapping is
    // keyed by the index name the driver reports. This pins the value that
    // mapping depends on, so a driver upgrade that stopped reporting it fails
    // here rather than turning every duplicate into a 500.
    const owner = await createUser(db)
    const rival = await createUser(db)

    await db.execute(
      `INSERT INTO "Seller" ("id", "userId", "brandName", "slug", "updatedAt")
       VALUES ($1, $2, '중복확인', 'dup-check', now())`,
      [randomUUID(), owner.id],
    )

    const error: unknown = await db
      .execute(
        `INSERT INTO "Seller" ("id", "userId", "brandName", "slug", "updatedAt")
         VALUES ($1, $2, '중복확인', 'dup-check-2', now())`,
        [randomUUID(), rival.id],
      )
      .then(
        () => null,
        (reason: unknown) => reason,
      )

    expect((error as { code?: string }).code).toBe(UNIQUE_VIOLATION)
    expect((error as { constraint?: string }).constraint).toBe('Seller_brandName_key')
  })
})
