-- 쿠폰 적용 (TASK-0075)
--
-- 표가 늘지 않는다. 이 TASK 가 하는 일은 **이미 있는 쿠폰을 이미 있는 계산 엔진에
-- 꽂는 것**이고(F1 — `calculateOrder` 변경 0줄), 그 일이 데이터베이스에 남기는
-- 흔적은 「이 장이 얼마를 깎았나」 한 칸뿐이다.

-- 이 장이 **실제로 깎은 금액**.
--
-- 정책으로 다시 계산할 수 없는 값이다. 정률이면 그때의 상품금액이 필요하고, 겹쳐
-- 덮인 장은 남은 금액까지만 깎였는데, 그 「그때」는 주문이 지난 뒤에는 아무 데도
-- 없다. `Order.totalCouponDiscountAmount` 도 답하지 못한다 — 여러 장의 합계라
-- 어느 장이 얼마였는지를 잃는다.
--
-- **정산이 읽는 값이다** (`docs/design/pricing.md` 6장): 판매자 부담 쿠폰의
-- 안분액만 그 판매자의 정산액에서 빠진다. `SellerOrder.couponDiscountAmount` 는
-- 플랫폼 쿠폰과 판매자 쿠폰이 섞인 합계라 그 나눔에 답할 수 없다.
--
-- 지금 채워 두지 않으면 나중에 채울 수 없다. 컬럼을 M12 에 더하면 그때 이미 저장된
-- 주문들은 이 값을 영영 갖지 못하고, 정산은 그 주문들에 대해 틀린 답을 낸다.
ALTER TABLE "UserCoupon" ADD COLUMN "discountAmount" INTEGER;

-- **「썼다」는 이제 넷이 함께 움직인다** — 상태 · 시각 · 주문 · 금액.
--
-- 셋이었던 이유 그대로 넷이다. 금액만 빠진 행은 「썼는데 얼마인지 모르겠다」로
-- 끝나는 기록이고, 그것을 읽는 것은 정산이다. 반대로 금액만 남은 행 —
-- 복원(TASK-0078)이 상태·시각·주문을 비우면서 금액을 남긴 경우 — 은 되돌아온
-- 쿠폰이 여전히 정산에서 차감되는 결과가 된다. 복원은 **넷을 함께 비운다.**
--
-- 0원은 허용한다. 두 장이 같은 항목을 덮어 뒤엣것이 한 푼도 못 깎는 경우가 있고,
-- 그때도 그 장은 쓰인 것이다 — 값이 없는 것(NULL)과 0원은 다른 사실이다.
ALTER TABLE "UserCoupon" DROP CONSTRAINT "UserCoupon_used_check";

ALTER TABLE "UserCoupon" ADD CONSTRAINT "UserCoupon_used_check"
  CHECK (
    ("status" = 'USED') = ("usedAt" IS NOT NULL)
    AND ("usedAt" IS NULL) = ("orderId" IS NULL)
    AND ("usedAt" IS NULL) = ("discountAmount" IS NULL)
  );

-- 금액은 음수가 될 수 없다. 「쿠폰이 돈을 더 받는다」는 계산기가 만들 수 없는
-- 상태지만, 이 칸을 채우는 코드가 언젠가 다른 곳에 하나 더 생기는 날 그것을
-- 거절하는 것이 아무것도 남지 않는다.
ALTER TABLE "UserCoupon" ADD CONSTRAINT "UserCoupon_discount_amount_check"
  CHECK ("discountAmount" IS NULL OR "discountAmount" >= 0);
