import { z } from 'zod'

/**
 * The category tree, as the API states it (TASK-0028).
 *
 * Contract gate C1: these schemas are the only definition of a category
 * request or response in the repository. `apps/api` validates its input with
 * them and the front-ends parse their answers with them, so a renamed field
 * cannot be green on one side and broken on the other. C3 then holds
 * structurally, because `createApiClient` parses every response with the very
 * schema declared here.
 */

/**
 * Category ids are short sequential integers, unlike the UUIDv7 of the
 * account-side tables — `path` concatenates them into a string that is read on
 * every catalogue query (`docs/design/erd.md` 1·2).
 *
 * They are never reused: id 5 stays vacant after its category is deleted, so a
 * `categoryId` recorded in an old order snapshot always means the same thing.
 */
export const categoryIdSchema = z.int().positive()

/** Three levels, no deeper (TASK-0028 2장). The database enforces it too. */
export const CATEGORY_MAX_DEPTH = 3

/**
 * A URL identifier: lowercase words joined by single hyphens.
 *
 * Constrained here rather than left to the storefront because the slug appears
 * in a public URL — an uppercase or space-carrying slug would work in a query
 * string and fail in a path segment.
 */
export const categorySlugSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)

export const categoryNameSchema = z.string().trim().min(1).max(60)

/** One node, without its children. */
export const categoryNodeSchema = z.object({
  id: categoryIdSchema,
  parentId: categoryIdSchema.nullable(),
  name: z.string(),
  slug: z.string(),
  /** 1 for a root. */
  depth: z.int().min(1).max(CATEGORY_MAX_DEPTH),
  /** Materialised ancestor path, ending in this node's own id: `/1/5/12/`. */
  path: z.string(),
  sortOrder: z.int().min(0),
  isActive: z.boolean(),
  /**
   * How many live products sit in this category (TASK-0117 2장).
   *
   * Required rather than optional, because a screen can only warn *before* a
   * delete — "이 카테고리에는 상품이 있어요" — if the count arrives with the
   * tree, and an optional field would leave endpoints that never learned to send
   * it. It was a constant 0 until TASK-0032 brought the `Product` table, which
   * is why it was required from the start: nothing on either side had to change
   * when the real count arrived. Every status counts — a draft is a product an
   * operator would still be surprised to lose (TASK-0117 R3).
   */
  productCount: z.int().min(0),
  /** Optimistic lock; send it back in an update (DECISIONS 4). */
  version: z.int().min(0),
})

export type CategoryNode = z.infer<typeof categoryNodeSchema>

export interface CategoryTreeNode extends CategoryNode {
  readonly children: readonly CategoryTreeNode[]
}

/**
 * The nested form. Recursive rather than depth-limited even though the depth is
 * capped at three: a schema that spelled out three levels would have to be
 * rewritten the day the cap changes, and would describe the limit twice.
 */
export const categoryTreeNodeSchema: z.ZodType<CategoryTreeNode> = z.lazy(() =>
  categoryNodeSchema.extend({ children: z.array(categoryTreeNodeSchema) }),
)

/** `nodes` are the roots of the returned forest, in display order. */
export const categoryTreeResponseSchema = z.object({
  nodes: z.array(categoryTreeNodeSchema),
})

export type CategoryTreeResponse = z.infer<typeof categoryTreeResponseSchema>

/** What a single-category mutation answers with. */
export const categoryResponseSchema = z.object({ category: categoryNodeSchema })

export type CategoryResponse = z.infer<typeof categoryResponseSchema>

/** A flat list, used where nesting would say nothing — reordering siblings. */
export const categoryListResponseSchema = z.object({
  categories: z.array(categoryNodeSchema),
})

export type CategoryListResponse = z.infer<typeof categoryListResponseSchema>

/** Query of `GET /api/v1/categories`, as a caller writes it. */
export const categoryTreeQuerySchema = z.object({
  /** Limits the answer to this node and its descendants. */
  rootId: categoryIdSchema.optional(),
  /** Inactive categories are hidden by default, together with their subtrees. */
  includeInactive: z.boolean().optional(),
})

export type CategoryTreeQuery = z.infer<typeof categoryTreeQuerySchema>

/**
 * The same query as it arrives on the wire, where every value is a string.
 *
 * Kept beside the typed form instead of in the controller so that the two
 * cannot drift: adding a parameter to one without the other stops compiling.
 */
export const categoryTreeQueryParamsSchema = z.object({
  rootId: z.coerce.number().int().positive().optional(),
  includeInactive: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
})

export const createCategoryRequestSchema = z.object({
  /** `null` creates a root. */
  parentId: categoryIdSchema.nullable(),
  name: categoryNameSchema,
  slug: categorySlugSchema,
  /** Appended after the last sibling when omitted. */
  sortOrder: z.int().min(0).optional(),
})

export type CreateCategoryRequest = z.infer<typeof createCategoryRequestSchema>

/**
 * Editing the fields a person types.
 *
 * `version` is required, not optional: an update that may omit its lock is an
 * update that will omit it, and the conflict it was there to catch becomes a
 * silently discarded edit (DECISIONS 4).
 */
export const updateCategoryRequestSchema = z.object({
  version: z.int().min(0),
  name: categoryNameSchema.optional(),
  slug: categorySlugSchema.optional(),
  isActive: z.boolean().optional(),
})

export type UpdateCategoryRequest = z.infer<typeof updateCategoryRequestSchema>

/**
 * Moving a node, with its whole subtree.
 *
 * No `version`: a move is serialised by an advisory lock rather than announced
 * as a conflict, because there is no editor to ask (DECISIONS 4 — 트리 이동).
 */
export const moveCategoryRequestSchema = z.object({
  /** `null` moves the node to the top level. */
  parentId: categoryIdSchema.nullable(),
  /** Appended after the last sibling of the new parent when omitted. */
  sortOrder: z.int().min(0).optional(),
})

export type MoveCategoryRequest = z.infer<typeof moveCategoryRequestSchema>

/**
 * Reordering siblings by listing all of them.
 *
 * The whole set rather than one moved id: two concurrent "put me third"
 * requests each computed their position from a different arrangement, and
 * applying both leaves an order neither asked for. Sending the arrangement
 * makes the result exactly one of the two.
 */
export const reorderCategoriesRequestSchema = z.object({
  parentId: categoryIdSchema.nullable(),
  orderedIds: z.array(categoryIdSchema).min(1),
})

export type ReorderCategoriesRequest = z.infer<typeof reorderCategoriesRequestSchema>
