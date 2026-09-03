import type { ApiClient } from '@shopping/shared'
import { ApiClientError } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import { useApiApp } from '../support/api-app.js'
import type { Barrier } from '../support/concurrently.js'
import { barrier, concurrently, fulfilled, rejected } from '../support/concurrently.js'
import { useDatabase } from '../support/database.js'
import { callers } from '../support/principal.js'

/**
 * Gate A7 for the category tree, and the negative control that gives it meaning.
 *
 * DECISIONS 4 assigns tree moves an **advisory lock**: "경로 재계산이 겹치면
 * 트리가 깨진다". This file is where that sentence is either true or not.
 *
 * Three layers, and all three are needed.
 *
 * 1. **The real endpoints under concurrent calls.** Two moves of the same node,
 *    a move racing a create against the depth cap, two moves that would form a
 *    cycle, concurrent reorders, concurrent edits. Every one of them has to end
 *    with a consistent tree and an answer each caller can act on.
 * 2. **Negative control A — the same moves without the lock, on the real
 *    table.** The database still refuses to hold a broken tree, but the
 *    application stops being correct: one request reports a successful move
 *    that changed nothing. A silent wrong answer is worse than an error.
 * 3. **Negative control B — the same moves without the lock and without the
 *    constraints** (`TestCategoryNaive`, a fixture table). Here the tree really
 *    does break: a cycle forms, and a subtree is left with a cached path that no
 *    longer leads to it. This is what layers 1 and 2 are holding up, and it is
 *    the proof that the harness creates a genuine race rather than two calls
 *    that politely took turns.
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
 * The assertion used to be on the Korean sentence, which meant a copy edit
 * broke a concurrency test — and, worse, that the test was only ever checking
 * that *a* refusal came back with familiar words rather than that the right rule
 * refused it (TASK-0117 R1).
 */
function codeOf(reason: unknown): string | null {
  return reason instanceof ApiClientError ? reason.code : null
}

/**
 * Rows that disagree with the tree they are part of.
 *
 * The same three rules the migration states, asked as a question instead of a
 * constraint: a path that is not its parent's path plus its own id, a depth that
 * does not match the path, an edge whose parent no longer carries that path.
 * Asserting on the answer rather than on the constraint's existence is what
 * makes this a statement about the outcome of a race.
 */
async function inconsistentRows(): Promise<{ id: number }[]> {
  return db.query<{ id: number }>(`
    SELECT c."id" FROM "Category" c
     WHERE c."path" <> COALESCE(c."parentPath", '/') || c."id"::text || '/'
        OR c."depth" <> length(c."path") - length(replace(c."path", '/', '')) - 1
        OR c."depth" NOT BETWEEN 1 AND 3
        OR (c."parentId" IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM "Category" p
                             WHERE p."id" = c."parentId" AND p."path" = c."parentPath"))
  `)
}

async function pathOfCategory(id: number): Promise<string> {
  const { path } = await db.one<{ path: string }>(`SELECT "path" FROM "Category" WHERE "id" = $1`, [
    id,
  ])

  return path
}

async function createRoot(name: string): Promise<number> {
  const { category } = await client().createCategory({
    parentId: null,
    name,
    slug: `${name}-${String(Math.trunc(performance.now() * 1000))}`,
  })

  return category.id
}

async function createChild(parentId: number, name: string): Promise<number> {
  const { category } = await client().createCategory({
    parentId,
    name,
    slug: `${name}-${String(Math.trunc(performance.now() * 1000))}`,
  })

  return category.id
}

describe('two moves of the same node, at the same time', () => {
  it.each(RUNS)('both really happen and the tree stays consistent (run %i)', async () => {
    const source = await createRoot('source')
    const node = await createChild(source, 'node')
    const leaf = await createChild(node, 'leaf')
    const [first, second] = [await createRoot('first'), await createRoot('second')]

    const results = await concurrently(2, (index) =>
      client().moveCategory(node, { parentId: index === 0 ? first : second }),
    )

    // Both are served: the lock makes them sequential, not one of them a loser.
    const moved = fulfilled(results)

    expect(moved).toHaveLength(2)
    // Each answer describes the move that request actually performed.
    expect(moved.map((answer) => answer.category.parentId).sort()).toEqual(
      [first, second].sort((left, right) => left - right),
    )

    const finalPath = await pathOfCategory(node)
    const parentId = [first, second].find((id) => finalPath === `/${String(id)}/${String(node)}/`)

    expect(parentId).toBeDefined()
    // The descendant followed, in the same statement that moved its parent.
    expect(await pathOfCategory(leaf)).toBe(`${finalPath}${String(leaf)}/`)
    expect(await inconsistentRows()).toEqual([])
  })
})

