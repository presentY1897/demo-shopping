/**
 * What the attribute double promises the screen that builds on it (TASK-0031).
 *
 * The definitions store keeps state, so `apps/admin`'s attribute specs are only
 * as trustworthy as the refusals below: a double that let a stale `version`
 * through, or that answered "inherited" for a definition on a sibling branch,
 * would make the console's specs pass while the screen showed the wrong thing.
 *
 * Every call goes through `createApiClient`, the client the app itself uses, so
 * a response that drifted from the shared schema fails here as
 * `malformed_response` rather than reaching a screen that renders it (C1·C2).
 */

import type { ApiFieldError, AttributeType, CategoryTreeNode } from '@shopping/shared'
import {
  attributeTypes,
  createApiClient,
  isApiClientError,
  isApiFieldError,
} from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import { attributeDefinitions } from './fixtures/attributes'
import { categoryTree } from './fixtures/categories'
import { setupTestServer } from './node'

setupTestServer()

const client = createApiClient({ appId: 'admin', baseUrl: 'http://api.test.invalid' })

function flatten(nodes: readonly CategoryTreeNode[]): CategoryTreeNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)])
}

const CATEGORIES = flatten(categoryTree.nodes)

function id(slug: string): number {
  const node = CATEGORIES.find((candidate) => candidate.slug === slug)

  if (node === undefined) throw new Error(`no category ${slug}`)

  return node.id
}

const WOMEN = id('women')
const OUTER = id('women-outer')
const COAT = id('women-outer-coat')
const JACKET = id('women-outer-jacket')
const SHOES = id('shoes')

/** The envelope of a refused call, or `null` when it succeeded. */
async function refusalOf(
  call: Promise<unknown>,
): Promise<{ status: number; code: string; details: readonly unknown[] } | null> {
  return call.then(
    () => null,
    (error: unknown) => {
      if (!isApiClientError(error) || error.body === undefined) return null

      return {
        status: error.status ?? -1,
        code: error.body.error.code,
        details: error.body.error.details,
      }
    },
  )
}

function fieldErrors(details: readonly unknown[]): readonly ApiFieldError[] {
  return details.filter((entry): entry is ApiFieldError => isApiFieldError(entry))
}

const defineCoatText = { categoryId: COAT, key: 'lining', label: '안감', type: 'TEXT' } as const

describe('the attribute fixture', () => {
  it('spreads one lineage over three levels, which is what F1 needs', () => {
    const owners = new Set(attributeDefinitions.attributes.map((row) => row.categoryId))

    expect(owners).toEqual(new Set([WOMEN, OUTER, COAT]))
  })

  it('uses every one of the five types at least once', () => {
    const used = new Set<AttributeType>(attributeDefinitions.attributes.map((row) => row.type))

    expect([...used].sort()).toEqual([...attributeTypes].sort())
  })

  it('gives options exactly to the types that take them', () => {
    for (const row of attributeDefinitions.attributes) {
      const takesOptions = row.type === 'SELECT' || row.type === 'MULTI_SELECT'

      expect(row.options.length > 0).toBe(takesOptions)
    }
  })
})

describe('reading the definitions of one category', () => {
  it('answers with the ancestors first and the category last', async () => {
    const { attributes } = await client.getAttributes({ categoryId: COAT })

    expect(attributes.map((row) => row.key)).toEqual([
      'brand',
      'fit',
      'neckline',
      'wool_ratio',
      'detachable_liner',
      'season',
    ])
    expect(attributes.map((row) => row.inherited)).toEqual([true, true, false, false, false, false])
  })

  it('names the category each inherited definition belongs to', async () => {
    const { attributes } = await client.getAttributes({ categoryId: COAT })
    const brand = attributes.find((row) => row.key === 'brand')

    expect(brand?.categoryId).toBe(WOMEN)
  })

  it('narrows to the category’s own rows when asked', async () => {
    const { attributes } = await client.getAttributes({
      categoryId: COAT,
      includeInherited: false,
    })

    expect(attributes.every((row) => !row.inherited)).toBe(true)
    expect(attributes.map((row) => row.key)).toEqual([
      'neckline',
      'wool_ratio',
      'detachable_liner',
      'season',
    ])
  })

  it('does not carry a definition sideways to a sibling', async () => {
    const { attributes } = await client.getAttributes({ categoryId: JACKET })

    expect(attributes.map((row) => row.key)).toEqual(['brand', 'fit'])
  })

  it('answers an empty list for a category nobody has defined anything on', async () => {
    await expect(client.getAttributes({ categoryId: SHOES })).resolves.toEqual({ attributes: [] })
  })

  it('tells an empty category from one that does not exist', async () => {
    const refusal = await refusalOf(client.getAttributes({ categoryId: 9_999 }))

    expect(refusal?.status).toBe(404)
  })
})

