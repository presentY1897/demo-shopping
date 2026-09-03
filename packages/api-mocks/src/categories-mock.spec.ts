/**
 * What the category double promises the screens that build on it.
 *
 * The other endpoints in this package answer from a frozen fixture, and a spec
 * for those would only restate the fixture. This one keeps state, so the screen
 * specs in `apps/admin` are only as trustworthy as the four refusals below —
 * a double that let a stale version through would make TASK-0029's conflict
 * spec pass while the screen did nothing.
 *
 * Every call goes through `createApiClient`, the same client the app uses, so a
 * response that drifted from the shared schema fails here as
 * `malformed_response` rather than reaching a screen that renders it (C1·C2).
 */

import type { CategoryTreeNode } from '@shopping/shared'
import { CATEGORY_MAX_DEPTH, createApiClient, isApiClientError } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import { categoryTree } from './fixtures/categories'
import { setupTestServer } from './node'

setupTestServer()

const client = createApiClient({ appId: 'admin', baseUrl: 'http://api.test.invalid' })

function flatten(nodes: readonly CategoryTreeNode[]): CategoryTreeNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)])
}

/** The status a failed call came back with, or `null` if it succeeded. */
async function statusOf(call: Promise<unknown>): Promise<number | null> {
  return call.then(
    () => null,
    (error: unknown) => (isApiClientError(error) ? (error.status ?? -1) : -1),
  )
}

describe('the category fixture', () => {
  const all = flatten(categoryTree.nodes)

  it('is the size TASK-0029 F1 asks a screen to render', () => {
    expect(all).toHaveLength(40)
    expect(Math.max(...all.map((node) => node.depth))).toBe(CATEGORY_MAX_DEPTH)
  })

  it('holds slugs the database would accept', () => {
    expect(new Set(all.map((node) => node.slug)).size).toBe(all.length)
  })

  it('has a path that agrees with its parent everywhere', () => {
    const byId = new Map(all.map((node) => [node.id, node]))

    for (const node of all) {
      const parentPath = node.parentId === null ? '/' : byId.get(node.parentId)?.path
      expect(node.path).toBe(`${String(parentPath)}${String(node.id)}/`)
    }
  })

  it('carries a retired branch, so the console has one to draw', () => {
    expect(all.some((node) => !node.isActive)).toBe(true)
  })
})

describe('the category endpoints', () => {
  it('hides an inactive node unless it is asked for', async () => {
    const shown = await client.getCategoryTree()
    const withRetired = await client.getCategoryTree({ includeInactive: true })

    expect(flatten(withRetired.nodes).length).toBeGreaterThan(flatten(shown.nodes).length)
    expect(flatten(shown.nodes).every((node) => node.isActive)).toBe(true)
  })

  it('shows a created category on the next read', async () => {
    const { category } = await client.createCategory({
      parentId: null,
      name: '리빙',
      slug: 'living',
    })
    const { nodes } = await client.getCategoryTree({ includeInactive: true })

    expect(flatten(nodes).map((node) => node.id)).toContain(category.id)
  })

  it('refuses a slug that is already taken', async () => {
    const call = client.createCategory({ parentId: null, name: '여성2', slug: 'women' })

    expect(await statusOf(call)).toBe(409)
  })

  it('refuses an edit that carries a stale version', async () => {
    const [root] = flatten((await client.getCategoryTree()).nodes)

    await client.updateCategory(root!.id, { version: root!.version, name: '여성복' })
    const stale = client.updateCategory(root!.id, { version: root!.version, name: '여성의류' })

    expect(await statusOf(stale)).toBe(409)
  })

  it('refuses to delete a category that still has children', async () => {
    const [root] = flatten((await client.getCategoryTree()).nodes)

    expect(await statusOf(client.deleteCategory(root!.id))).toBe(409)
  })

  it('deletes a leaf, and it is gone from the tree', async () => {
    const leaf = flatten((await client.getCategoryTree()).nodes).find(
      (node) => node.depth === CATEGORY_MAX_DEPTH,
    )

    await client.deleteCategory(leaf!.id)
    const remaining = flatten((await client.getCategoryTree({ includeInactive: true })).nodes)

    expect(remaining.map((node) => node.id)).not.toContain(leaf!.id)
  })

  it('rewrites the whole subtree when a branch moves', async () => {
    const nodes = flatten((await client.getCategoryTree()).nodes)
    const branch = nodes.find((node) => node.depth === 2 && node.children.length > 0)
    const newRoot = nodes.find((node) => node.depth === 1 && node.id !== branch?.parentId)

    await client.moveCategory(branch!.id, { parentId: newRoot!.id })
    const moved = flatten((await client.getCategoryTree()).nodes)
    const child = moved.find((node) => node.parentId === branch!.id)

    expect(moved.find((node) => node.id === branch!.id)?.path).toBe(
      `${newRoot!.path}${String(branch!.id)}/`,
    )
    expect(child?.path.startsWith(`${newRoot!.path}${String(branch!.id)}/`)).toBe(true)
  })

  it('refuses a move that would exceed the depth cap', async () => {
    const nodes = flatten((await client.getCategoryTree()).nodes)
    const branch = nodes.find((node) => node.depth === 2 && node.children.length > 0)
    const leaf = nodes.find((node) => node.depth === CATEGORY_MAX_DEPTH)

    expect(await statusOf(client.moveCategory(branch!.id, { parentId: leaf!.id }))).toBe(400)
  })

  it("refuses a move into a node's own subtree", async () => {
    const nodes = flatten((await client.getCategoryTree()).nodes)
    const branch = nodes.find((node) => node.depth === 1)
    const [child] = branch!.children

    expect(await statusOf(client.moveCategory(branch!.id, { parentId: child!.id }))).toBe(400)
  })

  it('renumbers siblings from the arrangement it is sent', async () => {
    const [root] = (await client.getCategoryTree()).nodes
    const ids = root!.children.map((child) => child.id)

    const { categories } = await client.reorderCategories({
      parentId: root!.id,
      orderedIds: [...ids].reverse(),
    })

    expect(categories.map((category) => category.id)).toEqual([...ids].reverse())
    expect(categories.map((category) => category.sortOrder)).toEqual(ids.map((_, index) => index))
  })

  it('refuses a partial arrangement', async () => {
    const [root] = (await client.getCategoryTree()).nodes
    const [first] = root!.children

    const call = client.reorderCategories({ parentId: root!.id, orderedIds: [first!.id] })

    expect(await statusOf(call)).toBe(400)
  })
})
