import type { ApiClient, CategoryTreeNode } from '@shopping/shared'
import { ApiClientError, categoryTreeResponseSchema } from '@shopping/shared'
import { beforeEach, describe, expect, it } from 'vitest'

import { deniedMessage } from '../../src/auth/access-denied.js'
import { useApiApp } from '../support/api-app.js'
import { useDatabase } from '../support/database.js'
import { callers } from '../support/principal.js'

/**
 * The category endpoints over real HTTP, against this worker's real database.
 *
 * Everything here goes through `createApiClient` from `@shopping/shared`, which
 * parses each response with the schema the front-ends are typed against. Gate C3
 * therefore holds structurally: a renamed or missing field fails these specs as
 * `malformed_response` whether or not an assertion happens to mention it.
 *
 * Authentication does not exist yet, so the harness binds the header-reading
 * principal resolver that TASK-0021 will replace with a JWT one (`authenticate`
 * below). Without it every guarded endpoint answers 401 and gate A3 — 권한 없는
 * 역할로 호출하면 403 — would have nothing to observe.
 */

const db = useDatabase()
const api = useApiApp({ database: db, authenticate: true })

/** `catalog.read` + `catalog.write`, but no `catalog.delete`. */
function operator(): ApiClient {
  return api.clientAs(callers.operator)
}

/** The only role holding `catalog.delete`. */
function superAdmin(): ApiClient {
  return api.clientAs(callers.superAdmin)
}

interface HttpFailure {
  readonly status: number
  readonly code: string
  readonly details: readonly unknown[]
}

/** Asserts the call failed over HTTP and returns the shared error envelope. */
async function failure(work: Promise<unknown>): Promise<HttpFailure> {
  const error: unknown = await work.then(
    () => null,
    (reason: unknown) => reason,
  )

  if (!(error instanceof ApiClientError) || error.kind !== 'http') {
    throw new Error(`HTTP 오류를 기대했지만 다른 결과가 나왔습니다: ${String(error)}`)
  }

  return {
    status: error.status ?? 0,
    code: error.body?.error.code ?? '',
    details: error.body?.error.details ?? [],
  }
}

/** The three-level branch most specs start from: 의류 > 상의 > 티셔츠. */
async function branch(): Promise<{ root: number; child: number; leaf: number }> {
  const client = operator()
  const { category: root } = await client.createCategory({
    parentId: null,
    name: '의류',
    slug: 'clothing',
  })
  const { category: child } = await client.createCategory({
    parentId: root.id,
    name: '상의',
    slug: 'tops',
  })
  const { category: leaf } = await client.createCategory({
    parentId: child.id,
    name: '티셔츠',
    slug: 'tees',
  })

  return { root: root.id, child: child.id, leaf: leaf.id }
}

/** Every id in a forest, parents before children. */
function ids(nodes: readonly CategoryTreeNode[]): number[] {
  return nodes.flatMap((node) => [node.id, ...ids(node.children)])
}

describe('creating a tree', () => {
  it('builds three levels with the right path and depth (F1)', async () => {
    const client = operator()
    const { category: root } = await client.createCategory({
      parentId: null,
      name: '의류',
      slug: 'clothing',
    })

    expect(root).toMatchObject({ parentId: null, depth: 1, path: `/${String(root.id)}/` })

    const { category: child } = await client.createCategory({
      parentId: root.id,
      name: '상의',
      slug: 'tops',
    })

    expect(child).toMatchObject({
      parentId: root.id,
      depth: 2,
      path: `${root.path}${String(child.id)}/`,
    })

    const { category: leaf } = await client.createCategory({
      parentId: child.id,
      name: '티셔츠',
      slug: 'tees',
    })

    expect(leaf).toMatchObject({ depth: 3, path: `${child.path}${String(leaf.id)}/` })
  })

  it('refuses a fourth level (F5)', async () => {
    const { leaf } = await branch()
    const refused = await failure(
      operator().createCategory({ parentId: leaf, name: '반팔', slug: 'short-sleeve' }),
    )

    expect(refused.status).toBe(400)
    expect(refused.code).toBe('CATEGORY_MAX_DEPTH')
    expect(refused.details).toMatchObject([{ field: 'parentId', params: { max: 3 } }])
  })

  it('refuses an unknown parent', async () => {
    const refused = await failure(
      operator().createCategory({ parentId: 9_999, name: '고아', slug: 'orphan' }),
    )

    expect(refused.status).toBe(400)
    expect(refused.code).toBe('CATEGORY_PARENT_MISSING')
    expect(refused.details).toMatchObject([{ field: 'parentId' }])
  })

  it('refuses a slug that is already taken, and the database is what decides', async () => {
    await operator().createCategory({ parentId: null, name: '가방', slug: 'bags' })

    const refused = await failure(
      operator().createCategory({ parentId: null, name: '가방2', slug: 'bags' }),
    )

    expect(refused.status).toBe(409)
    expect(refused.code).toBe('CATEGORY_SLUG_TAKEN')
    expect(refused.details).toMatchObject([{ field: 'slug' }])
  })

  it('appends new siblings after the existing ones', async () => {
    const client = operator()
    const { category: first } = await client.createCategory({
      parentId: null,
      name: '첫째',
      slug: 'first',
    })
    const { category: second } = await client.createCategory({
      parentId: null,
      name: '둘째',
      slug: 'second',
    })

    expect([first.sortOrder, second.sortOrder]).toEqual([0, 1])
  })
})

