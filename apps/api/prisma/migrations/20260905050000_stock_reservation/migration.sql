-- 재고 예약 (TASK-0048)
--
-- 오버셀을 **구조적으로** 막는다 (D-026). 담을 때는 잡지 않고 주문서에 들어갈 때
-- 잡는다 — 담고 안 사는 사람 때문에 재고가 잠기면 파는 쪽이 손해다.
--
-- `ProductVariant.reserved` 가 캐시 컬럼이고, 예약 생성은 그 컬럼에 대한 **조건부
-- 갱신**이다. `UPDATE … WHERE stock - reserved >= n` 은 한 문장이라 두 요청이 동시에
-- 통과할 수 없다 — 그것이 이 표의 존재 이유다.
--
-- 생성물에서 이 변경과 무관한 `Category_path_idx` 의 DROP + CREATE 를 뺐다.
-- `@@index([path(ops: raw("text_pattern_ops"))])` 가 Prisma 에서 왕복하지 않아
-- **모든** 새 마이그레이션에 섞인다.

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('HELD', 'CONFIRMED', 'RELEASED');

-- AlterTable
ALTER TABLE "ProductVariant" ADD COLUMN "reserved" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "StockReservation" (
    "id" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "checkoutId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'HELD',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "settledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockReservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
--
-- 만료 스케줄러가 읽는 것 (TASK-0051): 「아직 잡혀 있고 시각이 지난 것」.
CREATE INDEX "StockReservation_status_expiresAt_idx" ON "StockReservation"("status", "expiresAt");

-- CreateIndex
--
-- 「이 주문서 시도의 예약 전부」. 결제 실패와 이탈이 그 모양이다.
CREATE INDEX "StockReservation_checkoutId_idx" ON "StockReservation"("checkoutId");

-- CreateIndex
--
-- 정합성 점검이 읽는 것 (F7): variant 별 HELD 합계.
CREATE INDEX "StockReservation_variantId_status_idx" ON "StockReservation"("variantId", "status");

-- AddForeignKey
--
-- `RESTRICT`: 잡혀 있는 재고를 가진 Variant 는 지워지지 않는다.
ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
--
-- 계정이 사라지면 그 사람의 예약도 사라진다 — 아무도 결제하지 않을 것이다.
ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- PSL 로 표현할 수 없는 것. Prisma 의 드리프트 검사는 CHECK 를 무시한다.
--
-- 0을 잡는 것은 잡지 않는 것이고, 그것은 행이 없는 것으로 표현한다.
ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_quantity_check" CHECK ("quantity" >= 1);

-- 잡혀 있는 수량은 음수일 수 없고, 있는 재고보다 많을 수도 없다.
--
-- **이것이 오버셀의 마지막 방어선이다.** 조건부 갱신이 이미 막지만, 그 문장을
-- 우회하는 경로가 생기는 날 데이터베이스가 거절한다.
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_reserved_check" CHECK ("reserved" >= 0 AND "reserved" <= "stock");
