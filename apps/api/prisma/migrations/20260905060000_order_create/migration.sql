-- CreateEnum
CREATE TYPE "SellerOrderStatus" AS ENUM ('PAYMENT_PENDING', 'PAYMENT_FAILED', 'PAID', 'PREPARING', 'SHIPPED', 'DELIVERED', 'CONFIRMED', 'CANCELED', 'RETURNED');

-- AlterTable
ALTER TABLE "Seller" ADD COLUMN     "freeShippingThreshold" INTEGER,
ADD COLUMN     "shippingFee" INTEGER NOT NULL DEFAULT 3000;

-- CreateTable
CREATE TABLE "Order" (
    "id" UUID NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "checkoutId" UUID NOT NULL,
    "recipientName" TEXT NOT NULL,
    "recipientPhone" TEXT NOT NULL,
    "postalCode" TEXT NOT NULL,
    "addressLine1" TEXT NOT NULL,
    "addressLine2" TEXT,
    "totalProductAmount" INTEGER NOT NULL,
    "totalCouponDiscountAmount" INTEGER NOT NULL DEFAULT 0,
    "totalPointDiscountAmount" INTEGER NOT NULL DEFAULT 0,
    "totalShippingFee" INTEGER NOT NULL DEFAULT 0,
    "paidAmount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SellerOrder" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "sellerId" UUID NOT NULL,
    "status" "SellerOrderStatus" NOT NULL DEFAULT 'PAYMENT_PENDING',
    "brandName" TEXT NOT NULL,
    "productAmount" INTEGER NOT NULL,
    "couponDiscountAmount" INTEGER NOT NULL DEFAULT 0,
    "pointDiscountAmount" INTEGER NOT NULL DEFAULT 0,
    "shippingPointAmount" INTEGER NOT NULL DEFAULT 0,
    "shippingFee" INTEGER NOT NULL DEFAULT 0,
    "paidAmount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SellerOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" UUID NOT NULL,
    "sellerOrderId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "productSnapshot" JSONB NOT NULL,
    "unitPrice" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "productAmount" INTEGER NOT NULL,
    "couponDiscountAmount" INTEGER NOT NULL DEFAULT 0,
    "pointDiscountAmount" INTEGER NOT NULL DEFAULT 0,
    "discountAmount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderStatusHistory" (
    "id" UUID NOT NULL,
    "sellerOrderId" UUID NOT NULL,
    "fromStatus" "SellerOrderStatus",
    "toStatus" "SellerOrderStatus" NOT NULL,
    "reason" TEXT,
    "actorId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Order_orderNumber_key" ON "Order"("orderNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Order_checkoutId_key" ON "Order"("checkoutId");

-- CreateIndex
CREATE INDEX "Order_userId_createdAt_idx" ON "Order"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "SellerOrder_sellerId_status_createdAt_idx" ON "SellerOrder"("sellerId", "status", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "SellerOrder_orderId_sellerId_key" ON "SellerOrder"("orderId", "sellerId");

-- CreateIndex
CREATE INDEX "OrderItem_variantId_idx" ON "OrderItem"("variantId");

-- CreateIndex
CREATE INDEX "OrderStatusHistory_sellerOrderId_createdAt_idx" ON "OrderStatusHistory"("sellerOrderId", "createdAt");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellerOrder" ADD CONSTRAINT "SellerOrder_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellerOrder" ADD CONSTRAINT "SellerOrder_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "Seller"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_sellerOrderId_fkey" FOREIGN KEY ("sellerOrderId") REFERENCES "SellerOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderStatusHistory" ADD CONSTRAINT "OrderStatusHistory_sellerOrderId_fkey" FOREIGN KEY ("sellerOrderId") REFERENCES "SellerOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 주문번호는 사람이 읽고 전화로 불러 주는 값이다. 형식을 DB 가 지키는 이유는
-- 생성기가 하나가 아니게 되는 날 — 시드, 백필, 다른 서비스 — 형식이 조용히
-- 갈라지기 때문이다. 알파벳은 Crockford base32(I·L·O·U 없음)라 0/O 와 1/I 를
-- 사람이 헷갈리지 않는다.
ALTER TABLE "Order" ADD CONSTRAINT "Order_orderNumber_format_check"
  CHECK ("orderNumber" ~ '^[0-9]{8}-[0-9ABCDEFGHJKMNPQRSTVWXYZ]{8}$');

-- 금액은 음수가 될 수 없다. 계산 엔진이 틀리는 방식은 「조금 다른 값」이 아니라
-- 「음수」이고(TASK-0047 F8 이 실제로 그것을 잡았다), 음수 금액은 환불에서 돈이
-- 나가는 방향으로 나타난다.
ALTER TABLE "Order" ADD CONSTRAINT "Order_amounts_check"
  CHECK ("totalProductAmount" >= 0 AND "totalCouponDiscountAmount" >= 0
     AND "totalPointDiscountAmount" >= 0 AND "totalShippingFee" >= 0
     AND "paidAmount" >= 0);

ALTER TABLE "SellerOrder" ADD CONSTRAINT "SellerOrder_amounts_check"
  CHECK ("productAmount" >= 0 AND "couponDiscountAmount" >= 0
     AND "pointDiscountAmount" >= 0 AND "shippingPointAmount" >= 0
     AND "shippingFee" >= 0 AND "paidAmount" >= 0);

ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_quantity_check"
  CHECK ("quantity" >= 1);

ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_amounts_check"
  CHECK ("unitPrice" >= 0 AND "productAmount" >= 0
     AND "couponDiscountAmount" >= 0 AND "pointDiscountAmount" >= 0);

-- 안분액의 합은 항목이 실제로 받은 할인이다. 두 컬럼을 각각 쓰면서 합계를 따로
-- 적으면 셋이 어긋날 수 있고, 부분 취소는 합계 쪽을 읽는다.
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_discount_sum_check"
  CHECK ("discountAmount" = "couponDiscountAmount" + "pointDiscountAmount");

-- **항목의 할인은 그 항목의 값을 넘을 수 없다.** TASK-0047 F8 이 무작위 1000회로
-- 잡은 결함이 정확히 이 위반이었다 — 적립금이 배송비를 낸 몫까지 항목에 안분돼
-- 부분 취소의 환불액이 음수가 됐다. 그때는 코드로 고쳤고, 여기서는 DB 가 막는다.
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_discount_bound_check"
  CHECK ("discountAmount" <= "productAmount");

-- 배송비와 무료 기준은 음수일 수 없다. `freeShippingThreshold` 의 NULL 은 「무료
-- 조건 없음」이고 0 은 「언제나 무료」다 — 둘 다 유효하다.
ALTER TABLE "Seller" ADD CONSTRAINT "Seller_shipping_check"
  CHECK ("shippingFee" >= 0 AND ("freeShippingThreshold" IS NULL OR "freeShippingThreshold" >= 0));
