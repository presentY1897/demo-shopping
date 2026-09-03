import type { ApiClient, CreateAttributeRequest } from '@shopping/shared'
import { NotFoundException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'

import { AttributeService } from '../../src/catalog/attribute.service.js'
import { useApiApp } from '../support/api-app.js'
import { useDatabase } from '../support/database.js'
import { callers } from '../support/principal.js'

/**
 * The validator against **real definitions in a real database**.
 *
 * `attribute-schema.spec.ts` already covers every branch of the generator over
 * plain values. What it cannot show is the loop this task is actually about:
 * rows an operator created a moment ago become the schema that judges the next
 * save. That loop crosses the API, the tree, PostgreSQL's enum and array types
 * and the inheritance resolver, and each of those is a place where a definition
 * could arrive at the generator in a shape it does not expect.
 *
 * There is no endpoint here on purpose (TASK-0030 4.5): validation is a service
 * method that the product save path will call (TASK-0032). So the spec resolves
 * the very provider the application bound and asks it directly — no mock, no
 * second implementation.
 */

const db = useDatabase()
const api = useApiApp({ database: db, authenticate: true })

function client(): ApiClient {
  return api.clientAs(callers.superAdmin)
}

function attributes(): AttributeService {
  return api.resolve<AttributeService>(AttributeService)
}

/** 의류 > 상의 > 티셔츠. */
async function branch(): Promise<{ root: number; child: number; leaf: number }> {
  const caller = client()
  const { category: root } = await caller.createCategory({
    parentId: null,
    name: '의류',
    slug: 'clothing',
  })
  const { category: child } = await caller.createCategory({
    parentId: root.id,
    name: '상의',
    slug: 'tops',
  })
  const { category: leaf } = await caller.createCategory({
    parentId: child.id,
    name: '티셔츠',
    slug: 'tees',
  })

  return { root: root.id, child: child.id, leaf: leaf.id }
}

async function define(request: CreateAttributeRequest): Promise<void> {
  await client().createAttribute(request)
}

/** The messages of a refused validation, or a failure of the test. */
async function refused(categoryId: number, values: unknown): Promise<readonly string[]> {
  const verdict = await attributes().validateAttributes(categoryId, values)

  if (verdict.ok) throw new Error(`거부를 기대했지만 통과했습니다: ${JSON.stringify(values)}`)

  return verdict.issues.map((issue) => `${issue.key}: ${issue.message}`)
}

/** The stored values of an accepted validation, or a failure of the test. */
async function passed(categoryId: number, values: unknown): Promise<Record<string, unknown>> {
  const verdict = await attributes().validateAttributes(categoryId, values)

  if (!verdict.ok) throw new Error(`통과를 기대했지만 거부되었습니다: ${JSON.stringify(verdict)}`)

  return verdict.values
}

describe('a lineage of definitions decides what a product may carry', () => {
  it("judges a leaf against its own and its ancestors' definitions (F1)", async () => {
    const { root, child, leaf } = await branch()

    await define({
      categoryId: root,
      key: 'brand',
      label: '브랜드',
      type: 'TEXT',
      isRequired: true,
    })
    await define({
      categoryId: child,
      key: 'fit',
      label: '핏',
      type: 'SELECT',
      options: ['오버', '레귤러'],
    })
    await define({
      categoryId: leaf,
      key: 'sleeve_length',
      label: '소매 길이',
      type: 'NUMBER',
    })

    expect(await passed(leaf, { brand: '가상브랜드', fit: '오버', sleeve_length: 62 })).toEqual({
      brand: '가상브랜드',
      fit: '오버',
      sleeve_length: 62,
    })

    // The ancestors' rules really do apply this far down.
    expect(await refused(leaf, { fit: '오버' })).toEqual([
      "brand: 필수 속성 '브랜드'(brand) 값이 없습니다.",
    ])
    expect(await refused(leaf, { brand: '가상브랜드', fit: '슬림' })).toEqual([
      "fit: '핏'(fit) 값은 정의된 선택지 중 하나여야 합니다: 오버, 레귤러",
    ])
  })

  it("does not apply a descendant's definition to its ancestor", async () => {
    const { root, leaf } = await branch()

    await define({
      categoryId: leaf,
      key: 'sleeve_length',
      label: '소매 길이',
      type: 'NUMBER',
      isRequired: true,
    })

    // Required on 티셔츠, meaningless on 의류.
    expect(await passed(root, {})).toEqual({})
    expect((await refused(leaf, {})).length).toBe(1)
  })

  it('answers 404 for a category that does not exist', async () => {
    // The status, not the sentence: what a caller acts on is that this is a
    // dead reference rather than an empty rule set (TASK-0117 R1).
    const error: unknown = await attributes()
      .validateAttributes(9_999, {})
      .then(
        () => null,
        (reason: unknown) => reason,
      )

    expect(error).toBeInstanceOf(NotFoundException)
    expect((error as NotFoundException).getStatus()).toBe(404)
  })
})

describe('each type refuses what it should, with definitions read from the database', () => {
  it('refuses a string where the definition says NUMBER (F2)', async () => {
    const { leaf } = await branch()

    await define({ categoryId: leaf, key: 'weight', label: '중량', type: 'NUMBER' })

    expect(await refused(leaf, { weight: '1200' })).toEqual([
      "weight: '중량'(weight) 값은 숫자여야 합니다.",
    ])
    expect(await passed(leaf, { weight: 1200 })).toEqual({ weight: 1200 })
  })

  it("refuses a value outside a SELECT's options (F3)", async () => {
    const { leaf } = await branch()

    await define({
      categoryId: leaf,
      key: 'color',
      label: '색상',
      type: 'SELECT',
      options: ['블랙', '화이트'],
    })

    expect(await refused(leaf, { color: '네이비' })).toEqual([
      "color: '색상'(color) 값은 정의된 선택지 중 하나여야 합니다: 블랙, 화이트",
    ])
    expect(await passed(leaf, { color: '화이트' })).toEqual({ color: '화이트' })
  })

  it('refuses an undefined choice inside a MULTI_SELECT', async () => {
    const { leaf } = await branch()

    await define({
      categoryId: leaf,
      key: 'seasons',
      label: '계절',
      type: 'MULTI_SELECT',
      options: ['봄', '여름', '겨울'],
    })

    expect((await refused(leaf, { seasons: ['봄', '장마'] })).length).toBe(1)
    expect(await passed(leaf, { seasons: ['봄', '겨울'] })).toEqual({ seasons: ['봄', '겨울'] })
  })

  it('refuses a string where the definition says BOOLEAN', async () => {
    const { leaf } = await branch()

    await define({ categoryId: leaf, key: 'waterproof', label: '방수', type: 'BOOLEAN' })

    expect((await refused(leaf, { waterproof: 'true' })).length).toBe(1)
    expect(await passed(leaf, { waterproof: false })).toEqual({ waterproof: false })
  })

  it('refuses a missing required attribute (F4)', async () => {
    const { leaf } = await branch()

    await define({
      categoryId: leaf,
      key: 'material',
      label: '소재',
      type: 'TEXT',
      isRequired: true,
    })

    expect(await refused(leaf, {})).toEqual(["material: 필수 속성 '소재'(material) 값이 없습니다."])
  })

  it('refuses a key no definition names (F5)', async () => {
    const { leaf } = await branch()

    await define({ categoryId: leaf, key: 'color', label: '색상', type: 'TEXT' })

    // The typo case, and the reason unknown keys are an error rather than
    // something to drop: `colour` would otherwise save as a product that simply
    // has no colour, and nothing would notice until the facet came up empty.
    expect(await refused(leaf, { colour: '블랙' })).toEqual([
      'colour: 정의되지 않은 속성입니다: colour',
    ])
  })
})

describe('a definition takes effect immediately (F6)', () => {
  it('starts being enforced on the very next validation', async () => {
    const { leaf } = await branch()

    expect(await passed(leaf, {})).toEqual({})

    await define({
      categoryId: leaf,
      key: 'material',
      label: '소재',
      type: 'TEXT',
      isRequired: true,
    })

    // No deploy, no cache to invalidate, no restart. This is D-005 —
    // "코드 수정 없이 카테고리와 속성을 추가할 수 있어야 한다" — as an
    // observable fact.
    expect(await refused(leaf, {})).toEqual(["material: 필수 속성 '소재'(material) 값이 없습니다."])
  })

  it('stops being enforced as soon as the definition is retired', async () => {
    const { leaf } = await branch()
    const { attribute } = await client().createAttribute({
      categoryId: leaf,
      key: 'material',
      label: '소재',
      type: 'TEXT',
      isRequired: true,
    })

    expect((await refused(leaf, {})).length).toBe(1)

    await client().deleteAttribute(attribute.id)

    expect(await passed(leaf, {})).toEqual({})
  })

  it('follows an edit that widens a SELECT', async () => {
    const { leaf } = await branch()
    const { attribute } = await client().createAttribute({
      categoryId: leaf,
      key: 'color',
      label: '색상',
      type: 'SELECT',
      options: ['블랙'],
    })

    expect((await refused(leaf, { color: '화이트' })).length).toBe(1)

    await client().updateAttribute(attribute.id, {
      version: attribute.version,
      options: ['블랙', '화이트'],
    })

    expect(await passed(leaf, { color: '화이트' })).toEqual({ color: '화이트' })
  })

  it('follows a category move, because the lineage is read afresh', async () => {
    const { root, leaf } = await branch()
    const { category: elsewhere } = await client().createCategory({
      parentId: null,
      name: '기타',
      slug: 'misc',
    })

    await define({
      categoryId: root,
      key: 'brand',
      label: '브랜드',
      type: 'TEXT',
      isRequired: true,
    })

    expect((await refused(leaf, {})).length).toBe(1)

    // Moving 티셔츠 out from under 의류 takes 브랜드 with it — the definition
    // belongs to the lineage, not to the row.
    await client().moveCategory(leaf, { parentId: elsewhere.id })

    expect(await passed(leaf, {})).toEqual({})
  })
})

describe('normalisation before storage', () => {
  it('trims text and drops the values that carry nothing', async () => {
    const { leaf } = await branch()

    await define({ categoryId: leaf, key: 'material', label: '소재', type: 'TEXT' })
    await define({
      categoryId: leaf,
      key: 'seasons',
      label: '계절',
      type: 'MULTI_SELECT',
      options: ['봄'],
    })

    // What comes back is what should reach JSONB: no padding, and no key whose
    // value is an empty string or an empty array pretending to be a choice.
    expect(await passed(leaf, { material: '  울  ', seasons: [] })).toEqual({ material: '울' })
  })
})
