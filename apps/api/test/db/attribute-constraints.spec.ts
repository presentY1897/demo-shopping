import { DatabaseError } from 'pg'
import { describe, expect, it } from 'vitest'

import { useDatabase } from '../support/database.js'
import type { CategoryRow } from '../support/factories.js'
import { createAttributeDefinition, createCategory } from '../support/factories.js'

/**
 * Gate S5 for attribute definitions: the rules are tried against the real
 * database.
 *
 * Splitting definitions (rows) from values (JSONB) buys the catalogue a listing
 * with no joins and costs it the database's say over a single value
 * (`docs/design/erd.md` 2). What the database *can* still hold is the shape of
 * the definition itself, and this file is where "stated in the migration" is
 * proven to mean "enforced".
 *
 * Each rule is tried **twice**, as TASK-0106 4.8 established: a violation has to
 * be refused with the right SQLSTATE and constraint name, and the neighbouring
 * case that must be permitted has to succeed. The second half is what a check of
 * the migration text can never do — a predicate written backwards still refuses
 * violations, it just also refuses everything else.
 *
 * Every attempt is raw SQL. Going through Prisma or through `AttributeService`
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

interface RawDefinition {
  readonly categoryId: number
  readonly key?: string
  readonly label?: string
  readonly type?: string
  readonly options?: readonly string[]
  readonly sortOrder?: number
  readonly deletedAt?: Date | null
}

/** Inserts a row with every column written by hand, defaults included. */
function insertRaw(row: RawDefinition): Promise<unknown> {
  return db.execute(
    `INSERT INTO "AttributeDefinition"
       ("categoryId", "key", "label", "type", "options", "sortOrder", "deletedAt", "updatedAt")
     VALUES ($1, $2, $3, $4::"AttributeType", $5::text[], $6, $7, now())`,
    [
      row.categoryId,
      row.key ?? 'material',
      row.label ?? '소재',
      row.type ?? 'TEXT',
      row.options ?? [],
      row.sortOrder ?? 0,
      row.deletedAt ?? null,
    ],
  )
}

async function category(): Promise<CategoryRow> {
  return createCategory(db)
}

describe('AttributeDefinition_categoryId_key_active_key — one live key per category', () => {
  it('refuses a second live definition of the same key', async () => {
    const owner = await category()

    await createAttributeDefinition(db, { categoryId: owner.id, key: 'material' })

    const error = await refusal(insertRaw({ categoryId: owner.id, key: 'material' }))

    expect(error.code).toBe('23505')
    expect(error.constraint).toBe('AttributeDefinition_categoryId_key_active_key')
  })

  it('allows the same key on a different category', async () => {
    const [first, second] = [await category(), await category()]

    await createAttributeDefinition(db, { categoryId: first.id, key: 'material' })

    // Uniqueness is per category. The rule that spans a *lineage* cannot be a
    // constraint at all — a CHECK may not run a subquery — so it lives in
    // `AttributeService` under the tree lock and is proven by
    // `attribute-lineage-contention.spec.ts` instead.
    await expect(
      createAttributeDefinition(db, { categoryId: second.id, key: 'material' }),
    ).resolves.toMatchObject({ key: 'material' })
  })

  it('lets a deleted definition free its key', async () => {
    const owner = await category()

    await createAttributeDefinition(db, {
      categoryId: owner.id,
      key: 'material',
      deletedAt: new Date('2026-09-03T00:00:00.000Z'),
    })

    // A plain unique index would let a retired definition hold its key forever,
    // exactly as it would let a withdrawn account hold its Google identity.
    await expect(
      createAttributeDefinition(db, { categoryId: owner.id, key: 'material' }),
    ).resolves.toMatchObject({ key: 'material' })
  })
})

describe('AttributeDefinition_key_format_check — the key is an identifier', () => {
  it.each([
    ['대문자', 'Material'],
    ['점', 'size.eu'],
    ['공백', 'size eu'],
    ['숫자로 시작', '1size'],
    ['하이픈', 'size-eu'],
    ['빈 문자열', ''],
    ['40자 초과', `a${'b'.repeat(40)}`],
  ])('refuses a key with %s', async (_label, key) => {
    const owner = await category()
    const error = await refusal(insertRaw({ categoryId: owner.id, key }))

    expect(error.code).toBe('23514')
    expect(error.constraint).toBe('AttributeDefinition_key_format_check')
  })

  it.each([
    ['소문자', 'material'],
    ['밑줄', 'size_eu'],
    ['숫자 포함', 'size2'],
    ['40자', `a${'b'.repeat(39)}`],
  ])('allows a key with %s', async (_label, key) => {
    const owner = await category()

    await expect(insertRaw({ categoryId: owner.id, key })).resolves.toBe(1)
  })
})