describe('a key already defined in the lineage', () => {
  it('is refused upwards, naming the category that holds it', async () => {
    const refusal = await refusalOf(
      client.createAttribute({ ...defineCoatText, key: 'brand', label: '브랜드' }),
    )

    expect(refusal?.status).toBe(409)
    expect(refusal?.code).toBe('ATTRIBUTE_KEY_TAKEN')
    expect(fieldErrors(refusal?.details ?? [])).toEqual([
      expect.objectContaining({ field: 'key', params: { name: '여성' } }),
    ])
  })

  it('is refused downwards too', async () => {
    const refusal = await refusalOf(
      client.createAttribute({
        categoryId: WOMEN,
        key: 'neckline',
        label: '넥라인',
        type: 'TEXT',
      }),
    )

    expect(refusal?.code).toBe('ATTRIBUTE_KEY_TAKEN')
    expect(fieldErrors(refusal?.details ?? [])[0]?.params).toEqual({ name: '코트' })
  })

  it('is allowed on a branch that shares no lineage', async () => {
    const { attribute } = await client.createAttribute({
      categoryId: SHOES,
      key: 'fit',
      label: '핏',
      type: 'TEXT',
    })

    expect(attribute.key).toBe('fit')
  })

  it('is free again once the definition holding it is retired', async () => {
    const { attributes } = await client.getAttributes({ categoryId: COAT })
    const neckline = attributes.find((row) => row.key === 'neckline')

    await client.deleteAttribute(neckline?.id ?? 0)

    await expect(
      client.createAttribute({ ...defineCoatText, key: 'neckline', label: '넥라인' }),
    ).resolves.toMatchObject({ attribute: { key: 'neckline' } })
  })
})

describe('editing a definition', () => {
  it('refuses a stale version rather than overwriting', async () => {
    const { attributes } = await client.getAttributes({ categoryId: COAT })
    const target = attributes.find((row) => row.key === 'wool_ratio')

    await client.updateAttribute(target?.id ?? 0, { version: 0, label: '울 함량' })
    const refusal = await refusalOf(
      client.updateAttribute(target?.id ?? 0, { version: 0, label: '다른 이름' }),
    )

    expect(refusal?.status).toBe(409)
    expect(refusal?.code).toBe('ATTRIBUTE_VERSION_CONFLICT')
    expect(fieldErrors(refusal?.details ?? [])[0]?.field).toBe('version')
  })

  it('refuses an option list that disagrees with the stored type', async () => {
    const { attributes } = await client.getAttributes({ categoryId: COAT })
    const text = attributes.find((row) => row.key === 'wool_ratio')

    const refusal = await refusalOf(
      client.updateAttribute(text?.id ?? 0, { version: 0, options: ['하나'] }),
    )

    expect(refusal?.status).toBe(400)
    expect(fieldErrors(refusal?.details ?? [])).toEqual([
      expect.objectContaining({ field: 'options', code: 'INVALID' }),
    ])
  })

  it('refuses emptying the options of a SELECT', async () => {
    const { attributes } = await client.getAttributes({ categoryId: COAT })
    const select = attributes.find((row) => row.key === 'neckline')

    const refusal = await refusalOf(
      client.updateAttribute(select?.id ?? 0, { version: 0, options: [] }),
    )

    expect(fieldErrors(refusal?.details ?? [])[0]?.field).toBe('options')
  })

  it('refuses a duplicated choice', async () => {
    const { attributes } = await client.getAttributes({ categoryId: COAT })
    const select = attributes.find((row) => row.key === 'neckline')

    const refusal = await refusalOf(
      client.updateAttribute(select?.id ?? 0, { version: 0, options: ['숄', '숄'] }),
    )

    expect(refusal?.status).toBe(400)
  })

  it('bumps the version so the next save has to carry the new one', async () => {
    const { attributes } = await client.getAttributes({ categoryId: COAT })
    const target = attributes.find((row) => row.key === 'season')

    const { attribute } = await client.updateAttribute(target?.id ?? 0, {
      version: 0,
      sortOrder: 0,
    })

    expect(attribute.version).toBe(1)
    expect(attribute.sortOrder).toBe(0)
  })
})

describe('defining an attribute on a category that is gone', () => {
  it('is a 400 whose detail names no field, so both detail shapes stay exercised', async () => {
    const refusal = await refusalOf(
      client.createAttribute({ ...defineCoatText, categoryId: 9_999 }),
    )

    expect(refusal?.status).toBe(400)
    expect(refusal?.code).toBe('BAD_REQUEST')
    expect(refusal?.details.every((entry) => typeof entry === 'string')).toBe(true)
  })
})

describe('a new definition', () => {
  it('lands after the category’s last one', async () => {
    const { attribute } = await client.createAttribute(defineCoatText)

    expect(attribute.sortOrder).toBe(4)
    expect(attribute.version).toBe(0)
  })

  it('is visible to the very next read', async () => {
    await client.createAttribute(defineCoatText)
    const { attributes } = await client.getAttributes({ categoryId: COAT })

    expect(attributes.map((row) => row.key)).toContain('lining')
  })
})
