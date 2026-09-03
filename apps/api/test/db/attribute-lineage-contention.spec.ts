import type { ApiClient, CreateAttributeRequest } from '@shopping/shared'
import { ApiClientError } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import { AttributeService } from '../../src/catalog/attribute.service.js'
import { useApiApp } from '../support/api-app.js'
import type { Barrier } from '../support/concurrently.js'
import { barrier, concurrently, fulfilled, rejected } from '../support/concurrently.js'
import { useDatabase } from '../support/database.js'
import { callers } from '../support/principal.js'

/**
 * Gate A7 for attribute definitions, and the negative control that gives it
 * meaning.
 *
 * **Why this endpoint is in scope at all.** A7 asks for concurrency proof where
 * a balance, a stock level, an ordering or an idempotency key is at stake, and
 * an attribute definition is none of those. It qualifies for a different reason,
 * stated in TASK-0030 4.2: the rule "one live definition of a key per lineage"
 * is one the **database cannot enforce**. A CHECK constraint may not run a
 * subquery, and no built-in exclusion operator expresses "one path is a prefix
 * of another". So it is a check-then-insert in application code — the exact
 * shape that two concurrent requests defeat — and the only thing between it and
 * a duplicate is the advisory lock. Everything the other constraints get for
 * free from PostgreSQL, this one has to earn here.
 *
 * Three layers, and all three are needed.
 *
 * 1. **The real endpoints under concurrent calls.** Two creates of one key from
 *    opposite ends of a lineage, a create racing a category move, concurrent
 *    reads during writes, concurrent edits of one definition.
 * 2. **Negative control — the same creates without the lock, on the real
 *    table.** Both commit, the lineage ends up with two definitions of one key,
 *    and the damage is not that a query returns two rows: it is that
 *    `validateAttributes` then **silently stops enforcing the one an operator
 *    added**, so a product that should have been refused is saved.
 * 3. **The locked path, on the same fixture.** One request is refused with a
 *    409 that names the conflict, and the lineage keeps exactly one answer.
 *
 * There is no third layer with the constraints removed, unlike TASK-0028's
 * `category-tree-contention.spec.ts`. There is nothing to remove: the database
 * never had a constraint for this rule, which is the whole reason the file
 * exists.
 */

const db = useDatabase()
const api = useApiApp({ database: db, authenticate: true })

/** `catalog.read` + `write` + `delete`. */
function client(): ApiClient {
  return api.clientAs(callers.superAdmin)
}

/** A race that fails once in ten is not fixed; every case below repeats. */
const RUNS = Array.from({ length: 10 }, (_unused, index) => index + 1)

function statusOf(reason: unknown): number {
  return reason instanceof ApiClientError ? (reason.status ?? 0) : 0
}

/**
 * The refusal's domain code.
 *
 * Was the Korean sentence, which made a copy edit break a concurrency test and,
 * worse, let the test pass on *any* 409 whose wording happened to match
 * (TASK-0117 R1).
 */
function codeOf(reason: unknown): string | null {
  return reason instanceof ApiClientError ? reason.code : null
}

/** Unique per call, so a repeated run never collides with the previous one. */
function slug(name: string): string {
  return `${name}-${String(Math.trunc(performance.now() * 1000))}`
}

/** 의류 > 상의 > 티셔츠, built through the API. */
async function branch(): Promise<{ root: number; child: number; leaf: number }> {
  const caller = client()
  const { category: root } = await caller.createCategory({
    parentId: null,
    name: '의류',
    slug: slug('clothing'),
  })
  const { category: child } = await caller.createCategory({
    parentId: root.id,
    name: '상의',
    slug: slug('tops'),
  })
  const { category: leaf } = await caller.createCategory({
    parentId: child.id,
    name: '티셔츠',
    slug: slug('tees'),
  })

  return { root: root.id, child: child.id, leaf: leaf.id }
}

/**
 * The two definitions that race, and the reason they are not identical.
 *
 * The root's is **required** and the leaf's is not. That asymmetry is what makes
 * the negative control's damage observable: with both rows committed, the nearer
 * one wins and the requirement an operator added at 의류 simply stops applying.
 */
function rootBrand(categoryId: number): CreateAttributeRequest {
  return { categoryId, key: 'brand', label: '브랜드', type: 'TEXT', isRequired: true }
}

function leafBrand(categoryId: number): CreateAttributeRequest {
  return { categoryId, key: 'brand', label: '브랜드', type: 'TEXT', isRequired: false }
}

/** Live definitions of one key anywhere in the tree. */
async function liveDefinitions(key: string): Promise<{ id: number; categoryId: number }[]> {
  return db.query<{ id: number; categoryId: number }>(
    `SELECT "id", "categoryId" FROM "AttributeDefinition"
      WHERE "key" = $1 AND "deletedAt" IS NULL ORDER BY "id"`,
    [key],
  )
}

