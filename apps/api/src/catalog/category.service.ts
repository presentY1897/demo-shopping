import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { Prisma } from '@prisma/client'
import type {
  CategoryListResponse,
  CategoryNode,
  CategoryResponse,
  CategoryTreeResponse,
  CreateCategoryRequest,
  MoveCategoryRequest,
  ReorderCategoriesRequest,
  UpdateCategoryRequest,
} from '@shopping/shared'
import { CATEGORY_MAX_DEPTH, platformOwnership } from '@shopping/shared'

import { assertResourceAccess } from '../auth/access-denied.js'
import type { RequestPrincipal } from '../auth/request-principal.js'
import type { Clock } from '../common/clock.js'
import { CLOCK } from '../common/clock.js'
import { PrismaService } from '../prisma/prisma.service.js'
import {
  CATEGORY_TREE_LOCK_CLASS,
  CATEGORY_TREE_LOCK_KEY,
  CATEGORY_TREE_LOCK_SQL,
} from './category-lock.js'
import { pathOf, refuseMove } from './category-path.js'
import { buildCategoryForest } from './category-tree.js'

/** The transaction handle Prisma hands an interactive transaction. */
type Tx = Prisma.TransactionClient

/** Columns every answer is built from; `path` included, it is public state. */
const NODE_FIELDS = [
  'id',
  'parentId',
  'name',
  'slug',
  'depth',
  'path',
  'sortOrder',
  'isActive',
  'version',
] as const

/**
 * The column list, optionally qualified by a table alias.
 *
 * `Prisma.raw` is safe here because the only input is the constant above — and
 * an alias is needed at all because an `UPDATE ... FROM` puts two tables in
 * scope and an unqualified `"id"` in `RETURNING` is then ambiguous.
 */
function nodeColumns(alias?: string): Prisma.Sql {
  const prefix = alias === undefined ? '' : `${alias}.`

  return Prisma.raw(NODE_FIELDS.map((field) => `${prefix}"${field}"`).join(', '))
}

const NODE_COLUMNS = nodeColumns()

/** SQLSTATE of a unique violation. Only the slug index can raise it here. */
const UNIQUE_VIOLATION = '23505'

/**
 * The SQLSTATE behind a failed raw query, if there is one.
 *
 * Prisma reports every raw-query failure as `P2010` and keeps the database's own
 * answer in the driver adapter's cause — so a service that wants to tell "slug
 * already taken" from "something else went wrong" has to look there. Reading the
 * message instead would break the first time a locale or a version changes it.
 */
function sqlStateOf(error: unknown): string | undefined {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return undefined

  const cause = (error.meta as { driverAdapterError?: { cause?: { originalCode?: unknown } } })
    .driverAdapterError?.cause?.originalCode

  return typeof cause === 'string' ? cause : undefined
}

interface TreeQuery {
  readonly rootId?: number
  readonly includeInactive?: boolean
}

/** What a mutation needs to know about a node before it changes it. */
interface NodeRow {
  readonly id: number
  readonly parentId: number | null
  readonly path: string
  readonly depth: number
}

/**
 * The category tree (TASK-0028).
 *
 * Three rules run through everything below.
 *
 * **Reads are one query.** The materialised `path` turns "this node and
 * everything under it" into a prefix match, so a subtree of any size costs one
 * statement and the nesting is rebuilt in memory (gate A5).
 *
 * **Structural writes hold the tree lock.** Create, move, reorder and delete
 * open a transaction, take `pg_advisory_xact_lock` and only then read the rows
 * they are about to decide from. Without it two moves each validate against a
 * tree the other is in the middle of rewriting.
 *
 * **The database has the final say.** Every invariant checked here is also a
 * constraint in the migration — the checks in this file exist to turn a
 * violation into a 400 that names the problem, not to be the thing that
 * prevents it.
 */
