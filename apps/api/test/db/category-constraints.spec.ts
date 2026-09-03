import { DatabaseError } from 'pg'
import { describe, expect, it } from 'vitest'

import { useDatabase } from '../support/database.js'
import type { CategoryRow } from '../support/factories.js'
import { createCategory, createCategoryBranch } from '../support/factories.js'

/**
 * Gate S5 for the category tree: the rules are tried against the real database.
 *
 * The tree's invariants — no cycles, at most three levels, one live category per
 * slug — are races that an application check loses. Two requests each read a
 * legal tree, each decide their change keeps it legal, and both commit. So the
 * rules are stated in the migration, and this file is where "stated" is proven
 * to mean "enforced".
 *
 * Each rule is tried **twice**, as TASK-0106 4.8 established: a violation has to
 * be refused with the right SQLSTATE and constraint name, and the neighbouring
 * case that must be permitted has to succeed. The second half is what a check of
 * the migration text can never do — a predicate written backwards still refuses
 * violations, it just also refuses everything else.
 *
 * Every attempt is raw SQL. Going through Prisma or through `CategoryService`
 * would let application validation answer first, and the question here is
 * precisely whether the database would have refused on its own.
 */

const db = useDatabase()

/** Runs `work`, asserting that it was the database that refused, and how. */
async function refusal(work: Promise<unknown>): Promise<DatabaseError> {
  const error: unknown = await work.then(
    () => null,
    (reason: unknown) => reason,
  )

  if (!(error instanceof DatabaseError)) {
    throw new Error(
      `DB 가 거부할 것으로 기대했지만 성공했거나 다른 오류가 났습니다: ${String(error)}`,
    )
  }
  return error
}

/** Inserts a row with every tree column written by hand, defaults included. */
function insertRaw(row: {
  id: number
  parentId: number | null
  parentPath: string | null
  path: string
  depth: number
  slug: string
  sortOrder?: number
  deletedAt?: Date | null
}): Promise<unknown> {
  return db.execute(
    `INSERT INTO "Category"
       ("id", "parentId", "parentPath", "path", "depth", "name", "slug", "sortOrder", "deletedAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, '이름', $6, $7, $8, now())`,
    [
      row.id,
      row.parentId,
      row.parentPath,
      row.path,
      row.depth,
      row.slug,
      row.sortOrder ?? 0,
      row.deletedAt ?? null,
    ],
  )
}

/** An id from the sequence, so nothing here ever hard-codes one (rule T4). */
async function nextId(): Promise<number> {
  const { id } = await db.one<{ id: number }>(
    `SELECT nextval(pg_get_serial_sequence('"Category"', 'id'))::int AS id`,
  )

  return id
}

async function rowOf(id: number): Promise<CategoryRow> {
  return db.one<CategoryRow>(
    `SELECT "id", "parentId", "path", "depth", "slug", "sortOrder" FROM "Category" WHERE "id" = $1`,
    [id],
  )
}

describe('Category_depth_range_check — three levels, no more', () => {
  it('refuses a fourth level', async () => {
    const { leaf } = await createCategoryBranch(db, 'depth')
    const id = await nextId()

    const error = await refusal(
      insertRaw({
        id,
        parentId: leaf.id,
        parentPath: leaf.path,
        path: `${leaf.path}${String(id)}/`,
        depth: 4,
        slug: 'fourth-level',
      }),
    )

    expect(error.code).toBe('23514')
    expect(error.constraint).toBe('Category_depth_range_check')
  })

  it('allows all three levels', async () => {
    const { root, child, leaf } = await createCategoryBranch(db, 'ok')

    expect([root.depth, child.depth, leaf.depth]).toEqual([1, 2, 3])
  })

  it('refuses a depth below the first level', async () => {
    const id = await nextId()
    const error = await refusal(
      insertRaw({
        id,
        parentId: null,
        parentPath: null,
        path: `/${String(id)}/`,
        depth: 0,
        slug: 'level-zero',
      }),
    )

    // A depth of zero breaks both depth rules at once — no path can hold zero
    // ids — and PostgreSQL reports whichever it evaluated first. Naming one of
    // them here would make the test depend on that order.
    expect(error.code).toBe('23514')
    expect(error.constraint).toMatch(/^Category_depth_/)
  })
})

