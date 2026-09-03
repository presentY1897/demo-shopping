-- CreateEnum
CREATE TYPE "AttributeType" AS ENUM ('TEXT', 'NUMBER', 'SELECT', 'MULTI_SELECT', 'BOOLEAN');

-- CreateTable
CREATE TABLE "AttributeDefinition" (
    "id" SERIAL NOT NULL,
    "categoryId" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" "AttributeType" NOT NULL,
    "options" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "isFilterable" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttributeDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AttributeDefinition_key_idx" ON "AttributeDefinition"("key");

-- AddForeignKey
ALTER TABLE "AttributeDefinition" ADD CONSTRAINT "AttributeDefinition_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Constraints Prisma's schema language cannot express (TASK-0030 4.2).
--
-- The split that makes this table worth having — definitions as rows, values as
-- JSONB on `Product` — costs the database its say over a single value. What is
-- left that it *can* still hold is the shape of the definition itself, and that
-- is what follows. Every rule below is one an application check would lose to a
-- race or to a code path written next year.
--
-- `migrate diff` ignores partial indexes and CHECK constraints, so a later
-- `migrate dev` will not try to drop them.
-- ---------------------------------------------------------------------------

-- One live definition per key within a category.
--
-- Partial rather than plain because deletion is soft: the row stays behind so
-- that a product still carrying the key has something to explain it, and a
-- plain unique index would let a deleted definition hold its key forever.
--
-- This is the half of "no duplicate keys" the database *can* enforce. The other
-- half — the same key on an ancestor or a descendant — needs a lookup in other
-- rows, which a CHECK may not do; `AttributeService` holds it under the tree
-- advisory lock, and `test/db/attribute-lineage-contention.spec.ts` is where
-- that is either true or not.
CREATE UNIQUE INDEX "AttributeDefinition_categoryId_key_active_key"
  ON "AttributeDefinition" ("categoryId", "key") WHERE "deletedAt" IS NULL;

-- The key is an identifier, in two systems at once.
--
-- It is a JSON object key inside `Product.attributes` and a Meilisearch filter
-- field name (M06). A key with a dot, a space or an uppercase letter parses as
-- a path expression on the search side and silently matches nothing — a failure
-- with no error anywhere. Stated here so that no writer, including a future
-- import script that skips the service, can put one in.
ALTER TABLE "AttributeDefinition" ADD CONSTRAINT "AttributeDefinition_key_format_check"
  CHECK ("key" ~ '^[a-z][a-z0-9_]{0,39}$');

-- Options exist exactly for the types that have them.
--
-- Both directions matter. A `SELECT` with no options can never validate any
-- value, so a required one makes every product in that category unsaveable —
-- and the symptom appears at the product form, far from the definition that
-- caused it. Options on a `BOOLEAN` are a definition whose author meant
-- something else and whose choices nothing will ever read.
--
-- `cardinality` rather than `array_length`: `array_length('{}', 1)` is NULL,
-- and `NULL >= 1` is NULL, which a CHECK accepts.
ALTER TABLE "AttributeDefinition" ADD CONSTRAINT "AttributeDefinition_options_check"
  CHECK (
    CASE WHEN "type" IN ('SELECT', 'MULTI_SELECT')
         THEN cardinality("options") >= 1
         ELSE cardinality("options") = 0
    END
  );

-- No blank choice. An empty option is a value a person can pick and nothing can
-- display, and it round-trips through a form as "nothing selected".
ALTER TABLE "AttributeDefinition" ADD CONSTRAINT "AttributeDefinition_option_blank_check"
  CHECK (NOT ('' = ANY ("options")));

-- The label is what a person reads; a blank one makes the form unusable.
ALTER TABLE "AttributeDefinition" ADD CONSTRAINT "AttributeDefinition_label_check"
  CHECK (btrim("label") <> '');

-- Display order is a position, never a negative number (as on `Category`).
ALTER TABLE "AttributeDefinition" ADD CONSTRAINT "AttributeDefinition_sortOrder_check"
  CHECK ("sortOrder" >= 0);
