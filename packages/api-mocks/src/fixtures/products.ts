import type { Product, ProductOption, ProductVariant } from '@shopping/shared'
import { productDetailResponseSchema, productResponseSchema } from '@shopping/shared'

import { defineFixture } from '../define'
import { sessionSellerOwner } from './session'

/**
 * Two listings of the store `sessionSellerOwner` owns, as
 * `GET /api/v1/products/:id` answers them (TASK-0032 · TASK-0113).
 *
 * **They are the two shapes the editor has to be able to load**, not two
 * arbitrary products:
 *
 * | | {@link productWithOptions} | {@link productDraft} |
 * | --- | --- | --- |
 * | 상태 | `ACTIVE` — 판매 중 | `DRAFT` — 작성 중 |
 * | 옵션 | 색상 3 × 사이즈 4 | 없음 |
 * | Variant | 12 | **1** — 옵션 없는 상품도 하나를 갖는다 (DECISIONS 3) |
 * | 필수 속성 | 전부 채워져 있다 | `fit` 이 비어 있다 |
 *
 * The draft's missing required attribute is the fixture's real job: TASK-0113
 * made 임시저장 legal with an incomplete bag and 발행 illegal with one, and a
 * seed where both products were complete would leave the editor's 「판매 시작이
 * 왜 막혔는가」 branch reachable only by editing a fixture in a spec.
 *
 * Both sit in 코트 (category 3), whose lineage carries **six** effective
 * definitions over all five attribute types — see `fixtures/attributes.ts`. So
 * a form generated from this product exercises every control the generator has.
 *
 * Image URLs are stock photography, not our own keys. That is deliberate: the
 * product write path refuses a key belonging to another store and lets anything
 * that is not one of our keys through (TASK-0113 F14), and the seeded catalogue
 * is 780 such URLs (DECISIONS 13).
 */

/** The store these belong to, read off the session rather than retyped. */
const SELLER_ID = sessionSellerOwner.user.sellerId ?? ''

/** 코트. Its lineage is `/1/2/3/`, which is where the six definitions live. */
const COAT_CATEGORY_ID = 3

/**
 * Ids built from a prefix and a counter.
 *
 * Fixed rather than random for the reason every fixture in this package is
 * fixed: the value is parsed once at module load and frozen, and a spec that
 * asserted on an id would otherwise assert on whatever the last run produced.
 * The shape is a UUIDv7 — version nibble `7`, variant nibble `9` — because that
 * is what the database hands out and `productIdSchema` accepts.
 */
function uuid(group: number, index: number): string {
  const tail = `${String(group).padStart(2, '0')}${String(index).padStart(10, '0')}`

  return `019596d0-1f1c-7c2e-9a0e-${tail}`
}

const COLOURS = ['블랙', '아이보리', '카멜'] as const
const SIZES = ['S', 'M', 'L', 'XL'] as const

const options: ProductOption[] = [
  {
    id: uuid(20, 1),
    name: '색상',
    sortOrder: 0,
    values: COLOURS.map((value, index) => ({
      id: uuid(21, index + 1),
      value,
      meta: null,
      sortOrder: index,
    })),
  },
  {
    id: uuid(20, 2),
    name: '사이즈',
    sortOrder: 1,
    values: SIZES.map((value, index) => ({
      id: uuid(22, index + 1),
      value,
      meta: null,
      sortOrder: index,
    })),
  },
]

/**
 * The twelve combinations, first axis varying slowest.
 *
 * The same order `expandCombinations` produces, so the row a spec counts to is
 * the row the real API would have created (`variant-rules.ts`).
 */
const variants: ProductVariant[] = COLOURS.flatMap((_colour, colourIndex) =>
  SIZES.map((_size, sizeIndex) => {
    const index = colourIndex * SIZES.length + sizeIndex

    return {
      id: uuid(23, index + 1),
      sku: `LUMICOAT-${String(index + 1)}`,
      price: 189_000,
      listPrice: 249_000,
      // Deliberately uneven: a fixture where every row held the same number
      // would let a table that renders one row twelve times pass.
      stock: 4 + index,
      maxPurchaseQuantity: null,
      effectiveMaxPurchaseQuantity: 2,
      isActive: true,
      optionValueIds: [uuid(21, colourIndex + 1), uuid(22, sizeIndex + 1)],
    }
  }),
)

