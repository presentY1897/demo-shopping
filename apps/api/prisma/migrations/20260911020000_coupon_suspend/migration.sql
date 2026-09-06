-- 발행 중단 (TASK-0073 F5 · TASK-0074)
--
-- **이미 발급된 장에는 아무 일도 일어나지 않는다.** 중단은 「더 나가지 않게」이지
-- 「나간 것을 무르게」가 아니다 — 무르는 것은 사람이 받은 것을 빼앗는 일이라 다른
-- 결정이고, 그 문은 아직 없다. 그래서 `UserCoupon` 은 손대지 않는다.
--
-- 시각이지 불리언이 아닌 이유는 「언제 멈췄나」가 사람이 묻는 질문이기 때문이다.
-- 다시 열면 `NULL` 로 돌아가므로 이력이 남지는 않는다 — 그것이 필요해지는 날의
-- 답은 이 칸을 늘리는 것이 아니라 사건 표를 두는 것이다 (`PaymentEvent` 와 같은 판단).
ALTER TABLE "Coupon" ADD COLUMN "suspendedAt" TIMESTAMP(3);

-- 발급이 읽는 조건 그대로. 목록도 이 칸으로 거른다.
CREATE INDEX "Coupon_suspendedAt_idx" ON "Coupon"("suspendedAt");
