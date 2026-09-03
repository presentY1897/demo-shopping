import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { Prisma } from '@prisma/client'
import type {
  AttributeDefinition,
  AttributeListQuery,
  AttributeListResponse,
  AttributeResponse,
  AttributeType,
  CreateAttributeRequest,
  EffectiveAttribute,
  UpdateAttributeRequest,
} from '@shopping/shared'
import { optionIssues, platformOwnership } from '@shopping/shared'

import { assertResourceAccess } from '../auth/access-denied.js'
import type { RequestPrincipal } from '../auth/request-principal.js'
import type { Clock } from '../common/clock.js'
import { CLOCK } from '../common/clock.js'
import { domainFailure } from '../common/domain-failure.js'
import { PrismaService } from '../prisma/prisma.service.js'
import type { Inherited } from './attribute-inheritance.js'
import { ancestorIdsOf, resolveEffectiveAttributes } from './attribute-inheritance.js'
import type { AttributeRule, AttributeValidation } from './attribute-schema.js'
import { validateAttributeValues } from './attribute-schema.js'
import {
  CATEGORY_TREE_LOCK_CLASS,
  CATEGORY_TREE_LOCK_KEY,
  CATEGORY_TREE_LOCK_SQL,
} from './category-lock.js'

/** The transaction handle Prisma hands an interactive transaction. */
type Tx = Prisma.TransactionClient

/** Columns every answer is built from. Internal columns stay internal. */
const DEFINITION_FIELDS = [
  'id',
  'categoryId',
  'key',
  'label',
  'type',
  'options',
  'isRequired',
  'isFilterable',
  'sortOrder',
  'version',
] as const

const DEFINITION_COLUMNS = Prisma.raw(DEFINITION_FIELDS.map((field) => `"${field}"`).join(', '))

/** Qualified for the join in {@link AttributeService.list}, where two tables are in scope. */
const JOINED_COLUMNS = Prisma.raw(DEFINITION_FIELDS.map((field) => `d."${field}"`).join(', '))

/** SQLSTATE of a unique violation: the per-category key index is the only one here. */
const UNIQUE_VIOLATION = '23505'

/**
 * The SQLSTATE behind a failed raw query, if there is one.
 *
 * Prisma reports every raw-query failure as `P2010` and keeps the database's own
 * answer in the driver adapter's cause, so telling "key already defined" from
 * "something else went wrong" means looking there. Reading the message instead
 * would break the first time a locale or a version changes it.
 */
function sqlStateOf(error: unknown): string | undefined {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return undefined

  const cause = (error.meta as { driverAdapterError?: { cause?: { originalCode?: unknown } } })
    .driverAdapterError?.cause?.originalCode

  return typeof cause === 'string' ? cause : undefined
}

/**
 * One row of the lineage read.
 *
 * Every definition column is nullable because the join is a `LEFT JOIN`: a
 * category with no definitions still answers with one row, carrying its path and
 * nothing else. That row is what tells an empty list apart from a 404.
 */
type LineageRow = { readonly targetPath: string } & {
  readonly [K in keyof AttributeDefinition]: AttributeDefinition[K] | null
}

/** A row that really carried a definition. */
type DefinedRow = { readonly targetPath: string } & AttributeDefinition

/** A definition resolved against a lineage, still carrying the join's extra column. */
type ResolvedAttribute = Inherited<DefinedRow>

/** The stored row an update has to read before it can decide anything. */
interface StoredDefinition {
  readonly id: number
  readonly categoryId: number
  readonly key: string
  readonly type: AttributeType
  readonly options: string[]
}