@Injectable()
export class CategoryService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * The whole tree, or the subtree under `rootId`, nested.
   *
   * One statement for both, and one statement regardless of how many nodes come
   * back: the `LIKE` prefix is served by `Category_path_idx`, whose
   * `text_pattern_ops` operator class is what makes a prefix match indexable
   * under this database's `en_US.utf8` collation.
   */
  async tree(principal: RequestPrincipal, query: TreeQuery = {}): Promise<CategoryTreeResponse> {
    assertResourceAccess(principal, 'catalog.read', platformOwnership)

    const rootId = query.rootId ?? null
    const includeInactive = query.includeInactive ?? false

    const rows = await this.prisma.$queryRaw<CategoryNode[]>`
      SELECT ${NODE_COLUMNS}
        FROM "Category" c
       WHERE c."deletedAt" IS NULL
         AND (${includeInactive}::boolean OR c."isActive")
         AND (
           ${rootId}::int IS NULL
           OR c."path" LIKE (
                SELECT r."path" FROM "Category" r
                 WHERE r."id" = ${rootId}::int
                   AND r."deletedAt" IS NULL
                   AND (${includeInactive}::boolean OR r."isActive")
              ) || '%'
         )
       ORDER BY c."depth", c."sortOrder", c."id"
    `

    if (rootId !== null && rows.length === 0) {
      throw new NotFoundException('카테고리를 찾을 수 없습니다.')
    }

    return { nodes: buildCategoryForest(rows, rootId ?? undefined) }
  }

  /**
   * Adds a node under `parentId`, or a new root.
   *
   * The insert is a single statement that draws the id from the sequence and
   * builds the path from it in the same expression — the path cannot be written
   * before the id is known, and a two-step "insert then update" would spend a
   * moment holding a row the shape check would reject.
   */
  async create(
    principal: RequestPrincipal,
    input: CreateCategoryRequest,
  ): Promise<CategoryResponse> {
    assertResourceAccess(principal, 'catalog.write', platformOwnership)

    return this.inTree(async (tx) => {
      const parent = await this.parentFor(tx, input.parentId)

      if (parent !== null && parent.depth >= CATEGORY_MAX_DEPTH) {
        throw new BadRequestException(
          `카테고리는 ${String(CATEGORY_MAX_DEPTH)}단계까지만 만들 수 있습니다.`,
        )
      }

      const sortOrder = input.sortOrder ?? (await this.nextSortOrder(tx, input.parentId))
      const now = this.now()
      const parentPath = parent?.path ?? null
      const depth = (parent?.depth ?? 0) + 1

      const created = await this.uniqueSlug(
        () => tx.$queryRaw<CategoryNode[]>`
          WITH allocated AS (
            SELECT nextval(pg_get_serial_sequence('"Category"', 'id'))::int AS id
          )
          INSERT INTO "Category"
            ("id", "parentId", "parentPath", "path", "depth",
             "name", "slug", "sortOrder", "createdAt", "updatedAt")
          SELECT a.id, ${input.parentId}::int, ${parentPath}::text,
                 COALESCE(${parentPath}::text, '/') || a.id || '/', ${depth}::int,
                 ${input.name}::text, ${input.slug}::text, ${sortOrder}::int,
                 ${now}, ${now}
            FROM allocated a
          RETURNING ${NODE_COLUMNS}
        `,
      )

      return { category: this.only(created) }
    })
  }

  /**
   * Edits the fields a person types, guarded by the optimistic lock.
   *
   * The guard is the `version` in the `WHERE` clause, so the read and the write
   * are one statement and there is no window between them. A second editor who
   * loaded the same row gets a 409 naming the conflict rather than having their
   * colleague's rename silently replaced (DECISIONS 4).
   *
   * No tree lock: nothing here changes the shape of the tree.
   */
  async update(
    principal: RequestPrincipal,
    id: number,
    input: UpdateCategoryRequest,
  ): Promise<CategoryResponse> {
    assertResourceAccess(principal, 'catalog.write', platformOwnership)

    const updated = await this.uniqueSlug(
      () => this.prisma.$queryRaw<CategoryNode[]>`
        UPDATE "Category"
           SET "name"      = COALESCE(${input.name ?? null}::text, "name"),
               "slug"      = COALESCE(${input.slug ?? null}::text, "slug"),
               "isActive"  = COALESCE(${input.isActive ?? null}::boolean, "isActive"),
               "version"   = "version" + 1,
               "updatedAt" = ${this.now()}
         WHERE "id" = ${id}::int
           AND "deletedAt" IS NULL
           AND "version" = ${input.version}::int
        RETURNING ${NODE_COLUMNS}
      `,
    )

    if (updated.length === 1) return { category: this.only(updated) }

    // Nothing matched: either the row is gone or somebody else edited it first.
    // The distinction is what the caller needs — one is a dead link, the other
    // is a conflict they can resolve by reloading.
    await this.mustExist(this.prisma, id)
    throw new ConflictException('다른 사용자가 먼저 수정했습니다. 새로고침 후 다시 시도해주세요.')
  }

  /**
   * Moves a node and everything under it.
   *
   * The rewrite is deliberately **one** `UPDATE` over the whole subtree. Two
   * reasons, and both are load-bearing:
   *
   * - the cost of a move is one index range scan rather than one statement per
   *   descendant, so a subtree of any size is a single round trip;
   * - `Category_parentId_parentPath_fkey` is `ON UPDATE NO ACTION`, which
   *   PostgreSQL verifies when the **statement** ends. Rewriting the parent and
   *   its descendants separately would leave the tree inconsistent in between
   *   and the foreign key would refuse the first half.
   */
  async move(
    principal: RequestPrincipal,
    id: number,
    input: MoveCategoryRequest,
  ): Promise<CategoryResponse> {
    assertResourceAccess(principal, 'catalog.write', platformOwnership)

    return this.inTree(async (tx) => {
      const node = await this.mustExist(tx, id)
      const parent = await this.parentFor(tx, input.parentId)
      const subtreeDepth = await this.subtreeDepth(tx, node.path)

      const refusal = refuseMove(
        { path: node.path, depth: node.depth, subtreeDepth },
        { path: parent?.path ?? null, depth: parent?.depth ?? 0 },
      )

      if (refusal === 'cycle') {
        throw new BadRequestException('카테고리를 자기 자신이나 하위 카테고리로 옮길 수 없습니다.')
      }
      if (refusal === 'too_deep') {
        throw new BadRequestException(
          `카테고리는 ${String(CATEGORY_MAX_DEPTH)}단계까지만 만들 수 있습니다.`,
        )
      }

      const oldPrefix = node.path
      const newPrefix = pathOf(parent?.path ?? null, id)
      const depthDelta = (parent?.depth ?? 0) + 1 - node.depth
      // Keep the position when the parent is unchanged; otherwise land after
      // the last sibling of the new parent. `null` leaves the column alone.
      const sortOrder =
        input.sortOrder ??
        (input.parentId === node.parentId ? null : await this.nextSortOrder(tx, input.parentId))

      const moved = await tx.$queryRaw<CategoryNode[]>`
        UPDATE "Category"
           SET "path"       = ${newPrefix}::text
                              || substring("path" from ${oldPrefix.length + 1}::int),
               "parentPath" = CASE WHEN "id" = ${id}::int THEN ${parent?.path ?? null}::text
                                   ELSE ${newPrefix}::text
                                        || substring("parentPath" from ${oldPrefix.length + 1}::int)
                              END,
               "parentId"   = CASE WHEN "id" = ${id}::int THEN ${input.parentId}::int
                                   ELSE "parentId"
                              END,
               "depth"      = "depth" + ${depthDelta}::int,
               "sortOrder"  = CASE WHEN "id" = ${id}::int
                                   THEN COALESCE(${sortOrder}::int, "sortOrder")
                                   ELSE "sortOrder"
                              END,
               "updatedAt"  = ${this.now()}
         WHERE "path" LIKE ${oldPrefix}::text || '%'
        RETURNING ${NODE_COLUMNS}
      `

      return { category: this.only(moved.filter((row) => row.id === id)) }
    })
  }

  /**
   * Renumbers the children of one parent from the arrangement the caller sends.
   *
   * `orderedIds` has to be the complete set of live children. A request that
   * named only the moved node would carry a position computed from an
   * arrangement that may already be gone; the whole list makes the outcome
   * exactly one of the competing requests instead of a blend of both (gate A7,
   * "순서").
   */
  async reorder(
    principal: RequestPrincipal,
    input: ReorderCategoriesRequest,
  ): Promise<CategoryListResponse> {
    assertResourceAccess(principal, 'catalog.write', platformOwnership)

    return this.inTree(async (tx) => {
      const current = await tx.$queryRaw<{ id: number }[]>`
        SELECT "id" FROM "Category"
         WHERE "parentId" IS NOT DISTINCT FROM ${input.parentId}::int
           AND "deletedAt" IS NULL
      `
      const expected = new Set(current.map((row) => row.id))
      const given = new Set(input.orderedIds)

      if (
        given.size !== input.orderedIds.length ||
        given.size !== expected.size ||
        input.orderedIds.some((id) => !expected.has(id))
      ) {
        throw new BadRequestException(
          'orderedIds 는 해당 상위 카테고리의 하위 전체를 중복 없이 담아야 합니다.',
        )
      }

      const reordered = await tx.$queryRaw<CategoryNode[]>`
        UPDATE "Category" AS c
           SET "sortOrder" = (ordering.position - 1)::int,
               "updatedAt" = ${this.now()}
          FROM (
            SELECT id AS category_id, ordinality AS position
              FROM unnest(${input.orderedIds}::int[]) WITH ORDINALITY AS t(id, ordinality)
          ) AS ordering
         WHERE c."id" = ordering.category_id
        RETURNING ${nodeColumns('c')}
      `

      return {
        categories: [...reordered].sort((left, right) => left.sortOrder - right.sortOrder),
      }
    })
  }

  /**
   * Retires a category. The row stays and the id is never handed out again.
   *
   * A node with live children is refused rather than cascaded: the children
   * would be unreachable but still referenced by products, and the operator who
   * asked to remove one category would have removed a branch.
   */
  async remove(principal: RequestPrincipal, id: number): Promise<CategoryResponse> {
    assertResourceAccess(principal, 'catalog.delete', platformOwnership)

    return this.inTree(async (tx) => {
      await this.mustExist(tx, id)

      const [children] = await tx.$queryRaw<{ count: number }[]>`
        SELECT count(*)::int AS count FROM "Category"
         WHERE "parentId" = ${id}::int AND "deletedAt" IS NULL
      `

      if (children !== undefined && children.count > 0) {
        throw new ConflictException('하위 카테고리가 남아 있어 삭제할 수 없습니다.')
      }

      const now = this.now()
      const removed = await tx.$queryRaw<CategoryNode[]>`
        UPDATE "Category"
           SET "deletedAt" = ${now},
               "isActive"  = false,
               "version"   = "version" + 1,
               "updatedAt" = ${now}
         WHERE "id" = ${id}::int AND "deletedAt" IS NULL
        RETURNING ${NODE_COLUMNS}
      `

      return { category: this.only(removed) }
    })
  }

  /**
   * Runs `work` in a transaction that holds the tree lock from its first
   * statement.
   *
   * Taking the lock **before** any read is the whole point: a transaction that
   * read first and locked afterwards would decide from a tree the previous
   * holder was still rewriting.
   */
  private inTree<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      // `$executeRawUnsafe`, not `$queryRawUnsafe`: the lock function returns
      // `void`, which Prisma's row decoder has no mapping for.
      await tx.$executeRawUnsafe(
        CATEGORY_TREE_LOCK_SQL,
        CATEGORY_TREE_LOCK_CLASS,
        CATEGORY_TREE_LOCK_KEY,
      )

      return work(tx)
    })
  }

  /** The destination parent, or `null` for the top level. 400 when unknown. */
  private async parentFor(tx: Tx, parentId: number | null): Promise<NodeRow | null> {
    if (parentId === null) return null

    const parent = await this.find(tx, parentId)

    if (parent === null) throw new BadRequestException('상위 카테고리를 찾을 수 없습니다.')

    return parent
  }

  private async find(tx: Tx, id: number): Promise<NodeRow | null> {
    const rows = await tx.$queryRaw<NodeRow[]>`
      SELECT "id", "parentId", "path", "depth" FROM "Category"
       WHERE "id" = ${id}::int AND "deletedAt" IS NULL
    `

    return rows[0] ?? null
  }

  private async mustExist(tx: Tx, id: number): Promise<NodeRow> {
    const row = await this.find(tx, id)

    if (row === null) throw new NotFoundException('카테고리를 찾을 수 없습니다.')

    return row
  }

  /** Deepest level anywhere in the subtree rooted at `path`, itself included. */
  private async subtreeDepth(tx: Tx, path: string): Promise<number> {
    // Soft-deleted rows count: their `path` is rewritten by the move as well,
    // and a deleted node at the bottom still takes up a level.
    const [row] = await tx.$queryRaw<{ depth: number | null }[]>`
      SELECT max("depth") AS depth FROM "Category" WHERE "path" LIKE ${path}::text || '%'
    `

    return row?.depth ?? 0
  }

  /** One past the last sibling, so a new node lands at the end of the list. */
  private async nextSortOrder(tx: Tx, parentId: number | null): Promise<number> {
    const [row] = await tx.$queryRaw<{ next: number }[]>`
      SELECT COALESCE(max("sortOrder") + 1, 0)::int AS next FROM "Category"
       WHERE "parentId" IS NOT DISTINCT FROM ${parentId}::int AND "deletedAt" IS NULL
    `

    return row?.next ?? 0
  }

  /**
   * Turns the slug index's unique violation into a 409 the caller can act on.
   *
   * Checking for the slug first and inserting afterwards would be a race: two
   * requests both find it free. The database decides, and this only translates
   * its answer.
   */
  private async uniqueSlug<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work()
    } catch (error) {
      if (sqlStateOf(error) === UNIQUE_VIOLATION) {
        throw new ConflictException('이미 사용 중인 슬러그입니다.')
      }
      throw error
    }
  }

  /**
   * The injected instant, as a value PostgreSQL stores the way Prisma does.
   *
   * The cast is not decoration. `pg` serialises a `Date` with the *local* UTC
   * offset, and casting that straight to `timestamp` would drop the offset and
   * store local wall-clock time — nine hours off, and only visibly so for
   * whoever runs the suite outside UTC. Going through `timestamptz` and back
   * pins the value to UTC, which is what the `timestamp(3)` columns hold.
   */
  private now(): Prisma.Sql {
    return Prisma.sql`${this.clock.now().toISOString()}::timestamptz AT TIME ZONE 'UTC'`
  }

  private only(rows: readonly CategoryNode[]): CategoryNode {
    const [row] = rows

    if (row === undefined) throw new NotFoundException('카테고리를 찾을 수 없습니다.')

    return row
  }
}
