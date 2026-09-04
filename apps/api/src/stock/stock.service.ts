import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { Prisma } from '@prisma/client'
import type {
  StockLedgerEntry,
  StockLedgerQuery,
  StockLedgerResponse,
  StockLedgerType,
  StockReconciliationFault,
  StockRefType,
} from '@shopping/shared'
import { STOCK_LEDGER_DEFAULT_LIMIT } from '@shopping/shared'

import { assertResourceAccess } from '../auth/access-denied.js'
import { sellerOwnership, sellerOwnershipSelect } from '../auth/resource-ownership.js'
import type { RequestPrincipal } from '../auth/request-principal.js'
import type { Clock } from '../common/clock.js'
import { CLOCK } from '../common/clock.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { SearchOutboxService } from '../search/search-outbox.service.js'
import type { LedgerAudit, MovementDraft, MovementIssue } from './stock-ledger.js'
import { movementIssues, nextBalance, reconciliationFaults } from './stock-ledger.js'

/** The transaction handle Prisma hands an interactive transaction. */
type Tx = Prisma.TransactionClient

/** The index that refuses the second recording of one movement. */
const REF_INDEX = 'StockLedger_ref_key'

/** One movement, as a caller states it. */
export interface StockMovement {
  readonly variantId: string
  readonly type: StockLedgerType
  /** Signed and non-zero. An **adjustment**, never an absolute level (D-024). */
  readonly quantity: number
  readonly refType?: StockRefType | null
  readonly refId?: string | null
  readonly reason?: string | null
  readonly actorId?: string | null
}

/** The opening balance of a variant this transaction has just created. */
export interface OpeningStock {
  readonly variantId: string
  readonly quantity: number
}

/** One variant whose ledger does not explain its stock. */
export interface StockDiscrepancy {
  readonly variantId: string
  readonly stock: number
  readonly ledgerBalance: number
  readonly faults: readonly StockReconciliationFault[]
}

/** What a movement reads about a variant, after the lock is held. */
interface VariantState {
  readonly stock: number
  readonly lastSeq: number
}

/** The message each refusal carries. Total, so a new code cannot be silent. */
const ISSUE_MESSAGE: Readonly<Record<MovementIssue['code'], string>> = {
  zero_quantity: '변동 수량은 0일 수 없어요.',
  wrong_direction: '이 변동 유형에는 쓸 수 없는 부호예요.',
  unpaired_reference: '참조 유형과 참조 id 는 함께 보내야 해요.',
  reason_required: '재고를 조정하려면 사유를 입력해 주세요.',
  blank_reason: '사유를 입력해 주세요.',
}

/**
 * The one path every change to `ProductVariant.stock` takes (TASK-0036).
 *
 * **Nothing else writes that column.** Not the product editor, not a repository
 * helper, not a seed script — `test/db/stock-single-path.spec.ts` fails if a
 * second writer appears. R1 called that a code review item; a review item is
 * forgotten and a red test is not.
 *
 * Four rules run through everything below.
 *
 * **The variant's row is locked first, and explicitly.** Three things are
 * decided inside that lock — whether there is enough stock, which position the
 * movement takes, and what the balance is afterwards — and all three are read
 * from other rows. A lock acquired incidentally by the `UPDATE` a few lines
 * later would protect the write and not the decision, which is what TASK-0032
 * 7.3 measured for products (its cache assertion survived the missing lock;
 * its optimistic lock did not).
 *
 * **The lock and the read are two statements, on purpose.** Under READ
 * COMMITTED a blocked `SELECT … FOR UPDATE` re-reads the locked row, but a
 * subquery in the same statement keeps the snapshot it started with. Asking for
 * `stock` and `max(seq)` in the locking statement would therefore hand back a
 * current stock beside a stale position — and the symptom is a primary key
 * collision on a busy variant, which is exactly the kind of failure nobody
 * reproduces. The second statement takes a fresh snapshot and sees whatever the
 * previous holder committed.
 *
 * **The current value is never adjusted towards anything.** `stock` is written
 * as `balanceAfter`, the number the ledger just recorded, so the two cannot
 * drift by construction: there is no `stock = stock + n` anywhere.
 *
 * **A movement is stated as a delta.** "재고를 17로" overwrites whatever sold in
 * between; "+5 입고" is right whenever it is processed (D-024).
 */
