-- 정산 (TASK-0080)
--
-- **이 프로젝트 도메인 설계의 최종 수렴점**이다 (D-032). 쿠폰의 부담 주체, 적립금,
-- 반품 차감, 구매확정이 여기 한 줄로 모인다:
--
--   지급액 = 판매액 − 플랫폼 수수료 − 판매자 부담 쿠폰 − 반품 차감

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('PENDING', 'APPROVED', 'PAID');

-- CreateEnum
CREATE TYPE "SettlementItemType" AS ENUM ('SALE', 'RETURN_ADJUSTMENT');

-- CreateTable
CREATE TABLE "Settlement" (
    "id" UUID NOT NULL,
    "sellerId" UUID NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "status" "SettlementStatus" NOT NULL DEFAULT 'PENDING',
    "salesAmount" INTEGER NOT NULL DEFAULT 0,
    "commissionAmount" INTEGER NOT NULL DEFAULT 0,
    "sellerCouponAmount" INTEGER NOT NULL DEFAULT 0,
    "returnAdjustmentAmount" INTEGER NOT NULL DEFAULT 0,
    "payoutAmount" INTEGER NOT NULL DEFAULT 0,
    "approvedAt" TIMESTAMP(3),
    "approvedById" UUID,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Settlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettlementItem" (
    "id" UUID NOT NULL,
    "settlementId" UUID NOT NULL,
    "type" "SettlementItemType" NOT NULL,
    "sellerOrderId" UUID NOT NULL,
    "salesAmount" INTEGER NOT NULL,
    "commissionAmount" INTEGER NOT NULL,
    "sellerCouponAmount" INTEGER NOT NULL,
    "payoutAmount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SettlementItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Settlement_status_periodStart_idx" ON "Settlement"("status", "periodStart");

-- CreateIndex
CREATE INDEX "Settlement_sellerId_periodStart_idx" ON "Settlement"("sellerId", "periodStart" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Settlement_sellerId_periodStart_key" ON "Settlement"("sellerId", "periodStart");

-- CreateIndex
CREATE INDEX "SettlementItem_settlementId_idx" ON "SettlementItem"("settlementId");

-- CreateIndex
CREATE INDEX "SettlementItem_sellerOrderId_idx" ON "SettlementItem"("sellerOrderId");

-- AddForeignKey
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "Seller"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementItem" ADD CONSTRAINT "SettlementItem_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "Settlement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementItem" ADD CONSTRAINT "SettlementItem_sellerOrderId_fkey" FOREIGN KEY ("sellerOrderId") REFERENCES "SellerOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- **한 판매자 몫은 한 번만 정산된다** (F6).
--
-- 배치가 두 번 돌아도, 두 인스턴스가 동시에 돌아도, 같은 몫이 두 정산서에 들어갈 수
-- 없다. 배치 쪽의 「이미 정산됐나」 조회는 그 일이 **일어나기 전에** 거르는 장치이고,
-- 이 인덱스는 그 조회와 저장 사이에 남이 끼어들었을 때의 마지막 방어선이다 — 지급이
-- 두 번 나가는 것은 되돌릴 수 없다.
--
-- 부분 인덱스인 이유는 차감 줄이 같은 몫을 다시 가리키기 때문이다. 차감은 회차마다
-- 새로 생길 수 있고, 그것을 막는 것은 아래의 다른 인덱스다.
CREATE UNIQUE INDEX "SettlementItem_sale_key"
  ON "SettlementItem"("sellerOrderId") WHERE "type" = 'SALE';

-- **한 회차의 한 몫에 차감 줄은 하나뿐이다.**
--
-- 차감을 「어느 반품 때문인가」로 세지 않는 이유는 한 몫이 나눠서 여러 번 반품될 수
-- 있기 때문이다. 그때 「어느 반품」은 정의되지 않고, 옳은 것은 **이미 정산된 것과
-- 지금 정산돼야 하는 것의 차이** 하나뿐이다 — 그 차이는 한 회차에 한 번만 잰다.
CREATE UNIQUE INDEX "SettlementItem_adjustment_key"
  ON "SettlementItem"("settlementId", "sellerOrderId") WHERE "type" = 'RETURN_ADJUSTMENT';

-- **줄의 지급액은 세 항의 결과다** (F8). 계산해서 넣는 값이지만 저장하는 이유는
-- 읽는 쪽마다 다시 곱하지 않게 하기 위해서이고(`pricing.md` 원칙), 저장한 값이
-- 식과 어긋나지 않는 것은 규율이 아니라 이 제약이 지킨다.
ALTER TABLE "SettlementItem" ADD CONSTRAINT "SettlementItem_payout_check"
  CHECK ("payoutAmount" = "salesAmount" - "commissionAmount" - "sellerCouponAmount");

-- 판매 줄은 0 이상, 차감 줄은 0 이하. 부호를 여기서 못 박아 두면 합계가 **그냥
-- 합**이 되고, 읽는 쪽마다 「이건 빼는 값인가」를 판단하지 않아도 된다.
ALTER TABLE "SettlementItem" ADD CONSTRAINT "SettlementItem_sign_check"
  CHECK (
    ("type" = 'SALE' AND "salesAmount" >= 0 AND "commissionAmount" >= 0
      AND "sellerCouponAmount" >= 0)
    OR ("type" = 'RETURN_ADJUSTMENT' AND "salesAmount" <= 0 AND "commissionAmount" <= 0
      AND "sellerCouponAmount" <= 0)
  );

-- 기간의 끝은 **열려 있다**. 뒤집힌 기간은 아무 주도 아니다.
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_period_check"
  CHECK ("periodStart" < "periodEnd");

-- **정산서의 합계는 그 줄들의 합이어야 한다** (F8). 줄과 합계 사이의 관계는 SQL 로
-- 강제할 수 없지만, 합계 안에서의 관계는 할 수 있다.
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_total_check"
  CHECK (
    "payoutAmount"
      = "salesAmount" - "commissionAmount" - "sellerCouponAmount" + "returnAdjustmentAmount"
    AND "salesAmount" >= 0
    AND "commissionAmount" >= 0
    AND "sellerCouponAmount" >= 0
    AND "returnAdjustmentAmount" <= 0
  );

-- 상태와 시각·사람은 짝이다. 「승인됨인데 누가 언제 승인했는지 모른다」와
-- 「대기 중인데 승인 시각이 있다」는 둘 다 읽는 사람에게 거짓말이다.
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_status_check"
  CHECK (
    ("status" = 'PENDING' AND "approvedAt" IS NULL AND "approvedById" IS NULL
      AND "paidAt" IS NULL)
    OR ("status" = 'APPROVED' AND "approvedAt" IS NOT NULL AND "approvedById" IS NOT NULL
      AND "paidAt" IS NULL)
    OR ("status" = 'PAID' AND "approvedAt" IS NOT NULL AND "approvedById" IS NOT NULL
      AND "paidAt" IS NOT NULL)
  );