describe('reading the tree', () => {
  it('returns the whole forest nested', async () => {
    const { root, child, leaf } = await branch()
    await operator().createCategory({ parentId: null, name: '신발', slug: 'shoes' })

    const { nodes } = await operator().getCategoryTree()

    expect(nodes).toHaveLength(2)
    expect(ids(nodes.slice(0, 1))).toEqual([root, child, leaf])
  })

  it('returns a node and its whole subtree from one request (F2)', async () => {
    const { child, leaf } = await branch()
    const { nodes } = await operator().getCategoryTree({ rootId: child })

    expect(ids(nodes)).toEqual([child, leaf])
  })

  it('answers 404 for a subtree that does not exist', async () => {
    expect((await failure(operator().getCategoryTree({ rootId: 9_999 }))).status).toBe(404)
  })

  it('hides an inactive branch together with its children', async () => {
    const { root, child, leaf } = await branch()
    const { category: current } = await operator()
      .getCategoryTree({ rootId: child })
      .then(({ nodes }) => ({ category: nodes[0]! }))

    await operator().updateCategory(child, { version: current.version, isActive: false })

    expect(ids((await operator().getCategoryTree()).nodes)).toEqual([root])
    expect(ids((await operator().getCategoryTree({ includeInactive: true })).nodes)).toEqual([
      root,
      child,
      leaf,
    ])
  })

  it('answers a body the shared schema accepts', async () => {
    await branch()

    const raw: unknown = await fetch(`${api.baseUrl}/api/v1/categories`, {
      headers: { 'x-test-user': callers.operator.userId, 'x-test-roles': 'ADMIN_OPERATOR' },
    }).then((response) => response.json())

    expect(categoryTreeResponseSchema.safeParse(raw).success).toBe(true)
  })
})

describe('moving a node', () => {
  it('carries the whole subtree to the new parent (F3)', async () => {
    const { child, leaf } = await branch()
    const { category: destination } = await operator().createCategory({
      parentId: null,
      name: '신발',
      slug: 'shoes',
    })

    const { category: moved } = await operator().moveCategory(child, { parentId: destination.id })

    expect(moved).toMatchObject({
      parentId: destination.id,
      depth: 2,
      path: `${destination.path}${String(child)}/`,
    })

    const { nodes } = await operator().getCategoryTree({ rootId: destination.id })

    expect(ids(nodes)).toEqual([destination.id, child, leaf])
    // The descendant's path was rewritten too, not only the node that moved.
    expect(nodes[0]?.children[0]?.children[0]).toMatchObject({
      id: leaf,
      depth: 3,
      path: `${moved.path}${String(leaf)}/`,
    })
  })

  it('moves a node up to the top level', async () => {
    const { child, leaf } = await branch()
    const { category: moved } = await operator().moveCategory(child, { parentId: null })

    expect(moved).toMatchObject({ parentId: null, depth: 1, path: `/${String(child)}/` })

    const { nodes } = await operator().getCategoryTree({ rootId: child })

    expect(nodes[0]?.children[0]).toMatchObject({ id: leaf, depth: 2 })
  })

  it('refuses a move under itself or under its own descendant (F4)', async () => {
    const { root, child } = await branch()

    for (const parentId of [root, child]) {
      const refused = await failure(operator().moveCategory(root, { parentId }))

      expect(refused.status).toBe(400)
      expect(refused.code).toBe('CATEGORY_MOVE_INTO_SELF')
      expect(refused.details).toMatchObject([{ field: 'parentId' }])
    }
  })

  it('refuses a move that would push the subtree past the third level (F5)', async () => {
    const { child } = await branch()
    const other = await (async () => {
      const client = operator()
      const { category: otherRoot } = await client.createCategory({
        parentId: null,
        name: '신발',
        slug: 'shoes',
      })
      const { category: otherChild } = await client.createCategory({
        parentId: otherRoot.id,
        name: '스니커즈',
        slug: 'sneakers',
      })

      return otherChild
    })()

    // `child` carries a leaf, so it needs two levels; `other` is already at two.
    const refused = await failure(operator().moveCategory(child, { parentId: other.id }))

    expect(refused.status).toBe(400)
    expect(refused.code).toBe('CATEGORY_MAX_DEPTH')
  })

  it('answers 404 for a node that is not there', async () => {
    expect((await failure(operator().moveCategory(9_999, { parentId: null }))).status).toBe(404)
  })
})