describe('a move racing a create against the three-level cap', () => {
  it.each(RUNS)('lets exactly one through and refuses the other with 400 (run %i)', async () => {
    // `top` is two levels tall; `host` already sits at the second level. Either
    // change alone is legal, and together they would need a fourth level.
    const top = await createRoot('top')
    const middle = await createChild(top, 'middle')
    const host = await createRoot('host')
    const hostChild = await createChild(host, 'host-child')

    const results = await concurrently(2, (index) =>
      index === 0
        ? client().moveCategory(top, { parentId: hostChild })
        : client().createCategory({
            parentId: middle,
            name: 'deep',
            slug: `deep-${String(Math.trunc(performance.now() * 1000))}`,
          }),
    )

    expect(fulfilled(results)).toHaveLength(1)

    const [refusal] = rejected(results)

    // 400 and not 500: the loser was refused by the service, which read the
    // tree the winner had already committed. Without the lock this is where a
    // raw constraint violation would surface instead.
    expect(statusOf(refusal)).toBe(400)
    expect(codeOf(refusal)).toBe('CATEGORY_MAX_DEPTH')

    const [deepest] = await db.query<{ depth: number }>(
      `SELECT max("depth") AS depth FROM "Category"`,
    )

    expect(deepest?.depth).toBeLessThanOrEqual(3)
    expect(await inconsistentRows()).toEqual([])
  })
})

describe('two moves that would close a cycle', () => {
  it.each(RUNS)('refuses the second with 400 and leaves no cycle (run %i)', async () => {
    const [left, right] = [await createRoot('left'), await createRoot('right')]

    const results = await concurrently(2, (index) =>
      index === 0
        ? client().moveCategory(left, { parentId: right })
        : client().moveCategory(right, { parentId: left }),
    )

    expect(fulfilled(results)).toHaveLength(1)

    const [refusal] = rejected(results)

    expect(statusOf(refusal)).toBe(400)
    expect(codeOf(refusal)).toBe('CATEGORY_MOVE_INTO_SELF')

    // One of them is now the other's child, and neither is its own ancestor.
    const paths = await db.query<{ id: number; path: string }>(
      `SELECT "id", "path" FROM "Category" ORDER BY "id"`,
    )

    // Whichever request the lock let through decides which of the two is the
    // root; what matters is that the result is one of those two trees and not a
    // third thing that is neither.
    const shapes = [
      [`/${String(left)}/`, `/${String(left)}/${String(right)}/`].join(' '),
      [`/${String(right)}/`, `/${String(right)}/${String(left)}/`].join(' '),
    ]

    expect(shapes).toContain(
      paths
        .map((row) => row.path)
        .sort()
        .join(' '),
    )
    expect(await inconsistentRows()).toEqual([])
  })
})

describe('concurrent reordering of the same siblings', () => {
  it.each(RUNS)('ends on one of the submitted arrangements (run %i)', async () => {
    const parent = await createRoot('parent')
    const children: number[] = []

    for (const name of ['a', 'b', 'c', 'd']) children.push(await createChild(parent, name))

    const arrangements = [
      [...children].reverse(),
      [children[1], children[0], children[3], children[2]] as number[],
      [children[2], children[3], children[0], children[1]] as number[],
    ]

    const results = await concurrently(arrangements.length, (index) =>
      client().reorderCategories({
        parentId: parent,
        orderedIds: arrangements[index]!,
      }),
    )

    expect(fulfilled(results)).toHaveLength(arrangements.length)

    const stored = await db.query<{ id: number; sortOrder: number }>(
      `SELECT "id", "sortOrder" FROM "Category" WHERE "parentId" = $1 ORDER BY "sortOrder"`,
      [parent],
    )

    // Every position is used exactly once: no request wrote half an ordering.
    expect(stored.map((row) => row.sortOrder)).toEqual([0, 1, 2, 3])
    // And the result is one of the arrangements that was asked for, not a blend.
    expect(arrangements.map((order) => order.join(','))).toContain(
      stored.map((row) => row.id).join(','),
    )
  })
})

