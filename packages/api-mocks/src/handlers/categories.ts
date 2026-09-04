import type {
  CategoryNode,
  CategoryTreeNode,
  CategoryTreeResponse,
  CreateCategoryRequest,
  MoveCategoryRequest,
  ReorderCategoriesRequest,
  UpdateCategoryRequest,
} from '@shopping/shared'
import {
  CATEGORY_MAX_DEPTH,
  categoryListResponseSchema,
  categoryResponseSchema,
  categoryTreeQueryParamsSchema,
  categoryTreeResponseSchema,
  createCategoryRequestSchema,
  moveCategoryRequestSchema,
  reorderCategoriesRequestSchema,
  updateCategoryRequestSchema,
} from '@shopping/shared'
import type { RequestHandler } from 'msw'
import { http, HttpResponse } from 'msw'

import { defineFixture } from '../define'
import { categoryTree } from '../fixtures/categories'
import { mockPaths } from '../paths'
import { answering, MockApiError, pathId, readBody } from './refusal'

/**
 * The category endpoints, with the state a screen that edits a tree needs.
 *
 * Every other endpoint in this package answers from a frozen fixture, and for a
 * screen that only reads, that is the right amount of double. This one is
 * different: TASK-0029 asks whether a move is *reflected*, whether a second
 * editor's save is *refused*, and whether a delete with children is *blocked* —
 * questions about what the API does with the request, not about what it
 * volunteers. A fixture cannot answer them, and a per-spec `server.use` that
 * hand-rolls the answer would put a different half-API in every spec file.
 *
 * So the store below reproduces the four invariants the screen is built around,
 * and nothing else:
 *
 * | invariant | how the real API enforces it |
 * | --- | --- |
 * | optimistic lock | `UPDATE ... WHERE version = ?`, 0 rows means 409 |
 * | slug uniqueness | a partial unique index over live rows |
 * | no delete with children | counted inside the tree lock, 409 |
 * | depth cap and no cycles | `refuseMove` plus a CHECK constraint, 400 |
 *
 * It is deliberately **not** a second implementation of the tree: it keeps the
 * same materialised `path`, but concurrency, the advisory lock and the database
 * checks are the back-end's own tests (TASK-0028). What is reproduced here is
 * only the part a screen can observe through HTTP.
 *
 * Responses go through `defineFixture`, so every body this file invents is
 * parsed by the same schema the API answers against (gate C2) — a mock that
 * drifted from the contract fails here rather than in the app it misleads.
 */

/** The depth cap, refused the same way from create and from move. */
function tooDeep(): MockApiError {
  return new MockApiError(
    400,
    `카테고리는 ${String(CATEGORY_MAX_DEPTH)}단계까지만 만들 수 있어요.`,
    {
      code: 'CATEGORY_MAX_DEPTH',
      field: 'parentId',
      params: { max: CATEGORY_MAX_DEPTH },
    },
  )
}

/** Drops the nesting; the store keeps rows, exactly as the table does. */
function flatten(nodes: readonly CategoryTreeNode[]): CategoryNode[] {
  return nodes.flatMap(({ children, ...node }) => [node, ...flatten(children)])
}

/** Rebuilds the nesting for an answer, in display order. */
function nest(rows: readonly CategoryNode[], parentId: number | null): CategoryTreeNode[] {
  return rows
    .filter((row) => row.parentId === parentId)
    .sort((left, right) => left.sortOrder - right.sortOrder || left.id - right.id)
    .map((row) => ({ ...row, children: nest(rows, row.id) }))
}

/**
 * The rows, and the operations the console performs on them.
 *
 * Reset between tests by {@link resetCategoryStore}, which `setupTestServer`
 * calls: a store that carried a created category into the next test would make
 * specs pass or fail by their order in the file.
 */
class CategoryStore {
  private rows: CategoryNode[] = []
  private nextId = 1

  constructor() {
    this.reset()
  }

  reset(seed: CategoryTreeResponse = categoryTree): void {
    this.rows = flatten(seed.nodes).map((row) => ({ ...row }))
    // Ids are never reused, so the counter starts past every id ever issued.
    this.nextId = this.rows.reduce((highest, row) => Math.max(highest, row.id), 0) + 1
  }

  /**
   * Every row, as the table holds them.
   *
   * Exposed for the attribute endpoints, which resolve a lineage out of
   * `Category.path` exactly as the real query does — the two tables are joined
   * in one statement there (TASK-0030 4.3), so a mock that kept them in separate
   * worlds could not answer "inherited from where" at all.
   */
  snapshot(): readonly CategoryNode[] {
    return this.rows
  }

