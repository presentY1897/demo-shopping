ALTER TABLE "ProductImage" ADD COLUMN "thumbnailUrl" TEXT, ADD COLUMN "cardImageUrl" TEXT;
CREATE TABLE "ProductImageDerivative" (
 "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "sellerId" UUID NOT NULL, "sourceUrl" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'PENDING', "attempts" INTEGER NOT NULL DEFAULT 0,
 "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "leaseUntil" TIMESTAMP(3), "token" UUID,
 "thumbnailUrl" TEXT, "cardImageUrl" TEXT, "metadata" JSONB,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "ProductImageDerivative_status_check" CHECK ("status" IN ('PENDING','PROCESSING','READY','FAILED'))
);
CREATE UNIQUE INDEX "ProductImageDerivative_sellerId_sourceUrl_key" ON "ProductImageDerivative"("sellerId", "sourceUrl");
CREATE INDEX "ProductImageDerivative_status_nextAttemptAt_idx" ON "ProductImageDerivative"("status", "nextAttemptAt");
CREATE TABLE "ThumbnailPool" ("id" INTEGER PRIMARY KEY CHECK ("id" = 1), "token" UUID, "leaseUntil" TIMESTAMP(3));
INSERT INTO "ThumbnailPool"("id") VALUES (1);
CREATE FUNCTION enqueue_product_thumbnail() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."url" !~ '/products/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpeg|jpg|png|webp)$' THEN
   RETURN NEW;
 END IF;
 INSERT INTO "ProductImageDerivative" ("sellerId", "sourceUrl")
 SELECT p."sellerId", NEW."url" FROM "Product" p WHERE p."id" = NEW."productId"
 ON CONFLICT ("sellerId", "sourceUrl") DO NOTHING;
 SELECT d."thumbnailUrl", d."cardImageUrl" INTO NEW."thumbnailUrl", NEW."cardImageUrl"
 FROM "ProductImageDerivative" d JOIN "Product" p ON p."sellerId" = d."sellerId"
 WHERE p."id" = NEW."productId" AND d."sourceUrl" = NEW."url" AND d."status" = 'READY';
 RETURN NEW;
END $$;
CREATE TRIGGER enqueue_product_thumbnail BEFORE INSERT ON "ProductImage"
 FOR EACH ROW EXECUTE FUNCTION enqueue_product_thumbnail();
