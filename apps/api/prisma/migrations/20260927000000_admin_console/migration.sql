-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "moderatedAt" TIMESTAMP(3),
ADD COLUMN     "moderatedById" UUID,
ADD COLUMN     "moderationReason" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "demoCleanupError" TEXT,
ADD COLUMN     "demoCleanupFailedAt" TIMESTAMP(3),
ADD COLUMN     "suspendedAt" TIMESTAMP(3),
ADD COLUMN     "suspendedReason" TEXT;

-- CreateTable
CREATE TABLE "PersonalDataAccess" (
    "id" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "subjectId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonalDataAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SellerStatusHistory" (
    "id" UUID NOT NULL,
    "sellerId" UUID NOT NULL,
    "fromStatus" "SellerStatus",
    "toStatus" "SellerStatus" NOT NULL,
    "actorId" UUID,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SellerStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DemoPolicy" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "ttlHours" INTEGER NOT NULL DEFAULT 24,
    "seedOrders" INTEGER NOT NULL DEFAULT 3,
    "virtualCardLimit" INTEGER NOT NULL DEFAULT 5000000,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DemoPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PersonalDataAccess_subjectId_createdAt_idx" ON "PersonalDataAccess"("subjectId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "PersonalDataAccess_actorId_createdAt_idx" ON "PersonalDataAccess"("actorId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "SellerStatusHistory_sellerId_createdAt_idx" ON "SellerStatusHistory"("sellerId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "PersonalDataAccess" ADD CONSTRAINT "PersonalDataAccess_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalDataAccess" ADD CONSTRAINT "PersonalDataAccess_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellerStatusHistory" ADD CONSTRAINT "SellerStatusHistory_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "Seller"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellerStatusHistory" ADD CONSTRAINT "SellerStatusHistory_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 마지막 방어선은 DB (CLAUDE.md 3장).

-- 정지에는 언제나 사유가 있다. 사유 없는 정지는 해제할 근거도 없다 (TASK-0093 F4).
ALTER TABLE "User" ADD CONSTRAINT "User_suspended_reason_check"
  CHECK (("suspendedAt" IS NULL) = ("suspendedReason" IS NULL));

-- 데모 정리 실패도 짝이다 — 이유 없는 실패는 화면이 말할 것이 없다 (TASK-0096 F4).
ALTER TABLE "User" ADD CONSTRAINT "User_demo_cleanup_failure_check"
  CHECK (("demoCleanupFailedAt" IS NULL) = ("demoCleanupError" IS NULL));

-- 강제 숨김은 **시각·사유·처리자 셋이 함께** 있거나 셋 다 없다 (TASK-0095 F3).
-- 사유 없이 내려진 상품은 판매자에게 설명할 방법이 없고, 처리자가 없으면 누구에게
-- 물어야 할지도 모른다.
ALTER TABLE "Product" ADD CONSTRAINT "Product_moderation_check"
  CHECK (
    ("moderatedAt" IS NULL AND "moderationReason" IS NULL AND "moderatedById" IS NULL)
    OR ("moderatedAt" IS NOT NULL AND "moderationReason" IS NOT NULL AND "moderatedById" IS NOT NULL)
  );

-- 열람 사유는 비워 둘 수 없다 (TASK-0093 F7). 빈 문자열은 안 적은 것과 같다.
ALTER TABLE "PersonalDataAccess" ADD CONSTRAINT "PersonalDataAccess_reason_check"
  CHECK (length(btrim("reason")) > 0);

-- 자기 자신을 열람 대상으로 적지 않는다. 자기 정보를 보는 것은 감사 대상이 아니고,
-- 섞이면 「이 관리자가 남의 정보를 몇 번 봤나」가 부풀려진다.
ALTER TABLE "PersonalDataAccess" ADD CONSTRAINT "PersonalDataAccess_not_self_check"
  CHECK ("actorId" <> "subjectId");

-- 제자리 전이는 이력이 아니다 (`OrderStatusHistory` 와 같은 판단).
ALTER TABLE "SellerStatusHistory" ADD CONSTRAINT "SellerStatusHistory_moved_check"
  CHECK ("fromStatus" IS NULL OR "fromStatus" <> "toStatus");

-- 한 행짜리 표다 (`PointPolicy` 와 같은 모양).
ALTER TABLE "DemoPolicy" ADD CONSTRAINT "DemoPolicy_singleton_check" CHECK ("id" = 1);

-- 수명이 0이나 음수면 발급되는 즉시 만료된 계정이 나오고, 증상은 「데모가 안 된다」로만
-- 보인다. 위도 막는다 — 30일짜리 데모는 데모가 아니라 계정이다.
ALTER TABLE "DemoPolicy" ADD CONSTRAINT "DemoPolicy_ttl_check"
  CHECK ("ttlHours" BETWEEN 1 AND 720);
ALTER TABLE "DemoPolicy" ADD CONSTRAINT "DemoPolicy_seed_orders_check"
  CHECK ("seedOrders" BETWEEN 0 AND 50);
ALTER TABLE "DemoPolicy" ADD CONSTRAINT "DemoPolicy_card_limit_check"
  CHECK ("virtualCardLimit" BETWEEN 1000 AND 100000000);

-- 정책 행을 심는다. 없으면 첫 발급이 「정책이 없다」로 실패하는데, 그것은 기본값이
-- 있는 상태와 구별되지 않는 사고다.
INSERT INTO "DemoPolicy" ("id", "updatedAt") VALUES (1, now()) ON CONFLICT ("id") DO NOTHING;
