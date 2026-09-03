import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import type { ApiClient } from '@shopping/shared'
import { afterAll, describe, expect, it } from 'vitest'

import { useApiApp } from '../support/api-app.js'
import { useDatabase } from '../support/database.js'
import type { CategoryRow } from '../support/factories.js'
import { createAttributeDefinition, createCategory } from '../support/factories.js'
import { callers } from '../support/principal.js'

/**
 * Gates A1 (response time), A5 (no N+1) and S3 (the index is used), measured
 * rather than asserted by inspection.
 *
 * The statements are counted at the source: the application is booted against a
 * **real** `PrismaClient` — the same class, against the same worker database,
 * with query logging switched on. Nothing is mocked, which A6 forbids; the only
 * difference from production is that this client says what it ran.
 *
 * The count is what makes A5 a fact rather than a reading of the code. "The
 * lineage is one statement" is easy to write and easy to lose: a later `include`
 * or a loop that fetches an ancestor turns the endpoint linear in the depth of
 * the tree while every functional test still passes.
 */

const db = useDatabase()

/** Statements this run has seen, from the client the application is using. */
const statements: string[] = []

const observable = new PrismaClient({
  adapter: new PrismaPg({ connectionString: db.url, max: 5 }),
  log: [{ emit: 'event', level: 'query' }],
})

;(
  observable as unknown as {
    $on: (event: 'query', listener: (payload: { query: string }) => void) => void
  }
).$on('query', (payload) => statements.push(payload.query))

const api = useApiApp({ database: db, authenticate: true, prisma: observable })

afterAll(async () => {
  await observable.$disconnect()
})

function client(): ApiClient {
  return api.clientAs(callers.superAdmin)
}

/** Runs `work` and reports every statement it caused. */
async function statementsDuring(work: () => Promise<unknown>): Promise<string[]> {
  statements.length = 0
  await work()
  // The event is emitted from the adapter's callback; a macrotask is enough for
  // the ones already resolved to have arrived.
  await new Promise((resolve) => setTimeout(resolve, 20))

  return [...statements]
}

/** Statements that actually touched the definition table. */
function attributeStatements(seen: readonly string[]): string[] {
  return seen.filter((statement) => statement.includes('"AttributeDefinition"'))
}

/** A lineage `levels` deep, with `perLevel` definitions on each category. */
async function lineage(
  levels: number,
  perLevel: number,
  prefix: string,
): Promise<{ deepest: CategoryRow; total: number }> {
  let parent: CategoryRow | null = null
  let total = 0

  for (let level = 0; level < levels; level += 1) {
    const node: CategoryRow = await createCategory(db, {
      parent,
      slug: `${prefix}-${String(level)}`,
    })

    for (let index = 0; index < perLevel; index += 1) {
      await createAttributeDefinition(db, {
        categoryId: node.id,
        key: `${prefix.replaceAll('-', '_')}_${String(level)}_${String(index)}`,
        sortOrder: index,
      })
      total += 1
    }
    parent = node
  }

  if (parent === null) throw new Error('카테고리를 만들지 못했습니다.')

  return { deepest: parent, total }
}

describe('resolving a lineage is one query, whatever its depth (A5)', () => {
  it('costs the same for a root and for a three-level leaf', async () => {
    const shallow = await lineage(1, 2, 'shallow')
    const deep = await lineage(3, 2, 'deep')

    const forShallow = await statementsDuring(() =>
      client().getAttributes({ categoryId: shallow.deepest.id }),
    )
    const forDeep = await statementsDuring(() =>
      client().getAttributes({ categoryId: deep.deepest.id }),
    )

    expect(attributeStatements(forShallow)).toHaveLength(1)
    expect(attributeStatements(forDeep)).toHaveLength(1)

    // And the deeper read really did inherit the ancestors' definitions — a
    // count that stayed at one because nothing came back would prove nothing.
    const { attributes } = await client().getAttributes({ categoryId: deep.deepest.id })

    expect(attributes).toHaveLength(deep.total)
    expect(attributes.filter((attribute) => attribute.inherited)).toHaveLength(deep.total - 2)
  })

  it('costs the same for 6 definitions and for 120', async () => {
    const few = await lineage(3, 2, 'few')
    const many = await lineage(3, 40, 'many')

    const forFew = await statementsDuring(() =>
      client().getAttributes({ categoryId: few.deepest.id }),
    )
    const forMany = await statementsDuring(() =>
      client().getAttributes({ categoryId: many.deepest.id }),
    )

    expect(attributeStatements(forFew)).toHaveLength(1)
    expect(attributeStatements(forMany)).toHaveLength(1)
    expect((await client().getAttributes({ categoryId: many.deepest.id })).attributes).toHaveLength(
      120,
    )
  })

  it('costs a fixed number of statements to create a definition', async () => {
    const shallow = await lineage(1, 0, 'create-shallow')
    const deep = await lineage(3, 0, 'create-deep')

    const forShallow = await statementsDuring(() =>
      client().createAttribute({
        categoryId: shallow.deepest.id,
        key: 'shallow_key',
        label: '얕음',
        type: 'TEXT',
      }),
    )
    const forDeep = await statementsDuring(() =>
      client().createAttribute({
        categoryId: deep.deepest.id,
        key: 'deep_key',
        label: '깊음',
        type: 'TEXT',
      }),
    )

    // The lineage conflict check is one statement regardless of how many
    // ancestors there are — it is a prefix comparison, not a walk.
    expect(attributeStatements(forDeep)).toHaveLength(attributeStatements(forShallow).length)
  })
})

