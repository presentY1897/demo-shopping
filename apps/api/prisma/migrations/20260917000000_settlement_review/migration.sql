-- 정산서의 검토 (TASK-0081)
--
-- `state-machines.md` 5장이 정한 전이에 **보류**가 있다:
--
--   PENDING → APPROVED · PENDING → HOLD · HOLD → APPROVED · APPROVED → PAID
--
-- 보류는 승인의 반대가 아니라 **판단을 미룬 상태**다. 그래서 여기서 갈 수 있는 곳은
-- 승인뿐이고 「거절」은 없다 — 정산은 거절할 수 있는 것이 아니라 금액을 고쳐 다음
-- 회차에서 조정하는 것이다.
ALTER TYPE "SettlementStatus" ADD VALUE 'HOLD' BEFORE 'APPROVED';

-- 누가 언제 지급 처리했나. 「승인은 누가 했는지 아는데 지급은 모른다」가 되면
-- 사고를 되짚을 때 절반만 답할 수 있다.
ALTER TABLE "Settlement" ADD COLUMN "paidById" UUID;

-- **왜 보류했나** (F4). 보류에는 반드시 있고, 해소된 뒤에도 남는다 — 「이 회차가 왜
-- 늦었나」가 승인 뒤에 사라지면 안 된다. 판매자가 묻는 것은 대개 지급이 끝난 뒤다.
ALTER TABLE "Settlement" ADD COLUMN "holdReason" TEXT;
ALTER TABLE "Settlement" ADD COLUMN "heldAt" TIMESTAMP(3);
ALTER TABLE "Settlement" ADD COLUMN "heldById" UUID;

ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_paidById_fkey"
  FOREIGN KEY ("paidById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_heldById_fkey"
  FOREIGN KEY ("heldById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 보류 사유는 **비어 있을 수 없다.** 공백만 적고 넘어갈 수 있으면 F4 의 「사유를
-- 입력해야 한다」는 화면의 예의이지 규칙이 아니게 된다.
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_holdReason_check"
  CHECK ("holdReason" IS NULL OR btrim("holdReason") <> '');