describe('concurrent edits of one category', () => {
  it.each(RUNS)('lets one version through and conflicts the other (run %i)', async () => {
    const id = await createRoot('edited')
    const { nodes } = await client().getCategoryTree({ rootId: id })
    const { version } = nodes[0] as { version: number }

    const results = await concurrently(2, (index) =>
      client().updateCategory(id, { version, name: index === 0 ? '왼쪽' : '오른쪽' }),
    )

    // The optimistic lock is the whole mechanism here (DECISIONS 4): the loser
    // is told, rather than having their edit silently replaced.
    expect(fulfilled(results)).toHaveLength(1)
    expect(statusOf(rejected(results)[0])).toBe(409)

    const { name, version: stored } = await db.one<{ name: string; version: number }>(
      `SELECT "name", "version" FROM "Category" WHERE "id" = $1`,
      [id],
    )

    expect(['왼쪽', '오른쪽']).toContain(name)
    expect(stored).toBe(version + 1)
  })
})

/**
 * Negative control A — the same race with no advisory lock, on the real table.
 *
 * The move is re-implemented here in raw SQL, exactly as the service does it but
 * without `pg_advisory_xact_lock`. It is never reachable from `apps/api/src`.
 *
 * The barrier pins the interleaving down: both transactions read before either
 * writes, which is what a busy database produces on its own. What comes out is
 * not a broken tree — the constraints see to that — but something no test would
 * catch by looking at the rows: **one of the two callers is told its move
 * succeeded when the statement matched nothing at all.**
 */
function moveWithoutLock(nodeId: number, parentId: number, gate: Barrier): Promise<number> {
  return db.withConnection(async (connection) => {
    await connection.query('BEGIN')
    try {
      const { rows: nodeRows } = await connection.query<{ path: string; depth: number }>(
        `SELECT "path", "depth" FROM "Category" WHERE "id" = $1`,
        [nodeId],
      )
      const { rows: parentRows } = await connection.query<{ path: string; depth: number }>(
        `SELECT "path", "depth" FROM "Category" WHERE "id" = $1`,
        [parentId],
      )
      const node = nodeRows[0]
      const parent = parentRows[0]

      if (node === undefined || parent === undefined) throw new Error('픽스처가 없습니다.')

      const newPrefix = `${parent.path}${String(nodeId)}/`

      // Everything above is now stale, and this is the moment a lock would have
      // been held since before the first read.
      await gate.arrive()

      const updated = await connection.query(
        `UPDATE "Category"
            SET "path"       = $2 || substring("path" from $3::int),
                "parentPath" = CASE WHEN "id" = $4 THEN $5
                                    ELSE $2 || substring("parentPath" from $3::int) END,
                "parentId"   = CASE WHEN "id" = $4 THEN $6 ELSE "parentId" END,
                "depth"      = "depth" + $7::int
          WHERE "path" LIKE $1 || '%'`,
        [
          node.path,
          newPrefix,
          node.path.length + 1,
          nodeId,
          parent.path,
          parentId,
          parent.depth + 1 - node.depth,
        ],
      )

      await connection.query('COMMIT')
      return updated.rowCount ?? 0
    } catch (error) {
      await connection.query('ROLLBACK')
      throw error
    }
  })
}

