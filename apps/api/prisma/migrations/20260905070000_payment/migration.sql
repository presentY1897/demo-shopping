-- CreateEnum
CREATE TYPE "PaymentProviderName" AS ENUM ('VIRTUAL_CARD', 'TOSS');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('READY', 'AUTHORIZED', 'PAID', 'PARTIAL_CANCELED', 'CANCELED', 'FAILED');

-- CreateEnum
CREATE TYPE "PaymentEventKind" AS ENUM ('REQUESTED', 'AUTHORIZED', 'CAPTURED', 'CANCELED', 'REFUNDED', 'FAILED', 'WEBHOOK');

-- CreateTable
CREATE TABLE "Payment" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "provider" "PaymentProviderName" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'READY',
    "authorizedAmount" INTEGER NOT NULL,
    "canceledAmount" INTEGER NOT NULL DEFAULT 0,
    "paymentKey" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentEvent" (
    "id" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "kind" "PaymentEventKind" NOT NULL,
    "fromStatus" "PaymentStatus",
    "toStatus" "PaymentStatus",
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Refund" (
    "id" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "refundedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Payment_paymentKey_key" ON "Payment"("paymentKey");

-- CreateIndex
CREATE INDEX "Payment_orderId_createdAt_idx" ON "Payment"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "Payment_status_createdAt_idx" ON "Payment"("status", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentEvent_paymentId_createdAt_idx" ON "PaymentEvent"("paymentId", "createdAt");

-- CreateIndex
CREATE INDEX "Refund_paymentId_refundedAt_idx" ON "Refund"("paymentId", "refundedAt");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentEvent" ADD CONSTRAINT "PaymentEvent_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 승인액은 0보다 커야 한다. 0원 결제는 결제가 아니고, 그런 행이 생기면
-- 「승인액을 넘지 않았나」라는 질문이 늘 참이 되어 검증이 무력해진다.
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_authorizedAmount_check"
  CHECK ("authorizedAmount" > 0);

-- **환불 누계는 승인액을 넘을 수 없다.** 이 TASK 의 F4 이고, 애플리케이션이
-- 판단하지만 DB 도 막는다 — 동시에 들어온 두 환불이 각자 「아직 여유가 있다」를
-- 읽는 것이 F6 이 재는 경합이고, 그 경합에서 지는 쪽을 최종적으로 거절하는 것이
-- 이 줄이다. 돈이 걸린 자리에서 방어선이 하나뿐이면 안 된다.
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_canceledAmount_check"
  CHECK ("canceledAmount" >= 0 AND "canceledAmount" <= "authorizedAmount");

-- 0원 환불은 환불이 아니다. 음수는 「환불」이라는 이름으로 돈을 받는 일이다.
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_amount_check"
  CHECK ("amount" > 0);

-- 사유는 비어 있을 수 없다. 환불 행 하나하나가 나중에 「왜 돌려줬나」에 답해야
-- 하는 기록이고, 빈 문자열은 답이 아니다.
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_reason_check"
  CHECK (btrim("reason") <> '');

-- 상태를 바꾼 사건은 전후가 **둘 다** 있어야 하고, 안 바꾼 사건은 **둘 다** 없어야
-- 한다. 한쪽만 있는 행은 읽는 사람이 「어디서 왔는지 모르겠다」로 끝나는 기록이다.
ALTER TABLE "PaymentEvent" ADD CONSTRAINT "PaymentEvent_transition_check"
  CHECK (("fromStatus" IS NULL) = ("toStatus" IS NULL));
