-- 수수료율 (TASK-0079)
--
-- **요율에는 적용 기간과 변경 이력이 있어야 한다** (F4 · F5). 컬럼 하나로는 둘 다
-- 표현할 수 없고, 그래서 표가 된다. 행을 고치는 것이 아니라 **열린 행을 닫고 새 행을
-- 여는** 방식이라 이력이 따로 만들어야 할 표가 아니라 이 표를 시간순으로 읽은 결과다.

CREATE TABLE "CommissionRate" (
    "id" UUID NOT NULL,
    "sellerId" UUID,
    "categoryId" INTEGER,
    "rateBp" INTEGER NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommissionRate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CommissionRate_sellerId_validUntil_idx" ON "CommissionRate"("sellerId", "validUntil");
CREATE INDEX "CommissionRate_categoryId_validUntil_idx" ON "CommissionRate"("categoryId", "validUntil");
CREATE INDEX "CommissionRate_sellerId_categoryId_validFrom_idx"
  ON "CommissionRate"("sellerId", "categoryId", "validFrom" DESC);

ALTER TABLE "CommissionRate" ADD CONSTRAINT "CommissionRate_sellerId_fkey"
  FOREIGN KEY ("sellerId") REFERENCES "Seller"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CommissionRate" ADD CONSTRAINT "CommissionRate_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CommissionRate" ADD CONSTRAINT "CommissionRate_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 0~10000 bp. 범위를 DB 가 강제하는 이유는 `erd.md` 1장이 적어 두었다 — **정산이 이
-- 값을 곱하므로**, 음수나 100% 초과가 들어가면 판매자에게 주문액보다 많은 돈이
-- 계산되고 아무도 눈치채지 못한다.
ALTER TABLE "CommissionRate" ADD CONSTRAINT "CommissionRate_rate_check"
  CHECK ("rateBp" >= 0 AND "rateBp" <= 10000);

-- **범위는 셋 중 하나다** — 스토어 · 카테고리 · 전역(둘 다 NULL).
--
-- 둘 다 채워진 행은 「이 카테고리의 이 판매자」라는 네 번째 범위가 되는데, 그런 것을
-- 만들려면 우선순위 규칙을 다시 정해야 한다. 표현 불가능하게 두는 편이 낫다 —
-- 규칙에 없는 행이 저장되면 요율 결정이 그것을 조용히 무시한다.
ALTER TABLE "CommissionRate" ADD CONSTRAINT "CommissionRate_scope_check"
  CHECK (NOT ("sellerId" IS NOT NULL AND "categoryId" IS NOT NULL));

-- 기간이 뒤집힌 행은 아무 때도 유효하지 않다.
ALTER TABLE "CommissionRate" ADD CONSTRAINT "CommissionRate_period_check"
  CHECK ("validUntil" IS NULL OR "validFrom" < "validUntil");

-- **범위마다 열린 행은 하나뿐이다.** 둘이면 「지금 요율」이 두 개가 되고, 어느 것이
-- 적용될지는 조회의 정렬이 정한다 — 그것은 규칙이 아니라 우연이다.
--
-- 세 인덱스인 이유는 NULL 이 유니크에서 서로 다른 값으로 취급되기 때문이다. 하나로
-- 묶으면 전역 행이 몇 개든 들어간다.
CREATE UNIQUE INDEX "CommissionRate_open_seller_key"
  ON "CommissionRate"("sellerId") WHERE "validUntil" IS NULL AND "sellerId" IS NOT NULL;
CREATE UNIQUE INDEX "CommissionRate_open_category_key"
  ON "CommissionRate"("categoryId") WHERE "validUntil" IS NULL AND "categoryId" IS NOT NULL;
CREATE UNIQUE INDEX "CommissionRate_open_global_key"
  ON "CommissionRate"((TRUE))
  WHERE "validUntil" IS NULL AND "sellerId" IS NULL AND "categoryId" IS NULL;

-- **주문 시점의 요율을 항목에 박는다** (F4).
--
-- 항목마다인 이유는 요율이 카테고리에 걸리기 때문이다. 한 판매자 몫에 패션(3%)과
-- 가전(5%)이 섞여 있으면 몫 하나에 요율 하나를 적을 수 없고, 그 하나를 골라 적으면
-- 둘 중 하나는 틀린 값으로 정산된다.
--
-- 정산은 이 값을 읽고 위 표를 보지 않는다. 그래서 요율을 올려도 **어제 판 것의
-- 수수료가 바뀌지 않는다** — 정산이 나중에 계산되더라도 계약은 판매 시점에 성립한다.
ALTER TABLE "OrderItem" ADD COLUMN "commissionRateBp" INTEGER;

ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_commission_rate_check"
  CHECK ("commissionRateBp" IS NULL OR ("commissionRateBp" >= 0 AND "commissionRateBp" <= 10000));

-- 읽는 코드가 한 줄도 없는 채로 남아 있던 칸이다. 남겨 두는 것이 **함정**이다 —
-- 누군가 그 칸을 채우면 아무 일도 일어나지 않는다. 스토어의 요율은 이제 위 표가
-- 들고, 그래야 적용 기간과 변경 이력을 가질 수 있다.
ALTER TABLE "Seller" DROP CONSTRAINT "Seller_commissionRateBp_check";
ALTER TABLE "Seller" DROP COLUMN "commissionRateBp";
