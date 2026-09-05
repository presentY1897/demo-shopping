-- 장바구니 (TASK-0045)
--
-- 담는 단위는 Variant 다. 가격과 재고를 들고 있는 것이 Variant 이고, 「검정 M」과
-- 「검정 L」은 다른 물건이다.
--
-- 재고를 예약하지 않는다 (D-026). 담고 안 사는 사람 때문에 재고가 잠기면 파는
-- 쪽이 손해다. 예약은 주문서 진입 시점이고 그것은 TASK-0048 이다.
--
-- 생성물에서 이 변경과 무관한 `Category_path_idx` 의 DROP + CREATE 를 뺐다.
-- `@@index([path(ops: raw("text_pattern_ops"))])` 가 Prisma 에서 왕복하지 않아
-- **모든** 새 마이그레이션에 섞인다. 같은 정의로 다시 만드는 no-op 이고 큰
-- 테이블에서는 잠금이다.

-- CreateTable
CREATE TABLE "Cart" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CartItem" (
    "id" UUID NOT NULL,
    "cartId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "sellerId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "priceAtAdded" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CartItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
--
-- 계정당 장바구니 하나. 애플리케이션의 find-or-create 는 두 요청이 동시에 오면
-- 둘 다 통과한다 — 그때 남는 것은 장바구니 두 개이고 화면은 하나만 보여 준다.
CREATE UNIQUE INDEX "Cart_userId_key" ON "Cart"("userId");

-- CreateIndex
CREATE INDEX "CartItem_cartId_idx" ON "CartItem"("cartId");

-- CreateIndex
--
-- 같은 Variant 를 두 번 담으면 행이 둘이 아니라 수량이 합산된다 (F1). 이것이
-- 없으면 동시에 두 번 담은 사람의 장바구니에 같은 물건이 두 줄로 남는다.
CREATE UNIQUE INDEX "CartItem_cartId_variantId_key" ON "CartItem"("cartId", "variantId");

-- CreateIndex
--
-- `CartItem` 의 복합 외래키가 가리킬 대상. 장바구니 행이 `sellerId` 를 복사해
-- 두는 것은 판매자별 그룹핑(D-023)을 조인 없이 하기 위해서이고, 이 유니크
-- 인덱스가 그 사본을 Variant 자신의 판매자에 묶는다.
CREATE UNIQUE INDEX "ProductVariant_id_sellerId_key" ON "ProductVariant"("id", "sellerId");

-- AddForeignKey
--
-- 계정이 사라지면 장바구니도 사라진다. 남길 이력이 없다 — 주문은 별개의
-- 테이블이고 자기 스냅샷을 갖는다.
ALTER TABLE "Cart" ADD CONSTRAINT "Cart_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "Cart"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
--
-- `RESTRICT`: 팔린 적 있는 Variant 는 소프트 삭제되므로 이 참조가 끊기지 않는다.
-- 남의 장바구니에 든 것을 지우는 일은 판매자가 할 수 있는 일이 아니고, 그것을
-- 데이터베이스가 거절한다.
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_variantId_sellerId_fkey" FOREIGN KEY ("variantId", "sellerId") REFERENCES "ProductVariant"("id", "sellerId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- PSL 로 표현할 수 없는 것 둘. Prisma 의 드리프트 검사는 CHECK 를 무시하므로
-- 나중의 `migrate dev` 가 이것들을 지우지 않는다 (schema.prisma 머리말).
--
-- 수량 0은 「담지 않음」이고 그것은 행이 없는 것으로 표현한다. 음수는 뜻이 없다.
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_quantity_check" CHECK ("quantity" >= 1);

-- 담을 때의 가격. 음수 가격은 상품 쪽에서도 막혀 있다.
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_priceAtAdded_check" CHECK ("priceAtAdded" >= 0);
