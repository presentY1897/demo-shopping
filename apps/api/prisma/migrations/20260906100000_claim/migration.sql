-- 클레임 — 취소 · 반품 (TASK-0065 · `docs/design/state-machines.md` 4장).
--
-- 이 마이그레이션이 실제로 지키는 것은 하나다: **동시에 들어온 두 신청이 항목의
-- 남은 수량을 넘지 못한다.** 애플리케이션은 조건부 갱신 한 문장으로 그것을 막지만
-- (`claim.service.ts`), 잠금이든 조건부 갱신이든 **그것을 안 쓰는 코드가 하나
-- 생기는 날 조용히 넘친다.** 그래서 마지막 방어선이 아래
-- `OrderItem_claimedQuantity_check` 이고, `Payment_canceledAmount_check` 이 같은
-- 이유로 같은 모양이다 — 돈과 수량이 걸린 자리에서 방어선이 하나뿐이면 안 된다.
--
-- 생성물에서 이 변경과 무관한 둘을 뺐다.
--   * `Category_path_idx` 의 DROP + CREATE (`text_pattern_ops` 를 Prisma 가 모른다)
--   * `SellerOrder_trackingNumber_shipment_fkey` 의 DROP — 손으로 붙인 복합
--     외래키라 Prisma 가 모르고(PSL 로 두 열짜리 참조를 적을 수 없다), 지우면
--     「발송했는데 운송장이 없다」를 막던 제약이 조용히 사라진다 (TASK-0061).

