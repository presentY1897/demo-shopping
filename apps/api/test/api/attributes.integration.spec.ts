import type { ApiClient, CreateAttributeRequest } from '@shopping/shared'
import { ApiClientError, attributeListResponseSchema } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import { deniedMessage } from '../../src/auth/access-denied.js'
import { useApiApp } from '../support/api-app.js'
import { useDatabase } from '../support/database.js'
import { callers } from '../support/principal.js'

/**
 * The attribute endpoints over real HTTP, against this worker's real database.
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

/** 의류 > 상의 > 티셔츠, the three levels F1 is about. */
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

/** A definition, stating only what the test is about. */
function definition(
  categoryId: number,
  overrides: Partial<CreateAttributeRequest> = {},
): CreateAttributeRequest {
  return { categoryId, key: 'material', label: '소재', type: 'TEXT', ...overrides }
}

describe('inheritance down a three-level tree (F1)', () => {
  it('gives the leaf every ancestor definition, general first', async () => {
    const { root, child, leaf } = await branch()
    const client = operator()

    await client.createAttribute(definition(root, { key: 'brand', label: '브랜드' }))
    await client.createAttribute(definition(child, { key: 'fit', label: '핏' }))
    await client.createAttribute(definition(leaf, { key: 'neckline', label: '넥라인' }))

    const { attributes } = await client.getAttributes({ categoryId: leaf })

    expect(attributes.map((attribute) => [attribute.key, attribute.inherited])).toEqual([
      ['brand', true],
      ['fit', true],
      ['neckline', false],
    ])
  })

  it('does not push a definition downwards into a sibling branch', async () => {
    const { root, child } = await branch()
    const { category: sibling } = await operator().createCategory({
      parentId: root,
      name: '하의',
      slug: 'bottoms',
    })

    await operator().createAttribute(definition(child, { key: 'fit', label: '핏' }))

    const { attributes } = await operator().getAttributes({ categoryId: sibling.id })

    expect(attributes).toEqual([])
  })

  it('does not push a definition upwards into its own ancestor', async () => {
    const { root, leaf } = await branch()

    await operator().createAttribute(definition(leaf, { key: 'neckline', label: '넥라인' }))

    expect((await operator().getAttributes({ categoryId: root })).attributes).toEqual([])
  })

  it("narrows the answer to a category's own definitions when asked", async () => {
    const { root, leaf } = await branch()

    await operator().createAttribute(definition(root, { key: 'brand', label: '브랜드' }))
    await operator().createAttribute(definition(leaf, { key: 'neckline', label: '넥라인' }))

    const { attributes } = await operator().getAttributes({
      categoryId: leaf,
      includeInherited: false,
    })

    expect(attributes.map((attribute) => attribute.key)).toEqual(['neckline'])
  })

  it('answers an empty list for a category with nothing defined anywhere above', async () => {
    const { leaf } = await branch()

    expect((await operator().getAttributes({ categoryId: leaf })).attributes).toEqual([])
  })

  it('answers 404 for a category that does not exist', async () => {
    expect((await failure(operator().getAttributes({ categoryId: 9_999 }))).status).toBe(404)
  })

  it('answers a body the shared schema accepts', async () => {
    const { leaf } = await branch()

    await operator().createAttribute(definition(leaf))

    const raw: unknown = await fetch(
      `${api.baseUrl}/api/v1/attributes?categoryId=${String(leaf)}`,
      {
        headers: { 'x-test-user': callers.operator.userId, 'x-test-roles': 'ADMIN_OPERATOR' },
      },
    ).then((response) => response.json())

    expect(attributeListResponseSchema.safeParse(raw).success).toBe(true)
  })
})

