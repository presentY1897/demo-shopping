import { SKU_PREFIX_PATTERN } from '@shopping/shared'

/**
 * How a generated SKU is named when the seller does not name it (TASK-0113 4장).
 *
 * Pure, and deliberately so: this decides an identifier that ends up printed on
 * a label and pasted into a spreadsheet, and every property it has to hold —
 * reproducible from the row, unique inside a store, ordered by creation, legal
 * under the SKU format check — is a property of a string function. No clock, no
 * counter, no database. QUALITY-GATES Q5 (순수 로직) holds it to branch 100%.
 */

/**
 * How many leading hex characters of the id the prefix keeps.
 *
 * Eight, which is where the old rule stopped — and stopping there was the bug.
 * `Product.id` is a UUIDv7 whose first 48 bits are a unix millisecond, so eight
 * hex characters are the **top 32 bits** of that timestamp: the low 16 bits are
 * cut off and the value only changes every 2^16 ms ≈ **65.5 seconds**.
 */
const TIME_CHARS = 8

/**
 * How many trailing hex characters it appends.
 *
 * Six — 24 bits taken from the id's random tail (`rand_b`), which is what makes
 * two products of one seller inside the same 65-second window collide with
 * probability 1 in 16.7 million rather than **1**.
 */
const RANDOM_CHARS = 6

/**
 * The prefix generated SKUs carry when the caller names none — `<prefix>-1`,
 * `<prefix>-2`, …
 *
 * **Why not a random string.** The prefix has to be recomputable: adding an
 * option value to a saved product creates new combinations, and their SKUs are
 * numbered on from the same prefix the first ones got. A fresh random value at
 * that moment would split one product's SKUs into two families, which is a
 * catalogue nobody can read back. Deriving it from the row is what makes the
 * update path work without storing anything.
 *
 * **Why the timestamp half stays.** Keeping the leading characters means the
 * prefixes of one store sort in creation order, so a SKU column in a console
 * reads the way a seller expects. The bug was never that the timestamp was
 * there; it was that it was *all* that was there.
 *
 * **Why the tail is enough.** A collision now needs both halves to match: the
 * same 65-second window **and** the same 24 random bits. And when it does
 * happen it is not silent — `ProductVariant_seller_sku_key` refuses the insert
 * and the caller gets the same 409 they would get for typing a duplicate SKU by
 * hand.
 */
export function defaultSkuPrefix(productId: string): string {
  const hex = productId.replaceAll('-', '')
  const prefix = `${hex.slice(0, TIME_CHARS)}${hex.slice(-RANDOM_CHARS)}`.toUpperCase()

  // A product id is always a UUID by the time it reaches here — the column is
  // one and the schema parses one — so this cannot fire from a request. It
  // guards the other direction: a later change to the derivation that produced
  // a prefix the SKU format check refuses would otherwise surface as a
  // constraint violation on insert, at which point the request is already half
  // done and the message names an index instead of a rule.
  if (!SKU_PREFIX_PATTERN.test(prefix)) {
    throw new Error(`생성된 SKU 접두사가 규칙에 맞지 않습니다: ${prefix}`)
  }

  return prefix
}

/**
 * The SKU of the n-th generated variant, counting from `from`.
 *
 * Numbering is by position in the combination expansion, whose first axis
 * varies slowest — which is what makes "생성 SKU 번호가 판매자가 표에서 읽는
 * 순서와 같다" true (TASK-0032 F1). Kept beside the prefix so the two halves of
 * a generated SKU are decided in one place, and so that changing one of them
 * cannot silently change the other.
 */
export function generatedSku(prefix: string, offset: number): string {
  return `${prefix}-${String(offset)}`
}
