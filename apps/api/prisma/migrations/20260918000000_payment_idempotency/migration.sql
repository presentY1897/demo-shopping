-- Existing duplicate CHARGE references make this fail explicitly; never delete financial history.
ALTER TABLE "Payment" ADD COLUMN "authorizationStartedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "VirtualCardTransaction_charge_ref_key"
  ON "VirtualCardTransaction" ("refId") WHERE "kind" = 'CHARGE';
