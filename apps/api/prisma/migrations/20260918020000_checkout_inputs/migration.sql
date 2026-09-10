ALTER TABLE "StockReservation" ADD COLUMN "checkoutDraft" JSONB;
ALTER TABLE "Order" ADD COLUMN "deliveryNote" VARCHAR(100);
