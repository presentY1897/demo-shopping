import type { AttributeType, CategoryTreeNode } from '@shopping/shared'
import { attributeListResponseSchema } from '@shopping/shared'

import { defineFixture } from '../define'
import { categoryTree } from './categories'

/**
 * Attribute definitions over the category fixture, as TASK-0030 stores them.
 *
 * **What this seed has to prove is inheritance**, so it is spread over three
 * levels of one lineage rather than piled onto a leaf:
 *
 * ```
 * 여성            브랜드                                 ← 아우터와 코트가 물려받는다
 *   아우터        핏                                     ← 코트가 물려받는다
 *     코트        넥라인 · 울 혼용률 · 탈부착 내피 · 시즌  ← 코트 자신의 것
 * ```
 *
 * A screen opened on 코트 therefore sees six attributes, two of which it may not
 * edit here — which is the whole of F1 — and all **five types** appear at least
 * once, which is what F2 needs to have anything to switch between.
 *
 * Categories with no definitions at all (가방, 신발) are left empty on purpose:
 * the empty state (U1) has to be reachable by choosing a category, not only by
 * emptying the store.
 *
 * `inherited` is `false` on every row because a stored definition is not
 * inherited by anybody — it belongs to its own category. The flag is derived per
 * request, against the category being asked about.
 */

interface Seed {
  readonly slug: string
  readonly key: string
  readonly label: string
  readonly type: AttributeType
  readonly options?: readonly string[]
  readonly isRequired?: boolean
  readonly isFilterable?: boolean
}

const SEEDS: readonly Seed[] = [
  {
    slug: 'women',
    key: 'brand',
    label: '브랜드',
    type: 'TEXT',
    isRequired: true,
    isFilterable: true,
  },
  {
    slug: 'women-outer',
    key: 'fit',
    label: '핏',
    type: 'SELECT',
    options: ['오버핏', '레귤러핏', '슬림핏'],
    isRequired: true,
    isFilterable: true,
  },
  {
    slug: 'women-outer-coat',
    key: 'neckline',
    label: '넥라인',
    type: 'SELECT',
    options: ['노치드', '숄', '스탠드'],
    isFilterable: true,
  },
  { slug: 'women-outer-coat', key: 'wool_ratio', label: '울 혼용률', type: 'NUMBER' },
  { slug: 'women-outer-coat', key: 'detachable_liner', label: '탈부착 내피', type: 'BOOLEAN' },
  {
    slug: 'women-outer-coat',
    key: 'season',
    label: '착용 계절',
    type: 'MULTI_SELECT',
    options: ['간절기', '겨울'],
    isFilterable: true,
  },
]

/**
 * Category id by slug, read off the category fixture.
 *
 * Written down rather than derived, the two fixtures would disagree the first
 * time a category is inserted into the seed list — and the symptom would be
 * definitions silently attached to the wrong branch, which still renders.
 */
function idsBySlug(nodes: readonly CategoryTreeNode[]): ReadonlyMap<string, number> {
  return new Map(
    nodes.flatMap((node) => [[node.slug, node.id] as const, ...idsBySlug(node.children).entries()]),
  )
}

const CATEGORY_IDS = idsBySlug(categoryTree.nodes)

function categoryId(slug: string): number {
  const id = CATEGORY_IDS.get(slug)

  if (id === undefined) throw new Error(`no category fixture with slug ${slug}`)

  return id
}

/** Definitions as their owning categories hold them. */
export const attributeDefinitions = defineFixture(attributeListResponseSchema, {
  attributes: SEEDS.map((seed, index) => ({
    id: index + 1,
    categoryId: categoryId(seed.slug),
    key: seed.key,
    label: seed.label,
    type: seed.type,
    options: [...(seed.options ?? [])],
    isRequired: seed.isRequired ?? false,
    isFilterable: seed.isFilterable ?? false,
    // Per owning category, so the first definition of each category is 0 — what
    // the API's `nextSortOrder` would have produced inserting them in order.
    sortOrder: SEEDS.slice(0, index).filter((earlier) => earlier.slug === seed.slug).length,
    version: 0,
    inherited: false,
  })),
})

/** Nothing defined anywhere. The empty state has to come from somewhere. */
export const attributeDefinitionsEmpty = defineFixture(attributeListResponseSchema, {
  attributes: [],
})
