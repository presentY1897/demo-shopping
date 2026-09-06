-- 반품 — 신청의 부속 · 수거 · 검수 (TASK-0067 · `docs/design/state-machines.md` 4장).
--
-- 이 마이그레이션이 실제로 지키는 것은 셋이다.
--
--   ① **검수는 결과와 시각이 함께 있거나 함께 없다.** 한쪽만 있는 행은 「검수했는데
--      결과를 모른다」이고, 그런 반품은 환불도 반송도 시작할 수 없다.
--   ② **사진 열쇠는 소유자를 말하는 모양이어야 한다.** 형식이 어긋난 열쇠는
--      아무 화면도 그리지 못하면서 어떤 오류도 내지 않고, 무엇보다 「이 사진이
--      누구 것인가」를 다시 조회로 물어야 하게 만든다.
--   ③ **금액은 음수가 될 수 없다.** 반품비 차감이 음수면 그것은 차감이 아니라
--      지급이고, 원 배송비 환불이 음수면 환불이라는 이름으로 돈을 받는 일이 된다
--      (`ClaimItem_refundAmount_check` 과 같은 판단).
--
-- 손으로 썼다. `prisma migrate dev` 가 이 워크트리의 개발 데이터베이스를 다른
-- 작업과 나눠 쓰는 동안 잠금을 기다려 끝나지 않았고, 생성물에서 어차피 빼야 하는
-- 둘이 늘 같기 때문이다.
--   * `Category_path_idx` 의 DROP + CREATE (`text_pattern_ops` 를 Prisma 가 모른다)
--   * `SellerOrder_trackingNumber_shipment_fkey` 의 DROP — 손으로 붙인 복합
--     외래키라 Prisma 가 모르고(PSL 로 두 열짜리 참조를 적을 수 없다), 지우면
--     「발송했는데 운송장이 없다」를 막던 제약이 조용히 사라진다 (TASK-0061).

-- CreateEnum
CREATE TYPE "ReturnReason" AS ENUM ('CHANGE_OF_MIND', 'DEFECTIVE', 'WRONG_ITEM');

-- CreateEnum
CREATE TYPE "ReturnFeeBearer" AS ENUM ('BUYER', 'SELLER');

-- CreateEnum
CREATE TYPE "ReturnShipmentDirection" AS ENUM ('PICKUP', 'SEND_BACK');

-- CreateTable
CREATE TABLE "ReturnDetail" (
    "claimId" UUID NOT NULL,
    "reason" "ReturnReason" NOT NULL,
    "feeBearer" "ReturnFeeBearer" NOT NULL,
    "returnShippingFee" INTEGER NOT NULL,
    "originalShippingRefund" INTEGER NOT NULL DEFAULT 0,
    "returnShippingDeduction" INTEGER NOT NULL DEFAULT 0,
    "inspectedAt" TIMESTAMP(3),
    "inspectionPassed" BOOLEAN,
    "inspectionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReturnDetail_pkey" PRIMARY KEY ("claimId")
);

