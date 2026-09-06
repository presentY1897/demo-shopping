-- CreateEnum
CREATE TYPE "CouponIssuerType" AS ENUM ('PLATFORM', 'SELLER');

-- CreateEnum
CREATE TYPE "CouponDiscountType" AS ENUM ('FIXED', 'PERCENT');

-- CreateEnum
CREATE TYPE "CouponScopeType" AS ENUM ('ALL', 'CATEGORY', 'PRODUCT', 'SELLER');

-- CreateEnum
CREATE TYPE "UserCouponStatus" AS ENUM ('ISSUED', 'USED', 'EXPIRED');

-- CreateTable
CREATE TABLE "Coupon" (
    "id" UUID NOT NULL,
    "issuerType" "CouponIssuerType" NOT NULL,
    "sellerId" UUID,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "discountType" "CouponDiscountType" NOT NULL,
    "discountValue" INTEGER NOT NULL,
    "maxDiscountAmount" INTEGER,
    "minOrderAmount" INTEGER NOT NULL DEFAULT 0,
    "scopeType" "CouponScopeType" NOT NULL,
    "scopeIds" TEXT[],
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "issueLimit" INTEGER,
    "issuedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Coupon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserCoupon" (
    "id" UUID NOT NULL,
    "couponId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "status" "UserCouponStatus" NOT NULL DEFAULT 'ISSUED',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usedAt" TIMESTAMP(3),
    "orderId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserCoupon_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Coupon_code_key" ON "Coupon"("code");

-- CreateIndex
CREATE INDEX "Coupon_sellerId_createdAt_idx" ON "Coupon"("sellerId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Coupon_issuerType_validUntil_idx" ON "Coupon"("issuerType", "validUntil");

-- CreateIndex
CREATE INDEX "UserCoupon_userId_status_expiresAt_idx" ON "UserCoupon"("userId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "UserCoupon_status_expiresAt_idx" ON "UserCoupon"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "UserCoupon_orderId_idx" ON "UserCoupon"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "UserCoupon_couponId_userId_key" ON "UserCoupon"("couponId", "userId");

-- AddForeignKey
ALTER TABLE "Coupon" ADD CONSTRAINT "Coupon_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "Seller"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserCoupon" ADD CONSTRAINT "UserCoupon_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserCoupon" ADD CONSTRAINT "UserCoupon_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserCoupon" ADD CONSTRAINT "UserCoupon_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- 여기서부터는 PSL 로 표현할 수 없어 손으로 쓴 제약이다. Prisma 의 드리프트
-- 감지는 CHECK 를 보지 않으므로 이후 `migrate dev` 에도 그대로 살아남는다
-- (`20260905070000_payment` 가 선례이고, 판단도 같다: **마지막 방어선은 DB 다**).

-- **부담 주체와 판매자 참조는 짝이어야 한다.** 이것이 `issuerType` 을 정산의
-- 근거로 쓸 수 있게 하는 줄이다 (D-029). 「SELLER 인데 sellerId 가 없는」 행이
-- 하나라도 생기면 정산은 그 쿠폰을 누구에게서 차감할지 알 수 없고, 「PLATFORM
-- 인데 sellerId 가 있는」 행은 읽는 쪽마다 다르게 해석한다 — 어느 쪽도 실패로
-- 나타나지 않고 정산 금액으로만 드러난다.
ALTER TABLE "Coupon" ADD CONSTRAINT "Coupon_issuer_check"
  CHECK (("issuerType" = 'SELLER') = ("sellerId" IS NOT NULL));

-- **판매자 쿠폰은 자기 가게 밖으로 나가지 못한다** (TASK-0072 4장).
--
-- 판매자가 전체 쿠폰을 발행하면 다른 판매자의 매출에 자기 부담이 들어간다.
-- `CATEGORY` 도 같이 막는 이유는 카테고리가 플랫폼 공용이기 때문이다 — 「셔츠
-- 10%」는 이름만 좁을 뿐 남의 셔츠까지 덮는다.
--
-- `SELLER` 범위의 대상이 **자기 자신이어야 한다**는 것까지 이 줄이 든다. 두 값이
-- 같은 행에 있어서 CHECK 로 표현되는, 이 표에서 가장 강한 제약이다. 서버도 같은
-- 판단을 하지만(`coupon-rules.ts` 의 `sellerScopeFault`) 화면·서버·DB 세 겹 중
-- 마지막만이 API 를 직접 부르는 길까지 막는다.
--
-- `PRODUCT` 범위의 상품이 실제로 그 가게 것인지는 **여기서 잴 수 없다** — 조인이
-- 필요하고 CHECK 는 한 행만 본다. 그 절반은 발행 시점에 서비스가 확인한다
-- (`CouponService.assertScopeTargets`).
ALTER TABLE "Coupon" ADD CONSTRAINT "Coupon_seller_scope_check"
  CHECK (
    "issuerType" <> 'SELLER'
    OR (
      "scopeType" = 'PRODUCT'
      OR ("scopeType" = 'SELLER' AND "scopeIds" = ARRAY["sellerId"::text])
    )
  );

-- 범위 대상은 `ALL` 일 때 비어 있고 그 밖일 때 하나 이상이다. 「PRODUCT 인데
-- 대상이 없는」 쿠폰은 아무 상품에도 붙지 않은 채 발급되고, 받은 사람은 왜 적용이
-- 안 되는지 알 수 없다 — 오류가 아니라 아무 일도 일어나지 않는 쿠폰이다.
ALTER TABLE "Coupon" ADD CONSTRAINT "Coupon_scope_ids_check"
  CHECK (
    CASE WHEN "scopeType" = 'ALL'
         THEN cardinality("scopeIds") = 0
         ELSE cardinality("scopeIds") > 0
    END
  );

-- 정액과 정률은 **값의 뜻이 다르다.** 정률의 100 은 전액이고 그것을 넘는 수는
-- 존재하지 않는다 — 없으면 「150% 할인」이 저장되고, 계산기는 그 주문에서 돈을
-- 돌려주게 된다. 상한(`maxDiscountAmount`)은 정률에만 뜻이 있으므로 정액에서는
-- 반드시 비어 있어야 한다: 뜻 없는 값이 저장되면 읽는 쪽이 그것을 해석하려 든다.
ALTER TABLE "Coupon" ADD CONSTRAINT "Coupon_discount_check"
  CHECK (
    CASE "discountType"
      WHEN 'PERCENT' THEN "discountValue" BETWEEN 1 AND 100
      WHEN 'FIXED'   THEN "discountValue" > 0 AND "maxDiscountAmount" IS NULL
    END
  );

-- 상한과 최소 주문금액. 0원짜리 상한은 「할인이 0원」이라는 뜻이라 쿠폰이 아니고,
-- 음수 최소 주문금액은 조건이 아니다.
ALTER TABLE "Coupon" ADD CONSTRAINT "Coupon_amounts_check"
  CHECK (
    ("maxDiscountAmount" IS NULL OR "maxDiscountAmount" > 0)
    AND "minOrderAmount" >= 0
  );

-- **발급된 장수는 발급 수량을 넘을 수 없다.** 이 TASK 의 F5·F6 이고, 이 줄이
-- 마지막 방어선이다.
--
-- 애플리케이션은 조건부 갱신 한 문장으로 판단한다
-- (`UPDATE … WHERE "issuedCount" < "issueLimit"`) — 잔여 1장에 열 건이 동시에
-- 들어와도 Postgres 가 그 행을 한 번에 하나씩만 갱신하므로 아홉은 0행으로 진다.
-- 그래도 이 CHECK 를 두는 이유는 `Payment_canceledAmount_check` 와 같다: 「읽고
-- 판단하고 쓰는」 모양으로 언젠가 고쳐 쓰이는 날, 초과 발급을 거절하는 것이
-- 하나도 남지 않게 되기 때문이다. 초과 발급은 실패로 나타나지 않고 **약속한
-- 것보다 많이 나간 쿠폰**으로 나타난다.
--
-- 수량이 0인 쿠폰은 애초에 발급될 수 없으므로 함께 막는다 — `NULL` 이 무제한이라
-- 「0장 발급」은 무제한과 헷갈리기만 하는 값이다.
ALTER TABLE "Coupon" ADD CONSTRAINT "Coupon_issued_count_check"
  CHECK (
    "issuedCount" >= 0
    AND ("issueLimit" IS NULL OR ("issueLimit" > 0 AND "issuedCount" <= "issueLimit"))
  );

-- 유효기간은 앞이 뒤보다 앞서야 한다. 뒤집힌 기간은 아무도 쓸 수 없는 쿠폰이고,
-- 발행자는 그것을 발행 화면에서 알 수 없다.
ALTER TABLE "Coupon" ADD CONSTRAINT "Coupon_period_check"
  CHECK ("validFrom" < "validUntil");

-- **썼다는 사실은 셋이 함께 움직인다** — 상태 · 시각 · 주문.
--
-- 하나만 있는 행은 읽는 사람이 「언제 어디에 썼는지 모르겠다」로 끝나는 기록이고
-- (`PaymentEvent_transition_check` 와 같은 판단), 환불 복원(TASK-0078)은 바로
-- 그 세 값을 되짚어 쿠폰을 돌려준다. 복원은 셋을 함께 비워야 한다.
ALTER TABLE "UserCoupon" ADD CONSTRAINT "UserCoupon_used_check"
  CHECK (
    ("status" = 'USED') = ("usedAt" IS NOT NULL)
    AND ("usedAt" IS NULL) = ("orderId" IS NULL)
  );
