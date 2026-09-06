-- 상태와 「누가 언제」가 짝이다 (TASK-0081).
--
-- 파일이 나뉜 이유는 PostgreSQL 때문이다. `ALTER TYPE ... ADD VALUE` 로 더한 값은
-- **같은 트랜잭션 안에서 쓸 수 없고**, 마이그레이션 하나가 트랜잭션 하나다. 그래서
-- 앞 파일이 값을 더하고 이 파일이 그 값을 쓴다.
ALTER TABLE "Settlement" DROP CONSTRAINT "Settlement_status_check";

-- 「승인됐는데 누가 언제 승인했는지 모른다」와 「대기 중인데 승인 시각이 있다」는
-- 둘 다 읽는 사람에게 거짓말이다. 보류도 마찬가지다 — **사유 없는 보류**는 판매자가
-- 「왜 제 정산이 멈췄죠」라고 물었을 때 답할 것이 없는 상태다 (F4).
--
-- 보류 사유는 승인 뒤에도 남으므로 `APPROVED` · `PAID` 에서는 있고 없고를 묻지
-- 않는다 — 「이 회차가 왜 늦었나」는 지급이 끝난 뒤에 물어보는 질문이다.
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_status_check"
  CHECK (
    ("status" = 'PENDING' AND "approvedAt" IS NULL AND "approvedById" IS NULL
      AND "paidAt" IS NULL AND "paidById" IS NULL
      AND "heldAt" IS NULL AND "heldById" IS NULL AND "holdReason" IS NULL)
    OR ("status" = 'HOLD' AND "approvedAt" IS NULL AND "approvedById" IS NULL
      AND "paidAt" IS NULL AND "paidById" IS NULL
      AND "heldAt" IS NOT NULL AND "heldById" IS NOT NULL AND "holdReason" IS NOT NULL)
    OR ("status" = 'APPROVED' AND "approvedAt" IS NOT NULL AND "approvedById" IS NOT NULL
      AND "paidAt" IS NULL AND "paidById" IS NULL)
    OR ("status" = 'PAID' AND "approvedAt" IS NOT NULL AND "approvedById" IS NOT NULL
      AND "paidAt" IS NOT NULL AND "paidById" IS NOT NULL)
  );
