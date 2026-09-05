-- CreateEnum
CREATE TYPE "VirtualCardStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DELETED');

-- CreateEnum
CREATE TYPE "VirtualCardEntryKind" AS ENUM ('CHARGE', 'CANCEL', 'REFUND');

-- CreateTable
CREATE TABLE "VirtualCard" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "creditLimit" INTEGER NOT NULL,
    "usedAmount" INTEGER NOT NULL DEFAULT 0,
    "status" "VirtualCardStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VirtualCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VirtualCardTransaction" (
    "id" UUID NOT NULL,
    "cardId" UUID NOT NULL,
    "kind" "VirtualCardEntryKind" NOT NULL,
    "amount" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "refId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VirtualCardTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VirtualCard_number_key" ON "VirtualCard"("number");

-- CreateIndex
CREATE INDEX "VirtualCard_userId_status_createdAt_idx" ON "VirtualCard"("userId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "VirtualCardTransaction_cardId_createdAt_idx" ON "VirtualCardTransaction"("cardId", "createdAt");

-- AddForeignKey
ALTER TABLE "VirtualCard" ADD CONSTRAINT "VirtualCard_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VirtualCardTransaction" ADD CONSTRAINT "VirtualCardTransaction_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "VirtualCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 실제 카드 BIN 과 겹치지 않는 접두어 (F7 · R1). 형식을 DB 가 지키는 이유는
-- 발급기가 하나가 아니게 되는 날 — 시드, 백필 — 접두어가 조용히 갈라지기
-- 때문이다. 그때 사라지는 것은 「실제 카드가 아니라는 것이 번호에서 보인다」는
-- 성질 하나뿐이라 눈에 띄지 않는다.
ALTER TABLE "VirtualCard" ADD CONSTRAINT "VirtualCard_number_format_check"
  CHECK ("number" ~ '^9999-[0-9]{4}-[0-9]{4}-[0-9]{4}$');

-- **쓴 금액은 0과 한도 사이다.** 한도를 넘으면 카드가 감당 못 하는 돈이 나간
-- 것이고, 음수면 쓰지도 않은 한도가 늘어난 것이다. 애플리케이션이 먼저
-- 판단하지만 동시 승인이 그 판단을 비껴갈 수 있고(F8), 지는 쪽을 최종적으로
-- 거절하는 것은 이 줄이다 — 돈이 걸린 자리에서 방어선이 하나뿐이면 안 된다.
ALTER TABLE "VirtualCard" ADD CONSTRAINT "VirtualCard_usedAmount_check"
  CHECK ("usedAmount" >= 0 AND "usedAmount" <= "creditLimit");

-- 한도가 0인 카드는 카드가 아니다.
ALTER TABLE "VirtualCard" ADD CONSTRAINT "VirtualCard_creditLimit_check"
  CHECK ("creditLimit" > 0);

-- 0원짜리 사건은 사건이 아니다. 부호는 종류가 정한다 — 승인은 한도를 쓰고
-- (양수), 취소·환불은 돌려준다(음수). 뒤집힌 행 하나가 원장의 합을 조용히
-- 어긋내고, 그것은 대사할 때가 되어서야 보인다.
ALTER TABLE "VirtualCardTransaction" ADD CONSTRAINT "VirtualCardTransaction_direction_check"
  CHECK (
    ("kind" = 'CHARGE' AND "amount" > 0)
    OR ("kind" IN ('CANCEL', 'REFUND') AND "amount" < 0)
  );

-- 원장의 잔액도 0 아래로 내려가지 않는다.
ALTER TABLE "VirtualCardTransaction" ADD CONSTRAINT "VirtualCardTransaction_balance_check"
  CHECK ("balanceAfter" >= 0);