describe('ordering siblings', () => {
  let created: number[] = []

  beforeEach(async () => {
    const client = operator()

    created = []
    for (const slug of ['a', 'b', 'c']) {
      const { category } = await client.createCategory({ parentId: null, name: slug, slug })

      created.push(category.id)
    }
  })

  it('applies the given arrangement to the tree read (F6)', async () => {
    const reversed = [...created].reverse()
    const { categories } = await operator().reorderCategories({
      parentId: null,
      orderedIds: reversed,
    })

    expect(categories.map((category) => category.id)).toEqual(reversed)
    expect(categories.map((category) => category.sortOrder)).toEqual([0, 1, 2])

    const { nodes } = await operator().getCategoryTree()

    expect(nodes.map((node) => node.id)).toEqual(reversed)
  })

  it('refuses an arrangement that is not the complete sibling set', async () => {
    const refused = await failure(
      operator().reorderCategories({ parentId: null, orderedIds: created.slice(0, 2) }),
    )

    expect(refused.status).toBe(400)
    expect(refused.code).toBe('CATEGORY_REORDER_MISMATCH')
    expect(refused.details).toMatchObject([{ field: 'orderedIds' }])
  })

  it('refuses a duplicate id', async () => {
    const [first] = created

    expect(
      (
        await failure(
          operator().reorderCategories({
            parentId: null,
            orderedIds: [first!, first!, created[1]!],
          }),
        )
      ).status,
    ).toBe(400)
  })
})

describe('editing a category', () => {
  it('renames it and moves the optimistic lock forward', async () => {
    const { category } = await operator().createCategory({
      parentId: null,
      name: '의류',
      slug: 'clothing',
    })

    const { category: renamed } = await operator().updateCategory(category.id, {
      version: category.version,
      name: '패션',
    })

    expect(renamed).toMatchObject({ name: '패션', slug: 'clothing', version: category.version + 1 })
  })

  it('refuses a stale version instead of overwriting the other edit (DECISIONS 4)', async () => {
    const { category } = await operator().createCategory({
      parentId: null,
      name: '의류',
      slug: 'clothing',
    })

    await operator().updateCategory(category.id, { version: category.version, name: '패션' })

    const refused = await failure(
      operator().updateCategory(category.id, { version: category.version, name: '의상' }),
    )

    expect(refused.status).toBe(409)
    expect(refused.code).toBe('CATEGORY_VERSION_CONFLICT')

    const { nodes } = await operator().getCategoryTree({ rootId: category.id })

    expect(nodes[0]?.name).toBe('패션')
  })

  it('answers 404 rather than 409 when the row is gone', async () => {
    expect((await failure(operator().updateCategory(9_999, { version: 0 }))).status).toBe(404)
  })
})

