import type { AttributeType } from '@shopping/shared'

/**
 * The catalogue's shape: 40 categories over three levels, and what each one
 * asks a product to say about itself (TASK-0037 4장).
 *
 * **Static data, not generated.** Everything else in this seed is drawn from a
 * PRNG, and this deliberately is not. A generated taxonomy would give category
 * names that do not match the products filed under them, facets whose values
 * mean nothing, and a tree that reshuffles the day somebody adds a seller.
 * These 40 names are the one part a reader will actually read.
 *
 * **The depth is the point.** `CATEGORY_MAX_DEPTH` is 3 and the tree uses all
 * of it, because a two-level catalogue never exercises the rule that makes the
 * third level interesting: **attributes are inherited from every ancestor, and
 * the nearest definition wins** (`attribute-inheritance.ts`). A leaf here has
 * two attributes from its root, two from its section and sometimes one of its
 * own — which is the 3~6 the task asked for, without any category repeating
 * what its parent already said.
 *
 * **Keys repeat across the two roots on purpose.** `AttributeService` refuses a
 * key that already exists **in the same lineage**, so `fit` under 여성 > 상의 and
 * `fit` under 남성 > 상의 are two different definitions and both are legal. That
 * is what makes the two halves of the catalogue independently editable, which
 * is how a real store is organised.
 */

/** One attribute definition, as `POST /attributes` will receive it. */
export interface SeedAttribute {
  /** `ATTRIBUTE_KEY_PATTERN` — lowercase, unique within its lineage. */
  readonly key: string
  readonly label: string
  readonly type: AttributeType
  /** Required by `SELECT` · `MULTI_SELECT`, forbidden by the rest. */
  readonly options?: readonly string[]
  readonly isRequired?: boolean
  /** Whether the storefront may offer it as a facet (M06). */
  readonly isFilterable?: boolean
}

/** One node of the tree. */
export interface SeedCategory {
  /** `categorySlugSchema` — lowercase, digits, hyphens. Unique across the tree. */
  readonly slug: string
  readonly name: string
  readonly attributes?: readonly SeedAttribute[]
  readonly children?: readonly SeedCategory[]
}

/**
 * Colours, shared by both roots.
 *
 * `MULTI_SELECT` rather than `SELECT`: a listing is one product in several
 * colours, and the option axis carries which ones. Making the attribute single
 * valued would force a separate listing per colour, which is the thing
 * variants exist to avoid.
 */
const COLOURS = [
  '블랙',
  '화이트',
  '아이보리',
  '그레이',
  '네이비',
  '베이지',
  '브라운',
  '카키',
  '버건디',
  '라이트블루',
] as const

const ROOT_ATTRIBUTES: readonly SeedAttribute[] = [
  {
    key: 'color',
    label: '색상',
    type: 'MULTI_SELECT',
    options: COLOURS,
    isRequired: true,
    isFilterable: true,
  },
  {
    key: 'material',
    label: '주 소재',
    type: 'SELECT',
    options: ['면', '린넨', '울', '캐시미어', '폴리에스터', '나일론', '레이온', '가죽', '데님'],
    isRequired: true,
    isFilterable: true,
  },
]

const TOP_ATTRIBUTES: readonly SeedAttribute[] = [
  {
    key: 'fit',
    label: '핏',
    type: 'SELECT',
    options: ['슬림', '레귤러', '루즈', '오버사이즈'],
    isRequired: true,
    isFilterable: true,
  },
  {
    key: 'sleeve',
    label: '소매 기장',
    type: 'SELECT',
    options: ['민소매', '반소매', '7부', '긴소매'],
    isFilterable: true,
  },
]

const BOTTOM_ATTRIBUTES: readonly SeedAttribute[] = [
  {
    key: 'fit',
    label: '핏',
    type: 'SELECT',
    options: ['스키니', '슬림', '스트레이트', '와이드', '테이퍼드'],
    isRequired: true,
    isFilterable: true,
  },
  {
    key: 'rise',
    label: '밑위',
    type: 'SELECT',
    options: ['로우', '미드', '하이'],
    isFilterable: true,
  },
]

const OUTER_ATTRIBUTES: readonly SeedAttribute[] = [
  {
    key: 'fit',
    label: '핏',
    type: 'SELECT',
    options: ['슬림', '레귤러', '오버사이즈'],
    isRequired: true,
    isFilterable: true,
  },
  {
    key: 'season',
    label: '착용 계절',
    type: 'MULTI_SELECT',
    options: ['봄', '여름', '가을', '겨울'],
    isFilterable: true,
  },
]

const SHOE_ATTRIBUTES: readonly SeedAttribute[] = [
  {
    key: 'heel_mm',
    label: '굽 높이 (mm)',
    type: 'NUMBER',
    isFilterable: true,
  },
  {
    key: 'width',
    label: '발볼',
    type: 'SELECT',
    options: ['좁음', '보통', '넓음'],
    isFilterable: true,
  },
]

const BAG_ATTRIBUTES: readonly SeedAttribute[] = [
  {
    key: 'capacity',
    label: '수납 크기',
    type: 'SELECT',
    options: ['미니', '스몰', '미디엄', '라지'],
    isRequired: true,
    isFilterable: true,
  },
  {
    key: 'laptop_ok',
    label: '노트북 수납',
    type: 'BOOLEAN',
    isFilterable: true,
  },
]