  tree(query: { rootId?: number; includeInactive?: boolean }): CategoryTreeResponse {
    const visible = query.includeInactive === true ? this.rows : this.liveAndActive()

    if (query.rootId === undefined) return { nodes: nest(visible, null) }

    const root = visible.find((row) => row.id === query.rootId)
    if (root === undefined) throw new MockApiError(404, '카테고리를 찾을 수 없습니다.')

    const subtree = visible.filter((row) => row.path.startsWith(root.path))

    return { nodes: nest(subtree, root.parentId) }
  }

  create(input: CreateCategoryRequest): CategoryNode {
    const parent = this.parentFor(input.parentId)

    if (parent !== undefined && parent.depth >= CATEGORY_MAX_DEPTH) throw tooDeep()
    this.refuseTakenSlug(input.slug, null)

    const id = this.nextId
    this.nextId += 1

    const created: CategoryNode = {
      id,
      parentId: input.parentId,
      name: input.name,
      slug: input.slug,
      depth: (parent?.depth ?? 0) + 1,
      path: `${parent?.path ?? '/'}${String(id)}/`,
      sortOrder: input.sortOrder ?? this.nextSortOrder(input.parentId),
      isActive: true,
      productCount: 0,
      version: 0,
    }
    this.rows.push(created)

    return created
  }

  update(id: number, input: UpdateCategoryRequest): CategoryNode {
    const row = this.mustExist(id)

    // Version first, then the slug: the real statement guards on the version in
    // its `WHERE`, so a stale editor never reaches the unique index at all.
    if (row.version !== input.version) {
      throw new MockApiError(409, '다른 관리자가 먼저 저장했어요. 최신 내용을 불러올까요?', {
        code: 'CATEGORY_VERSION_CONFLICT',
        field: 'version',
      })
    }
    if (input.slug !== undefined) this.refuseTakenSlug(input.slug, id)

    const updated: CategoryNode = {
      ...row,
      name: input.name ?? row.name,
      slug: input.slug ?? row.slug,
      isActive: input.isActive ?? row.isActive,
      version: row.version + 1,
    }
    this.replace(updated)

    return updated
  }

  move(id: number, input: MoveCategoryRequest): CategoryNode {
    const node = this.mustExist(id)
    const parent = this.parentFor(input.parentId)

    if (parent?.path.startsWith(node.path) === true) {
      throw new MockApiError(400, '카테고리를 자기 자신이나 그 아래로 옮길 수 없어요.', {
        code: 'CATEGORY_MOVE_INTO_SELF',
        field: 'parentId',
      })
    }

    const depthDelta = (parent?.depth ?? 0) + 1 - node.depth
    if (this.subtreeDepth(node.path) + depthDelta > CATEGORY_MAX_DEPTH) throw tooDeep()

    const sortOrder =
      input.sortOrder ??
      (input.parentId === node.parentId ? node.sortOrder : this.nextSortOrder(input.parentId))
    const newPrefix = `${parent?.path ?? '/'}${String(id)}/`

    this.rows = this.rows.map((row) =>
      row.path.startsWith(node.path)
        ? {
            ...row,
            path: newPrefix + row.path.slice(node.path.length),
            depth: row.depth + depthDelta,
            ...(row.id === id ? { parentId: input.parentId, sortOrder } : {}),
          }
        : row,
    )

    return this.mustExist(id)
  }

  reorder(input: ReorderCategoriesRequest): CategoryNode[] {
    const siblings = this.rows.filter((row) => row.parentId === input.parentId)
    const given = new Set(input.orderedIds)

    if (
      given.size !== input.orderedIds.length ||
      given.size !== siblings.length ||
      siblings.some((row) => !given.has(row.id))
    ) {
      throw new MockApiError(400, '순서가 화면과 어긋났어요. 새로고침한 뒤 다시 시도해 주세요.', {
        code: 'CATEGORY_REORDER_MISMATCH',
        field: 'orderedIds',
      })
    }

    this.rows = this.rows.map((row) => {
      const position = input.orderedIds.indexOf(row.id)

      return position === -1 || row.parentId !== input.parentId
        ? row
        : { ...row, sortOrder: position }
    })

    return input.orderedIds.map((id) => this.mustExist(id))
  }

  remove(id: number): CategoryNode {
    const row = this.mustExist(id)

    if (this.rows.some((candidate) => candidate.parentId === id)) {
      throw new MockApiError(409, '하위 카테고리를 먼저 옮기거나 삭제해 주세요.', {
        code: 'CATEGORY_HAS_CHILDREN',
      })
    }

    // Soft delete: the row leaves the tree and its id is never handed out again.
    const removed: CategoryNode = { ...row, isActive: false, version: row.version + 1 }
    this.rows = this.rows.filter((candidate) => candidate.id !== id)

    return removed
  }