describe('removing a category', () => {
  it('hides it, keeps the row, and never hands the id out again (F7)', async () => {
    const client = superAdmin()
    const { category: first } = await client.createCategory({
      parentId: null,
      name: '첫째',
      slug: 'first',
    })
    const { category: doomed } = await client.createCategory({
      parentId: null,
      name: '사라질 것',
      slug: 'doomed',
    })

    const { category: removed } = await client.deleteCategory(doomed.id)

    expect(removed).toMatchObject({ id: doomed.id, isActive: false })
    expect((await client.getCategoryTree()).nodes.map((node) => node.id)).toEqual([first.id])

    const { category: next } = await client.createCategory({
      parentId: null,
      name: '다음',
      slug: 'next',
    })

    expect(next.id).toBeGreaterThan(doomed.id)
    expect(next.id).not.toBe(doomed.id)
  })

  it('keeps subtree reads working around the gap (F8)', async () => {
    const { root, child, leaf } = await branch()
    const { category: sibling } = await superAdmin().createCategory({
      parentId: root,
      name: '하의',
      slug: 'bottoms',
    })

    await superAdmin().deleteCategory(sibling.id)

    const { nodes } = await operator().getCategoryTree({ rootId: root })

    expect(ids(nodes)).toEqual([root, child, leaf])
  })

  it('releases the slug for a new category', async () => {
    const { category } = await superAdmin().createCategory({
      parentId: null,
      name: '가방',
      slug: 'bags',
    })

    await superAdmin().deleteCategory(category.id)

    const { category: reborn } = await superAdmin().createCategory({
      parentId: null,
      name: '가방',
      slug: 'bags',
    })

    expect(reborn.id).toBeGreaterThan(category.id)
  })

  it('refuses to remove a node that still has children', async () => {
    const { root } = await branch()
    const refused = await failure(superAdmin().deleteCategory(root))

    expect(refused.status).toBe(409)
    expect(refused.code).toBe('CATEGORY_HAS_CHILDREN')
    // No field: nothing the caller typed is at fault, so nothing gets an error
    // hung under it.
    expect(refused.details).toEqual([])
  })
})

describe('input validation (A2)', () => {
  it('answers 400 in the shared envelope for a malformed body', async () => {
    const refused = await failure(
      operator().createCategory({
        parentId: null,
        name: '',
        slug: 'Not A Slug',
      }),
    )

    expect(refused.status).toBe(400)
    expect(refused.code).toBe('BAD_REQUEST')
    expect(refused.details).toMatchObject([
      { field: 'name', code: 'INVALID' },
      { field: 'slug', code: 'INVALID' },
    ])
  })

  it('answers 400 for an id that is not a number', async () => {
    const response = await fetch(`${api.baseUrl}/api/v1/categories/not-a-number`, {
      method: 'DELETE',
      headers: { 'x-test-user': callers.superAdmin.userId, 'x-test-roles': 'ADMIN_SUPER' },
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: { code: 'BAD_REQUEST', details: [{ field: 'id', code: 'INVALID' }] },
    })
  })

  it('answers 400 for a query parameter of the wrong type', async () => {
    const response = await fetch(`${api.baseUrl}/api/v1/categories?rootId=abc`, {
      headers: { 'x-test-user': callers.operator.userId, 'x-test-roles': 'ADMIN_OPERATOR' },
    })

    expect(response.status).toBe(400)
  })
})

describe('authorization (A3 · A4)', () => {
  it('answers 401 when nobody could be identified (A4)', async () => {
    // `api.client` sends no caller header at all, which is what a request
    // without a token will look like once TASK-0022 lands.
    expect((await failure(api.client.getCategoryTree())).status).toBe(401)
    expect(
      (await failure(api.client.createCategory({ parentId: null, name: '가방', slug: 'bags' })))
        .status,
    ).toBe(401)
  })

  it('lets every role read the shared catalogue', async () => {
    await branch()

    for (const caller of [callers.buyer, callers.seller, callers.demoAdmin]) {
      const { nodes } = await api.clientAs(caller).getCategoryTree()

      expect(nodes).toHaveLength(1)
    }
  })

  it('answers 403 for a role without catalog.write (A3)', async () => {
    for (const caller of [callers.buyer, callers.seller]) {
      const refused = await failure(
        api.clientAs(caller).createCategory({ parentId: null, name: '가방', slug: 'bags' }),
      )

      expect(refused.status).toBe(403)
      expect(refused.details).toEqual([deniedMessage('catalog.write', 'missing_permission')])
    }
  })

  it('answers 403 for an operator asking to delete', async () => {
    const { root } = await branch()
    const refused = await failure(operator().deleteCategory(root))

    expect(refused.status).toBe(403)
    expect(refused.details).toEqual([deniedMessage('catalog.delete', 'missing_permission')])
  })

  it('keeps a demo administrator out of the platform catalogue', async () => {
    // `DEMO_ADMIN` holds `catalog.write` narrowed to scope `demo`, and the tree
    // is platform-owned — so the permission is present and the scope refuses.
    const refused = await failure(
      api.clientAs(callers.demoAdmin).createCategory({
        parentId: null,
        name: '가방',
        slug: 'bags',
      }),
    )

    expect(refused.status).toBe(403)
    expect(refused.details).toEqual([deniedMessage('catalog.write', 'out_of_scope')])
  })
})