const base = {
  sellerId: SELLER_ID,
  categoryId: COAT_CATEGORY_ID,
  ratingAvg: 0,
  ratingCount: 0,
  salesCount: 0,
} satisfies Partial<Product>

/** 판매 중인 상품. 옵션 두 축, 조합 12개, 필수 속성이 전부 채워져 있다. */
export const productWithOptions = defineFixture(productResponseSchema, {
  product: {
    ...base,
    id: uuid(10, 1),
    name: '오버핏 울 발마칸 코트',
    description: '울 70% 혼방. 탈부착 내피가 있어 간절기부터 한겨울까지 입습니다.',
    status: 'ACTIVE',
    attributes: {
      brand: '루미에르',
      fit: '오버핏',
      neckline: '노치드',
      wool_ratio: 70,
      detachable_liner: true,
      season: ['간절기', '겨울'],
    },
    maxPurchaseQuantity: 2,
    minPrice: 189_000,
    version: 3,
    images: [
      {
        id: uuid(24, 1),
        url: 'https://images.unsplash.com/photo-lumiere-coat-front',
        alt: '코트 정면',
        sortOrder: 0,
      },
      {
        id: uuid(24, 2),
        url: 'https://images.unsplash.com/photo-lumiere-coat-detail',
        alt: null,
        sortOrder: 1,
      },
    ],
    options,
    variants,
  },
})

/**
 * 작성 중인 상품 — 옵션 없음, Variant 하나, 필수 속성 `fit` 이 비어 있다.
 *
 * `optionValueIds: []` is not an omission. A product with no options still has
 * exactly one variant, because that is the thing that carries a price and a SKU
 * (DECISIONS 3), and its combination is the empty one.
 */
export const productDraft = defineFixture(productResponseSchema, {
  product: {
    ...base,
    id: uuid(10, 2),
    name: '캐시미어 머플러',
    description: null,
    status: 'DRAFT',
    attributes: { brand: '루미에르' },
    maxPurchaseQuantity: null,
    // Derived from the live variants on every write, whatever the status —
    // `ProductService.settle` runs the same statement for a draft (TASK-0032 4.6).
    minPrice: 49_000,
    version: 0,
    images: [],
    options: [],
    variants: [
      {
        id: uuid(23, 101),
        sku: 'LUMISCARF-1',
        price: 49_000,
        listPrice: null,
        stock: 0,
        maxPurchaseQuantity: null,
        effectiveMaxPurchaseQuantity: null,
        isActive: true,
        optionValueIds: [],
      },
    ],
  },
})

/**
 * 상점이 보는 상품 상세 (TASK-0043).
 *
 * A third listing rather than a reuse of {@link productWithOptions}, because the
 * detail screen has to be checked against two states that a *complete* product
 * cannot show:
 *
 * | | |
 * | --- | --- |
 * | **품절 조합** (F2) | 블랙 · S 의 재고가 0이다. SKU 는 있고 살 수만 없다 |
 * | **없는 조합** (F3) | 카멜 · XL 과 카멜 · L 은 **variant 자체가 없다** |
 *
 * The two are different states and the screen has to say so differently — one is
 * a combination that exists and is out of stock, the other was never made. A
 * fixture where every combination existed would let a screen that conflated them
 * pass.
 *
 * Three images rather than two, so a gallery has a thumbnail strip worth
 * drawing, and a `listPrice` above `price` so the discount badge has a number.
 */
const STOREFRONT_COLOURS = ['블랙', '아이보리', '카멜'] as const
const STOREFRONT_SIZES = ['S', 'M', 'L', 'XL'] as const

const storefrontOptions: ProductOption[] = [
  {
    id: uuid(30, 1),
    name: '색상',
    sortOrder: 0,
    values: STOREFRONT_COLOURS.map((value, index) => ({
      id: uuid(31, index + 1),
      value,
      meta: null,
      sortOrder: index,
    })),
  },
  {
    id: uuid(30, 2),
    name: '사이즈',
    sortOrder: 1,
    values: STOREFRONT_SIZES.map((value, index) => ({
      id: uuid(32, index + 1),
      value,
      meta: null,
      sortOrder: index,
    })),
  },
]

/** `색상 · 사이즈` pairs that were never made — the F3 case. */
const MISSING = new Set(['카멜·L', '카멜·XL'])

/** The one that exists and is out of stock — the F2 case. */
const SOLD_OUT = '블랙·S'

