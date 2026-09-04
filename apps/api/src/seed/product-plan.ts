import type { AttributeValue, CreateProductRequest, ProductStatus } from '@shopping/shared'

import { priceFor, sectionOf, variantSurcharge } from './pricing.js'
import type { SeededRandom } from './random.js'
import type { SeedAttribute } from './taxonomy.js'
import { effectiveAttributes } from './taxonomy.js'
import { productDescription, productName } from './vocabulary.js'

/**
 * One listing, as `POST /products` will receive it (TASK-0037 4장).
 *
 * **The seed writes through `ProductService`, not through Prisma.** That is
 * what makes F3 (속성 유효성 위반 0건) and F4 (재고 = 원장) true by construction
 * rather than by a second implementation of the same rules — the opening
 * balance goes through `StockService.open`, which writes the `INBOUND` row that
 * explains it, because that is the only way `ProductService` knows how to
 * create a variant.
 *
 * So this file's whole job is to produce a **request the API will accept**.
 * Everything it decides — which axes, how many combinations, which attribute
 * values — is decided against the same schemas the controller parses with.
 */

/** Size axes, by section. `null` means the section has no size. */
const SIZES: Readonly<Record<string, readonly string[] | null>> = {
  tops: ['S', 'M', 'L', 'XL'],
  outer: ['S', 'M', 'L', 'XL'],
  bottoms: ['26', '28', '30', '32', '34'],
  shoes: ['230', '240', '250', '260', '270', '280'],
  bags: null,
  accessories: null,
}

/** How many colours a listing offers, by section. */
const COLOUR_COUNT: Readonly<Record<string, readonly [number, number]>> = {
  tops: [1, 3],
  outer: [1, 2],
  bottoms: [1, 2],
  shoes: [1, 2],
  bags: [2, 3],
  accessories: [2, 3],
}

/** How many sizes a listing carries, when its section has them. */
const SIZE_COUNT: readonly [number, number] = [2, 4]

/**
 * A value for one attribute definition.
 *
 * `colours` is threaded in rather than drawn here because the `color` attribute
 * and the 색상 option axis have to agree: a listing that says it comes in 블랙
 * and 아이보리 and then offers a 네이비 combination is the kind of inconsistency
 * that makes seeded data obviously seeded.
 */
function attributeValue(
  random: SeededRandom,
  definition: SeedAttribute,
  colours: readonly string[],
): AttributeValue | undefined {
  if (definition.key === 'color') return [...colours]

  switch (definition.type) {
    case 'SELECT':
      return random.pick(definition.options ?? [])
    case 'MULTI_SELECT':
      return [...random.sample(definition.options ?? [], random.int(1, 2))]
    case 'BOOLEAN':
      return random.chance(0.4)
    case 'NUMBER':
      // The only NUMBER in the tree is `heel_mm`, and a heel is a round number
      // of millimetres in 5mm steps.
      return random.int(0, 18) * 5
    case 'TEXT':
      return undefined
  }
}

/**
 * The attribute map for one listing.
 *
 * Required definitions are always filled — an `ACTIVE` listing with a required
 * attribute missing is refused with `PRODUCT_ATTRIBUTES_REQUIRED`, so a seed
 * that skipped one would die partway through. Optional ones are filled about
 * three times in four, which is what gives the storefront's facets an uneven
 * count: a facet whose every listing answers it tells a reader nothing.
 */
export function attributesFor(
  random: SeededRandom,
  leafSlug: string,
  colours: readonly string[],
): Readonly<Record<string, AttributeValue>> {
  const entries = effectiveAttributes(leafSlug).flatMap((definition) => {
    if (definition.isRequired !== true && !random.chance(0.75)) return []

    const value = attributeValue(random, definition, colours)

    return value === undefined ? [] : [[definition.key, value] as const]
  })

  return Object.fromEntries(entries)
}

/** Everything the seed needs to know about one listing beyond the request. */
export interface PlannedProduct {
  readonly request: CreateProductRequest
  /** Which store owns it — an index into the brand list. */
  readonly sellerIndex: number
  /** The leaf it is filed under, for the image pool. */
  readonly leafSlug: string
  /** Showcase listings get the good pictures (4장 이미지 2계층 전략). */
  readonly showcase: boolean
}

/**
 * One listing, planned end to end.
 *
 * `categoryId` is filled in by the caller once the categories exist — the plan
 * is pure and knows only slugs, which is what lets `product-plan.spec.ts` check
 * 800 of them without a database.
 */