describe('Category_depth_path_check — depth agrees with the path', () => {
  it('refuses a row that understates its depth', async () => {
    const root = await createCategory(db, { slug: 'lying-root' })
    const id = await nextId()

    const error = await refusal(
      insertRaw({
        id,
        parentId: root.id,
        parentPath: root.path,
        path: `${root.path}${String(id)}/`,
        // The path holds two ids; claiming one would make the node look like a
        // root to every query that filters on `depth`.
        depth: 1,
        slug: 'lying-child',
      }),
    )

    expect(error.code).toBe('23514')
    expect(error.constraint).toBe('Category_depth_path_check')
  })

  it('allows the honest depth for the same row', async () => {
    const root = await createCategory(db, { slug: 'honest-root' })
    const child = await createCategory(db, { parent: root, slug: 'honest-child' })

    expect(child.depth).toBe(2)
    expect(child.path).toBe(`${root.path}${String(child.id)}/`)
  })
})

describe('Category_path_shape_check — the path is the parent path plus the id', () => {
  it('refuses a path that does not end in its own id', async () => {
    const id = await nextId()
    const error = await refusal(
      insertRaw({
        id,
        parentId: null,
        parentPath: null,
        path: `/${String(id + 1)}/`,
        depth: 1,
        slug: 'wrong-tail',
      }),
    )

    expect(error.code).toBe('23514')
    expect(error.constraint).toBe('Category_path_shape_check')
  })

  it('refuses a path that skips its parent', async () => {
    const root = await createCategory(db, { slug: 'skip-root' })
    const id = await nextId()

    const error = await refusal(
      insertRaw({
        id,
        parentId: root.id,
        parentPath: root.path,
        // Claims to be a root while pointing at a parent.
        path: `/${String(id)}/`,
        depth: 1,
        slug: 'skip-child',
      }),
    )

    expect(error.code).toBe('23514')
    expect(error.constraint).toBe('Category_path_shape_check')
  })

  it('allows a path with gaps in the ids above it', async () => {
    // Ids are never reused, so a real path is full of holes. The check compares
    // strings, not sequences, and must not care.
    const root = await createCategory(db, { slug: 'gap-root' })

    await nextId()
    await nextId()

    const child = await createCategory(db, { parent: root, slug: 'gap-child' })

    expect(child.id).toBeGreaterThan(root.id + 1)
    expect(child.path).toBe(`${root.path}${String(child.id)}/`)
  })
})

describe('Category_parent_pairing_check — both halves of the parent edge', () => {
  it('refuses a parent id without a parent path', async () => {
    const root = await createCategory(db, { slug: 'pairing-root' })
    const id = await nextId()

    const error = await refusal(
      insertRaw({
        id,
        parentId: root.id,
        parentPath: null,
        path: `/${String(id)}/`,
        depth: 1,
        slug: 'pairing-child',
      }),
    )

    expect(error.code).toBe('23514')
    expect(error.constraint).toBe('Category_parent_pairing_check')
  })

  it('allows a root, which has neither half', async () => {
    const root = await createCategory(db, { slug: 'pairing-ok' })
    const stored = await db.one<{ parentId: number | null; parentPath: string | null }>(
      `SELECT "parentId", "parentPath" FROM "Category" WHERE "id" = $1`,
      [root.id],
    )

    expect(stored).toEqual({ parentId: null, parentPath: null })
  })
})

