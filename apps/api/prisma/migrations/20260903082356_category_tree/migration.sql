-- CreateTable
CREATE TABLE "Category" (
    "id" SERIAL NOT NULL,
    "parentId" INTEGER,
    "path" TEXT NOT NULL,
    "parentPath" TEXT,
    "depth" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Category_parentId_sortOrder_idx" ON "Category"("parentId", "sortOrder");

-- CreateIndex
CREATE INDEX "Category_path_idx" ON "Category"("path" text_pattern_ops);

-- CreateIndex
CREATE UNIQUE INDEX "Category_id_path_key" ON "Category"("id", "path");

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_parentId_parentPath_fkey" FOREIGN KEY ("parentId", "parentPath") REFERENCES "Category"("id", "path") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- ---------------------------------------------------------------------------
-- Constraints Prisma's schema language cannot express.
--
-- Written by hand for the same reason as the ones in the previous migration:
-- every rule below is a race an application-level check loses. Two requests
-- both read a tree of depth 3, both conclude their move keeps it legal, and
-- both commit. `migrate diff` ignores partial indexes and CHECK constraints, so
-- a later `migrate dev` will not try to drop them.
-- ---------------------------------------------------------------------------

-- The path is exactly the parent's path plus this node's own id.
--
-- This is the constraint that makes the cache trustworthy. Combined with the
-- composite foreign key `(parentId, parentPath) -> (id, path)` it also makes a
-- **cycle unrepresentable**: a node's path is strictly longer than its parent's
-- (it adds at least two characters), so a chain of parents can never return to
-- where it started. Cycle prevention is therefore structural, not a check that
-- some code path might skip.
ALTER TABLE "Category" ADD CONSTRAINT "Category_path_shape_check"
  CHECK ("path" = COALESCE("parentPath", '/') || "id"::text || '/');

-- A node has both halves of its parent edge, or neither.
--
-- Without it a row could carry `parentId = NULL` with a non-empty `parentPath`:
-- the foreign key is MATCH SIMPLE and skips any row with a NULL in the key, so
-- such a row would claim ancestors nobody verified.
ALTER TABLE "Category" ADD CONSTRAINT "Category_parent_pairing_check"
  CHECK (("parentId" IS NULL) = ("parentPath" IS NULL));

-- `depth` is the number of ids in `path` — one more than nothing, one per '/'.
--
-- Kept as a column for ordering and for the range check below, but never
-- allowed to disagree with the path it is derived from.
ALTER TABLE "Category" ADD CONSTRAINT "Category_depth_path_check"
  CHECK ("depth" = length("path") - length(replace("path", '/', '')) - 1);

-- Three levels, no more (TASK-0028 2장).
--
-- In the database and not only in the service because the depth of a moved
-- subtree depends on rows another transaction may be moving at the same time.
-- With the check here, the losing request fails; without it, the tree quietly
-- grows a fourth level that no screen is built to render.
ALTER TABLE "Category" ADD CONSTRAINT "Category_depth_range_check"
  CHECK ("depth" BETWEEN 1 AND 3);

-- Display order is a position, never a negative number.
ALTER TABLE "Category" ADD CONSTRAINT "Category_sortOrder_check"
  CHECK ("sortOrder" >= 0);

-- One live category per slug.
--
-- Partial rather than a plain unique index because deletion is soft: the row
-- stays behind so that old order snapshots keep resolving, and a plain unique
-- index would let a deleted category hold its slug forever.
CREATE UNIQUE INDEX "Category_slug_active_key" ON "Category" ("slug") WHERE "deletedAt" IS NULL;
