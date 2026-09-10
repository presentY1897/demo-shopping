ALTER TABLE "StockReservation" ADD COLUMN "sourceCartItemId" UUID, ADD COLUMN "sourceCartUpdatedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "cartCleanedAt" TIMESTAMP(3);