describe('creating a definition', () => {
  it('stores every field and appends after the last definition', async () => {
    const { leaf } = await branch()
    const client = operator()

    const { attribute: first } = await client.createAttribute(
      definition(leaf, {
        key: 'color',
        label: '색상',
        type: 'SELECT',
        options: ['블랙', '화이트'],
        isRequired: true,
        isFilterable: true,
      }),
    )

    expect(first).toMatchObject({
      categoryId: leaf,
      key: 'color',
      label: '색상',
      type: 'SELECT',
      options: ['블랙', '화이트'],
      isRequired: true,
      isFilterable: true,
      sortOrder: 0,
      version: 0,
    })

    const { attribute: second } = await client.createAttribute(definition(leaf))

    expect(second.sortOrder).toBe(1)
  })

  it('refuses a category that is not there', async () => {
    const refused = await failure(operator().createAttribute(definition(9_999)))

    // Still a plain string, on purpose: this endpoint is what keeps `details`
    // carrying both shapes honest (TASK-0117 F9). The shape is the contract —
    // the sentence is this endpoint's own, and asserting it would pin the spec
    // to prose the way TASK-0117 exists to stop.
    expect(refused.status).toBe(400)
    expect(refused.code).toBe('BAD_REQUEST')
    expect(refused.details).toHaveLength(1)
    expect(typeof refused.details[0]).toBe('string')
  })

  it('refuses the same key on the same category', async () => {
    const { leaf } = await branch()

    await operator().createAttribute(definition(leaf))

    const refused = await failure(operator().createAttribute(definition(leaf)))

    expect(refused.status).toBe(409)
  })

  it('refuses a key an ancestor already defines (F7)', async () => {
    const { root, leaf } = await branch()

    await operator().createAttribute(definition(root, { key: 'brand', label: '브랜드' }))

    const refused = await failure(
      operator().createAttribute(definition(leaf, { key: 'brand', label: '브랜드' })),
    )

    expect(refused.status).toBe(409)
    expect(refused.code).toBe('ATTRIBUTE_KEY_TAKEN')
    expect(refused.details).toMatchObject([{ field: 'key', params: { name: '의류' } }])
  })

  it('refuses a key a descendant already defines (F7)', async () => {
    // The direction that is easy to forget: adding to a root would otherwise
    // silently shadow every leaf that already had the key.
    const { root, leaf } = await branch()

    await operator().createAttribute(definition(leaf, { key: 'brand', label: '브랜드' }))

    const refused = await failure(
      operator().createAttribute(definition(root, { key: 'brand', label: '브랜드' })),
    )

    expect(refused.status).toBe(409)
    expect(refused.code).toBe('ATTRIBUTE_KEY_TAKEN')
    expect(refused.details).toMatchObject([{ field: 'key', params: { name: '티셔츠' } }])
  })

  it('allows the same key on an unrelated branch', async () => {
    const { leaf } = await branch()
    const { category: other } = await operator().createCategory({
      parentId: null,
      name: '신발',
      slug: 'shoes',
    })

    await operator().createAttribute(definition(leaf, { key: 'brand', label: '브랜드' }))

    const { attribute } = await operator().createAttribute(
      definition(other.id, { key: 'brand', label: '브랜드' }),
    )

    expect(attribute.categoryId).toBe(other.id)
  })

  it('lets a deleted definition free its key for the lineage again', async () => {
    const { root, leaf } = await branch()
    const { attribute } = await operator().createAttribute(
      definition(root, { key: 'brand', label: '브랜드' }),
    )

    await superAdmin().deleteAttribute(attribute.id)

    const { attribute: reborn } = await operator().createAttribute(
      definition(leaf, { key: 'brand', label: '브랜드' }),
    )

    expect(reborn.categoryId).toBe(leaf)
  })
})

describe('editing a definition', () => {
  it('renames it and moves the optimistic lock forward', async () => {
    const { leaf } = await branch()
    const { attribute } = await operator().createAttribute(definition(leaf))

    const { attribute: renamed } = await operator().updateAttribute(attribute.id, {
      version: attribute.version,
      label: '소재 구성',
      isRequired: true,
    })

    expect(renamed).toMatchObject({
      label: '소재 구성',
      key: 'material',
      isRequired: true,
      version: attribute.version + 1,
    })
  })

  it('refuses a stale version instead of overwriting the other edit', async () => {
    const { leaf } = await branch()
    const { attribute } = await operator().createAttribute(definition(leaf))

    await operator().updateAttribute(attribute.id, { version: attribute.version, label: '첫 편집' })

    const refused = await failure(
      operator().updateAttribute(attribute.id, { version: attribute.version, label: '둘째 편집' }),
    )

    expect(refused.status).toBe(409)

    const { attributes } = await operator().getAttributes({ categoryId: leaf })

    expect(attributes[0]?.label).toBe('첫 편집')
  })

  it('widens the option list of a SELECT', async () => {
    const { leaf } = await branch()
    const { attribute } = await operator().createAttribute(
      definition(leaf, { key: 'color', label: '색상', type: 'SELECT', options: ['블랙'] }),
    )

    const { attribute: widened } = await operator().updateAttribute(attribute.id, {
      version: attribute.version,
      options: ['블랙', '화이트'],
    })

    expect(widened.options).toEqual(['블랙', '화이트'])
  })

  it('refuses to empty the option list of a SELECT', async () => {
    // A `SELECT` with no choices can never validate any value; a required one
    // would make every product in the category unsaveable.
    const { leaf } = await branch()
    const { attribute } = await operator().createAttribute(
      definition(leaf, { key: 'color', label: '색상', type: 'SELECT', options: ['블랙'] }),
    )

    const refused = await failure(
      operator().updateAttribute(attribute.id, { version: attribute.version, options: [] }),
    )

    expect(refused.status).toBe(400)
    expect(refused.details).toMatchObject([{ field: 'options', code: 'INVALID' }])
  })

  it('refuses options on a type that has none', async () => {
    const { leaf } = await branch()
    const { attribute } = await operator().createAttribute(definition(leaf))

    const refused = await failure(
      operator().updateAttribute(attribute.id, { version: attribute.version, options: ['블랙'] }),
    )

    expect(refused.status).toBe(400)
    expect(refused.details).toMatchObject([{ field: 'options', code: 'INVALID' }])
  })

  it('answers 404 rather than 409 when the row is gone', async () => {
    expect((await failure(operator().updateAttribute(9_999, { version: 0 }))).status).toBe(404)
  })
})