export function planProduct(
  random: SeededRandom,
  input: {
    readonly leafSlug: string
    readonly sellerIndex: number
    readonly colourOptions: readonly string[]
    readonly showcase: boolean
  },
): PlannedProduct {
  const { leafSlug, sellerIndex, colourOptions, showcase } = input
  const section = sectionOf(leafSlug)
  const [colourLow, colourHigh] = COLOUR_COUNT[section] ?? [1, 2]
  const colours = random.sample(colourOptions, random.int(colourLow, colourHigh))

  const sizePool = SIZES[section] ?? null
  const sizes =
    sizePool === null
      ? []
      : [...random.sample(sizePool, random.int(...SIZE_COUNT))].sort(
          (a, b) => sizePool.indexOf(a) - sizePool.indexOf(b),
        )

  const options = [
    { name: '색상', values: colours.map((value) => ({ value })) },
    ...(sizes.length > 0 ? [{ name: '사이즈', values: sizes.map((value) => ({ value })) }] : []),
  ]

  const name = productName(random, leafSlug)
  const { price, listPrice } = priceFor(random, leafSlug)

  // A tenth stay `DRAFT`. A catalogue where every listing is on sale never
  // exercises the seller console's own filter, and never shows a buyer's list
  // correctly hiding something.
  const status: ProductStatus = random.chance(0.1) ? 'DRAFT' : 'ACTIVE'

  const combinations = colours.flatMap((colour) =>
    sizes.length === 0 ? [[colour]] : sizes.map((size) => [colour, size]),
  )

  const variants = combinations.map((optionValues) => {
    const surcharge = variantSurcharge(random, price)

    return {
      optionValues,
      price: price + surcharge,
      // The struck-through price moves with the selling price.
      // `ProductVariant_list_price_check` requires `listPrice >= price`, and a
      // surcharge applied to one and not the other is a negative discount —
      // which the database refuses and which a storefront would render as a
      // positive one with the sign quietly dropped.
      ...(listPrice === null ? {} : { listPrice: listPrice + surcharge }),
      // A tenth of combinations are out of stock. `settle` only requires one
      // *active* variant for `ACTIVE`, not one in stock, so a sold-out listing is
      // a state the catalogue can legitimately be in — and the storefront has to
      // render it.
      stock: random.chance(0.1) ? 0 : random.int(3, 180),
    }
  })

  return {
    sellerIndex,
    leafSlug,
    showcase,
    request: {
      categoryId: 0,
      name,
      description: productDescription(random, name),
      status,
      attributes: attributesFor(random, leafSlug, colours),
      options,
      variantDefaults: { price, ...(listPrice === null ? {} : { listPrice }), stock: 0 },
      variants,
    },
  }
}

/** How much of a catalogue a run makes. */
export interface SeedScale {
  readonly label: 'small' | 'full'
  readonly sellers: number
  readonly products: number
}

/**
 * The two sizes (F1 · F8).
 *
 * `small` exists because R3 asks for it: a five-minute seed run in the middle of
 * a change is a five-minute interruption, and a person who is checking one
 * screen needs 50 listings, not 800.
 */
export const SEED_SCALES: Readonly<Record<'small' | 'full', SeedScale>> = {
  small: { label: 'small', sellers: 5, products: 50 },
  full: { label: 'full', sellers: 15, products: 800 },
}

/** How many listings get the full gallery (4장 이미지 2계층 전략). */
const SHOWCASE_COUNT = 20

/** One listing's place in the catalogue, before anything about it is drawn. */
export interface CataloguePlacement {
  /** Stable across runs — the seed's natural key, via the SKU prefix. */
  readonly index: number
  readonly leafSlug: string
  readonly sellerIndex: number
  readonly showcase: boolean
}

/**
 * Where each listing goes, before a word of it is generated.
 *
 * Both walks are round-robin rather than random, and that is the point: the
 * 800th listing has to land in the same category and the same store on every
 * run, or the seed cannot recognise what it wrote last time (F2). Randomness
 * belongs to what a listing *is*, not to where it sits.
 *
 * Walking the two lists at different rates is what stops the two cycles locking
 * together — 26 leaves and 15 stores share no factor, so every store ends up
 * with products across the whole tree instead of the same two categories.
 */
export function planCatalogue(
  scale: SeedScale,
  leafSlugs: readonly string[],
): readonly CataloguePlacement[] {
  if (leafSlugs.length === 0) throw new Error('잎 카테고리가 없습니다.')

  // Spread the showcase across the tree rather than taking the first twenty,
  // which would put every good gallery in one category.
  const showcaseStride = Math.max(Math.floor(scale.products / SHOWCASE_COUNT), 1)

  return Array.from({ length: scale.products }, (_unused, index) => ({
    index,
    leafSlug: leafSlugs[index % leafSlugs.length] ?? '',
    sellerIndex: index % scale.sellers,
    showcase: index % showcaseStride === 0 && index / showcaseStride < SHOWCASE_COUNT,
  }))
}

/** The SKU prefix that makes a seeded listing recognisable on the next run. */
export function seedSkuPrefix(index: number): string {
  return `SEED${String(index).padStart(4, '0')}`
}