@Injectable()
export class StockService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly outbox: SearchOutboxService,
  ) {}

  // ------------------------------------------------------------------ writes

  /** Applies one movement in a transaction of its own. */
  adjust(movement: StockMovement): Promise<StockLedgerEntry> {
    return this.prisma.$transaction((tx) => this.apply(tx, movement))
  }

  /**
   * Applies one movement inside a transaction the caller already opened.
   *
   * The entry point for anything that changes stock as part of a larger write —
   * a product edit today, an order tomorrow. Lock ordering is stable: a caller
   * holding the product's row takes variant locks after it, and nothing that
   * holds a variant lock ever asks for the product's, so the two cannot cycle.
   */
  async apply(tx: Tx, movement: StockMovement): Promise<StockLedgerEntry> {
    const draft = normalise(movement)
    const issues = movementIssues(draft)

    if (issues.length > 0) throw refusal(issues)

    await this.lockVariant(tx, movement.variantId)

    const state = await this.readState(tx, movement.variantId)
    const balance = nextBalance(state.stock, draft.quantity)

    if (balance === null) {
      throw new ConflictException({
        message: [
          {
            field: 'quantity',
            message: `재고가 부족해요. 지금 ${String(state.stock)}개 남아 있어요.`,
          },
        ],
      })
    }

    const entry = await this.record(tx, movement, draft, { seq: state.lastSeq + 1, balance })

    await this.publishStockCrossing(tx, movement.variantId, state.stock, balance)

    return entry
  }

  /**
   * Tells the search index only when the **answer** changed (TASK-0038 R3).
   *
   * The index carries `inStock`, a boolean, not the number — so a sale that
   * leaves 41 of 42 changes nothing a searcher can see. Publishing on every
   * movement would put one event per sale into the queue and rebuild the same
   * document for the same bytes; publishing on the zero crossing puts one event
   * where there is one change.
   *
   * The listing is reached from the variant rather than passed in because the
   * caller of a movement is holding an order line or an adjustment, and neither
   * of them knows or should know that a search index exists.
   */
  private async publishStockCrossing(
    tx: Tx,
    variantId: string,
    before: number,
    after: number,
  ): Promise<void> {
    if ((before === 0) === (after === 0)) return

    const rows = await tx.$queryRaw<readonly { productId: string }[]>`
      SELECT "productId" FROM "ProductVariant" WHERE "id" = ${variantId}::uuid
    `
    const productId = rows[0]?.productId

    if (productId !== undefined) await this.outbox.publish(tx, productId, 'UPSERT')
  }

  /**
   * Records the opening balance of variants this transaction has just created.
   *
   * No lock, and that is not an optimisation. The rows were inserted by this
   * very transaction and have never been committed, so no other transaction can
   * see them, let alone lock them: there is nothing to serialise against. A
   * hundred combinations would otherwise cost a hundred round trips to queue
   * behind nobody.
   *
   * Variants opening at zero get no row. A movement of nothing is not a
   * movement (`StockLedger_quantity_check`), and the ledger of a variant that
   * has never moved is correctly empty — its sum is zero and so is its stock.
   */
  async open(tx: Tx, rows: readonly OpeningStock[]): Promise<void> {
    const opening = rows.filter((row) => row.quantity > 0)

    if (opening.length === 0) return

    const now = this.clock.now()

    await tx.stockLedger.createMany({
      data: opening.map((row) => ({
        variantId: row.variantId,
        seq: 1,
        type: 'INBOUND' as const,
        quantity: row.quantity,
        balanceAfter: row.quantity,
        reason: '상품 등록 초기 재고',
        createdAt: now,
      })),
    })

    // One statement for every variant. A hundred combinations would otherwise be
    // a hundred round trips inside the transaction that created them (gate A5).
    const levels = Prisma.join(
      opening.map((row) => Prisma.sql`(${row.variantId}::uuid, ${row.quantity}::int)`),
    )

    await tx.$executeRaw`
      UPDATE "ProductVariant" v
         SET "stock"     = o."stock",
             "updatedAt" = ${this.nowSql()}
        FROM (VALUES ${levels}) AS o("id", "stock")
       WHERE v."id" = o."id"
    `
  }

  /**
   * Moves a variant to an absolute level by recording the difference.
   *
   * The product editor still accepts an absolute `stock` (TASK-0032 4.5), and
   * removing that field is the write contract's call, not this task's
   * (TASK-0036 4.7). What this task owes is that the level never moves without
   * the ledger saying so — so the difference is computed **under the variant's
   * row lock** and written as an `ADJUST`, which keeps whatever sold in the
   * meantime inside the history instead of erasing it.
   *
   * Answers `null` when the level is already what was asked for: setting stock
   * to the number it already holds is not a movement.
   */
  async setLevel(
    tx: Tx,
    input: {
      readonly variantId: string
      readonly level: number
      readonly actorId?: string | null
      readonly reason?: string
    },
  ): Promise<StockLedgerEntry | null> {
    await this.lockVariant(tx, input.variantId)

    const state = await this.readState(tx, input.variantId)
    const delta = input.level - state.stock

    if (delta === 0) return null

    const draft: MovementDraft = {
      type: 'ADJUST',
      quantity: delta,
      refType: null,
      refId: null,
      reason: input.reason ?? '판매자 재고 수정',
    }

    return this.record(
      tx,
      { variantId: input.variantId, type: 'ADJUST', quantity: delta, actorId: input.actorId },
      draft,
      { seq: state.lastSeq + 1, balance: input.level },
    )
  }

  // ------------------------------------------------------------------- reads

  /**
   * One variant's history, newest first.
   *
   * The answer carries the current stock **and** the ledger's own sum. A screen
   * that shows one number cannot tell a reader whether it is explained; showing
   * both is what makes "대사가 가능해야 한다" something a person can act on
   * rather than a property of a batch job nobody sees.
   */
  async history(
    principal: RequestPrincipal,
    variantId: string,
    query: StockLedgerQuery,
  ): Promise<StockLedgerResponse> {
    const variant = await this.prisma.productVariant.findUnique({
      where: { id: variantId },
      select: {
        id: true,
        sku: true,
        stock: true,
        product: { select: { seller: { select: sellerOwnershipSelect } } },
      },
    })

    if (variant === null) throw new NotFoundException('상품 옵션을 찾을 수 없습니다.')

    assertResourceAccess(principal, 'product.read', sellerOwnership(variant.product.seller))

    const limit = query.limit ?? STOCK_LEDGER_DEFAULT_LIMIT
    const [totals, rows] = await Promise.all([
      this.prisma.stockLedger.aggregate({
        where: { variantId },
        _sum: { quantity: true },
        _count: true,
      }),
      this.prisma.stockLedger.findMany({
        where: { variantId, ...(query.cursor === undefined ? {} : { seq: { lt: query.cursor } }) },
        orderBy: { seq: 'desc' },
        // One more than asked for, so that "is there another page" needs no
        // second query and no total count.
        take: limit + 1,
      }),
    ])

    const page = rows.slice(0, limit)

    return {
      variant: {
        variantId: variant.id,
        sku: variant.sku,
        stock: variant.stock,
        ledgerBalance: totals._sum.quantity ?? 0,
        entryCount: totals._count,
      },
      entries: page.map(toEntry),
      nextCursor: rows.length > limit ? (page.at(-1)?.seq ?? null) : null,
    }
  }

  /**
   * Every variant whose ledger does not explain its stock.
   *
   * The four statements of TASK-0036 4.1, in one pass. A window function walks
   * each variant's history in `seq` order and counts the rows whose
   * `balanceAfter` is not the previous one plus their own quantity, so the
   * answer says **which** rule broke — a reconciliation that only reports a
   * number being off cannot tell a lost update from a deleted row.
   *
   * A method rather than a script: a `scripts/*.mjs` copy of this query would be
   * a second implementation that no test runs, and the one nobody runs is the
   * one that ends up in production (TASK-0036 4.11). M15's consistency batch and
   * the specs both call this.
   */
  async reconcile(): Promise<readonly StockDiscrepancy[]> {
    const audits = await this.prisma.$queryRaw<
      readonly (LedgerAudit & { readonly variantId: string })[]
    >`
      SELECT v."id" AS "variantId",
             v."stock",
             COALESCE(l."entries", 0)          AS "entries",
             COALESCE(l."sum", 0)              AS "sum",
             COALESCE(l."lastBalanceAfter", 0) AS "lastBalanceAfter",
             COALESCE(l."maxSeq", 0)           AS "maxSeq",
             COALESCE(l."chainBreaks", 0)      AS "chainBreaks"
        FROM "ProductVariant" v
        LEFT JOIN LATERAL (
          SELECT count(*)::int                                      AS "entries",
                 COALESCE(sum(e."quantity"), 0)::int                AS "sum",
                 max(e."seq")::int                                  AS "maxSeq",
                 COALESCE(max(e."balanceAfter")
                          FILTER (WHERE e."seq" = e."lastSeq"), 0)::int AS "lastBalanceAfter",
                 count(*) FILTER (WHERE e."balanceAfter" <> e."expected")::int AS "chainBreaks"
            FROM (
              SELECT s."seq",
                     s."quantity",
                     s."balanceAfter",
                     COALESCE(lag(s."balanceAfter") OVER (ORDER BY s."seq"), 0) + s."quantity"
                       AS "expected",
                     max(s."seq") OVER () AS "lastSeq"
                FROM "StockLedger" s
               WHERE s."variantId" = v."id"
            ) e
        ) l ON TRUE
    `

    return audits
      .map((audit) => ({
        variantId: audit.variantId,
        stock: audit.stock,
        ledgerBalance: audit.sum,
        faults: reconciliationFaults(audit),
      }))
      .filter((row) => row.faults.length > 0)
  }

  // ------------------------------------------------------------- internals

  /**
   * Takes the variant's row lock, and nothing else.
   *
   * Deleted variants are locked like any other: a sale recorded against a
   * retired listing still has to reach the ledger, and hiding the row here
   * would leave the movement with nowhere to go. Which variants a caller may
   * *see* is decided by ownership, above.
   */
  private async lockVariant(tx: Tx, variantId: string): Promise<void> {
    const rows = await tx.$queryRaw<readonly { readonly id: string }[]>`
      SELECT "id" FROM "ProductVariant" WHERE "id" = ${variantId}::uuid FOR UPDATE
    `

    if (rows.length === 0) throw new NotFoundException('상품 옵션을 찾을 수 없습니다.')
  }

  /** The stock and the last position, read under the lock in a fresh snapshot. */
  private async readState(tx: Tx, variantId: string): Promise<VariantState> {
    const rows = await tx.$queryRaw<readonly VariantState[]>`
      SELECT v."stock",
             COALESCE((SELECT max(l."seq") FROM "StockLedger" l
                        WHERE l."variantId" = v."id"), 0)::int AS "lastSeq"
        FROM "ProductVariant" v
       WHERE v."id" = ${variantId}::uuid
    `
    const [row] = rows

    if (row === undefined) throw new NotFoundException('상품 옵션을 찾을 수 없습니다.')

    return row
  }

  /**
   * Writes the movement and the level it produced, in that order.
   *
   * `stock` is set **to** `balanceAfter` rather than adjusted towards it, so the
   * column and the row can never disagree by arithmetic — only by somebody
   * writing the column outside this file, which is what the single-path spec is
   * for.
   */
  private async record(
    tx: Tx,
    movement: StockMovement,
    draft: MovementDraft,
    position: { readonly seq: number; readonly balance: number },
  ): Promise<StockLedgerEntry> {
    const now = this.clock.now()

    await tx.$executeRaw`
      UPDATE "ProductVariant"
         SET "stock" = ${position.balance}, "updatedAt" = ${this.nowSql()}
       WHERE "id" = ${movement.variantId}::uuid
    `

    try {
      const entry = await tx.stockLedger.create({
        data: {
          variantId: movement.variantId,
          seq: position.seq,
          type: draft.type,
          quantity: draft.quantity,
          balanceAfter: position.balance,
          refType: draft.refType,
          refId: draft.refId,
          reason: draft.reason,
          actorId: movement.actorId ?? null,
          createdAt: now,
        },
      })

      return toEntry(entry)
    } catch (error) {
      throw duplicateOrRethrow(error)
    }
  }

  /**
   * The injected instant, as a value PostgreSQL stores the way Prisma does.
   *
   * The cast is not decoration — `pg` serialises a `Date` with the local UTC
   * offset, and casting that straight to `timestamp` would store local
   * wall-clock time (the same method on `ProductService`).
   */
  private nowSql(): Prisma.Sql {
    return Prisma.sql`${this.clock.now().toISOString()}::timestamptz AT TIME ZONE 'UTC'`
  }
}

