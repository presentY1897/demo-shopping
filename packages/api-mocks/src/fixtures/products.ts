import type { Product, ProductOption, ProductVariant } from '@shopping/shared'
import { productResponseSchema } from '@shopping/shared'

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
