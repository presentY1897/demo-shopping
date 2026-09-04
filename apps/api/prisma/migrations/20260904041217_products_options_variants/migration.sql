-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE', 'SUSPENDED');

-- CreateTable
CREATE TABLE "Product" (
    "id" UUID NOT NULL,
    "sellerId" UUID NOT NULL,
    "categoryId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "ProductStatus" NOT NULL DEFAULT 'DRAFT',
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "maxPurchaseQuantity" INTEGER,
    "minPrice" INTEGER,
    "ratingAvg" INTEGER NOT NULL DEFAULT 0,
    "ratingCount" INTEGER NOT NULL DEFAULT 0,
    "salesCount" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductImage" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "alt" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductOption" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductOptionValue" (
    "id" UUID NOT NULL,
    "optionId" UUID NOT NULL,
    "value" TEXT NOT NULL,
    "meta" JSONB,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductOptionValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductVariant" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "sellerId" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "listPrice" INTEGER,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "maxPurchaseQuantity" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "optionSignature" TEXT NOT NULL DEFAULT '',
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VariantOptionValue" (
    "variantId" UUID NOT NULL,
    "optionValueId" UUID NOT NULL,
    "optionId" UUID NOT NULL,
    "productId" UUID NOT NULL,

    CONSTRAINT "VariantOptionValue_pkey" PRIMARY KEY ("variantId","optionValueId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Product_id_sellerId_key" ON "Product"("id", "sellerId");

-- CreateIndex
CREATE INDEX "ProductImage_productId_sortOrder_idx" ON "ProductImage"("productId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "ProductOption_id_productId_key" ON "ProductOption"("id", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductOptionValue_id_optionId_key" ON "ProductOptionValue"("id", "optionId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_id_productId_key" ON "ProductVariant"("id", "productId");

-- CreateIndex
CREATE INDEX "VariantOptionValue_optionValueId_idx" ON "VariantOptionValue"("optionValueId");

-- CreateIndex
CREATE UNIQUE INDEX "VariantOptionValue_variantId_optionId_key" ON "VariantOptionValue"("variantId", "optionId");


-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "Seller"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductImage" ADD CONSTRAINT "ProductImage_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductOption" ADD CONSTRAINT "ProductOption_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductOptionValue" ADD CONSTRAINT "ProductOptionValue_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "ProductOption"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_productId_sellerId_fkey" FOREIGN KEY ("productId", "sellerId") REFERENCES "Product"("id", "sellerId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VariantOptionValue" ADD CONSTRAINT "VariantOptionValue_variantId_productId_fkey" FOREIGN KEY ("variantId", "productId") REFERENCES "ProductVariant"("id", "productId") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "VariantOptionValue" ADD CONSTRAINT "VariantOptionValue_optionId_productId_fkey" FOREIGN KEY ("optionId", "productId") REFERENCES "ProductOption"("id", "productId") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "VariantOptionValue" ADD CONSTRAINT "VariantOptionValue_optionValueId_optionId_fkey" FOREIGN KEY ("optionValueId", "optionId") REFERENCES "ProductOptionValue"("id", "optionId") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- ---------------------------------------------------------------------------
-- Constraints and indexes Prisma's schema language cannot express (TASK-0032 4.12).
--
-- Two kinds live here.
--
-- **Partial indexes.** Everything in this model is retired with `deletedAt`
-- rather than removed, because an order item points at a variant forever. A
-- plain unique index would therefore let a withdrawn SKU — or a deleted option
-- value's name — be held hostage by a row nobody can see any more, exactly as a
-- plain index on `User.googleSub` would burn a Google account on withdrawal.
-- The same predicate makes them the right index for the *read* paths too, which
-- is why no plain `(sellerId, status)` or `(productId, ...)` index is declared
-- alongside: two indexes on one leading column cost every write and serve no
-- read the other cannot (TASK-0030, where `(categoryId, sortOrder)` was removed
-- for this reason).
--
-- **CHECK constraints.** Money, quantities and the rating pair. Each of them is
-- also checked by `ProductService`, which is what turns a violation into a 400
-- naming the field; the constraint is what makes the rule true for the import
-- script and the psql session that never call the service.
--
-- `migrate diff` ignores both kinds, so a later `migrate dev` will not try to
-- drop them.
-- ---------------------------------------------------------------------------

-- One live SKU per seller.
--
-- Per seller, not globally: two stores each naming a variant `TSHIRT-BLACK-M`
-- is a coincidence. Per seller and not per product, because a SKU that repeats
-- across a store's own catalogue is exactly the mix-up a stock keeping unit
-- exists to prevent — and `ProductVariant.sellerId` can be trusted for this
-- because `ProductVariant_productId_sellerId_fkey` ties it to the product's own
-- seller.
CREATE UNIQUE INDEX "ProductVariant_seller_sku_key"
  ON "ProductVariant" ("sellerId", "sku") WHERE "deletedAt" IS NULL;

-- One live variant per combination.
--
-- `optionSignature` is the option value ids, sorted and joined — so this index
-- is what makes a duplicate combination unrepresentable rather than merely
-- refused by a check two concurrent writers can both pass. Two variants of one
-- combination is not a cosmetic problem: the storefront resolves a buyer's
-- choice to a variant, and two matching rows mean the price shown depends on
-- which one the planner returned first.
--
-- It also carries "옵션 없는 상품도 Variant 1개" (DECISIONS 3): an optionless
-- product's signature is the empty string, which is a value like any other, so
-- a second variant on such a product violates this index.
CREATE UNIQUE INDEX "ProductVariant_product_signature_key"
  ON "ProductVariant" ("productId", "optionSignature") WHERE "deletedAt" IS NULL;

-- One live option of a given name per product, and one live value per option.
--
-- Partial for the reason above: a retired 색상 axis must not stop the seller
-- from adding 색상 again. These are also the indexes that serve "this product's
-- live options" and "this option's live values".
CREATE UNIQUE INDEX "ProductOption_product_name_key"
  ON "ProductOption" ("productId", "name") WHERE "deletedAt" IS NULL;

CREATE UNIQUE INDEX "ProductOptionValue_option_value_key"
  ON "ProductOptionValue" ("optionId", "value") WHERE "deletedAt" IS NULL;

-- The seller console's product list: `sellerId = ? [AND status = ?]`, live rows.
CREATE INDEX "Product_seller_live_idx"
  ON "Product" ("sellerId", "status") WHERE "deletedAt" IS NULL;

-- The category tree's `productCount` (`categoryId = ?`) and the storefront's
-- category listing (`categoryId = ? AND status = 'ACTIVE'`). One index, because
-- the first is a prefix of the second.
CREATE INDEX "Product_category_live_idx"
  ON "Product" ("categoryId", "status") WHERE "deletedAt" IS NULL;

-- A listing needs a name a person can read.
ALTER TABLE "Product" ADD CONSTRAINT "Product_name_check"
  CHECK (btrim("name") <> '');

-- `attributes` is an object, not an array and not a scalar.
--
-- The database cannot check a single attribute *value* — that is the price of
-- storing them as JSONB, and `AttributeService.validateAttributes` is what pays
-- it (TASK-0030). What it can still say is that the bag is a bag: a `jsonb`
-- column accepts `[]` and `"소재"` just as readily as `{}`, and every reader
-- would otherwise have to guard against a shape no writer meant to produce.
ALTER TABLE "Product" ADD CONSTRAINT "Product_attributes_object_check"
  CHECK (jsonb_typeof("attributes") = 'object');

-- Money is a non-negative integer count of won (CLAUDE.md 6장).
ALTER TABLE "Product" ADD CONSTRAINT "Product_minPrice_check"
  CHECK ("minPrice" IS NULL OR "minPrice" >= 0);

-- A listing on sale has a price.
--
-- `minPrice` is NULL exactly when no variant can be ordered, so without this a
-- product could sit in `ACTIVE` with nothing buyable behind it — a card in the
-- storefront grid with an empty price and a detail page that cannot be added to
-- a basket. `ProductService` refuses it first with a sentence; this is what
-- makes the rule true for every other writer.
--
-- It is also why a product is inserted as `DRAFT` and moved to its requested
-- status by the same statement that computes `minPrice`: at no point does a row
-- exist that this constraint would have to be relaxed for.
ALTER TABLE "Product" ADD CONSTRAINT "Product_active_price_check"
  CHECK ("status" <> 'ACTIVE' OR "minPrice" IS NOT NULL);

-- The rating pair (TASK-0032 4.6). `ratingAvg` is the average times 100, so
-- five stars is 500 — an integer, because this schema has no floating point
-- column and a rating is not the place to introduce the first one.
--
-- The third clause is the one worth stating: with no reviews the average is not
-- "0 stars", it is absent, and letting the two columns disagree would make "이
-- 상품에 리뷰가 있나" answerable two ways.
ALTER TABLE "Product" ADD CONSTRAINT "Product_rating_check"
  CHECK (
    "ratingCount" >= 0
    AND "ratingAvg" BETWEEN 0 AND 500
    AND ("ratingCount" > 0 OR "ratingAvg" = 0)
  );

ALTER TABLE "Product" ADD CONSTRAINT "Product_salesCount_check"
  CHECK ("salesCount" >= 0);

-- A cap of zero is not a cap, it is a product nobody may order. NULL is the way
-- to say "no limit" (TASK-0032 4.1).
ALTER TABLE "Product" ADD CONSTRAINT "Product_maxPurchaseQuantity_check"
  CHECK ("maxPurchaseQuantity" IS NULL OR "maxPurchaseQuantity" >= 1);

ALTER TABLE "ProductImage" ADD CONSTRAINT "ProductImage_url_check"
  CHECK (btrim("url") <> '');

ALTER TABLE "ProductImage" ADD CONSTRAINT "ProductImage_sortOrder_check"
  CHECK ("sortOrder" >= 0);

ALTER TABLE "ProductOption" ADD CONSTRAINT "ProductOption_name_check"
  CHECK (btrim("name") <> '');

ALTER TABLE "ProductOption" ADD CONSTRAINT "ProductOption_sortOrder_check"
  CHECK ("sortOrder" >= 0);

ALTER TABLE "ProductOptionValue" ADD CONSTRAINT "ProductOptionValue_value_check"
  CHECK (btrim("value") <> '');

ALTER TABLE "ProductOptionValue" ADD CONSTRAINT "ProductOptionValue_sortOrder_check"
  CHECK ("sortOrder" >= 0);

-- `meta` carries presentation extras keyed by name — a colour chip's hex, a
-- size chart's measurements. Same reasoning as `Product.attributes`.
ALTER TABLE "ProductOptionValue" ADD CONSTRAINT "ProductOptionValue_meta_object_check"
  CHECK ("meta" IS NULL OR jsonb_typeof("meta") = 'object');

-- A SKU is an identifier: it is typed into a spreadsheet, printed on a label
-- and pasted into a URL. Letting it carry a slash or a newline turns a stock
-- export into something no importer can read back.
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_sku_format_check"
  CHECK ("sku" ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$');

ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_price_check"
  CHECK ("price" >= 0);

-- The struck-through price is at or above the selling price. A `listPrice`
-- below `price` is a negative discount, which every storefront renders as a
-- positive one with the sign quietly dropped.
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_list_price_check"
  CHECK ("listPrice" IS NULL OR "listPrice" >= "price");

-- Stock never goes negative.
--
-- The reservation path (TASK-0048) guards it with a conditional update
-- (`UPDATE ... WHERE stock - reserved >= qty`) and this is the backstop under
-- it: an admin adjustment, a refund's restock or an import that gets the sign
-- wrong all reach this column without going through that statement.
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_stock_check"
  CHECK ("stock" >= 0);

ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_maxPurchaseQuantity_check"
  CHECK ("maxPurchaseQuantity" IS NULL OR "maxPurchaseQuantity" >= 1);
