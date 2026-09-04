import { z } from 'zod'

import { variantIdSchema } from './products.js'

/**
 * The stock ledger, as the API states it (TASK-0036).
 *
 * `ProductVariant.stock` is the current value and this is what explains it:
 * every movement is a row, the current quantity is their sum, and the two can
 * be reconciled (CLAUDE.md 6장). A screen that shows a stock number without
 * being able to answer "왜 줄었나" is the thing this contract exists to prevent.
 *
 * Contract gate C1: these schemas are the only definition of a ledger response
 * in the repository. `apps/api` validates its input with them and the
 * front-ends parse their answers with them; C3 then holds structurally,
 * because `createApiClient` parses every response with the schema declared here.
 */

/**
 * What moved the stock.
 *
 * The type decides the **sign** and the database enforces it
 * (`StockLedger_direction_check`): a `SALE` that adds stock would make every
 * reader of the ledger wrong, and a reader is a seller's history screen, a
 * reconciliation batch and — from M07 — the order pipeline.
 */
export const stockLedgerTypes = [
  /** Goods received, and the opening balance of a newly created variant. */
  'INBOUND',
  'SALE',
  'CANCEL',
  'RETURN_IN',
  /** A reservation turning into a real decrement (M07). */
  'RESERVE_CONFIRM',
  /** A person overriding the count. The only two-way type, and the only one
   * obliged to say why. */
  'ADJUST',
] as const

export type StockLedgerType = (typeof stockLedgerTypes)[number]

export const stockLedgerTypeSchema = z.enum(stockLedgerTypes)

/**
 * Which table a movement's `refId` points at.
 *
 * The reference is what makes a movement idempotent — one `SALE` per order item
 * — so the names are an enum rather than free text even though none of these
 * tables exists yet. They come from `docs/design/erd.md` 3·4·5, so they are
 * already decided rather than guessed.
 */
export const stockRefTypes = ['ORDER_ITEM', 'STOCK_RESERVATION', 'CLAIM_ITEM'] as const

export type StockRefType = (typeof stockRefTypes)[number]

export const stockRefTypeSchema = z.enum(stockRefTypes)

/**
 * A signed movement, in whole units. Never zero.
 *
 * `+5` is five received, `-3` is three taken. An **adjustment amount and not an
 * absolute level** (D-024): "재고를 17로" overwrites whatever sold in between,
 * while "+5 입고" is right whenever it is processed.
 *
 * Bounded by the same ceiling a variant's stock has, so that a stray digit is
 * refused where a person can still see it.
 */
export const STOCK_MAX_MOVEMENT = 1_000_000

export const stockMovementQuantitySchema = z
  .int()
  .min(-STOCK_MAX_MOVEMENT)
  .max(STOCK_MAX_MOVEMENT)
  .refine((value) => value !== 0, { error: '변동 수량은 0일 수 없어요.' })

export const STOCK_REASON_MAX_LENGTH = 200

export const stockReasonSchema = z.string().trim().min(1).max(STOCK_REASON_MAX_LENGTH)

/** One movement, as the ledger recorded it. */
export const stockLedgerEntrySchema = z.object({
  /**
   * This movement's position in the variant's history, from 1.
   *
   * The row's identity, and the cursor. It is the order the movements really
   * happened in, because it is allocated while the variant's row is locked
   * (TASK-0036 4.2) — which a timestamp cannot promise inside one millisecond.
   */
  seq: z.int().min(1),
  type: stockLedgerTypeSchema,
  /** Signed. The sign always agrees with `type`. */
  quantity: z.int(),
  /** Stock immediately after this movement — what the variant held at the time. */
  balanceAfter: z.int().min(0),
  /** What caused it. Both fields are present or both are `null`. */
  refType: stockRefTypeSchema.nullable(),
  refId: z.uuid().nullable(),
  /** Why, in the operator's words. Always present for `ADJUST`. */
  reason: z.string().nullable(),
  /** Who did it; `null` for a movement the system made on its own. */
  actorId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
})

export type StockLedgerEntry = z.infer<typeof stockLedgerEntrySchema>

/**
 * The variant the history belongs to, with both numbers a reconciliation needs.
 *
 * `stock` is the current value; `ledgerBalance` is the sum of every movement
 * ever recorded for it. They are equal, and a screen that shows both is a
 * screen on which a broken ledger is visible rather than merely present — which
 * is what "대사가 가능해야 한다" asks for.
 */
export const variantStockSchema = z.object({
  variantId: variantIdSchema,
  sku: z.string(),
  stock: z.int().min(0),
  ledgerBalance: z.int(),
  /** How many movements exist in total, whatever this page holds. */
  entryCount: z.int().min(0),
})

export type VariantStock = z.infer<typeof variantStockSchema>

export const STOCK_LEDGER_MAX_LIMIT = 100

export const STOCK_LEDGER_DEFAULT_LIMIT = 20

/**
 * A page of history, newest first.
 *
 * `nextCursor` is the `seq` to pass back, or `null` at the end. A `seq` cursor
 * needs no tie-breaker and cannot shift under an insert: new movements always
 * take a **larger** number, so they land on the page the reader has already
 * passed rather than in the middle of one they have not.
 */
export const stockLedgerResponseSchema = z.object({
  variant: variantStockSchema,
  entries: z.array(stockLedgerEntrySchema),
  nextCursor: z.int().min(1).nullable(),
})

export type StockLedgerResponse = z.infer<typeof stockLedgerResponseSchema>

/** Query of `GET /api/v1/variants/:id/ledger`, as a caller writes it. */
export const stockLedgerQuerySchema = z.object({
  limit: z.int().min(1).max(STOCK_LEDGER_MAX_LIMIT).optional(),
  /** Reads the movements **before** this position. */
  cursor: z.int().min(1).optional(),
})

export type StockLedgerQuery = z.infer<typeof stockLedgerQuerySchema>

/**
 * The same query as it arrives on the wire, where every value is a string.
 *
 * Kept beside the typed form instead of in the controller so that the two
 * cannot drift: adding a parameter to one without the other stops compiling.
 */
export const stockLedgerQueryParamsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(STOCK_LEDGER_MAX_LIMIT).optional(),
  cursor: z.coerce.number().int().min(1).optional(),
})

/**
 * One variant whose ledger does not explain its stock, and what is wrong.
 *
 * The four faults are the four statements TASK-0036 4.1 turns "현재값은 원장의
 * 결과" into. Reporting *which* one broke is the difference between a
 * reconciliation that finds the bug and one that only says a number is off.
 */
export const stockReconciliationFaults = [
  /** L1 — `stock` is not the sum of the movements. */
  'sum_mismatch',
  /** L2 — some row's `balanceAfter` is not the previous one plus its quantity. */
  'chain_break',
  /** L3 — the newest movement's `balanceAfter` is not the current stock. */
  'endpoint_mismatch',
  /** L4 — `seq` does not run 1..n; a row is missing or was written unlocked. */
  'seq_gap',
] as const

export type StockReconciliationFault = (typeof stockReconciliationFaults)[number]
