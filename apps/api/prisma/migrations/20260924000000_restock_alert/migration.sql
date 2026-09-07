-- 재입고 알림 신청 (TASK-0086 F4 · TASK-0090)
--
-- 찜과 나누는 이유는 **두 개의 다른 마음**이기 때문이다 — 담아 두는 것은 「나중에
-- 살까」이고 알림 신청은 「지금 사고 싶은데 없다」다. 담은 것 전부에 재입고 알림을
-- 보내면 그것은 신청하지 않은 알림이 된다.
ALTER TABLE "Wishlist" ADD COLUMN "notifyRestock" BOOLEAN NOT NULL DEFAULT false;

-- 재입고 알림을 기다리는 줄들 — 그 배치가 읽는 유일한 축이다. 부분 인덱스가 아닌
-- 이유는 신청한 줄이 전체의 작은 몫이라 `false` 쪽도 함께 담아 두는 비용이 작고,
-- 부분 인덱스는 조건이 바뀌는 날 조용히 안 쓰이기 때문이다.
CREATE INDEX "Wishlist_notifyRestock_productId_idx" ON "Wishlist"("notifyRestock", "productId");