-- CreateEnum
CREATE TYPE "ClaimType" AS ENUM ('CANCEL', 'RETURN');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('CANCEL_REQUESTED', 'CANCEL_APPROVED', 'CANCEL_REJECTED', 'RETURN_REQUESTED', 'RETURN_APPROVED', 'PICKING_UP', 'INSPECTING', 'RETURN_COMPLETED', 'RETURN_REJECTED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "ClaimFault" AS ENUM ('CUSTOMER', 'SELLER');

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "claimedQuantity" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ClaimRequest" (
    "id" UUID NOT NULL,
    "sellerOrderId" UUID NOT NULL,
    "type" "ClaimType" NOT NULL,
    "status" "ClaimStatus" NOT NULL,
    "reason" TEXT NOT NULL,
    "fault" "ClaimFault" NOT NULL,
    "requestedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClaimRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaimItem" (
    "id" UUID NOT NULL,
    "claimId" UUID NOT NULL,
    "orderItemId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "refundAmount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClaimItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaimStatusHistory" (
    "id" UUID NOT NULL,
    "claimId" UUID NOT NULL,
    "fromStatus" "ClaimStatus",
    "toStatus" "ClaimStatus" NOT NULL,
    "reason" TEXT,
    "actor" "OrderActor" NOT NULL,
    "actorId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClaimStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClaimRequest_sellerOrderId_createdAt_idx" ON "ClaimRequest"("sellerOrderId", "createdAt");

-- CreateIndex
CREATE INDEX "ClaimRequest_status_createdAt_idx" ON "ClaimRequest"("status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ClaimRequest_requestedById_createdAt_idx" ON "ClaimRequest"("requestedById", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ClaimItem_orderItemId_idx" ON "ClaimItem"("orderItemId");

-- CreateIndex
CREATE UNIQUE INDEX "ClaimItem_claimId_orderItemId_key" ON "ClaimItem"("claimId", "orderItemId");

-- CreateIndex
CREATE INDEX "ClaimStatusHistory_claimId_createdAt_idx" ON "ClaimStatusHistory"("claimId", "createdAt");

-- AddForeignKey
ALTER TABLE "ClaimRequest" ADD CONSTRAINT "ClaimRequest_sellerOrderId_fkey" FOREIGN KEY ("sellerOrderId") REFERENCES "SellerOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimRequest" ADD CONSTRAINT "ClaimRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimItem" ADD CONSTRAINT "ClaimItem_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "ClaimRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimItem" ADD CONSTRAINT "ClaimItem_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimStatusHistory" ADD CONSTRAINT "ClaimStatusHistory_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "ClaimRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 신청 수량은 0보다 커야 한다. 0개짜리 신청은 신청이 아니고, 그런 줄이 생기면
-- 「이 신청이 몇 개를 잡고 있나」가 항목마다 다른 뜻을 갖는다.
ALTER TABLE "ClaimItem" ADD CONSTRAINT "ClaimItem_quantity_check"
  CHECK ("quantity" > 0);

-- 환불액의 하한. **이 TASK 는 이 값을 계산하지 않는다** (TASK-0068) — 그래서 지금
-- 모든 행이 0 이고, 이 줄이 지키는 것은 나중에 계산이 붙을 때다. 계산이 틀리는
-- 방식은 「조금 다른 값」이 아니라 **음수**이고, 음수 환불은 「환불」이라는 이름으로
-- 돈을 받는 일이 된다 (`Refund_amount_check` 과 같은 판단).
ALTER TABLE "ClaimItem" ADD CONSTRAINT "ClaimItem_refundAmount_check"
  CHECK ("refundAmount" >= 0);

-- 사유는 비어 있을 수 없다. 판매자가 승인·거절을 판단하는 근거가 이 한 줄이고,
-- 빈 문자열은 근거가 아니라 빈 칸이다.
ALTER TABLE "ClaimRequest" ADD CONSTRAINT "ClaimRequest_reason_check"
  CHECK (btrim("reason") <> '');

-- **유형과 상태의 짝** (설계서 4장의 두 경로).
--
-- 전이표(`claim-rules.ts`)가 취소에서 반품 상태로 가는 화살표를 정의하지 않지만,
-- 그것은 전이를 지나는 코드에만 적용되는 규칙이다. 상태를 직접 쓰는 코드가 하나
-- 생기면 `type = CANCEL` 인데 `status = INSPECTING` 인 행이 태어나고, 그런 행은
-- 아무 화면도 그릴 수 없으면서 어떤 오류도 내지 않는다.
--
-- `REFUNDED` 만 양쪽에 있다. 환불은 두 경로가 만나는 유일한 자리다.
ALTER TABLE "ClaimRequest" ADD CONSTRAINT "ClaimRequest_type_status_check"
  CHECK (
    ("type" = 'CANCEL' AND "status" IN ('CANCEL_REQUESTED', 'CANCEL_APPROVED', 'CANCEL_REJECTED', 'REFUNDED'))
    OR
    ("type" = 'RETURN' AND "status" IN ('RETURN_REQUESTED', 'RETURN_APPROVED', 'PICKING_UP', 'INSPECTING', 'RETURN_COMPLETED', 'RETURN_REJECTED', 'REFUNDED'))
  );

-- 같은 상태로 옮긴 이력은 없다. 문이 멱등이라(이미 목표 상태면 아무 일도 하지
-- 않는다) 그런 줄은 생길 수 없고, 생겼다면 그것은 문을 지나지 않은 쓰기다.
ALTER TABLE "ClaimStatusHistory" ADD CONSTRAINT "ClaimStatusHistory_transition_check"
  CHECK ("fromStatus" IS NULL OR "fromStatus" <> "toStatus");

-- **이 TASK 의 마지막 방어선이다** (R1).
--
-- 살아 있는 클레임이 잡고 있는 수량은 음수가 될 수 없고, 주문한 수량을 넘을 수
-- 없다. 애플리케이션은 `UPDATE … WHERE "quantity" - "claimedQuantity" >= $q` 한
-- 문장으로 이미 막지만 — 판단과 갱신이 같은 문장이라 「읽고 판단하고 쓰는」 사이가
-- 비지 않는다 — **그 문장을 안 지나는 쓰기가 하나 생기는 날** 초과분은 조용히
-- 넘친다. 그때 증상은 오류가 아니라 「주문한 것보다 많이 환불된 주문」이고,
-- 그것은 장부를 맞춰 볼 때가 되어서야 보인다.
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_claimedQuantity_check"
  CHECK ("claimedQuantity" >= 0 AND "claimedQuantity" <= "quantity");
