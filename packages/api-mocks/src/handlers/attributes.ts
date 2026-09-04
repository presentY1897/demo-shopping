import type {
  AttributeDefinition,
  AttributeListResponse,
  AttributeType,
  CategoryNode,
  CreateAttributeRequest,
  EffectiveAttribute,
  UpdateAttributeRequest,
} from '@shopping/shared'
import {
  attributeListQueryParamsSchema,
  attributeListResponseSchema,
  attributeResponseSchema,
  createAttributeRequestSchema,
  optionIssues,
  updateAttributeRequestSchema,
} from '@shopping/shared'
import type { RequestHandler } from 'msw'
import { http, HttpResponse } from 'msw'

import { defineFixture } from '../define'
import { attributeDefinitions } from '../fixtures/attributes'
import { mockPaths } from '../paths'
import { categoryRowsSnapshot } from './categories'
import { answering, MockApiError, pathId, readBody } from './refusal'

/**
 * The attribute endpoints, with the state a screen that edits definitions needs.
 *
 * Like the category store next door, this is not a second implementation of
 * TASK-0030 — it is the part of it **a screen can observe through HTTP**:
 *
 * | invariant | how the real API enforces it |
 * | --- | --- |
 * | a lineage holds one live definition per key | tree advisory lock + a lookup (4.2) |
 * | the nearest definition wins | `resolveEffectiveAttributes` (4.1) |
 * | optimistic lock | `UPDATE ... WHERE version = ?`, 0 rows means 409 |
 * | `options` must agree with the **stored** type | `optionIssues` on the read-back row |
 * | delete is soft | `SET "deletedAt"`, the key becomes free again |
 *
 * Concurrency, the advisory lock and the database's CHECK constraints are the
 * back end's own tests (TASK-0030 7.3, 7.4). What is reproduced here is only
 * what an administrator can make happen from a browser.
 *
 * **Two things are borrowed rather than rewritten.** `optionIssues` is imported
 * from `@shopping/shared`, so the mock refuses an option list for exactly the
 * reasons the API refuses it. The lineage comes from `categoryRowsSnapshot()`,
 * so a category created in a spec is a category an attribute can be defined on.
 *
 * The nearest-wins resolution below **is** rewritten, because the real one lives
 * in `apps/api` and a mock package cannot import an app. It is fifteen lines and
 * it is observable — TASK-0028's move can put two definitions of one key into
 * one lineage — so leaving it out would make the double answer a question the
 * API answers differently.
 */

/** The ids in a materialised path, roots first: `/1/5/12/` → `[1, 5, 12]`. */
function lineageOf(path: string): readonly number[] {
  return path
    .split('/')
    .filter((segment) => segment !== '')
    .map(Number)
}

/** A definition together with how far down the lineage its owner sits. */
interface Ranked {
  readonly row: AttributeDefinition
  readonly level: number
}

/**
 * One winner per key, ordered general → specific.
 *
 * Deeper wins; ties fall back to `sortOrder` and then `id` so the answer is a
 * function of the rows rather than of the order they were stored in — the same
 * ordering `resolveEffectiveAttributes` produces.
 */
function resolve(
  rows: readonly AttributeDefinition[],
  lineage: readonly number[],
): readonly Ranked[] {
  const levels = new Map(lineage.map((categoryId, level) => [categoryId, level]))
  const winners = new Map<string, Ranked>()

  for (const row of rows) {
    const level = levels.get(row.categoryId)
    if (level === undefined) continue

    const held = winners.get(row.key)
    const beats =
      held === undefined ||
      (level !== held.level
        ? level > held.level
        : row.sortOrder !== held.row.sortOrder
          ? row.sortOrder < held.row.sortOrder
          : row.id < held.row.id)

    if (beats) winners.set(row.key, { row, level })
  }

  return [...winners.values()].sort(
    (left, right) =>
      left.level - right.level ||
      left.row.sortOrder - right.row.sortOrder ||
      left.row.id - right.row.id,
  )
}

/**
 * The live definitions, and the four things the console does to them.
 *
 * Reset between tests by {@link resetAttributeStore}, which `setupTestServer`
 * calls: definitions created by one spec must not decide what the next one sees.
 */
class AttributeStore {
  private rows: AttributeDefinition[] = []
  private nextId = 1

  constructor() {
    this.reset()
  }

  reset(seed: AttributeListResponse = attributeDefinitions): void {
    this.rows = seed.attributes.map(({ inherited: _inherited, ...row }) => ({ ...row }))
    this.nextId = this.rows.reduce((highest, row) => Math.max(highest, row.id), 0) + 1
  }

  list(query: { categoryId: number; includeInherited?: boolean }): AttributeListResponse {
    const target = this.mustHaveCategory(query.categoryId)
    const lineage = lineageOf(target.path)
    const own = lineage.length - 1
    const includeInherited = query.includeInherited ?? true

    return {
      attributes: resolve(this.rows, lineage)
        .map(({ row, level }): EffectiveAttribute => ({ ...row, inherited: level < own }))
        .filter((attribute) => includeInherited || !attribute.inherited),
    }
  }

  create(input: CreateAttributeRequest): AttributeDefinition {
    const category = this.categoryFor(input.categoryId)

    this.refuseLineageConflict(category, input.key)

    const created: AttributeDefinition = {
      id: this.nextId,
      categoryId: input.categoryId,
      key: input.key,
      label: input.label,
      type: input.type,
      options: [...(input.options ?? [])],
      isRequired: input.isRequired ?? false,
      isFilterable: input.isFilterable ?? false,
      sortOrder: input.sortOrder ?? this.nextSortOrder(input.categoryId),
      version: 0,
    }
    this.nextId += 1
    this.rows.push(created)

    return created
  }