/** The service the application actually bound, talking to the same database. */
function attributes(): AttributeService {
  return api.resolve<AttributeService>(AttributeService)
}

describe('two creates of one key from opposite ends of a lineage', () => {
  it.each(RUNS)('lets exactly one through and refuses the other (run %i)', async () => {
    const { root, leaf } = await branch()

    const results = await concurrently(2, (index) =>
      index === 0
        ? client().createAttribute(rootBrand(root))
        : client().createAttribute(leafBrand(leaf)),
    )

    expect(fulfilled(results)).toHaveLength(1)

    const [refusal] = rejected(results)

    // 409 and not 500: the loser was refused by the service, which read the
    // lineage the winner had already committed.
    expect(statusOf(refusal)).toBe(409)
    expect(codeOf(refusal)).toBe('ATTRIBUTE_KEY_TAKEN')

    // One answer to "what does 브랜드 mean here", not two rows of which one is
    // invisible.
    expect(await liveDefinitions('brand')).toHaveLength(1)

    const { attributes: effective } = await client().getAttributes({ categoryId: leaf })

    expect(effective.filter((attribute) => attribute.key === 'brand')).toHaveLength(1)
  })
})

describe('a create racing a category move', () => {
  it.each(RUNS)('never leaves the lineage with two answers (run %i)', async () => {
    // `host` defines 브랜드; `orphan` does not and sits under another root.
    const { category: host } = await client().createCategory({
      parentId: null,
      name: '의류',
      slug: slug('host'),
    })
    const { category: elsewhere } = await client().createCategory({
      parentId: null,
      name: '기타',
      slug: slug('elsewhere'),
    })
    const { category: orphan } = await client().createCategory({
      parentId: elsewhere.id,
      name: '떠도는 것',
      slug: slug('orphan'),
    })

    await client().createAttribute(rootBrand(host.id))

    // Sharing the tree lock is what makes these two serialise. Either the move
    // lands first and the create is refused, or the create lands first and the
    // move — which knows nothing about attributes — brings the two definitions
    // into one lineage.
    // `unknown`, because the two calls answer with different shapes and only
    // their success or failure matters here.
    const results = await concurrently<unknown>(2, (index) =>
      index === 0
        ? client().createAttribute(leafBrand(orphan.id))
        : client().moveCategory(orphan.id, { parentId: host.id }),
    )

    const refusals = rejected(results)

    expect(refusals.length).toBeLessThanOrEqual(1)
    for (const refusal of refusals) expect(statusOf(refusal)).toBe(409)

    // Whatever the interleaving produced, the question "which definitions apply
    // to 떠도는 것" has exactly one answer per key — which is the property
    // `resolveEffectiveAttributes` being a total function buys (TASK-0030 4.1).
    const { attributes: effective } = await client().getAttributes({ categoryId: orphan.id })
    const keys = effective.map((attribute) => attribute.key)

    expect(new Set(keys).size).toBe(keys.length)
    expect(keys.filter((key) => key === 'brand')).toHaveLength(1)
  })
})

describe('reads while definitions are being written', () => {
  it.each(RUNS)('never observes the same key twice (run %i)', async () => {
    const { root, child, leaf } = await branch()
    const writes = [
      client().createAttribute({ ...rootBrand(root), key: 'brand' }),
      client().createAttribute({ categoryId: child, key: 'fit', label: '핏', type: 'TEXT' }),
      client().createAttribute({
        categoryId: leaf,
        key: 'neckline',
        label: '넥라인',
        type: 'TEXT',
      }),
    ]
    const reads = Array.from({ length: 6 }, () => client().getAttributes({ categoryId: leaf }))

    const [, ...answers] = await Promise.all([Promise.all(writes), ...reads])

    for (const { attributes: effective } of answers) {
      const keys = effective.map((attribute) => attribute.key)

      // The read is a single statement, so it sees one snapshot: a subset of
      // what is being created, never a duplicate and never half a definition.
      expect(new Set(keys).size).toBe(keys.length)
      expect(keys.every((key) => ['brand', 'fit', 'neckline'].includes(key))).toBe(true)
    }
  })
})

describe('concurrent edits of one definition', () => {
  it.each(RUNS)('lets one version through and conflicts the other (run %i)', async () => {
    const { leaf } = await branch()
    const { attribute } = await client().createAttribute(leafBrand(leaf))

    const results = await concurrently(2, (index) =>
      client().updateAttribute(attribute.id, {
        version: attribute.version,
        label: index === 0 ? '왼쪽' : '오른쪽',
      }),
    )

    // The optimistic lock is the whole mechanism here (DECISIONS 4): the loser
    // is told rather than having their edit silently replaced.
    expect(fulfilled(results)).toHaveLength(1)
    expect(statusOf(rejected(results)[0])).toBe(409)

    const { label, version } = await db.one<{ label: string; version: number }>(
      `SELECT "label", "version" FROM "AttributeDefinition" WHERE "id" = $1`,
      [attribute.id],
    )

    expect(['왼쪽', '오른쪽']).toContain(label)
    expect(version).toBe(attribute.version + 1)
  })
})

