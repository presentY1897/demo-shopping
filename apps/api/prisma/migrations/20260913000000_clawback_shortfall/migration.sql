-- 회수하지 못한 적립금 (TASK-0078 F6)
--
-- 구매확정 후 반품이면 지급했던 적립금을 되가져온다. 이미 써 버렸으면 되가져올 수
-- 없고, 음수 잔액을 만들지 않기로 했으므로(`PointAccount_balance_check`) 못 가져온
-- 몫이 남는다.
--
-- **그 몫은 원장에 남지 못한다.** 원장은 「돈이 움직인 기록」인데 하나도 못 가져간
-- 경우에는 움직인 돈이 0원이고, 0원짜리 행은 `PointTransaction_amount_check` 가
-- 막는다. 그 규칙이 옳다 — 0원짜리 사건은 사건이 아니다. 그러니 사실이 갈 다른 곳이
-- 필요하고, 환불 한 건의 결과가 모이는 이 표가 그 자리다.
--
-- 일부라도 가져간 경우에는 그 `ADJUST` 의 이유에도 적힌다. 그래도 이 칸이 따로 있는
-- 이유는 **이유가 문장이기 때문**이다: 문장으로는 「회수 실패 목록」을 만들 수 없고,
-- 숫자로 서 있어야 세고 거를 수 있다.
ALTER TABLE "ClaimRefund" ADD COLUMN "pointClawbackShortfall" INTEGER NOT NULL DEFAULT 0;

-- 음수는 뜻이 없다. 「덜 회수했다」의 반대는 「더 회수했다」가 아니라 0이다.
ALTER TABLE "ClaimRefund" ADD CONSTRAINT "ClaimRefund_clawback_shortfall_check"
  CHECK ("pointClawbackShortfall" >= 0);

-- 「아직 못 받아낸 것이 있는 환불」. 관리자 화면이 생기는 날 이 인덱스가 그 목록이다.
CREATE INDEX "ClaimRefund_clawback_shortfall_idx"
  ON "ClaimRefund"("pointClawbackShortfall") WHERE "pointClawbackShortfall" > 0;
