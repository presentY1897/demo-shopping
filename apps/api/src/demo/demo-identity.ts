import type { DemoRole } from '@shopping/shared'

/**
 * What an issued account is called (TASK-0024 4.7).
 *
 * Pure functions of a token the caller generated, so the shapes they have to
 * satisfy are checkable without issuing anything:
 *
 * | value | what refuses a bad one |
 * | --- | --- |
 * | brand name | `sellerBrandNameSchema` (2–40, no surrounding space) · `Seller_brandName_key` |
 * | slug | `sellerSlugSchema` (`^[a-z0-9]+(?:-[a-z0-9]+)*$`) · `Seller_slug_key` |
 * | email | nothing — `User.email` is not unique and a demo never signs in with it |
 *
 * **Every brand name is invented** (CLAUDE.md 6장). The words below are common
 * nouns, and the token on the end is what makes a name unique — the uniqueness
 * index is global, so two visitors issuing a store in the same second must not
 * collide.
 */

/** Base32-ish alphabet: no `0`/`O`, no `1`/`I`/`l`. A slug reads unambiguously. */
const TOKEN_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'

export const DEMO_TOKEN_LENGTH = 8

/**
 * A token for one issued account.
 *
 * Takes its randomness as an argument so the formatting above stays testable
 * without stubbing the crypto module: the caller passes `randomBytes`.
 */
export function demoToken(bytes: (size: number) => Uint8Array): string {
  return Array.from(
    bytes(DEMO_TOKEN_LENGTH),
    (byte) => TOKEN_ALPHABET[byte % TOKEN_ALPHABET.length],
  )
    .join('')
    .slice(0, DEMO_TOKEN_LENGTH)
}

/**
 * Invented store names. Nothing here is a real brand (CLAUDE.md 6장).
 *
 * A comma separated string rather than an array because the pick below indexes
 * it: under `noUncheckedIndexedAccess` an indexed read is `string | undefined`,
 * and the `??` that satisfies the compiler would be a branch no input can reach
 * — an untestable line inside a file held to 100% for a reason.
 */
const STORE_WORDS = '물결상점,느린상점,오후상점,들판상점,고요상점'

const PERSONA_NAME: Readonly<Record<DemoRole, string>> = {
  BUYER: '체험 구매자',
  SELLER: '체험 판매자',
  ADMIN: '체험 관리자',
}

/**
 * The address on the account.
 *
 * A subdomain of our own domain rather than `example.com`, so a row that leaks
 * into a screen reads as ours and cannot be confused with somebody's real
 * address. Nothing is ever sent to it — email is out of scope (DECISIONS 8).
 */
export function demoEmail(role: DemoRole, token: string): string {
  return `${role.toLowerCase()}-${token}@demo.demo-shopping.com`
}

export function demoName(role: DemoRole): string {
  return PERSONA_NAME[role]
}

/**
 * The store's display name.
 *
 * The word is picked from the token rather than at random, so the same token
 * always produces the same store — which is what lets a spec assert on a name
 * without the assertion being a coin toss.
 */
export function demoBrandName(token: string): string {
  const words = STORE_WORDS.split(',')
  const at = sumOf(token) % words.length
  // `slice().join('')` and not `words[at]`: a one element slice joins to a
  // string whatever the index was, so there is no unreachable fallback to write.
  const word = words.slice(at, at + 1).join('')

  return `${word} ${token.slice(0, 4).toUpperCase()}`
}

export function demoSlug(token: string): string {
  return `demo-${token}`
}

/**
 * A SKU that is free within one store.
 *
 * Copied SKUs are unique per **source** seller (`ProductVariant_seller_sku_key`),
 * and a demo store gathers variants from several of them, so two originals can
 * arrive with the same string. Only the collisions are renamed — leaving the
 * first one alone keeps a cloned catalogue readable instead of prefixing every
 * row for the sake of the rare clash.
 *
 * The suffix keeps the format check happy (`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`)
 * by being appended inside the 64 character budget rather than past it.
 */
export function uniqueSku(sku: string, taken: ReadonlySet<string>): string {
  if (!taken.has(sku)) return sku

  for (let attempt = 2; attempt < 1_000; attempt += 1) {
    const suffix = `-${String(attempt)}`
    const candidate = `${sku.slice(0, 64 - suffix.length)}${suffix}`

    if (!taken.has(candidate)) return candidate
  }

  throw new Error(`SKU ${sku} 의 중복을 떼어낼 수 없습니다.`)
}

/** `charCodeAt` rather than `codePointAt`: it is typed `number`, so no fallback. */
function sumOf(token: string): number {
  let total = 0

  for (let index = 0; index < token.length; index += 1) total += token.charCodeAt(index)

  return total
}
