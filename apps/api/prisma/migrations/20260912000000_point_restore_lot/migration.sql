-- 되돌아온 적립금도 **통**이다 (TASK-0078)
--
-- TASK-0076 은 통의 세 칸을 `EARN` 에만 허용했다. 그때는 적립만 잔고를 만들었으므로
-- 맞는 제약이었는데, 그 제약 아래에서는 **복구가 불가능하다**: `RESTORE` 가 잔액을
-- 늘리면서 통을 만들지 못하므로 P5(남은 통들의 합 = 잔액)가 그 즉시 깨진다.
--
-- 환불이 적립금을 돌려주는 것은 `pricing.md` 4장이 정한 일이라, 고칠 것은 그 규칙이
-- 아니라 이 제약이다.
--
-- **`earnRateBp` 은 통의 일부가 아니다.** 「얼마의 비율로 적립됐나」는 적립의 사실이고
-- 되돌아온 적립금에는 그런 비율이 없다 — 그것은 쓴 것이 돌아온 것이지 새로 적립된
-- 것이 아니다. 그래서 셋을 함께 묶던 것을 둘과 하나로 나눈다.
ALTER TABLE "PointTransaction" DROP CONSTRAINT "PointTransaction_lot_check";

ALTER TABLE "PointTransaction" ADD CONSTRAINT "PointTransaction_lot_check"
  CHECK (
    ("type" IN ('EARN', 'RESTORE')) = ("expiresAt" IS NOT NULL)
    AND ("type" IN ('EARN', 'RESTORE')) = ("remainingAmount" IS NOT NULL)
    AND ("type" = 'EARN') = ("earnRateBp" IS NOT NULL)
  );