/** Every optional resolved, so the rules never have to ask "was it omitted?". */
function normalise(movement: StockMovement): MovementDraft {
  return {
    type: movement.type,
    quantity: movement.quantity,
    refType: movement.refType ?? null,
    refId: movement.refId ?? null,
    reason: movement.reason ?? null,
  }
}

/** A 400 that names every input the movement got wrong. */
function refusal(issues: readonly MovementIssue[]): BadRequestException {
  return new BadRequestException({
    message: issues.map((issue) => ({
      field: issue.field,
      message: ISSUE_MESSAGE[issue.code],
      code: 'INVALID',
    })),
  })
}

/**
 * Turns the index's refusal into an answer, or re-throws.
 *
 * `StockLedger_ref_key` is what makes a retried order movement unrecordable —
 * a check would let two concurrent retries both find nothing. The 409 names
 * `refId` because that is the input a caller can look at; the movement it
 * refers to is already in the ledger.
 */
function duplicateOrRethrow(error: unknown): unknown {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return error

  if (error.code === 'P2002' && violatedIndexOf(error) === REF_INDEX) {
    return new ConflictException({
      message: [{ field: 'refId', message: '이미 처리된 재고 변동이에요.' }],
    })
  }

  return error
}

/**
 * The index a unique violation names, as the driver adapter reports it.
 *
 * `meta.target` is empty here: Prisma only fills it for indexes declared in the
 * schema language, and this one is **partial**, so it lives in the migration
 * (TASK-0036 4.4). The adapter still carries the database's own answer, which
 * is what is read — the same route `ProductService.sqlStateOf` takes to the
 * SQLSTATE, and for the same reason: matching on the message would break the
 * first time a locale or a version changed it.
 */
function violatedIndexOf(error: Prisma.PrismaClientKnownRequestError): string | undefined {
  const index = (
    error.meta as
      { driverAdapterError?: { cause?: { constraint?: { index?: unknown } } } } | undefined
  )?.driverAdapterError?.cause?.constraint?.index

  return typeof index === 'string' ? index : undefined
}

/** The stored row, in the shape `@shopping/shared` declares. */
function toEntry(row: {
  seq: number
  type: StockLedgerType
  quantity: number
  balanceAfter: number
  refType: StockRefType | null
  refId: string | null
  reason: string | null
  actorId: string | null
  createdAt: Date
}): StockLedgerEntry {
  return {
    seq: row.seq,
    type: row.type,
    quantity: row.quantity,
    balanceAfter: row.balanceAfter,
    refType: row.refType,
    refId: row.refId,
    reason: row.reason,
    actorId: row.actorId,
    createdAt: row.createdAt.toISOString(),
  }
}