/**
 * Attribute definitions (TASK-0030).
 *
 * Four rules run through everything below.
 *
 * **Reads are one statement.** The lineage is derived inside the query from
 * `Category.path`, so resolving a three-level category costs exactly what
 * resolving a root costs and the count does not grow with the number of
 * definitions (gate A5).
 *
 * **Writes hold the category tree lock.** The rule they enforce — one live
 * definition of a key per *lineage* — spans rows the database cannot see from a
 * CHECK, and a lineage is exactly what a category move rewrites. Sharing
 * TASK-0028's lock rather than taking one of our own is what makes the check
 * sound against the tree it read (TASK-0030 4.2).
 *
 * **The database still has the final say on shape.** Key format, the
 * options/type agreement, the label, the per-category key: all of them are
 * constraints in the migration. The checks here exist to turn a violation into a
 * 400 that names the problem, not to be the thing that prevents it.
 *
 * **Values are judged by generated schemas, never by hand.**
 * {@link AttributeService.validateAttributes} reads the definitions and builds a
 * zod schema from them on every call. There is no cache, which is what makes
 * "정의를 추가하면 즉시 검증에 반영된다" (완료 기준 F6) true rather than
 * eventually true.
 */
@Injectable()
export class AttributeService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * The definitions that apply to one category, ancestors' included.
   *
   * `includeInherited: false` narrows the answer to the rows this category owns
   * — what an editing screen needs, because those are the only ones it may
   * change. The inherited ones are still resolved first, so a definition hidden
   * by a nearer one does not reappear just because the caller asked for less.
   */
  async list(
    principal: RequestPrincipal,
    query: AttributeListQuery,
  ): Promise<AttributeListResponse> {
    assertResourceAccess(principal, 'catalog.read', platformOwnership)

    const effective = await this.effectiveFor(this.prisma, query.categoryId)
    const includeInherited = query.includeInherited ?? true

    return {
      attributes: effective
        .filter((attribute) => includeInherited || !attribute.inherited)
        .map((attribute) => this.present(attribute)),
    }
  }

  /**
   * Adds a definition to one category.
   *
   * Inside the tree lock, and the order matters: the lineage is read after the
   * lock is taken, so the set of ancestors and descendants the conflict check
   * looked at is the set the row is inserted into.
   */
  async create(
    principal: RequestPrincipal,
    input: CreateAttributeRequest,
  ): Promise<AttributeResponse> {
    assertResourceAccess(principal, 'catalog.write', platformOwnership)

    return this.inTree(async (tx) => {
      const category = await this.categoryFor(tx, input.categoryId)

      await this.refuseLineageConflict(tx, category.path, input.key)

      const sortOrder = input.sortOrder ?? (await this.nextSortOrder(tx, input.categoryId))
      const now = this.now()

      const created = await this.uniqueKey(
        category.name,
        () => tx.$queryRaw<AttributeDefinition[]>`
          INSERT INTO "AttributeDefinition"
            ("categoryId", "key", "label", "type", "options",
             "isRequired", "isFilterable", "sortOrder", "createdAt", "updatedAt")
          VALUES (${input.categoryId}::int, ${input.key}::text, ${input.label}::text,
                  ${input.type}::"AttributeType", ${input.options ?? []}::text[],
                  ${input.isRequired ?? false}::boolean, ${input.isFilterable ?? false}::boolean,
                  ${sortOrder}::int, ${now}, ${now})
          RETURNING ${DEFINITION_COLUMNS}
        `,
      )

      return { attribute: this.only(created) }
    })
  }

  /**
   * Edits the fields an operator types, guarded by the optimistic lock.
   *
   * `key` and `type` are not among them, and the request schema has no place to
   * send them: both change the meaning of values already stored under this
   * definition (`packages/shared/src/api/attributes.ts`). What *can* change is
   * the option list, which is why the type has to be read back from the row
   * before the same check the create request runs can be applied to it.
   *
   * No tree lock: nothing here changes which categories a key is defined on.
   */
  async update(
    principal: RequestPrincipal,
    id: number,
    input: UpdateAttributeRequest,
  ): Promise<AttributeResponse> {
    assertResourceAccess(principal, 'catalog.write', platformOwnership)

    const stored = await this.mustExist(this.prisma, id)

    if (input.options !== undefined) {
      const issues = optionIssues(stored.type, input.options)

      if (issues.length > 0) {
        // One entry per issue, each naming `options` — the same shape
        // `parseInput` produces, so a form places these without a second branch.
        throw new BadRequestException({
          message: issues.map((issue) => ({
            field: issue.path.join('.'),
            message: issue.message,
            code: 'INVALID',
          })),
        })
      }
    }

    const updated = await this.prisma.$queryRaw<AttributeDefinition[]>`
      UPDATE "AttributeDefinition"
         SET "label"        = COALESCE(${input.label ?? null}::text, "label"),
             "options"      = COALESCE(${input.options ?? null}::text[], "options"),
             "isRequired"   = COALESCE(${input.isRequired ?? null}::boolean, "isRequired"),
             "isFilterable" = COALESCE(${input.isFilterable ?? null}::boolean, "isFilterable"),
             "sortOrder"    = COALESCE(${input.sortOrder ?? null}::int, "sortOrder"),
             "version"      = "version" + 1,
             "updatedAt"    = ${this.now()}
       WHERE "id" = ${id}::int
         AND "deletedAt" IS NULL
         AND "version" = ${input.version}::int
      RETURNING ${DEFINITION_COLUMNS}
    `

    if (updated.length === 1) return { attribute: this.only(updated) }

    // The row was there a moment ago, so this is a lost race rather than a dead
    // link — the distinction the caller needs, because one is resolved by
    // reloading and the other is not.
    await this.mustExist(this.prisma, id)
    throw new ConflictException(
      domainFailure(
        'ATTRIBUTE_VERSION_CONFLICT',
        '다른 관리자가 먼저 저장했어요. 최신 내용을 불러올까요?',
        { field: 'version' },
      ),
    )
  }

  /**
   * Retires a definition. The row stays and the key becomes free again.
   *
   * Soft, like a category's removal, and for a stronger reason: products keep
   * the key in their `attributes` JSONB, and a hard delete would leave a value
   * nothing can explain. The partial unique index is what lets the key be
   * defined again afterwards.
   *
   * TASK-0030 R2 asks for a refusal when the definition is still in use. That
   * check belongs to TASK-0032, which is where `Product` — and therefore the
   * first value that could be orphaned — arrives.
   */
  async remove(principal: RequestPrincipal, id: number): Promise<AttributeResponse> {
    assertResourceAccess(principal, 'catalog.delete', platformOwnership)

    await this.mustExist(this.prisma, id)

    const now = this.now()
    const removed = await this.prisma.$queryRaw<AttributeDefinition[]>`
      UPDATE "AttributeDefinition"
         SET "deletedAt" = ${now},
             "version"   = "version" + 1,
             "updatedAt" = ${now}
       WHERE "id" = ${id}::int AND "deletedAt" IS NULL
      RETURNING ${DEFINITION_COLUMNS}
    `

    return { attribute: this.only(removed) }
  }

  /**
   * The verdict on one product's attribute values — the function every save
   * path has to go through.
   *
   * Definitions are read on **every** call. That is the point rather than an
   * oversight: a cache would make "정의를 추가하면 즉시 검증에 반영된다" true
   * only until something went stale, and the failure mode of a stale cache here
   * is a product saved against a rule that no longer exists.
   *
   * Throws only when the category is unknown; a value that fails validation
   * comes back as a result, because the caller has to decide whether that is a
   * 400, a highlighted field or a rejected import row.
   */
  async validateAttributes(categoryId: number, values: unknown): Promise<AttributeValidation> {
    return validateAttributeValues(await this.rulesFor(categoryId), values)
  }

  /** The rules of one category, ancestors' included — what a form is built from. */
  async rulesFor(categoryId: number): Promise<readonly AttributeRule[]> {
    return this.effectiveFor(this.prisma, categoryId)
  }

  /**
   * Every definition that applies to `categoryId`, in one statement.
   *
   * The lineage is computed inside the query — `btrim` strips the surrounding
   * slashes from `/1/5/12/` and `string_to_array` turns what is left into
   * `{1,5,12}` — so `= ANY` is served by
   * `AttributeDefinition_categoryId_key_active_key` — which leads with
   * `categoryId` and is already restricted to live rows — and the depth of the
   * category costs nothing (gate A5).
   *
   * The join is a `LEFT JOIN` for one reason: a category with no definitions and
   * a category that does not exist would otherwise both answer with zero rows,
   * and the first has to be an empty list while the second is a 404.
   */
  private async effectiveFor(tx: Tx, categoryId: number): Promise<readonly ResolvedAttribute[]> {
    const rows = await tx.$queryRaw<LineageRow[]>`
      SELECT t."path" AS "targetPath", ${JOINED_COLUMNS}
        FROM "Category" t
        LEFT JOIN "AttributeDefinition" d
               ON d."categoryId" = ANY (string_to_array(btrim(t."path", '/'), '/')::int[])
              AND d."deletedAt" IS NULL
       WHERE t."id" = ${categoryId}::int AND t."deletedAt" IS NULL
    `

    const [first] = rows

    if (first === undefined) throw new NotFoundException('카테고리를 찾을 수 없습니다.')

    const defined = rows.filter((row): row is DefinedRow => row.id !== null)

    return resolveEffectiveAttributes(defined, ancestorIdsOf(first.targetPath))
  }

  /**
   * The contract's shape, spelled out.
   *
   * Written field by field rather than by spreading the row: the query carries
   * one column the contract does not have (`targetPath`), and a spread would put
   * it in the response — where nothing would fail, because a zod object ignores
   * what it was not asked about.
   */
  private present(attribute: ResolvedAttribute): EffectiveAttribute {
    return {
      id: attribute.id,
      categoryId: attribute.categoryId,
      key: attribute.key,
      label: attribute.label,
      type: attribute.type,
      options: attribute.options,
      isRequired: attribute.isRequired,
      isFilterable: attribute.isFilterable,
      sortOrder: attribute.sortOrder,
      version: attribute.version,
      inherited: attribute.inherited,
    }
  }

  /**
   * Runs `work` in a transaction holding the category tree lock.
   *
   * Taking the lock **before** any read is the whole point, exactly as in
   * `CategoryService`: a transaction that read the lineage first and locked
   * afterwards would decide from a tree somebody else was still rewriting.
   */
  private inTree<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        CATEGORY_TREE_LOCK_SQL,
        CATEGORY_TREE_LOCK_CLASS,
        CATEGORY_TREE_LOCK_KEY,
      )

      return work(tx)
    })
  }

  /**
   * The category a definition is being attached to. 400, because the caller
   * named it.
   *
   * The name comes along because {@link AttributeService.uniqueKey} needs it:
   * the conflict sentence a console shows says *which* category already defines
   * the key, and that is a fact only this row carries.
   *
   * Deliberately still a plain-string refusal rather than a coded one — it is
   * the endpoint that keeps `details` carrying both shapes honest (F9).
   */
  private async categoryFor(tx: Tx, categoryId: number): Promise<{ path: string; name: string }> {
    const rows = await tx.$queryRaw<{ path: string; name: string }[]>`
      SELECT "path", "name" FROM "Category"
       WHERE "id" = ${categoryId}::int AND "deletedAt" IS NULL
    `
    const [row] = rows

    if (row === undefined) {
      throw new BadRequestException('선택한 카테고리가 없어졌어요. 목록을 새로고침해 주세요.')
    }

    return row
  }

  /**
   * Refuses a key that is already defined anywhere in this category's lineage.
   *
   * Both directions, and the second is the one worth stating. An **ancestor**
   * already defining `material` means the new row would be a second answer to
   * the same question for this category. A **descendant** defining it means the
   * new row would become a second answer for *that* category. Checking only
   * upwards would let a root-level definition quietly shadow every leaf that had
   * one already.
   *
   * `c."path" LIKE $path || '%'` is the descendants and `$path LIKE c."path" ||
   * '%'` is the ancestors; a category is both to itself, which is what makes
   * this also cover the case the unique index catches.
   */
  private async refuseLineageConflict(tx: Tx, path: string, key: string): Promise<void> {
    const conflicts = await tx.$queryRaw<{ categoryId: number; name: string }[]>`
      SELECT d."categoryId", c."name"
        FROM "AttributeDefinition" d
        JOIN "Category" c ON c."id" = d."categoryId"
       WHERE d."deletedAt" IS NULL
         AND d."key" = ${key}::text
         AND (c."path" LIKE ${path}::text || '%' OR ${path}::text LIKE c."path" || '%')
       LIMIT 1
    `
    const [conflict] = conflicts

    if (conflict === undefined) return

    throw new ConflictException(
      domainFailure(
        'ATTRIBUTE_KEY_TAKEN',
        `'${conflict.name}' 에 같은 이름의 속성이 이미 있어요.`,
        {
          field: 'key',
          params: { name: conflict.name },
        },
      ),
    )
  }

  /** One past the last definition, so a new one lands at the end of the form. */
  private async nextSortOrder(tx: Tx, categoryId: number): Promise<number> {
    const [row] = await tx.$queryRaw<{ next: number }[]>`
      SELECT COALESCE(max("sortOrder") + 1, 0)::int AS next FROM "AttributeDefinition"
       WHERE "categoryId" = ${categoryId}::int AND "deletedAt" IS NULL
    `

    return row?.next ?? 0
  }

  private async mustExist(tx: Tx, id: number): Promise<StoredDefinition> {
    const rows = await tx.$queryRaw<StoredDefinition[]>`
      SELECT "id", "categoryId", "key", "type", "options" FROM "AttributeDefinition"
       WHERE "id" = ${id}::int AND "deletedAt" IS NULL
    `
    const [row] = rows

    if (row === undefined) throw new NotFoundException('속성 정의를 찾을 수 없습니다.')

    return row
  }

  /**
   * Turns the per-category unique index's violation into a 409.
   *
   * Reachable even though {@link AttributeService.refuseLineageConflict} looked
   * first, because the lineage check runs against live rows and the index also
   * covers the row this very statement is inserting — and because a check that
   * is only ever right is a check nobody notices going wrong.
   *
   * Answers with the same code and the same sentence as the lineage check: the
   * caller is in the same situation either way, and two wordings for one
   * situation is how a screen ends up with two branches for one thing.
   */
  private async uniqueKey<T>(categoryName: string, work: () => Promise<T>): Promise<T> {
    try {
      return await work()
    } catch (error) {
      if (sqlStateOf(error) === UNIQUE_VIOLATION) {
        throw new ConflictException(
          domainFailure(
            'ATTRIBUTE_KEY_TAKEN',
            `'${categoryName}' 에 같은 이름의 속성이 이미 있어요.`,
            {
              field: 'key',
              params: { name: categoryName },
            },
          ),
        )
      }
      throw error
    }
  }

  /**
   * The injected instant, as a value PostgreSQL stores the way Prisma does.
   *
   * The cast is not decoration — see the same method on `CategoryService`: `pg`
   * serialises a `Date` with the local UTC offset, and casting that straight to
   * `timestamp` would store local wall-clock time.
   */
  private now(): Prisma.Sql {
    return Prisma.sql`${this.clock.now().toISOString()}::timestamptz AT TIME ZONE 'UTC'`
  }

  private only(rows: readonly AttributeDefinition[]): AttributeDefinition {
    const [row] = rows

    if (row === undefined) throw new NotFoundException('속성 정의를 찾을 수 없습니다.')

    return row
  }
}
