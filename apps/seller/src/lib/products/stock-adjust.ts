import type { SellerStockAdjustType, StockAdjustRequest } from '@shopping/shared'
import {
  STOCK_MAX_MOVEMENT,
  STOCK_REASON_MAX_LENGTH,
  stockAdjustRequestSchema,
} from '@shopping/shared'

/**
 * Turning what a seller typed into a request — or into the reason it is not one.
 *
 * **There is no absolute field to read here, and that is the screen's one
 * design decision** (4장 「조정량 UI」, F2b). A box that said "재고" and accepted
 * `17` would be wrong the moment something sold between the read and the save:
 * the seller means "17 as of what I am looking at", the server would hear "17,
 * whatever happened since", and the sale would be silently undone. A delta says
 * the same intent in a way that survives the gap.
 *
 * **What this file can decide, and what it cannot.** It can refuse an empty box,
 * a `0`, a non-integer and a number past the movement cap — all of those are
 * true of the input alone. It cannot decide whether the result would be
 * negative: only the server knows the stock at the instant the request lands,
 * which is the same argument again. That refusal arrives as a 400 and is shown
 * on this field (F9).
 */

/** Why an adjustment cannot be sent yet. */
export type StockAdjustIssue = 'required' | 'zero' | 'range' | 'reason_too_long'

export interface StockAdjustDraft {
  /** Exactly what is in the box, including `''`, `'+5'` and `'abc'`. */
  readonly delta: string
  readonly type: SellerStockAdjustType
  readonly reason: string
}

export type StockAdjustParse =
  | { readonly ok: true; readonly request: StockAdjustRequest }
  | { readonly ok: false; readonly issue: StockAdjustIssue }

/** `'+5'` → `5`, `'-2'` → `-2`, `''` · `'3.5'` · `'abc'` → `null`. */
export function parseDelta(value: string): number | null {
  const trimmed = value.trim()

  // `Number('')` is 0 and `Number(' ')` is 0, which would turn an empty box into
  // a zero adjustment — a refusal with the wrong sentence on it.
  if (trimmed === '' || !/^[+-]?\d+$/.test(trimmed)) return null

  return Number(trimmed)
}

/**
 * What the seller typed, as a request the API would accept.
 *
 * The final gate is `stockAdjustRequestSchema` itself rather than the checks
 * above it: the checks exist to name *which* problem it is, and the schema
 * exists so that a rule added to the contract cannot be missed here (C1).
 */
export function parseStockAdjust(draft: StockAdjustDraft): StockAdjustParse {
  const delta = parseDelta(draft.delta)

  if (delta === null) return { ok: false, issue: 'required' }
  if (delta === 0) return { ok: false, issue: 'zero' }
  if (Math.abs(delta) > STOCK_MAX_MOVEMENT) return { ok: false, issue: 'range' }

  const reason = draft.reason.trim()

  if (reason.length > STOCK_REASON_MAX_LENGTH) return { ok: false, issue: 'reason_too_long' }

  const parsed = stockAdjustRequestSchema.safeParse({
    delta,
    type: draft.type,
    ...(reason === '' ? {} : { reason }),
  })

  return parsed.success ? { ok: true, request: parsed.data } : { ok: false, issue: 'range' }
}

/**
 * What the number will read after the click, or `null` when it cannot be said.
 *
 * R1's answer: a seller who wants "17" is shown `12 → 17` while typing `+5`, so
 * the absolute number they were thinking of is on screen without a box that
 * would send it. `null` when the input is not yet a number, and **also** when
 * the result would be negative — the screen does not refuse that (the server
 * does), but it must not promise a figure the server is going to reject.
 */
export function previewBalance(current: number, delta: string): number | null {
  const parsed = parseDelta(delta)

  if (parsed === null || parsed === 0) return null

  const next = current + parsed

  return next < 0 ? null : next
}