describe('negative control A — no advisory lock, real table', () => {
  it.each(RUNS)('reports a move that never happened (run %i)', async () => {
    const source = await createRoot('source')
    const node = await createChild(source, 'node')
    const leaf = await createChild(node, 'leaf')
    const [first, second] = [await createRoot('first'), await createRoot('second')]

    const gate = barrier(2)
    const results = await concurrently(2, (index) =>
      moveWithoutLock(node, index === 0 ? first : second, gate),
    )

    const affected = fulfilled(results).sort((left, right) => left - right)

    // One transaction moved the two-node subtree. The other re-evaluated its
    // `WHERE path LIKE '/source/node/%'` against the committed rows, matched
    // nothing, and returned to its caller with no error to report.
    expect(affected).toEqual([0, 2])

    // The tree is intact — the constraints never let it be otherwise — and the
    // node is under whichever request happened to write first. The caller of
    // the other one has no way to know that.
    const finalPath = await pathOfCategory(node)

    expect([`/${String(first)}/${String(node)}/`, `/${String(second)}/${String(node)}/`]).toContain(
      finalPath,
    )
    expect(await pathOfCategory(leaf)).toBe(`${finalPath}${String(leaf)}/`)
    expect(await inconsistentRows()).toEqual([])
  })

  it.each(RUNS)('the locked path performs both moves instead (run %i)', async () => {
    const source = await createRoot('source')
    const node = await createChild(source, 'node')
    const [first, second] = [await createRoot('first'), await createRoot('second')]

    const results = await concurrently(2, (index) =>
      client().moveCategory(node, { parentId: index === 0 ? first : second }),
    )

    // Same tree, same two requests, same moment — and here every caller's answer
    // describes a move that really took place.
    expect(
      fulfilled(results)
        .map((answer) => answer.category.parentId)
        .sort(),
    ).toEqual([first, second].sort((left, right) => left - right))
  })
})

/**
 * Negative control B — no lock and no constraints.
 *
 * `TestCategoryNaive` (`test/setup/test-schema.sql`) is shaped like `Category`
 * and defends nothing: no composite foreign key, no checks. It exists for this
 * file alone and is never referenced by `apps/api/src`.
 *
 * Running the same interleaving here answers the question the two blocks above
 * cannot: *would* the tree break? It does, in both of the ways the design set
 * out to prevent — a cycle, and a subtree the path cache no longer leads to.
 */
async function naiveRoot(name: string): Promise<{ id: number; path: string }> {
  return db.one<{ id: number; path: string }>(
    `WITH allocated AS (
       SELECT nextval(pg_get_serial_sequence('"TestCategoryNaive"', 'id'))::int AS id
     )
     INSERT INTO "TestCategoryNaive" ("id", "parentId", "parentPath", "path", "depth", "name")
     SELECT a.id, NULL, NULL, '/' || a.id || '/', 1, $1 FROM allocated a
     RETURNING "id", "path"`,
    [name],
  )
}

async function naiveChild(
  parent: { id: number; path: string },
  name: string,
): Promise<{ id: number; path: string }> {
  return db.one<{ id: number; path: string }>(
    `WITH allocated AS (
       SELECT nextval(pg_get_serial_sequence('"TestCategoryNaive"', 'id'))::int AS id
     )
     INSERT INTO "TestCategoryNaive" ("id", "parentId", "parentPath", "path", "depth", "name")
     SELECT a.id, $1, $2, $2 || a.id || '/', 2, $3 FROM allocated a
     RETURNING "id", "path"`,
    [parent.id, parent.path, name],
  )
}

/**
 * The same move as `moveWithoutLock`, against the unguarded fixture table.
 *
 * Two rendezvous points rather than one. `read` releases when every caller has
 * read, and `commit` — when given — releases when every caller has *written*,
 * so no transaction can see another's rows before choosing what to update. That
 * second gate is what makes the outcome a fact instead of a coin toss: without
 * it, a mover that happens to run after its rival committed matches the rival's
 * rows too and the corruption takes a different (but equally broken) shape.
 */
function naiveMove(
  node: { id: number; path: string },
  parent: { id: number; path: string },
  gates: { readonly read: Barrier; readonly commit?: Barrier },
): Promise<number> {
  return db.withConnection(async (connection) => {
    await connection.query('BEGIN')
    try {
      const { rows } = await connection.query<{ path: string; depth: number }>(
        `SELECT "path", "depth" FROM "TestCategoryNaive" WHERE "id" = $1`,
        [node.id],
      )
      const seen = rows[0]

      if (seen === undefined) throw new Error('픽스처가 없습니다.')

      const newPrefix = `${parent.path}${String(node.id)}/`

      await gates.read.arrive()

      const updated = await connection.query(
        `UPDATE "TestCategoryNaive"
            SET "path"       = $2 || substring("path" from $3::int),
                "parentPath" = CASE WHEN "id" = $4 THEN $5
                                    ELSE $2 || substring("parentPath" from $3::int) END,
                "parentId"   = CASE WHEN "id" = $4 THEN $6 ELSE "parentId" END,
                "depth"      = "depth" + 1
          WHERE "path" LIKE $1 || '%'`,
        [seen.path, newPrefix, seen.path.length + 1, node.id, parent.path, parent.id],
      )

      await gates.commit?.arrive()
      await connection.query('COMMIT')
      return updated.rowCount ?? 0
    } catch (error) {
      await connection.query('ROLLBACK')
      throw error
    }
  })
}

