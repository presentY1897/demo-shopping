-- 주문 항목에 **판매자가 부담한 쿠폰 몫**을 적어 둔다 (TASK-0080 F3 · F4).
--
-- 정산의 한 줄이 `판매액 − 수수료 − 판매자 부담 쿠폰` 인데, 지금까지 저장된
-- `couponDiscountAmount` 는 플랫폼 쿠폰과 판매자 쿠폰이 **섞인** 값이다. 섞인 채로는
-- 「플랫폼 부담은 차감하지 않는다」(D-029)를 계산할 수 없다.
--
-- 정산 시점에 되계산하지 않는 이유는 쿠폰의 범위가 주문 · 판매자 · 항목 셋이기
-- 때문이다. 정책만 보고 「이 항목에 얼마가 붙었나」를 되짚으려면 안분을 통째로 다시
-- 돌려야 하고, 그러면 그 규칙이 두 벌이 된다 — 두 벌은 갈라진다.
ALTER TABLE "OrderItem" ADD COLUMN "sellerCouponDiscountAmount" INTEGER NOT NULL DEFAULT 0;

-- 이미 있는 행은 **같은 안분 규칙으로** 되살린다 (`pricing.md` 2장).
--
-- 한 판매자 몫에 붙은 판매자 쿠폰의 총액은 정확히 알 수 있다 —
-- `UserCoupon.discountAmount` 가 장별 할인액을 들고 있고(D-222), 판매자 쿠폰은 그
-- 스토어의 몫에만 닿는다. 모르는 것은 그 총액이 **항목들에 어떻게 나뉘었나**뿐이고,
-- 그것을 「상품금액 비례 내림, 잔여는 가장 큰 항목에」로 되살린다.
--
-- 되살린 값이 그 항목의 전체 쿠폰액을 넘지 않게 자른다. 안분의 한도(`cap`)까지
-- 되살릴 수는 없으므로, 넘는 경우에는 **적게 빼는 쪽**으로 기운다 — 정산에서 더
-- 빼는 것은 판매자에게 손해이고, 그 손해는 아무 데도 나타나지 않는다.
--
-- 새로 만들어지는 주문은 계산기가 직접 적으므로 이 되살림을 지나지 않는다.
WITH totals AS (
  SELECT so."id" AS "sellerOrderId", SUM(uc."discountAmount") AS "sellerCoupon"
    FROM "SellerOrder" so
    JOIN "UserCoupon" uc
      ON uc."orderId" = so."orderId" AND uc."discountAmount" IS NOT NULL
    JOIN "Coupon" c
      ON c."id" = uc."couponId" AND c."issuerType" = 'SELLER' AND c."sellerId" = so."sellerId"
   GROUP BY so."id"
), weights AS (
  SELECT oi."id",
         oi."sellerOrderId",
         oi."couponDiscountAmount",
         t."sellerCoupon",
         FLOOR(
           t."sellerCoupon" * oi."productAmount"
           / NULLIF(SUM(oi."productAmount") OVER (PARTITION BY oi."sellerOrderId"), 0)
         )::int AS "base",
         ROW_NUMBER() OVER (
           PARTITION BY oi."sellerOrderId" ORDER BY oi."productAmount" DESC, oi."id"
         ) AS "rank"
    FROM "OrderItem" oi
    JOIN totals t ON t."sellerOrderId" = oi."sellerOrderId"
), shares AS (
  SELECT w."id",
         w."couponDiscountAmount",
         w."base"
           + CASE
               WHEN w."rank" = 1
                 THEN w."sellerCoupon" - SUM(w."base") OVER (PARTITION BY w."sellerOrderId")
               ELSE 0
             END AS "share"
    FROM weights w
)
UPDATE "OrderItem" oi
   SET "sellerCouponDiscountAmount" = LEAST(GREATEST(s."share", 0), s."couponDiscountAmount")
  FROM shares s
 WHERE s."id" = oi."id";

-- 부담 몫은 전체 쿠폰 몫 안에 있다. **마지막 방어선은 DB** — 이 값이 전체를 넘으면
-- 정산이 판매자에게서 실제로 깎인 것보다 많이 빼고, 그 차이는 정산서 한 줄의
-- 숫자로만 나타난다.
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_sellerCoupon_check"
  CHECK ("sellerCouponDiscountAmount" >= 0
     AND "sellerCouponDiscountAmount" <= "couponDiscountAmount");