  /** Inactive nodes hide their whole subtree, as the API's `LIKE` filter does. */
  private liveAndActive(): CategoryNode[] {
    const retired = this.rows.filter((row) => !row.isActive)

    return this.rows.filter((row) => !retired.some((hidden) => row.path.startsWith(hidden.path)))
  }

  private mustExist(id: number): CategoryNode {
    const row = this.rows.find((candidate) => candidate.id === id)

    if (row === undefined) throw new MockApiError(404, '카테고리를 찾을 수 없습니다.')

    return row
  }

  private parentFor(parentId: number | null): CategoryNode | undefined {
    if (parentId === null) return undefined

    const parent = this.rows.find((row) => row.id === parentId)

    if (parent === undefined) {
      throw new MockApiError(400, '선택한 상위 카테고리가 없어졌어요. 목록을 새로고침해 주세요.', {
        code: 'CATEGORY_PARENT_MISSING',
        field: 'parentId',
      })
    }

    return parent
  }

  private refuseTakenSlug(slug: string, exceptId: number | null): void {
    if (this.rows.some((row) => row.slug === slug && row.id !== exceptId)) {
      throw new MockApiError(409, '이미 쓰고 있는 주소예요. 다른 주소를 입력해 주세요.', {
        code: 'CATEGORY_SLUG_TAKEN',
        field: 'slug',
      })
    }
  }

  private nextSortOrder(parentId: number | null): number {
    return this.rows
      .filter((row) => row.parentId === parentId)
      .reduce((next, row) => Math.max(next, row.sortOrder + 1), 0)
  }

  private subtreeDepth(path: string): number {
    return this.rows
      .filter((row) => row.path.startsWith(path))
      .reduce((deepest, row) => Math.max(deepest, row.depth), 0)
  }

  private replace(node: CategoryNode): void {
    this.rows = this.rows.map((row) => (row.id === node.id ? node : row))
  }
}

const store = new CategoryStore()

/**
 * Puts the tree back to the fixture. Called from `setupTestServer`'s `afterEach`.
 *
 * A spec that needs a different starting point — the empty tree, say — passes
 * one here in its own `beforeEach`, which runs after the reset.
 */
export function resetCategoryStore(seed?: CategoryTreeResponse): void {
  store.reset(seed)
}

/**
 * The categories the mock currently holds, flat.
 *
 * The attribute handlers read this rather than keeping a tree of their own: a
 * definition's lineage *is* the category tree, and a spec that creates a
 * category and then defines an attribute on it has to see one world, not two.
 */
export function categoryRowsSnapshot(): readonly CategoryNode[] {
  return store.snapshot()
}

/**
 * `reorder` is listed before `:id`: msw takes the first matching handler, and
 * `/categories/:id` reads `reorder` as an id perfectly happily.
 */
export const categoryHandlers: readonly RequestHandler[] = [
  http.get(mockPaths.categories, ({ request }) =>
    answering(() => {
      const url = new URL(request.url)
      const query = categoryTreeQueryParamsSchema.safeParse(Object.fromEntries(url.searchParams))

      if (!query.success) throw new MockApiError(400, '요청 형식이 올바르지 않습니다.')

      return HttpResponse.json(defineFixture(categoryTreeResponseSchema, store.tree(query.data)))
    }),
  ),

  http.post(mockPaths.categories, ({ request }) =>
    answering(async () => {
      const body = await readBody(request, createCategoryRequestSchema)

      return HttpResponse.json(
        defineFixture(categoryResponseSchema, { category: store.create(body) }),
        { status: 201 },
      )
    }),
  ),

  http.post(mockPaths.categoryReorder, ({ request }) =>
    answering(async () => {
      const body = await readBody(request, reorderCategoriesRequestSchema)

      return HttpResponse.json(
        defineFixture(categoryListResponseSchema, { categories: store.reorder(body) }),
      )
    }),
  ),

  http.post(mockPaths.categoryMove, ({ request, params }) =>
    answering(async () => {
      const body = await readBody(request, moveCategoryRequestSchema)

      return HttpResponse.json(
        defineFixture(categoryResponseSchema, { category: store.move(pathId(params), body) }),
      )
    }),
  ),

  http.patch(mockPaths.category, ({ request, params }) =>
    answering(async () => {
      const body = await readBody(request, updateCategoryRequestSchema)

      return HttpResponse.json(
        defineFixture(categoryResponseSchema, { category: store.update(pathId(params), body) }),
      )
    }),
  ),

  http.delete(mockPaths.category, ({ params }) =>
    answering(() =>
      HttpResponse.json(
        defineFixture(categoryResponseSchema, { category: store.remove(pathId(params)) }),
      ),
    ),
  ),
]
