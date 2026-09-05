import type { CategoryTreeNode } from '@shopping/shared'
import { categoryTreeResponseSchema } from '@shopping/shared'

import { defineFixture } from '../define'

/**
 * A category tree the size of the real one, as `GET /api/v1/categories` answers
 * it (TASK-0028).
 *
 * **40 nodes over three levels**, which is the number TASK-0029 F1 asks the
 * screen to render. A five node tree would hide everything that makes this
 * screen hard: an operator scrolling to a leaf, a subtree deep enough that
 * moving it would break the depth cap, and siblings numerous enough that
 * "위로" has somewhere to go.
 *
 * The shape is fashion-first (DECISIONS 1장) and the brand names are absent on
 * purpose — categories are structure, not merchandise.
 */

interface Seed {
  readonly slug: string
  readonly name: string
  readonly children: readonly Seed[]
}

function seed(slug: string, name: string, ...children: Seed[]): Seed {
  return { slug, name, children }
}

/**
 * Retired branches, by slug.
 *
 * One inactive leaf rather than none: the console asks for the tree with
 * `includeInactive=true` and has to draw the difference, and a fixture where
 * every node is active would let that rendering be wrong forever.
 */
const INACTIVE_SLUGS = new Set(['men-pants-chino'])

const SEEDS: readonly Seed[] = [
  seed(
    'women',
    '여성',
    seed(
      'women-outer',
      '아우터',
      seed('women-outer-coat', '코트'),
      seed('women-outer-jacket', '재킷'),
      seed('women-outer-padding', '패딩'),
    ),
    seed(
      'women-top',
      '상의',
      seed('women-top-tee', '티셔츠'),
      seed('women-top-shirt', '셔츠'),
      seed('women-top-knit', '니트'),
    ),
    seed('women-dress', '원피스', seed('women-dress-mini', '미니'), seed('women-dress-long', '롱')),
    seed(
      'women-pants',
      '팬츠',
      seed('women-pants-denim', '데님'),
      seed('women-pants-slacks', '슬랙스'),
    ),
  ),
  seed(
    'men',
    '남성',
    seed('men-outer', '아우터', seed('men-outer-coat', '코트'), seed('men-outer-jacket', '재킷')),
    seed(
      'men-top',
      '상의',
      seed('men-top-tee', '티셔츠'),
      seed('men-top-shirt', '셔츠'),
      seed('men-top-knit', '니트'),
    ),
    seed('men-pants', '팬츠', seed('men-pants-denim', '데님'), seed('men-pants-chino', '치노')),
  ),
  seed(
    'bags',
    '가방',
    seed('bags-shoulder', '숄더백'),
    seed('bags-backpack', '백팩'),
    seed('bags-cross', '크로스백'),
  ),
  seed(
    'shoes',
    '신발',
    seed('shoes-sneakers', '스니커즈'),
    seed('shoes-boots', '부츠'),
    seed('shoes-sandals', '샌들'),
    seed('shoes-loafers', '로퍼'),
  ),
  seed(
    'accessories',
    '액세서리',
    seed('accessories-hat', '모자'),
    seed('accessories-belt', '벨트'),
    seed('accessories-jewelry', '주얼리'),
    seed('accessories-watch', '시계'),
  ),
]

/**
 * Turns the outline above into the nodes the API would return.
 *
 * Ids are handed out depth-first, which is the order a seed script creating the
 * tree top-down would produce, and `path` is built from them exactly as the
 * database's own expression does (`/1/2/3/`). Writing forty nodes out by hand
 * would put four derived fields on every one of them, and the first typo would
 * be a `path` that disagrees with its `parentId` — a state the real database
 * refuses to hold.
 */
function build(
  seeds: readonly Seed[],
  parent: CategoryTreeNode | null,
  ids: { next: number },
): CategoryTreeNode[] {
  return seeds.map((entry, index) => {
    const id = ids.next
    ids.next += 1

    const node = {
      id,
      parentId: parent?.id ?? null,
      name: entry.name,
      slug: entry.slug,
      depth: (parent?.depth ?? 0) + 1,
      path: `${parent?.path ?? '/'}${String(id)}/`,
      sortOrder: index,
      isActive: !INACTIVE_SLUGS.has(entry.slug),
      // Zero everywhere until TASK-0032 brings products. The console's
      // pre-warning is behind `> 0`, so this fixture exercises the path a
      // freshly seeded catalogue takes.
      productCount: 0,
      version: 0,
      children: [] as readonly CategoryTreeNode[],
    }

    return { ...node, children: build(entry.children, node, ids) }
  })
}

/** The whole tree, inactive nodes included — what the console asks for. */
export const categoryTree = defineFixture(categoryTreeResponseSchema, {
  nodes: build(SEEDS, null, { next: 1 }),
})

/** Nothing has been created yet. The empty state (U1) has to come from somewhere. */
export const categoryTreeEmpty = defineFixture(categoryTreeResponseSchema, { nodes: [] })

/**
 * The same tree as a shopper sees it — active nodes only.
 *
 * Pruned rather than filtered: an inactive node takes its whole subtree with it,
 * which is what the API does (`buildCategoryForest` drops a node whose parent
 * was filtered out, and its children then find no parent either). A mock that
 * merely hid the inactive node would leave its children hanging off the root and
 * offer the storefront a branch the API never serves.
 */
function pruneInactive(nodes: readonly CategoryTreeNode[]): CategoryTreeNode[] {
  return nodes
    .filter((node) => node.isActive)
    .map((node) => ({ ...node, children: pruneInactive(node.children) }))
}

export const storefrontCategoryTree = defineFixture(categoryTreeResponseSchema, {
  nodes: pruneInactive(categoryTree.nodes),
})
