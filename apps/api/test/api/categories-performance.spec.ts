import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import type { ApiClient } from '@shopping/shared'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { useApiApp } from '../support/api-app.js'
import { useDatabase } from '../support/database.js'
import type { CategoryRow } from '../support/factories.js'
import { createCategory } from '../support/factories.js'
import { callers } from '../support/principal.js'

/**
 * Gates A1 (response time) and A5 (no N+1), measured rather than asserted by
 * inspection.
 *
 * The statements are counted at the source: the application is booted against a
 * **real** `PrismaClient` — the same class, against the same worker database,
 * with query logging switched on. Nothing is mocked, which A6 forbids; the only
 * difference from production is that this client says what it ran.
 *
 * Counting is what makes A5 a fact instead of a reading of the code. "The tree
 * read is one query" is easy to write and easy to lose: a later `include`, a
 * loop that fetches a parent, and the endpoint quietly becomes linear in the
 * size of the tree while every functional test still passes.
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

/** Statements that actually touched the category table. */
function categoryStatements(seen: readonly string[]): string[] {
  return seen.filter((statement) => statement.includes('"Category"'))
}

/** A branch `root > child > (leaf × width)`, built straight through SQL. */
async function branchOfWidth(
  width: number,
  prefix: string,
): Promise<{ root: CategoryRow; child: CategoryRow }> {
  const root = await createCategory(db, { slug: `${prefix}-root` })
  const child = await createCategory(db, { parent: root, slug: `${prefix}-child` })

  for (let index = 0; index < width; index += 1) {
    await createCategory(db, { parent: child, slug: `${prefix}-leaf-${String(index)}` })
  }

  return { root, child }
}

describe('reading the tree is one query, whatever its size (A5)', () => {
  it('costs the same for a subtree of 3 and a subtree of 42', async () => {
    const small = await branchOfWidth(1, 'small')
    const large = await branchOfWidth(40, 'large')

    const forSmall = await statementsDuring(() =>
      client().getCategoryTree({ rootId: small.root.id }),
    )
    const forLarge = await statementsDuring(() =>
      client().getCategoryTree({ rootId: large.root.id }),
    )

    expect(categoryStatements(forSmall)).toHaveLength(1)
    expect(categoryStatements(forLarge)).toHaveLength(1)

    // And the larger read really did return the larger subtree — a count that
    // stayed at one because nothing came back would prove nothing.
    const { nodes } = await client().getCategoryTree({ rootId: large.root.id })

    expect(nodes[0]?.children[0]?.children).toHaveLength(40)
  })

  it('costs one query for the whole forest as well', async () => {
    await branchOfWidth(20, 'forest-a')
    await branchOfWidth(20, 'forest-b')

    const seen = await statementsDuring(() => client().getCategoryTree())

    expect(categoryStatements(seen)).toHaveLength(1)
  })
})

describe('moving a subtree is a fixed number of statements (A5)', () => {
  it('costs the same for a subtree of 2 and a subtree of 41', async () => {
    const narrow = await branchOfWidth(0, 'narrow')
    const wide = await branchOfWidth(39, 'wide')
    const destinations = [
      await createCategory(db, { slug: 'destination-a' }),
      await createCategory(db, { slug: 'destination-b' }),
    ]

    const forNarrow = await statementsDuring(() =>
      client().moveCategory(narrow.child.id, { parentId: destinations[0]?.id ?? 0 }),
    )
    const forWide = await statementsDuring(() =>
      client().moveCategory(wide.child.id, { parentId: destinations[1]?.id ?? 0 }),
    )

    // One `UPDATE` rewrites the whole subtree, so 39 extra descendants cost 39
    // extra rows and not one extra statement.
    expect(categoryStatements(forWide)).toHaveLength(categoryStatements(forNarrow).length)

    const { nodes } = await client().getCategoryTree({ rootId: destinations[1]?.id ?? 0 })

    expect(nodes[0]?.children[0]?.children).toHaveLength(39)
  })
})

describe('the path index serves a prefix match (S3)', () => {
  beforeEach(async () => {
    // Enough rows that a sequential scan is not simply the cheaper plan.
    await db.execute(
      `INSERT INTO "Category" ("id", "parentId", "parentPath", "path", "depth", "name", "slug", "updatedAt")
       SELECT n, NULL, NULL, '/' || n || '/', 1, '대량 ' || n, 'bulk-' || n, now()
         FROM generate_series(1000, 6000) AS n`,
    )
    await db.execute(`SELECT setval(pg_get_serial_sequence('"Category"', 'id'), 6001)`)
    await db.execute(`ANALYZE "Category"`)
  })

  it('plans an index scan rather than reading the table', async () => {
    // `EXPLAIN` answers one text column per plan line; the name of that column
    // is not worth pinning down, so every value of every row is joined.
    const rows = await db.query<Record<string, string>>(
      `EXPLAIN SELECT "id" FROM "Category" WHERE "path" LIKE '/1234/%'`,
    )
    const plan = rows.map((row) => Object.values(row).join(' ')).join('\n')

    // `text_pattern_ops` is what makes this possible: the database collation is
    // `en_US.utf8`, under which a default btree index cannot answer `LIKE 'x%'`.
    expect(plan).toContain('Category_path_idx')
    expect(plan).not.toContain('Seq Scan')
  })
})

describe('response time (A1)', () => {
  it('answers a tree read well inside 300ms at p95', async () => {
    await branchOfWidth(40, 'timed')

    const durations: number[] = []
    const caller = client()

    for (let index = 0; index < 50; index += 1) {
      const started = performance.now()

      await caller.getCategoryTree()
      durations.push(performance.now() - started)
    }

    durations.sort((left, right) => left - right)

    const p95 = durations[Math.floor(durations.length * 0.95)] ?? Number.POSITIVE_INFINITY

    expect(p95).toBeLessThan(300)
  })

  it('answers a move well inside 300ms at p95', async () => {
    const { child } = await branchOfWidth(40, 'timed-move')
    const destinations: number[] = []

    for (let index = 0; index < 2; index += 1) {
      destinations.push((await createCategory(db, { slug: `swing-${String(index)}` })).id)
    }

    const durations: number[] = []
    const caller = client()

    for (let index = 0; index < 30; index += 1) {
      const started = performance.now()

      await caller.moveCategory(child.id, { parentId: destinations[index % 2]! })
      durations.push(performance.now() - started)
    }

    durations.sort((left, right) => left - right)

    const p95 = durations[Math.floor(durations.length * 0.95)] ?? Number.POSITIVE_INFINITY

    expect(p95).toBeLessThan(300)
  })
})