const ACCESSORY_ATTRIBUTES: readonly SeedAttribute[] = [
  {
    key: 'size_free',
    label: '사이즈',
    type: 'SELECT',
    options: ['프리', 'S', 'M', 'L'],
    isRequired: true,
    isFilterable: true,
  },
]

/** The section attributes that both roots reuse, keyed by section slug suffix. */
const SECTION_ATTRIBUTES: Readonly<Record<string, readonly SeedAttribute[]>> = {
  tops: TOP_ATTRIBUTES,
  bottoms: BOTTOM_ATTRIBUTES,
  outer: OUTER_ATTRIBUTES,
  shoes: SHOE_ATTRIBUTES,
  bags: BAG_ATTRIBUTES,
  accessories: ACCESSORY_ATTRIBUTES,
}

/** `[섹션 이름, 섹션 slug 접미사, [잎 이름, 잎 slug 접미사][]]`. */
type SectionSpec = readonly [string, string, readonly (readonly [string, string])[]]

const WOMEN_SECTIONS: readonly SectionSpec[] = [
  [
    '상의',
    'tops',
    [
      ['티셔츠', 'tshirts'],
      ['블라우스', 'blouses'],
      ['니트', 'knits'],
    ],
  ],
  [
    '하의',
    'bottoms',
    [
      ['청바지', 'jeans'],
      ['스커트', 'skirts'],
      ['슬랙스', 'slacks'],
    ],
  ],
  [
    '아우터',
    'outer',
    [
      ['코트', 'coats'],
      ['재킷', 'jackets'],
    ],
  ],
  [
    '신발',
    'shoes',
    [
      ['스니커즈', 'sneakers'],
      ['부츠', 'boots'],
    ],
  ],
  [
    '가방',
    'bags',
    [
      ['숄더백', 'shoulder'],
      ['백팩', 'backpacks'],
    ],
  ],
  ['액세서리', 'accessories', [['모자', 'hats']]],
]

const MEN_SECTIONS: readonly SectionSpec[] = [
  [
    '상의',
    'tops',
    [
      ['티셔츠', 'tshirts'],
      ['셔츠', 'shirts'],
      ['니트', 'knits'],
    ],
  ],
  [
    '하의',
    'bottoms',
    [
      ['청바지', 'jeans'],
      ['슬랙스', 'slacks'],
      ['반바지', 'shorts'],
    ],
  ],
  [
    '아우터',
    'outer',
    [
      ['코트', 'coats'],
      ['재킷', 'jackets'],
    ],
  ],
  [
    '신발',
    'shoes',
    [
      ['스니커즈', 'sneakers'],
      ['구두', 'dress-shoes'],
    ],
  ],
  [
    '가방',
    'bags',
    [
      ['백팩', 'backpacks'],
      ['크로스백', 'cross'],
    ],
  ],
  ['액세서리', 'accessories', [['모자', 'hats']]],
]

function sections(rootSlug: string, specs: readonly SectionSpec[]): readonly SeedCategory[] {
  return specs.map(([name, suffix, leaves]) => ({
    slug: `${rootSlug}-${suffix}`,
    name,
    attributes: SECTION_ATTRIBUTES[suffix] ?? [],
    children: leaves.map(([leafName, leafSuffix]) => ({
      slug: `${rootSlug}-${suffix}-${leafSuffix}`,
      name: leafName,
    })),
  }))
}

/**
 * The whole tree: 2 roots, 12 sections, 26 leaves.
 *
 * The two roots are built from the same function because a woman's 상의 and a
 * man's 상의 ask the same questions. Writing them out twice would let one drift
 * and would make "why does the men's filter have one fewer facet?" a thing
 * somebody has to find out by reading data.
 */
export const seedTaxonomy: readonly SeedCategory[] = [
  {
    slug: 'women',
    name: '여성',
    attributes: ROOT_ATTRIBUTES,
    children: sections('women', WOMEN_SECTIONS),
  },
  {
    slug: 'men',
    name: '남성',
    attributes: ROOT_ATTRIBUTES,
    children: sections('men', MEN_SECTIONS),
  },
]

/** One node with the two facts the tree shape carries but the node does not. */
export type FlatCategory = SeedCategory & {
  readonly parentSlug: string | null
  readonly depth: number
}

/**
 * Every node, roots first — the order the seed has to create them in.
 *
 * Depth is carried down rather than derived from the slug. `men-shoes-dress-shoes`
 * has four hyphen-separated segments and is three levels deep, so counting them
 * would have filed one leaf at depth 4 — past `CATEGORY_MAX_DEPTH`, and only for
 * the one leaf whose name happens to contain a hyphen.
 */
export function flatten(
  nodes: readonly SeedCategory[] = seedTaxonomy,
  parentSlug: string | null = null,
  depth = 1,
): readonly FlatCategory[] {
  return nodes.flatMap((node) => [
    { ...node, parentSlug, depth },
    ...flatten(node.children ?? [], node.slug, depth + 1),
  ])
}

/** The leaves — the only categories a product is filed under. */
export function leafCategories(): readonly FlatCategory[] {
  return flatten().filter((node) => (node.children ?? []).length === 0)
}