const storefrontVariants: ProductVariant[] = STOREFRONT_COLOURS.flatMap((colour, colourIndex) =>
  STOREFRONT_SIZES.flatMap((size, sizeIndex) => {
    const key = `${colour}·${size}`

    if (MISSING.has(key)) return []

    const index = colourIndex * STOREFRONT_SIZES.length + sizeIndex

    return [
      {
        id: uuid(33, index + 1),
        sku: `LUMIKNIT-${String(index + 1)}`,
        price: 118_000,
        listPrice: 158_000,
        stock: key === SOLD_OUT ? 0 : 3 + index,
        maxPurchaseQuantity: null,
        effectiveMaxPurchaseQuantity: 3,
        isActive: true,
        optionValueIds: [uuid(31, colourIndex + 1), uuid(32, sizeIndex + 1)],
      },
    ]
  }),
)

// No `export const STOREFRONT_PRODUCT_ID` — `src/fixtures/*` may export nothing
// but branded fixtures (`registry.spec.ts`), and a caller reads the id off the
// fixture it already has.
export const storefrontProductDetail = defineFixture(productDetailResponseSchema, {
  product: {
    ...base,
    id: uuid(10, 3),
    name: '램스울 라운드넥 니트',
    description: '램스울 90% 혼방. 안감 없이 한 겹으로 입어도 따뜻합니다.',
    status: 'ACTIVE',
    attributes: {
      brand: '루미에르',
      fit: '레귤러핏',
      neckline: '라운드',
      wool_ratio: 90,
      detachable_liner: false,
      season: ['간절기', '겨울'],
    },
    maxPurchaseQuantity: 3,
    minPrice: 118_000,
    ratingAvg: 460,
    ratingCount: 128,
    salesCount: 940,
    version: 5,
    images: [
      {
        id: uuid(34, 1),
        url: 'https://images.unsplash.com/photo-lumiere-knit-front',
        alt: '니트 정면',
        sortOrder: 0,
      },
      {
        id: uuid(34, 2),
        url: 'https://images.unsplash.com/photo-lumiere-knit-back',
        alt: '니트 뒷면',
        sortOrder: 1,
      },
      {
        id: uuid(34, 3),
        url: 'https://images.unsplash.com/photo-lumiere-knit-detail',
        alt: null,
        sortOrder: 2,
      },
    ],
    options: storefrontOptions,
    variants: storefrontVariants,
  },
  seller: { id: SELLER_ID, brandName: '루미에르' },
  // Already labelled and ordered — the API resolves it up the category lineage
  // (TASK-0043 4.3), because the labels live on `AttributeDefinition` and the
  // route serving those is permissioned. The labels here are
  // `fixtures/attributes.ts`'s own, so the two fixtures agree.
  attributes: [
    { key: 'brand', label: '브랜드', value: '루미에르' },
    { key: 'fit', label: '핏', value: '레귤러핏' },
    { key: 'neckline', label: '넥라인', value: '라운드' },
    { key: 'wool_ratio', label: '울 혼용률', value: 90 },
    { key: 'detachable_liner', label: '탈부착 내피', value: false },
    { key: 'season', label: '착용 계절', value: ['간절기', '겨울'] },
  ],
})

/** 옵션이 없는 상품 — 축이 하나도 없을 때의 상세 화면. */
export const storefrontProductWithoutOptions = defineFixture(productDetailResponseSchema, {
  product: {
    ...base,
    id: uuid(10, 4),
    name: '캐시미어 머플러',
    description: null,
    status: 'ACTIVE',
    attributes: { brand: '루미에르', fit: '레귤러핏' },
    maxPurchaseQuantity: null,
    minPrice: 49_000,
    ratingAvg: 0,
    ratingCount: 0,
    salesCount: 12,
    version: 1,
    images: [
      {
        id: uuid(34, 9),
        url: 'https://images.unsplash.com/photo-lumiere-scarf',
        alt: null,
        sortOrder: 0,
      },
    ],
    options: [],
    variants: [
      {
        id: uuid(33, 101),
        sku: 'LUMISCARF-9',
        price: 49_000,
        listPrice: null,
        stock: 7,
        maxPurchaseQuantity: null,
        effectiveMaxPurchaseQuantity: null,
        isActive: true,
        optionValueIds: [],
      },
    ],
  },
  seller: { id: SELLER_ID, brandName: '루미에르' },
  attributes: [
    { key: 'brand', label: '브랜드', value: '루미에르' },
    { key: 'fit', label: '핏', value: '레귤러핏' },
  ],
})