  update(id: number, input: UpdateAttributeRequest): AttributeDefinition {
    const row = this.mustExist(id)

    // Options first, then the version — the order `AttributeService.update`
    // uses. `type` comes from the stored row because the request cannot carry
    // it: changing it would change what every stored value means (4.4).
    if (input.options !== undefined) this.refuseBadOptions(row.type, input.options)

    if (row.version !== input.version) {
      throw new MockApiError(409, '다른 관리자가 먼저 저장했어요. 최신 내용을 불러올까요?', {
        code: 'ATTRIBUTE_VERSION_CONFLICT',
        field: 'version',
      })
    }

    const updated: AttributeDefinition = {
      ...row,
      label: input.label ?? row.label,
      options: input.options === undefined ? row.options : [...input.options],
      isRequired: input.isRequired ?? row.isRequired,
      isFilterable: input.isFilterable ?? row.isFilterable,
      sortOrder: input.sortOrder ?? row.sortOrder,
      version: row.version + 1,
    }
    this.rows = this.rows.map((candidate) => (candidate.id === id ? updated : candidate))

    return updated
  }

  /** Soft delete: the row leaves the live set and its key becomes free again. */
  remove(id: number): AttributeDefinition {
    const row = this.mustExist(id)
    const removed: AttributeDefinition = { ...row, version: row.version + 1 }

    this.rows = this.rows.filter((candidate) => candidate.id !== id)

    return removed
  }

  private refuseBadOptions(type: AttributeType, options: readonly string[]): void {
    const issues = optionIssues(type, options)

    if (issues.length === 0) return

    throw new MockApiError(400, issues[0]?.message ?? '', {
      entries: issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
        code: 'INVALID',
      })),
    })
  }

  /**
   * Refuses a key already defined anywhere in this category's lineage — both
   * upwards and downwards.
   *
   * An **ancestor** already defining `material` would make the new row a second
   * answer for this category; a **descendant** defining it would make the new
   * row a second answer for *that* one. Checking only upwards would let a
   * root-level definition quietly shadow every leaf that had one (TASK-0030 4.2).
   */
  private refuseLineageConflict(category: CategoryNode, key: string): void {
    const categories = new Map(categoryRowsSnapshot().map((row) => [row.id, row]))

    for (const row of this.rows) {
      if (row.key !== key) continue

      const owner = categories.get(row.categoryId)
      if (owner === undefined) continue
      if (!owner.path.startsWith(category.path) && !category.path.startsWith(owner.path)) continue

      throw new MockApiError(409, `'${owner.name}' 에 같은 이름의 속성이 이미 있어요.`, {
        code: 'ATTRIBUTE_KEY_TAKEN',
        field: 'key',
        params: { name: owner.name },
      })
    }
  }

  private nextSortOrder(categoryId: number): number {
    return this.rows
      .filter((row) => row.categoryId === categoryId)
      .reduce((next, row) => Math.max(next, row.sortOrder + 1), 0)
  }

  private mustExist(id: number): AttributeDefinition {
    const row = this.rows.find((candidate) => candidate.id === id)

    if (row === undefined) throw new MockApiError(404, '속성 정의를 찾을 수 없습니다.')

    return row
  }

  /** 404, because the caller asked *about* this category. */
  private mustHaveCategory(id: number): CategoryNode {
    const row = categoryRowsSnapshot().find((candidate) => candidate.id === id)

    if (row === undefined) throw new MockApiError(404, '카테고리를 찾을 수 없습니다.')

    return row
  }

  /**
   * 400, because the caller *named* this category in a body it sent.
   *
   * Deliberately a plain-string refusal with no code, exactly as
   * `AttributeService.categoryFor` still answers — it is what keeps the two
   * shapes of `details` honest on the front end (TASK-0030 F9).
   */
  private categoryFor(id: number): CategoryNode {
    const row = categoryRowsSnapshot().find((candidate) => candidate.id === id)

    if (row === undefined) {
      throw new MockApiError(400, '선택한 카테고리가 없어졌어요. 목록을 새로고침해 주세요.')
    }

    return row
  }
}

const store = new AttributeStore()

/** Puts the definitions back to the fixture. Called from `setupTestServer`. */
export function resetAttributeStore(seed?: AttributeListResponse): void {
  store.reset(seed)
}

export const attributeHandlers: readonly RequestHandler[] = [
  http.get(mockPaths.attributes, ({ request }) =>
    answering(() => {
      const url = new URL(request.url)
      const query = attributeListQueryParamsSchema.safeParse(Object.fromEntries(url.searchParams))

      if (!query.success) throw new MockApiError(400, '요청 형식이 올바르지 않습니다.')

      return HttpResponse.json(defineFixture(attributeListResponseSchema, store.list(query.data)))
    }),
  ),

  http.post(mockPaths.attributes, ({ request }) =>
    answering(async () => {
      const body = await readBody(request, createAttributeRequestSchema)

      return HttpResponse.json(
        defineFixture(attributeResponseSchema, { attribute: store.create(body) }),
        { status: 201 },
      )
    }),
  ),

  http.patch(mockPaths.attribute, ({ request, params }) =>
    answering(async () => {
      const body = await readBody(request, updateAttributeRequestSchema)

      return HttpResponse.json(
        defineFixture(attributeResponseSchema, { attribute: store.update(pathId(params), body) }),
      )
    }),
  ),

  http.delete(mockPaths.attribute, ({ params }) =>
    answering(() =>
      HttpResponse.json(
        defineFixture(attributeResponseSchema, { attribute: store.remove(pathId(params)) }),
      ),
    ),
  ),
]