describe('the indexes serve the queries (S3)', () => {
  it('plans an index scan for the lineage lookup', async () => {
    // Spread over many categories on purpose. With every row on one category
    // the index would return the whole table and a sequential scan really is
    // the cheaper plan — the assertion would then be about the fixture rather
    // than about the index.
    await db.execute(
      `INSERT INTO "Category" ("id", "parentId", "parentPath", "path", "depth", "name", "slug", "updatedAt")
       SELECT n, NULL, NULL, '/' || n || '/', 1, '대량 ' || n, 'bulk-' || n, now()
         FROM generate_series(1000, 3000) AS n`,
    )
    await db.execute(`SELECT setval(pg_get_serial_sequence('"Category"', 'id'), 3001)`)
    await db.execute(
      `INSERT INTO "AttributeDefinition" ("categoryId", "key", "label", "type", "sortOrder", "updatedAt")
       SELECT c.n, 'bulk_' || c.n || '_' || d.i, '대량', 'TEXT'::"AttributeType", d.i, now()
         FROM generate_series(1000, 3000) AS c(n), generate_series(0, 1) AS d(i)`,
    )
    await db.execute(`ANALYZE "Category"`)
    await db.execute(`ANALYZE "AttributeDefinition"`)

    const rows = await db.query<Record<string, string>>(
      `EXPLAIN SELECT "id" FROM "AttributeDefinition"
        WHERE "categoryId" = ANY (ARRAY[2000]::int[]) AND "deletedAt" IS NULL`,
    )
    const plan = rows.map((row) => Object.values(row).join(' ')).join('\n')

    // The partial unique index is what serves this: it leads with `categoryId`
    // and its `WHERE "deletedAt" IS NULL` predicate matches the query's filter
    // exactly, so a separate `(categoryId, sortOrder)` index would be a second
    // copy of the same prefix that no read would ever choose.
    expect(plan).toContain('AttributeDefinition_categoryId_key_active_key')
    expect(plan).not.toContain('Seq Scan')
  })

  it('plans an index scan for the lineage conflict check', async () => {
    const { deepest } = await lineage(1, 0, 'keyed')

    await db.execute(
      `INSERT INTO "AttributeDefinition" ("categoryId", "key", "label", "type", "updatedAt")
       SELECT $1, 'bulk_' || n, '대량 ' || n, 'TEXT'::"AttributeType", now()
         FROM generate_series(1, 4000) AS n`,
      [deepest.id],
    )
    await db.execute(`ANALYZE "AttributeDefinition"`)

    const rows = await db.query<Record<string, string>>(
      `EXPLAIN SELECT "id" FROM "AttributeDefinition" WHERE "key" = 'bulk_1234'`,
    )
    const plan = rows.map((row) => Object.values(row).join(' ')).join('\n')

    expect(plan).toContain('AttributeDefinition_key_idx')
    expect(plan).not.toContain('Seq Scan')
  })
})

describe('response time (A1)', () => {
  it('answers a three-level lineage well inside 300ms at p95', async () => {
    const { deepest } = await lineage(3, 20, 'timed')

    const durations: number[] = []
    const caller = client()

    for (let index = 0; index < 50; index += 1) {
      const started = performance.now()

      await caller.getAttributes({ categoryId: deepest.id })
      durations.push(performance.now() - started)
    }

    durations.sort((left, right) => left - right)

    const p95 = durations[Math.floor(durations.length * 0.95)] ?? Number.POSITIVE_INFINITY

    expect(p95).toBeLessThan(300)
  })

  it('creates a definition well inside 300ms at p95, tree lock included', async () => {
    const { deepest } = await lineage(3, 20, 'timed-create')

    const durations: number[] = []
    const caller = client()

    for (let index = 0; index < 30; index += 1) {
      const started = performance.now()

      await caller.createAttribute({
        categoryId: deepest.id,
        key: `created_${String(index)}`,
        label: `생성 ${String(index)}`,
        type: 'TEXT',
      })
      durations.push(performance.now() - started)
    }

    durations.sort((left, right) => left - right)

    const p95 = durations[Math.floor(durations.length * 0.95)] ?? Number.POSITIVE_INFINITY

    expect(p95).toBeLessThan(300)
  })
})
