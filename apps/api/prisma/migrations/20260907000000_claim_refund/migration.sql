-- 클레임 하나에 대한 **환불 한 번** (TASK-0068 · `docs/design/pricing.md` 4장).
--
-- 이 마이그레이션이 실제로 지키는 것은 넷이다.
--
--   ① **한 클레임의 환불은 하나뿐이다.** 기본키가 `claimId` 그 자체이므로 두 번째
--      환불 기록은 **애초에 만들 수 없다.** 열쇠를 클레임의 id 로 잡은 근거는
--      `cancel-events.ts` 의 `idempotencyKey` 에 있다 — 전이표에 `CANCEL_APPROVED`
--      로도 `RETURN_COMPLETED` 로도 돌아오는 화살표가 없어 한 클레임은 평생 한 번만
--      그 자리에 선다.
--   ② **총액은 항목 몫과 배송비 조정에서 나온다.** `max(0, items + shipping)` 은
--      `refund-calc.ts` 의 `refundBreakdown` 이 내리는 결론이고, 그것을 여기 한 번
--      더 적는 이유는 이 열이 **실제로 프로바이더에 요청한 금액**이기 때문이다 —
--      세 숫자가 어긋난 행은 「얼마를 왜 돌려줬나」에 답하지 못한다.
--   ③ **환불이 청구로 뒤집히지 않는다.** `amount >= 0` 이 그 문장이고, 반품비가
--      항목 환불액보다 큰 경우(아주 싼 물건의 변심 반품)에 0으로 바닥을 친다.
--      `shippingAmount` 만 부호가 있다 — 재부과와 반품비 차감이 음수다.
--   ④ **돈이 나갔는데 어느 결제인지 모를 수 없다.** `refundedAt` 이 채워진 행은
--      반드시 결제를 가리킨다.
--
-- 손으로 썼다. 앞선 마이그레이션들과 같은 이유이고, 생성물에서 어차피 빼야 하는
-- 둘이 늘 같기 때문이다.
--   * `Category_path_idx` 의 DROP + CREATE (`text_pattern_ops` 를 Prisma 가 모른다)
--   * `SellerOrder_trackingNumber_shipment_fkey` 의 DROP — 손으로 붙인 복합
--     외래키라 Prisma 가 모르고(PSL 로 두 열짜리 참조를 적을 수 없다), 지우면
--     「발송했는데 운송장이 없다」를 막던 제약이 조용히 사라진다 (TASK-0061).

-- CreateTable
CREATE TABLE "ClaimRefund" (
    "claimId" UUID NOT NULL,
    "paymentId" UUID,
    "itemsAmount" INTEGER NOT NULL DEFAULT 0,
    "shippingAmount" INTEGER NOT NULL DEFAULT 0,
    "amount" INTEGER NOT NULL DEFAULT 0,
    "refundedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "lastAttemptAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClaimRefund_pkey" PRIMARY KEY ("claimId")
);

-- CreateIndex
CREATE INDEX "ClaimRefund_refundedAt_lastAttemptAt_idx" ON "ClaimRefund"("refundedAt", "lastAttemptAt");

-- CreateIndex
--
-- 재시도 배치가 읽는 것: **환불을 기다리는 자리에 오래 앉아 있는** 클레임.
-- `ClaimRequest_status_createdAt_idx` 로는 안 된다 — 신청 시각이 아니라 **승인·검수가
-- 상태를 옮긴 시각**을 기준으로 유예를 재야 하고, 그 둘은 사람이 며칠 뒤에 승인하는
-- 정상 흐름에서 곧바로 갈린다.
CREATE INDEX "ClaimRequest_status_updatedAt_idx" ON "ClaimRequest"("status", "updatedAt");

-- AddForeignKey
ALTER TABLE "ClaimRefund" ADD CONSTRAINT "ClaimRefund_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "ClaimRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
--
-- `Restrict`: 환불이 가리키는 결제는 지워지지 않는다. 지워지면 「돈이 어디로
-- 나갔나」에 답할 수 없다.
ALTER TABLE "ClaimRefund" ADD CONSTRAINT "ClaimRefund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 총액은 항목 몫과 배송비 조정에서 나온다 (② · ③).
--
-- **`shippingAmount` 만 부호가 없다.** 재부과(무료배송 조건이 무너진 부분 취소)와
-- 반품비 차감이 음수이고, 그 부호가 곧 「더 돌려주나 덜 돌려주나」다. 나머지 둘은
-- 음수가 될 수 없다 — 항목 몫이 음수면 안분이 상품금액을 넘은 것이고, 총액이
-- 음수면 환불이라는 이름으로 돈을 받는 일이 된다 (`ClaimItem_refundAmount_check`
-- 과 같은 판단).
ALTER TABLE "ClaimRefund" ADD CONSTRAINT "ClaimRefund_amount_check"
  CHECK ("itemsAmount" >= 0
         AND "amount" >= 0
         AND "attempts" >= 0
         AND "amount" = GREATEST(0, "itemsAmount" + "shippingAmount"));

-- 돈이 나갔는데 어느 결제인지 모를 수 없다 (④).
ALTER TABLE "ClaimRefund" ADD CONSTRAINT "ClaimRefund_settled_check"
  CHECK ("refundedAt" IS NULL OR "paymentId" IS NOT NULL);

-- 시도한 적 없는 환불에 실패 사유가 있을 수 없다.
--
-- `ReturnDetail_inspectionNote_check` 과 같은 모양이다. 사유만 남은 행은 「누군가
-- 시도했지만 그 사실은 안 적혔다」이고, 그러면 `attempts` 로 재시도를 판단하는
-- 사람이 잘못된 수를 본다.
ALTER TABLE "ClaimRefund" ADD CONSTRAINT "ClaimRefund_lastError_check"
  CHECK ("lastError" IS NULL OR "lastAttemptAt" IS NOT NULL);