describe('negative control B — no lock, no constraints', () => {
  it.each(RUNS)('closes a cycle that no query can escape (run %i)', async () => {
    const left = await naiveRoot('left')
    const right = await naiveRoot('right')

    const gates = { read: barrier(2), commit: barrier(2) }
    const results = await concurrently(2, (index) =>
      index === 0 ? naiveMove(left, right, gates) : naiveMove(right, left, gates),
    )

    // Both "succeed": each moved one row, and neither knew about the other.
    expect(fulfilled(results)).toEqual([1, 1])

    const rows = await db.query<{ id: number; parentId: number | null; path: string }>(
      `SELECT "id", "parentId", "path" FROM "TestCategoryNaive" ORDER BY "id"`,
    )
    const parentOf = new Map(rows.map((row) => [row.id, row.parentId]))

    // Each is now the other's parent. Walking up from either never terminates —
    // which is exactly what the composite foreign key on `Category` makes
    // impossible, and what the advisory lock keeps the service from attempting.
    expect(parentOf.get(left.id)).toBe(right.id)
    expect(parentOf.get(right.id)).toBe(left.id)

    // The cached paths agree with the cycle rather than with any real tree.
    expect(rows.map((row) => row.path).sort()).toEqual(
      [
        `/${String(right.id)}/${String(left.id)}/`,
        `/${String(left.id)}/${String(right.id)}/`,
      ].sort(),
    )
  })

  it.each(RUNS)('strands a subtree the path cache no longer reaches (run %i)', async () => {
    const branch = await naiveRoot('branch')
    const middle = await naiveChild(branch, 'middle')
    const destination = await naiveRoot('destination')

    // Two rendezvous points, so the interleaving is fixed rather than likely:
    // the second transaction reads first, then waits for the first to commit,
    // and finally writes from what it read.
    const read = barrier(2)
    const written = barrier(2)

    await Promise.all([
      (async () => {
        await naiveMove(branch, destination, { read })
        await written.arrive()
      })(),
      db.withConnection(async (connection) => {
        await connection.query('BEGIN')

        const { rows } = await connection.query<{ path: string }>(
          `SELECT "path" FROM "TestCategoryNaive" WHERE "id" = $1`,
          [middle.id],
        )
        const parentPath = rows[0]?.path ?? ''

        await read.arrive()
        await written.arrive()

        await connection.query(
          `WITH allocated AS (
             SELECT nextval(pg_get_serial_sequence('"TestCategoryNaive"', 'id'))::int AS id
           )
           INSERT INTO "TestCategoryNaive" ("id", "parentId", "parentPath", "path", "depth", "name")
           SELECT a.id, $1, $2, $2 || a.id || '/', 3, 'stranded' FROM allocated a`,
          [middle.id, parentPath],
        )
        await connection.query('COMMIT')
      }),
    ])

    const moved = await db.one<{ path: string }>(
      `SELECT "path" FROM "TestCategoryNaive" WHERE "id" = $1`,
      [branch.id],
    )

    // The subtree read the API performs — one prefix match on `path` — no longer
    // finds the new node, although its `parentId` chain leads straight into this
    // branch. Two answers to "what is under this category", which is precisely
    // the failure the path cache exists to avoid.
    const byPath = await db.query<{ id: number }>(
      `SELECT "id" FROM "TestCategoryNaive" WHERE "path" LIKE $1 || '%'`,
      [moved.path],
    )
    const byParent = await db.query<{ id: number }>(
      `WITH RECURSIVE descendants AS (
         SELECT "id" FROM "TestCategoryNaive" WHERE "id" = $1
         UNION ALL
         SELECT c."id" FROM "TestCategoryNaive" c JOIN descendants d ON c."parentId" = d."id"
       )
       SELECT "id" FROM descendants`,
      [branch.id],
    )

    expect(byPath).toHaveLength(2)
    expect(byParent).toHaveLength(3)
  })
})
