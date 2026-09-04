-- CreateEnum
CREATE TYPE "StockLedgerType" AS ENUM ('INBOUND', 'SALE', 'CANCEL', 'RETURN_IN', 'RESERVE_CONFIRM', 'ADJUST');

-- CreateEnum
CREATE TYPE "StockRefType" AS ENUM ('ORDER_ITEM', 'STOCK_RESERVATION', 'CLAIM_ITEM');

-- CreateTable
CREATE TABLE "StockLedger" (
    "variantId" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "type" "StockLedgerType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "refType" "StockRefType",
    "refId" UUID,
    "reason" TEXT,
    "actorId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockLedger_pkey" PRIMARY KEY ("variantId","seq")
);

-- AddForeignKey
ALTER TABLE "StockLedger" ADD CONSTRAINT "StockLedger_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLedger" ADD CONSTRAINT "StockLedger_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Constraints, indexes and the trigger Prisma's schema language cannot express
-- (TASK-0036 4.12).
--
-- Three kinds live here.
--
-- **CHECK constraints.** The sign a type implies, the pairing of a reference,
-- the reason an adjustment owes. Each is also checked by `StockService`, which
-- is what turns a violation into an answer naming the field; the constraint is
-- what makes the rule true for the import script and the psql session that
-- never call the service.
--
-- **A partial unique index.** "The same movement is recorded once" is a rule two
-- concurrent writers can both pass as a check and only an index can hold. It is
-- partial because a movement with no reference — a seller's inbound, an
-- operator's adjustment — repeats legitimately: doing "+5 입고" twice is two
-- receipts, not a duplicate.
--
-- **A trigger.** The one rule whose subject is an *action* rather than a value:
-- a ledger row is never edited and never removed. A mistaken movement is offset
-- by an opposite `ADJUST`, so that who reversed what stays in the ledger too
-- (TASK-0036 4.5). `TRUNCATE` does not fire row triggers, so the test harness's
-- isolation (worker database + TRUNCATE) is unaffected.
--
-- `migrate diff` models none of the three, so a later `migrate dev` will not try
-- to drop them.
-- ---------------------------------------------------------------------------

-- A movement of nothing is not a movement.
--
-- Separate from the direction check below so that each violation names one
-- rule: a zero quantity fails here whatever the type, and the direction check
-- deliberately says nothing about `ADJUST`'s magnitude.
ALTER TABLE "StockLedger" ADD CONSTRAINT "StockLedger_quantity_check"
  CHECK ("quantity" <> 0);

-- The type decides the sign.
--
-- A `SALE` that adds stock is not a row to be corrected later — it is a row
-- that makes every reader of the ledger wrong, and the readers are a seller's
-- history screen, the reconciliation below and (from M07) the order pipeline.
-- `ADJUST` is the only two-way movement, which is exactly why it is the only
-- one obliged to say why.
ALTER TABLE "StockLedger" ADD CONSTRAINT "StockLedger_direction_check"
  CHECK (
    CASE "type"
      WHEN 'INBOUND'         THEN "quantity" > 0
      WHEN 'CANCEL'          THEN "quantity" > 0
      WHEN 'RETURN_IN'       THEN "quantity" > 0
      WHEN 'SALE'            THEN "quantity" < 0
      WHEN 'RESERVE_CONFIRM' THEN "quantity" < 0
      WHEN 'ADJUST'          THEN TRUE
    END
  );

-- Stock never went negative at any point in history, not merely today.
--
-- `ProductVariant_stock_check` says the same about the current value; this says
-- it about every value the variant ever held, which is the only way a ledger can
-- answer "how much was on hand then" without the answer being impossible.
ALTER TABLE "StockLedger" ADD CONSTRAINT "StockLedger_balance_check"
  CHECK ("balanceAfter" >= 0);

-- Positions start at 1. A row numbered 0 or below would make "seq runs 1..n
-- with no gaps" (L4) uncountable, and L4 is how a row inserted outside the row
-- lock becomes visible.
ALTER TABLE "StockLedger" ADD CONSTRAINT "StockLedger_seq_check"
  CHECK ("seq" >= 1);

-- A reference is both columns or neither.
--
-- Half a reference can be neither followed nor used as an idempotency key: the
-- partial index below keys on `refId`, so a row carrying a `refType` alone would
-- silently opt out of the very rule it looks like it is participating in.
ALTER TABLE "StockLedger" ADD CONSTRAINT "StockLedger_ref_pair_check"
  CHECK (("refType" IS NULL) = ("refId" IS NULL));

-- A stated reason is a real one.
ALTER TABLE "StockLedger" ADD CONSTRAINT "StockLedger_reason_blank_check"
  CHECK ("reason" IS NULL OR btrim("reason") <> '');

-- An adjustment says why.
--
-- Every other type is explained by its own name — a sale, a return, a receipt.
-- An `ADJUST` is a person overriding the count, and an unexplained override is
-- the one movement nobody can audit afterwards.
ALTER TABLE "StockLedger" ADD CONSTRAINT "StockLedger_adjust_reason_check"
  CHECK ("type" <> 'ADJUST' OR "reason" IS NOT NULL);

-- One movement per (variant, type, reference).
--
-- Orders, cancellations and returns are retried paths. A `SALE` recorded twice
-- for one order item takes the stock twice, and nothing in the ledger looks
-- wrong afterwards: both rows are perfectly well formed. Making the second row
-- unrepresentable is the only way to find that out at the moment it happens
-- rather than during a stock count.
--
-- Partial, because a movement with no reference repeats legitimately.
CREATE UNIQUE INDEX "StockLedger_ref_key"
  ON "StockLedger" ("variantId", "type", "refType", "refId") WHERE "refId" IS NOT NULL;

-- The ledger is written once and never rewritten.
--
-- `RESTRICT` semantics (SQLSTATE 23001) with a constraint name, so that a caller
-- reads this refusal exactly as it reads a foreign key's — and so that a spec can
-- assert which rule refused without quoting the sentence.
CREATE FUNCTION "stock_ledger_append_only"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = '23001',
    MESSAGE = '재고 원장은 수정하거나 삭제할 수 없습니다. 반대 방향 ADJUST 로 상쇄하세요.',
    CONSTRAINT = 'StockLedger_append_only',
    TABLE = 'StockLedger';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "StockLedger_append_only"
  BEFORE UPDATE OR DELETE ON "StockLedger"
  FOR EACH ROW EXECUTE FUNCTION "stock_ledger_append_only"();