describe('AttributeDefinition_options_check — options belong to the types that have them', () => {
  it.each(['SELECT', 'MULTI_SELECT'])('refuses %s with no options', async (type) => {
    const owner = await category()
    const error = await refusal(insertRaw({ categoryId: owner.id, type, options: [] }))

    // A SELECT with no choices can never validate any value, and a required one
    // makes every product in the category permanently unsaveable.
    expect(error.code).toBe('23514')
    expect(error.constraint).toBe('AttributeDefinition_options_check')
  })

  it.each(['TEXT', 'NUMBER', 'BOOLEAN'])('refuses %s carrying options', async (type) => {
    const owner = await category()
    const error = await refusal(
      insertRaw({ categoryId: owner.id, type, options: ['블랙', '화이트'] }),
    )

    expect(error.code).toBe('23514')
    expect(error.constraint).toBe('AttributeDefinition_options_check')
  })

  it.each(['SELECT', 'MULTI_SELECT'])('allows %s with one option', async (type) => {
    const owner = await category()

    await expect(insertRaw({ categoryId: owner.id, type, options: ['블랙'] })).resolves.toBe(1)
  })

  it.each(['TEXT', 'NUMBER', 'BOOLEAN'])('allows %s with none', async (type) => {
    const owner = await category()

    await expect(insertRaw({ categoryId: owner.id, type, options: [] })).resolves.toBe(1)
  })
})

describe('AttributeDefinition_option_blank_check — no unlabelled choice', () => {
  it('refuses an empty option', async () => {
    const owner = await category()
    const error = await refusal(
      insertRaw({ categoryId: owner.id, type: 'SELECT', options: ['블랙', ''] }),
    )

    expect(error.code).toBe('23514')
    expect(error.constraint).toBe('AttributeDefinition_option_blank_check')
  })

  it('allows options that all carry text', async () => {
    const owner = await category()

    await expect(
      insertRaw({ categoryId: owner.id, type: 'SELECT', options: ['블랙', '화이트'] }),
    ).resolves.toBe(1)
  })

  it("does not enforce distinctness — that one is the application's", async () => {
    const owner = await category()

    // Deliberate, and worth pinning down: telling duplicates from distinct
    // values needs an aggregate, and a CHECK may not contain one. So the
    // database accepts this row and `createAttributeRequestSchema` is what
    // refuses it — see `attributes.integration.spec.ts`.
    await expect(
      insertRaw({ categoryId: owner.id, type: 'SELECT', options: ['블랙', '블랙'] }),
    ).resolves.toBe(1)
  })
})

describe('AttributeDefinition_label_check — the label is readable', () => {
  it.each([
    ['빈 문자열', ''],
    ['공백뿐', '   '],
  ])('refuses a label that is %s', async (_label, value) => {
    const owner = await category()
    const error = await refusal(insertRaw({ categoryId: owner.id, label: value }))

    expect(error.code).toBe('23514')
    expect(error.constraint).toBe('AttributeDefinition_label_check')
  })

  it('allows a label with text', async () => {
    const owner = await category()

    await expect(insertRaw({ categoryId: owner.id, label: ' 소재 ' })).resolves.toBe(1)
  })
})

describe('AttributeDefinition_sortOrder_check — a position, never negative', () => {
  it('refuses a negative position', async () => {
    const owner = await category()
    const error = await refusal(insertRaw({ categoryId: owner.id, sortOrder: -1 }))

    expect(error.code).toBe('23514')
    expect(error.constraint).toBe('AttributeDefinition_sortOrder_check')
  })

  it('allows zero', async () => {
    const owner = await category()

    await expect(insertRaw({ categoryId: owner.id, sortOrder: 0 })).resolves.toBe(1)
  })
})

describe('AttributeDefinition_categoryId_fkey — a definition belongs to a category', () => {
  it('refuses a definition attached to nothing', async () => {
    const error = await refusal(insertRaw({ categoryId: 9_999 }))

    expect(error.code).toBe('23503')
    expect(error.constraint).toBe('AttributeDefinition_categoryId_fkey')
  })

  it('refuses deleting a category that still carries definitions', async () => {
    const owner = await category()

    await createAttributeDefinition(db, { categoryId: owner.id })

    // Categories are retired with `deletedAt`, so this `DELETE` is the one
    // nobody wrote — an import script, a console session. `RESTRICT` is what
    // keeps it from taking the definitions with it and leaving every product's
    // `attributes` unexplainable.
    const error = await refusal(db.execute(`DELETE FROM "Category" WHERE "id" = $1`, [owner.id]))

    expect(error.code).toBe('23503')
    expect(error.constraint).toBe('AttributeDefinition_categoryId_fkey')
  })

  it('allows retiring the category the definition hangs off', async () => {
    const owner = await category()

    await createAttributeDefinition(db, { categoryId: owner.id })

    await expect(
      db.execute(`UPDATE "Category" SET "deletedAt" = now() WHERE "id" = $1`, [owner.id]),
    ).resolves.toBe(1)
  })
})

describe('the type is a closed set', () => {
  it('refuses a type the enum does not name', async () => {
    const owner = await category()
    const error = await refusal(insertRaw({ categoryId: owner.id, type: 'COLOUR_PICKER' }))

    // `22P02`, invalid text representation: the enum makes an unknown type
    // unrepresentable rather than merely unvalidated, which is what lets
    // `attribute-schema.ts` use a total `Record<AttributeType, …>` lookup with
    // no default branch.
    expect(error.code).toBe('22P02')
  })
})