/**
 * The create, re-implemented in raw SQL exactly as the service does it but
 * **without** `pg_advisory_xact_lock`. Never reachable from `apps/api/src`.
 *
 * The barrier pins the interleaving down: both transactions run their lineage
 * check before either inserts, which is what a busy database produces on its
 * own. Without it the two calls might simply take turns, and the spec would be
 * green while proving nothing.
 */
function createWithoutLock(
  request: CreateAttributeRequest,
  gate: Barrier,
): Promise<{ conflicts: number; id: number }> {
  return db.withConnection(async (connection) => {
    await connection.query('BEGIN')
    try {
      const { rows: categoryRows } = await connection.query<{ path: string }>(
        `SELECT "path" FROM "Category" WHERE "id" = $1 AND "deletedAt" IS NULL`,
        [request.categoryId],
      )
      const category = categoryRows[0]

      if (category === undefined) throw new Error('픽스처가 없습니다.')

      const { rows: conflictRows } = await connection.query(
        `SELECT d."id"
           FROM "AttributeDefinition" d
           JOIN "Category" c ON c."id" = d."categoryId"
          WHERE d."deletedAt" IS NULL
            AND d."key" = $2
            AND (c."path" LIKE $1 || '%' OR $1 LIKE c."path" || '%')`,
        [category.path, request.key],
      )

      // Everything above is now stale, and this is the moment the lock would
      // have been held since before the first read.
      await gate.arrive()

      const { rows: inserted } = await connection.query<{ id: number }>(
        `INSERT INTO "AttributeDefinition"
           ("categoryId", "key", "label", "type", "isRequired", "updatedAt")
         VALUES ($1, $2, $3, $4::"AttributeType", $5, now())
         RETURNING "id"`,
        [request.categoryId, request.key, request.label, request.type, request.isRequired ?? false],
      )

      await connection.query('COMMIT')
      return { conflicts: conflictRows.length, id: inserted[0]?.id ?? 0 }
    } catch (error) {
      await connection.query('ROLLBACK')
      throw error
    }
  })
}

describe('negative control — no advisory lock, real table', () => {
  it.each(RUNS)('commits two definitions of one key into one lineage (run %i)', async () => {
    const { root, leaf } = await branch()

    const gate = barrier(2)
    const results = await concurrently(2, (index) =>
      index === 0
        ? createWithoutLock(rootBrand(root), gate)
        : createWithoutLock(leafBrand(leaf), gate),
    )

    // Both saw an empty lineage, both were told they had succeeded, and both
    // really did insert. No constraint objected, because there is none that
    // could: a CHECK may not ask about other rows.
    expect(fulfilled(results).map((answer) => answer.conflicts)).toEqual([0, 0])
    expect(await liveDefinitions('brand')).toHaveLength(2)
  })

  it.each(RUNS)('stops enforcing the requirement an operator added (run %i)', async () => {
    const { root, leaf } = await branch()

    const gate = barrier(2)

    await concurrently(2, (index) =>
      index === 0
        ? createWithoutLock(rootBrand(root), gate)
        : createWithoutLock(leafBrand(leaf), gate),
    )

    // This is the damage, and it is not "a query returns two rows". The nearer
    // definition wins, so 브랜드 — which an operator marked required for the
    // whole of 의류 — is optional for 티셔츠 and nothing anywhere says so. A
    // product with no brand saves cleanly.
    const verdict = await attributes().validateAttributes(leaf, {})

    expect(verdict.ok).toBe(true)

    // And the root, which nothing shadows, still refuses the same product.
    const atRoot = await attributes().validateAttributes(root, {})

    expect(atRoot.ok).toBe(false)
  })

  it.each(RUNS)('the locked path refuses the second create instead (run %i)', async () => {
    const { root, leaf } = await branch()

    const results = await concurrently(2, (index) =>
      index === 0
        ? client().createAttribute(rootBrand(root))
        : client().createAttribute(leafBrand(leaf)),
    )

    // Same tree, same two requests, same moment — and here the lineage ends up
    // with one definition and one caller holding an error they can act on.
    expect(fulfilled(results)).toHaveLength(1)
    expect(statusOf(rejected(results)[0])).toBe(409)
    expect(await liveDefinitions('brand')).toHaveLength(1)
  })
})
