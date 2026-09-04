import type { SeededRandom } from './random.js'

/**
 * What things cost (TASK-0037 4장, F5).
 *
 * **A catalogue where everything costs about the same cannot demonstrate a
 * price filter or a sort.** That is the whole reason this file is not one
 * `random.int(10_000, 50_000)`: the storefront's price facet, the "낮은 가격순"
 * sort and the settlement figures in M13 all become meaningless the moment the
 * distribution is flat, and none of them would *fail* — they would just look
 * like they do nothing.
 *
 * So the spread is built from the thing that actually spreads a fashion
 * catalogue: **what kind of garment it is.** A cap and a wool coat are two
 * orders of magnitude apart in any real store, and filing every product under a
 * section gives that for free.
 *
 * F5 asks for a 20× spread between the cheapest and the dearest. The bands
 * below give **57×** at the extremes, and `pricing.spec.ts` fails if an edit
 * ever narrows them past the requirement.
 */

/** `[최저, 최고]` in KRW, by section — the middle segment of a leaf slug. */
const BANDS: Readonly<Record<string, readonly [number, number]>> = {
  accessories: [12_000, 60_000],
  tops: [19_000, 120_000],
  bottoms: [29_000, 160_000],
  bags: [39_000, 320_000],
  shoes: [49_000, 290_000],
  outer: [89_000, 690_000],
}

/**
 * The section a leaf belongs to — `men-shoes-dress-shoes` is `shoes`.
 *
 * Index 1, not "the second-to-last segment": one leaf name contains a hyphen
 * and counting from the end would file it under `dress`.
 */
export function sectionOf(leafSlug: string): string {
  const section = leafSlug.split('-')[1]

  if (section === undefined) throw new Error(`섹션을 알 수 없는 카테고리입니다: ${leafSlug}`)

  return section
}

/**
 * Rounds to a price a shop would actually print.
 *
 * `48_213` → `48_900`. Every price in the catalogue ending in a random three
 * digits is the single clearest sign that a dataset was generated, and it costs
 * one line to avoid.
 */
function retail(value: number): number {
  return Math.max(Math.round(value / 1_000) * 1_000 - 100, 900)
}

/** What one listing costs, and what it claims it used to cost. */
export interface SeedPrice {
  readonly price: number
  /** `null` when the listing is not on sale — most of them. */
  readonly listPrice: number | null
}

/**
 * A price for one listing.
 *
 * The draw inside a band is **squared** rather than uniform, which pushes most
 * listings toward the cheap end of their own section and leaves a thin tail at
 * the top. A uniform draw would put as many ₩600,000 coats on the page as
 * ₩100,000 ones, and the first page of any real category is not shaped like
 * that — which matters here because the first page is what a reader sees.
 */
export function priceFor(random: SeededRandom, leafSlug: string): SeedPrice {
  const band = BANDS[sectionOf(leafSlug)]

  if (band === undefined) throw new Error(`가격대가 없는 섹션입니다: ${leafSlug}`)

  const [low, high] = band
  const skewed = random.next() ** 2
  const price = retail(low + (high - low) * skewed)

  // About one listing in four is on sale, and the discount is 10~40%. Every
  // listing having a struck-through price is as unconvincing as none having one.
  if (!random.chance(0.25)) return { price, listPrice: null }

  const discount = random.int(10, 40) / 100

  return { price, listPrice: retail(price / (1 - discount)) }
}

/**
 * How much dearer one option combination is than the listing's base price.
 *
 * Zero for most of them. A few combinations — the largest size, the colour that
 * needs a different dye lot — cost a little more, which is what makes the
 * variant table on the seller console worth looking at.
 */
export function variantSurcharge(random: SeededRandom, base: number): number {
  if (!random.chance(0.2)) return 0

  // A round step scaled to the listing, not a percentage: a shop charges
  // "+5,000원 for XL", never "+7,340원".
  const step = base >= 200_000 ? 10_000 : base >= 60_000 ? 5_000 : 2_000

  return step * random.int(1, 3)
}
