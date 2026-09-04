import type { SellerResponse, SellerStatus } from '@shopping/shared'
import { ApiClientError, sellerResponseSchema } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import { useApiApp } from '../support/api-app.js'
import { useDatabase } from '../support/database.js'
import { createUser } from '../support/factories.js'
import type { TestCaller } from '../support/principal.js'
import { callers } from '../support/principal.js'

/**
 * 완료 기준 F2 · R5 — 승인과 역할 부여가 **한 트랜잭션**이라는 것.
 *
 * The happy path proves the pair exists; it does not prove it is atomic. A
 * service that updated the status, committed, and then granted the role would
 * pass every assertion in `sellers.integration.spec.ts` and still leave a store
 * `ACTIVE` with no `SELLER_OWNER` the first time the second statement failed —
 * a seller who cannot open the console anybody can see they were approved for.
 * R5 names exactly that, so it has to be provoked.
 *
 * **The failure is injected into the database, not into Prisma.** A6 forbids
 * mocking the client, and there would be nothing to learn from a stub refusing
 * on command: the question is whether PostgreSQL's transaction is holding both
 * writes. A trigger that refuses the role insert makes the second half fail for
 * real, inside the transaction the service opened, which is the shape a foreign
 * key violation or a lost connection would take.
 */

const db = useDatabase()
const api = useApiApp({ database: db, authenticate: true })

let names = 0

function unique(prefix: string): string {
  names += 1
  return `${prefix}-${String(names)}-${String(process.env.VITEST_POOL_ID ?? '1')}`
}

async function pendingStore(): Promise<{ id: string; userId: string; version: number }> {
  const user = await createUser(db)
  const caller: TestCaller = { userId: user.id, roles: ['BUYER'] }
  const { seller } = await api.clientAs(caller).request({
    path: '/sellers/applications',
    method: 'POST',
    body: { brandName: unique('브랜드'), slug: unique('store').toLowerCase() },
    schema: sellerResponseSchema,
  })

  return { id: seller.id, userId: user.id, version: seller.version }
}

function approve(id: string, version: number): Promise<SellerResponse> {
  return api.clientAs(callers.operator).request({
    path: `/admin/sellers/${id}/approve`,
    method: 'POST',
    body: { version },
    schema: sellerResponseSchema,
  })
}

async function stateOf(
  id: string,
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
    [id, userId],
  )
}

/** Runs `work` with the role grant made impossible, then puts the table back. */
async function withRefusedRoleGrant(work: () => Promise<void>): Promise<void> {
  await db.query(`
    CREATE OR REPLACE FUNCTION refuse_owner_role() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION '역할 부여를 거부하도록 만든 픽스처입니다.';
    END;
    $$ LANGUAGE plpgsql
  `)
  await db.query(`
    CREATE TRIGGER refuse_owner_role_trigger
      BEFORE INSERT ON "UserRole"
      FOR EACH ROW WHEN (NEW."role" = 'SELLER_OWNER'::"Role")
      EXECUTE FUNCTION refuse_owner_role()
  `)

  try {
    await work()
  } finally {
    await db.query('DROP TRIGGER IF EXISTS refuse_owner_role_trigger ON "UserRole"')
    await db.query('DROP FUNCTION IF EXISTS refuse_owner_role()')
  }
}

describe('F2 · R5 — 승인 트랜잭션', () => {
  it('leaves the store PENDING when the role grant fails', async () => {
    const store = await pendingStore()

    await withRefusedRoleGrant(async () => {
      const error: unknown = await approve(store.id, store.version).then(
        () => null,
        (reason: unknown) => reason,
      )

      // The caller learns nothing about the trigger — a 500 says only that the
      // request did not happen, which is the truth.
      expect(error).toBeInstanceOf(ApiClientError)
      expect((error as ApiClientError).status).toBe(500)

      const state = await stateOf(store.id, store.userId)

      // The half that would otherwise have survived alone.
      expect(state.status).toBe('PENDING')
      expect(state.version).toBe(store.version)
      expect(state.ownerRoles).toBe(0)
    })
  })

  it('lands both halves once the grant is possible again', async () => {
    // The control: the identical call against the identical fixture, with the
    // injected failure removed. Without this the assertion above would also
    // pass for a service that simply never approves anything.
    const store = await pendingStore()

    await withRefusedRoleGrant(async () => {
      await approve(store.id, store.version).catch(() => null)
    })

    const { seller } = await approve(store.id, store.version)
    const state = await stateOf(store.id, store.userId)

    expect(seller.status).toBe('ACTIVE')
    expect(state.version).toBe(store.version + 1)
    expect(state.ownerRoles).toBe(1)
  })

  it('re-grants nothing when a store is suspended and reinstated', async () => {
    // Reinstatement is not a second approval: the role is already held, and
    // `skipDuplicates` is what keeps `UserRole_userId_role_key` from turning a
    // routine operation into a 500.
    const store = await pendingStore()

    await approve(store.id, store.version)
    await api.clientAs(callers.superAdmin).request({
      path: `/admin/sellers/${store.id}/suspend`,
      method: 'POST',
      body: { version: 1, reason: '점검' },
      schema: sellerResponseSchema,
    })
    await api.clientAs(callers.superAdmin).request({
      path: `/admin/sellers/${store.id}/reinstate`,
      method: 'POST',
      body: { version: 2 },
      schema: sellerResponseSchema,
    })

    expect(await stateOf(store.id, store.userId)).toEqual({
      status: 'ACTIVE',
      version: 3,
      ownerRoles: 1,
    })
  })
})