describe('removing a definition', () => {
  it('takes it out of the effective list and keeps the row', async () => {
    const { leaf } = await branch()
    const { attribute } = await operator().createAttribute(definition(leaf))

    const { attribute: removed } = await superAdmin().deleteAttribute(attribute.id)

    expect(removed.id).toBe(attribute.id)
    expect((await operator().getAttributes({ categoryId: leaf })).attributes).toEqual([])

    const [row] = await db.query<{ id: number }>(
      `SELECT "id" FROM "AttributeDefinition" WHERE "id" = $1 AND "deletedAt" IS NOT NULL`,
      [attribute.id],
    )

    expect(row?.id).toBe(attribute.id)
  })

  it('answers 404 for a definition that is not there', async () => {
    expect((await failure(superAdmin().deleteAttribute(9_999))).status).toBe(404)
  })
})

describe('input validation (A2)', () => {
  it('answers 400 in the shared envelope for a malformed key', async () => {
    const { leaf } = await branch()
    const refused = await failure(
      operator().createAttribute(definition(leaf, { key: 'Size.EU', label: '' })),
    )

    expect(refused.status).toBe(400)
    expect(refused.code).toBe('BAD_REQUEST')
    expect(refused.details).toMatchObject([
      { field: 'key', code: 'INVALID' },
      { field: 'label', code: 'INVALID' },
    ])
  })

  it('answers 400 for a SELECT with no options', async () => {
    const { leaf } = await branch()
    const refused = await failure(
      operator().createAttribute(definition(leaf, { key: 'color', type: 'SELECT' })),
    )

    expect(refused.status).toBe(400)
    expect(refused.details).toMatchObject([{ field: 'options', code: 'INVALID' }])
  })

  it('answers 400 for duplicate options', async () => {
    const { leaf } = await branch()
    const refused = await failure(
      operator().createAttribute(
        definition(leaf, { key: 'color', type: 'SELECT', options: ['블랙', '블랙'] }),
      ),
    )

    expect(refused.status).toBe(400)
  })

  it('answers 400 for a missing categoryId', async () => {
    const response = await fetch(`${api.baseUrl}/api/v1/attributes`, {
      headers: { 'x-test-user': callers.operator.userId, 'x-test-roles': 'ADMIN_OPERATOR' },
    })

    expect(response.status).toBe(400)
  })

  it('answers 400 for an id that is not a number', async () => {
    const response = await fetch(`${api.baseUrl}/api/v1/attributes/not-a-number`, {
      method: 'DELETE',
      headers: { 'x-test-user': callers.superAdmin.userId, 'x-test-roles': 'ADMIN_SUPER' },
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: { code: 'BAD_REQUEST', details: [{ field: 'id', code: 'INVALID' }] },
    })
  })
})

describe('authorization (A3 · A4)', () => {
  it('answers 401 when nobody could be identified (A4)', async () => {
    const { leaf } = await branch()

    expect((await failure(api.client.getAttributes({ categoryId: leaf }))).status).toBe(401)
    expect((await failure(api.client.createAttribute(definition(leaf)))).status).toBe(401)
    expect((await failure(api.client.updateAttribute(1, { version: 0 }))).status).toBe(401)
    expect((await failure(api.client.deleteAttribute(1))).status).toBe(401)
  })

  it('lets every role read the definitions of the shared catalogue', async () => {
    const { leaf } = await branch()

    await operator().createAttribute(definition(leaf))

    for (const caller of [callers.buyer, callers.seller, callers.demoAdmin]) {
      const { attributes } = await api.clientAs(caller).getAttributes({ categoryId: leaf })

      expect(attributes).toHaveLength(1)
    }
  })

  it('answers 403 for a role without catalog.write (A3)', async () => {
    const { leaf } = await branch()

    for (const caller of [callers.buyer, callers.seller]) {
      const refused = await failure(api.clientAs(caller).createAttribute(definition(leaf)))

      expect(refused.status).toBe(403)
      expect(refused.details).toEqual([deniedMessage('catalog.write', 'missing_permission')])
    }
  })

  it('answers 403 for an operator asking to delete', async () => {
    const { leaf } = await branch()
    const { attribute } = await operator().createAttribute(definition(leaf))
    const refused = await failure(operator().deleteAttribute(attribute.id))

    expect(refused.status).toBe(403)
    expect(refused.details).toEqual([deniedMessage('catalog.delete', 'missing_permission')])
  })

  it('keeps a demo administrator out of the platform catalogue', async () => {
    const { leaf } = await branch()
    const refused = await failure(api.clientAs(callers.demoAdmin).createAttribute(definition(leaf)))

    expect(refused.status).toBe(403)
    expect(refused.details).toEqual([deniedMessage('catalog.write', 'out_of_scope')])
  })
})