describe('Category_parentId_parentPath_fkey — the edge points at a real parent', () => {
  it('refuses a forged ancestor path', async () => {
    const root = await createCategory(db, { slug: 'forge-root' })
    const id = await nextId()

    const error = await refusal(
      insertRaw({
        id,
        parentId: root.id,
        // Well-formed, self-consistent, and not this parent's path.
        parentPath: '/9999/',
        path: `/9999/${String(id)}/`,
        depth: 2,
        slug: 'forged',
      }),
    )

    expect(error.code).toBe('23503')
    expect(error.constraint).toBe('Category_parentId_parentPath_fkey')
  })

  /**
   * The cycle case, and the reason the edge is composite.
   *
   * A plain `parentId` reference would happily accept this update: node A
   * becoming a child of its own descendant is a perfectly good integer. What
   * refuses it is that A's path is still referenced by everything below A, so
   * changing it orphans them — and PostgreSQL checks that at the end of the
   * statement, whatever the application believed.
   */
  it('refuses making a node a child of its own descendant', async () => {
    const { root, child } = await createCategoryBranch(db, 'cycle')

    const error = await refusal(
      db.execute(
        `UPDATE "Category"
            SET "parentId" = $2, "parentPath" = $3, "path" = $3 || $1::text || '/', "depth" = 3
          WHERE "id" = $1`,
        [root.id, child.id, child.path],
      ),
    )

    expect(error.code).toBe('23503')
    expect(error.constraint).toBe('Category_parentId_parentPath_fkey')
  })

  /**
   * The move that *is* legal, done the way `CategoryService` does it.
   *
   * One statement for the whole subtree. `ON UPDATE NO ACTION` is verified when
   * the statement ends, by which time the parent and its descendants agree
   * again — the same rewrite split into two statements would be refused, which
   * is why the service issues exactly one.
   */
  it('allows a subtree to move when parent and descendants are rewritten together', async () => {
    const { root, child, leaf } = await createCategoryBranch(db, 'move')
    const destination = await createCategory(db, { slug: 'move-destination' })
    const newPrefix = `${destination.path}${String(child.id)}/`

    const affected = await db.execute(
      `UPDATE "Category"
          SET "path"       = $2 || substring("path" from $3::int),
              "parentPath" = CASE WHEN "id" = $4 THEN $5
                                  ELSE $2 || substring("parentPath" from $3::int) END,
              "parentId"   = CASE WHEN "id" = $4 THEN $6 ELSE "parentId" END,
              "depth"      = "depth" + 0
        WHERE "path" LIKE $1 || '%'`,
      [child.path, newPrefix, child.path.length + 1, child.id, destination.path, destination.id],
    )

    expect(affected).toBe(2)
    expect((await rowOf(child.id)).path).toBe(newPrefix)
    expect((await rowOf(leaf.id)).path).toBe(`${newPrefix}${String(leaf.id)}/`)
    // The old parent is untouched and still a valid root.
    expect((await rowOf(root.id)).path).toBe(root.path)
  })
})

describe('Category_slug_active_key — one live category per slug', () => {
  it('refuses a second live category with the same slug', async () => {
    await createCategory(db, { slug: 'shoes' })

    const error = await refusal(createCategory(db, { slug: 'shoes' }))

    expect(error.code).toBe('23505')
    expect(error.constraint).toBe('Category_slug_active_key')
  })

  it('lets a deleted category release its slug', async () => {
    const first = await createCategory(db, {
      slug: 'bags',
      deletedAt: new Date('2026-01-01T00:00:00.000Z'),
    })
    const second = await createCategory(db, { slug: 'bags' })

    expect(second.id).not.toBe(first.id)

    const { count } = await db.one<{ count: string }>(
      `SELECT count(*)::text AS count FROM "Category" WHERE "slug" = 'bags'`,
    )

    expect(count).toBe('2')
  })

  it('allows any number of deleted rows sharing one slug', async () => {
    const deletedAt = new Date('2026-01-01T00:00:00.000Z')

    await createCategory(db, { slug: 'hats', deletedAt })
    await createCategory(db, { slug: 'hats', deletedAt })

    const { count } = await db.one<{ count: string }>(
      `SELECT count(*)::text AS count FROM "Category" WHERE "slug" = 'hats'`,
    )

    expect(count).toBe('2')
  })
})

describe('Category_sortOrder_check — a position is never negative', () => {
  it('refuses a negative sort order', async () => {
    const error = await refusal(createCategory(db, { slug: 'negative', sortOrder: -1 }))

    expect(error.code).toBe('23514')
    expect(error.constraint).toBe('Category_sortOrder_check')
  })

  it('allows zero and any gap above it', async () => {
    const first = await createCategory(db, { slug: 'order-zero', sortOrder: 0 })
    const second = await createCategory(db, { slug: 'order-gap', sortOrder: 900 })

    expect([first.sortOrder, second.sortOrder]).toEqual([0, 900])
  })
})

describe('ids are never reused', () => {
  it('leaves a gap where a deleted category was', async () => {
    const first = await createCategory(db, { slug: 'gap-one' })
    const second = await createCategory(db, { slug: 'gap-two' })

    await db.execute(`UPDATE "Category" SET "deletedAt" = now() WHERE "id" = $1`, [second.id])

    const third = await createCategory(db, { slug: 'gap-three' })

    expect(second.id).toBe(first.id + 1)
    expect(third.id).toBe(second.id + 1)
  })

  it('keeps the id even when the insert that drew it failed', async () => {
    const burned = await nextId()
    const next = await createCategory(db, { slug: 'after-burn' })

    // A sequence is not rolled back, which is the whole mechanism: an id that
    // was ever handed out never comes back, so a stale `categoryId` in an order
    // snapshot can only ever point at nothing, never at something else.
    expect(next.id).toBe(burned + 1)
  })
})