-- CreateTable
CREATE TABLE "ReturnPhoto" (
    "id" UUID NOT NULL,
    "claimId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReturnPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnShipment" (
    "id" UUID NOT NULL,
    "claimId" UUID NOT NULL,
    "direction" "ReturnShipmentDirection" NOT NULL,
    "carrierCode" TEXT NOT NULL,
    "carrierName" TEXT NOT NULL,
    "trackingNumber" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReturnShipment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReturnPhoto_claimId_key_key" ON "ReturnPhoto"("claimId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "ReturnPhoto_claimId_position_key" ON "ReturnPhoto"("claimId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "ReturnShipment_trackingNumber_key" ON "ReturnShipment"("trackingNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ReturnShipment_claimId_direction_key" ON "ReturnShipment"("claimId", "direction");

-- AddForeignKey
ALTER TABLE "ReturnDetail" ADD CONSTRAINT "ReturnDetail_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "ClaimRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnPhoto" ADD CONSTRAINT "ReturnPhoto_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "ReturnDetail"("claimId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnShipment" ADD CONSTRAINT "ReturnShipment_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "ReturnDetail"("claimId") ON DELETE CASCADE ON UPDATE CASCADE;

-- 검수의 두 열은 **함께 있거나 함께 없다** (①).
--
-- `Shipment_deliveredAt_check` 이 같은 이유로 같은 모양이다. 한쪽만 채우는 쓰기가
-- 하나 생기면 「검수한 적 있는지」와 「합격인지」가 서로 다른 답을 하게 되고,
-- 그때 환불을 부를지 말지 판단할 수 있는 사람이 아무도 없다.
ALTER TABLE "ReturnDetail" ADD CONSTRAINT "ReturnDetail_inspection_check"
  CHECK (("inspectedAt" IS NULL) = ("inspectionPassed" IS NULL));

-- 검수하지 않은 반품에 불합격 사유가 있을 수 없다. 사유만 남은 행은 「누군가
-- 판단했지만 결과는 안 적혔다」이고, 그것은 ①이 막는 상태와 같은 종류의 거짓이다.
ALTER TABLE "ReturnDetail" ADD CONSTRAINT "ReturnDetail_inspectionNote_check"
  CHECK ("inspectionNote" IS NULL OR "inspectedAt" IS NOT NULL);

-- 금액의 하한 (③).
ALTER TABLE "ReturnDetail" ADD CONSTRAINT "ReturnDetail_amount_check"
  CHECK ("returnShippingFee" >= 0
         AND "originalShippingRefund" >= 0
         AND "returnShippingDeduction" >= 0);

-- **부담자와 금액이 어긋날 수 없다** (`pricing.md` 4장 · `return-rules.ts`).
--
-- 규칙 함수가 이미 짝을 맞춰 내놓지만, 그것은 그 함수를 지나는 코드에만 적용되는
-- 규칙이다. 관리자 도구나 배치가 한 열만 고치는 날 「판매자 부담인데 구매자
-- 환불액에서 반품비가 빠지는」 행이 태어나고, 그 행은 아무 오류도 내지 않으면서
-- 돈을 두 번 가져간다.
ALTER TABLE "ReturnDetail" ADD CONSTRAINT "ReturnDetail_bearer_amount_check"
  CHECK (
    ("feeBearer" = 'BUYER' AND "originalShippingRefund" = 0)
    OR
    ("feeBearer" = 'SELLER' AND "returnShippingDeduction" = 0)
  );

-- 사진 열쇠의 형식 (②) — `returns/{userId}/{objectId}.{ext}`.
--
-- `packages/shared` 의 `returnPhotoKeyPattern` 과 **같은 모양을 세 번째로** 적는다
-- (계약 · 순수 규칙 · 여기). 정규식을 상수에서 조립하지 않는 이유는
-- `shipment-rules.ts` 의 운송장 패턴과 같다 — 자기가 검사할 값과 같은 자리에서 온
-- 패턴은 아무것도 검사하지 못한다.
ALTER TABLE "ReturnPhoto" ADD CONSTRAINT "ReturnPhoto_key_format_check"
  CHECK ("key" ~ '^returns/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpeg|jpg|png|webp)$');

-- 순서는 0부터. 음수 자리는 화면이 그릴 수 없다.
ALTER TABLE "ReturnPhoto" ADD CONSTRAINT "ReturnPhoto_position_check"
  CHECK ("position" >= 0);

-- 운송사 코드는 대문자 두 글자다 (`Shipment_carrierCode_format_check` 과 같은 줄).
-- 길이가 자유로우면 아래 번호 형식이 사실상 검사하지 않는 것이 된다.
ALTER TABLE "ReturnShipment" ADD CONSTRAINT "ReturnShipment_carrierCode_format_check"
  CHECK ("carrierCode" ~ '^[A-Z]{2}$');

-- 회수·반송 운송장도 **가상임이 번호에 드러나야 한다** (TASK-0061 R1).
--
-- `Shipment_trackingNumber_format_check` 과 **글자 하나까지 같은 조건**이다. 접두어가
-- 한 번 빠지면 남는 것은 실제 조회창에 넣어 보는 사람뿐이고, 그 위험은 물건이 가는
-- 방향과 아무 상관이 없다 — 표를 나눈 것이 이 성질까지 나눈다는 뜻은 아니다.
ALTER TABLE "ReturnShipment" ADD CONSTRAINT "ReturnShipment_trackingNumber_format_check"
  CHECK ("trackingNumber" ~ ('^DEMO-' || "carrierCode" || '-[0-9]{12}$'));
