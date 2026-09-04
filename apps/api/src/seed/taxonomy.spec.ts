/**
 * The taxonomy is static data, so the checks are **invariants the API enforces
 * anyway** — asserted here because failing them at `pnpm db:seed` means a
 * half-built catalogue and a hunt through 40 categories for the one that is
 * wrong. Every rule below is a rule `CategoryService` or `AttributeService`
 * would refuse at runtime.
 */

import {
  ATTRIBUTE_KEY_PATTERN,
  attributeTypeHasOptions,
  categoryNameSchema,
  categorySlugSchema,
  CATEGORY_MAX_DEPTH,
  createAttributeRequestSchema,
} from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import { effectiveAttributes, flatten, leafCategories, seedTaxonomy } from './taxonomy.js'

const nodes = flatten()

describe('the shape TASK-0037 4장 asked for', () => {
  it('has 40 categories', () => {
    expect(nodes).toHaveLength(40)
  })

  it('uses all three levels and no more', () => {
    const depths = new Set(nodes.map((node) => node.depth))

    expect([...depths].sort()).toEqual([1, 2, 3])
    expect(Math.max(...depths)).toBeLessThanOrEqual(CATEGORY_MAX_DEPTH)
  })

  it('files products only under leaves', () => {
    // 26 leaves under 12 sections under 2 roots.
    expect(leafCategories()).toHaveLength(26)
    expect(seedTaxonomy).toHaveLength(2)
  })
})

describe('what the API would refuse', () => {
  it('gives every category a slug and a name it accepts', () => {
    for (const node of nodes) {
      expect(categorySlugSchema.safeParse(node.slug).success).toBe(true)
      expect(categoryNameSchema.safeParse(node.name).success).toBe(true)
    }
  })

  it('gives every category a unique slug', () => {
    const slugs = nodes.map((node) => node.slug)

    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it('names a parent that exists, before the child', () => {
    const seen = new Set<string>()

    for (const node of nodes) {
      if (node.parentSlug !== null) expect(seen).toContain(node.parentSlug)
      seen.add(node.slug)
    }
  })

  it('describes every attribute the way `POST /attributes` wants it', () => {
    for (const node of nodes) {
      for (const attribute of node.attributes ?? []) {
        const parsed = createAttributeRequestSchema.safeParse({ ...attribute, categoryId: 1 })

        expect(parsed.success, `${node.slug}/${attribute.key}`).toBe(true)
        expect(ATTRIBUTE_KEY_PATTERN.test(attribute.key)).toBe(true)
        expect(attributeTypeHasOptions(attribute.type)).toBe((attribute.options ?? []).length > 0)
      }
    }
  })
})

describe('inheritance — the reason the tree is three deep', () => {
  const effective = (slug: string): readonly string[] =>
    effectiveAttributes(slug).map((attribute) => attribute.key)

  /** The same walk without the de-duplication, so a repeat still shows up. */
  function rawKeys(slug: string): readonly string[] {
    const bySlug = new Map(nodes.map((node) => [node.slug, node]))
    const keys: string[] = []

    let cursor = bySlug.get(slug)

    while (cursor !== undefined) {
      keys.push(...(cursor.attributes ?? []).map((attribute) => attribute.key))
      cursor = cursor.parentSlug === null ? undefined : bySlug.get(cursor.parentSlug)
    }

    return keys
  }

  it('never repeats a key inside one lineage', () => {
    // `AttributeService` refuses this outright, so a duplicate here is a seed
    // that dies partway through with `ATTRIBUTE_KEY_TAKEN`.
    for (const node of nodes) {
      const keys = rawKeys(node.slug)

      expect(new Set(keys).size, node.slug).toBe(keys.length)
    }
  })

  it('reuses keys across the two roots, which is legal and intended', () => {
    // `fit` under 여성 > 상의 and under 남성 > 상의 are different definitions in
    // different lineages. If this ever stops being true the two halves of the
    // catalogue have been merged into one.
    expect(effective('women-tops')).toContain('fit')
    expect(effective('men-tops')).toContain('fit')
  })

  it('gives every leaf the 3~6 attributes 4장 asked for', () => {
    for (const leaf of leafCategories()) {
      const keys = effective(leaf.slug)

      expect(keys.length, leaf.slug).toBeGreaterThanOrEqual(3)
      expect(keys.length, leaf.slug).toBeLessThanOrEqual(6)
    }
  })
})
