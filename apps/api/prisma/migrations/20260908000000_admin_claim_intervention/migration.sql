-- 관리자 개입 (TASK-0071 · `docs/design/state-machines.md` 4장).
--
-- **상태를 하나도 더하지 않는다.** 관리자가 판매자의 거절을 뒤집는 방법은 「거절된
-- 클레임을 되살리는 것」이 아니라 **새 신청을 관리자가 대신 내는 것**이고, 그래서
-- 전이표에도 `ClaimStatus` 에도 손댈 것이 없다. 되살리는 쪽을 고르지 않은 이유가
-- 셋이다.
--
--   ① 거절은 잡고 있던 수량을 **이미 돌려주었다** (`RELEASES_QUANTITY`). 되돌리는
--      화살표는 그 수량을 **다시 잡는** 연산을 함께 요구하는데, 그 사이 구매자가
--      다시 신청했으면 잡을 수 없다 — 화살표 하나가 아니라 문 안의 새 연산이다.
--   ② `ClaimRefund` 의 기본키가 `claimId` 인 근거가 **전이표에 돌아오는 화살표가
--      없다**는 사실이다. `RETURN_REJECTED → RETURN_APPROVED` 를 열면
--      `RETURN_APPROVED → PICKING_UP → INSPECTING → RETURN_REJECTED` 가 고리가
--      되고, 그 근거가 한눈에 성립하지 않게 된다.
--   ③ `RETURN_REJECTED` 는 두 자리에서 온다(신청 거절 · 검수 불합격). 역화살표
--      하나는 그 둘을 구분하지 못해, 검수에서 떨어진 반품에 회수 운송장이 다시 난다.
--
-- 그래서 이 마이그레이션이 더하는 것은 **선 하나와 표 하나**다.
--
--   * `ClaimRequest.overturnsClaimId` — 개입이 어느 거절을 뒤집었는가. 없으면
--     **원본 쪽에서 「이 거절이 뒤집혔다」를 읽을 방법이 없고**, 판매자는 자기
--     거절이 살아 있는 줄 안다. 「누가·왜」는 개입 신청의 첫 이력 줄이 이미 담는다.
--   * `ClaimAppeal` — 거절에 대한 구매자의 이의. **상태 전이가 아니라서** 이력에는
--     적을 자리가 없다: 이의를 냈다고 클레임은 움직이지 않고, 같은 상태로 적는 것은
--     `ClaimStatusHistory_transition_check` 이 막는다.
--
-- 손으로 썼다. 앞선 마이그레이션들과 같은 이유이고, 생성물에서 어차피 빼야 하는
-- 둘이 늘 같기 때문이다.
--   * `Category_path_idx` 의 DROP + CREATE (`text_pattern_ops` 를 Prisma 가 모른다)
--   * `SellerOrder_trackingNumber_shipment_fkey` 의 DROP — 손으로 붙인 복합
--     외래키라 Prisma 가 모르고, 지우면 「발송했는데 운송장이 없다」를 막던 제약이
--     조용히 사라진다 (TASK-0061).

-- CreateEnum
--
-- **「검토 중」이 값으로 없다.** 그것은 `reviewedAt IS NULL` 이고, 상태를 하나 더
-- 두면 「검토 중인데 결론이 적힌 행」이 표현 가능해진다 — `ClaimRefund.refundedAt`
-- 이 같은 이유로 상태 열거형을 두지 않았다.
CREATE TYPE "ClaimAppealOutcome" AS ENUM ('UPHELD', 'DISMISSED');

-- AlterTable
ALTER TABLE "ClaimRequest" ADD COLUMN "overturnsClaimId" UUID;

-- CreateIndex
--
-- 「이 거절이 뒤집혔는가」를 원본 쪽에서 되짚는다. 판매자 화면과 관리자 개입 이력이
-- 같은 선을 반대 방향으로 읽으므로, 인덱스가 없으면 그 조회가 표를 훑는다.
CREATE INDEX "ClaimRequest_overturnsClaimId_idx" ON "ClaimRequest"("overturnsClaimId");

-- AddForeignKey
--
-- `SET NULL`: 원본이 사라져도 개입 자체는 남아야 한다 — 개입의 환불은 이미 나갔을
-- 수 있고, 그 사실이 원본과 함께 지워질 이유가 없다.
ALTER TABLE "ClaimRequest" ADD CONSTRAINT "ClaimRequest_overturnsClaimId_fkey"
  FOREIGN KEY ("overturnsClaimId") REFERENCES "ClaimRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 자기 자신을 뒤집는 신청은 없다.
--
-- 애플리케이션은 「거절된 남의 클레임만 뒤집는다」로 이미 막지만, 그 문장을 안 지나는
-- 쓰기가 하나 생기는 날 이 행은 **자기를 가리키는 고리**가 되고 개입 이력을 따라
-- 읽는 코드가 그 자리에서 멈춘다 (`Category_parentId` 가 같은 이유로 같은 모양이다).
ALTER TABLE "ClaimRequest" ADD CONSTRAINT "ClaimRequest_overturn_check"
  CHECK ("overturnsClaimId" IS NULL OR "overturnsClaimId" <> "id");

-- CreateTable
--
-- 기본키가 `claimId` 인 것이 **「한 거절에 이의는 하나」의 전부**다. `ClaimRefund` ·
-- `ReturnDetail` 과 같은 모양이고 같은 이유다 — 유니크 인덱스를 따로 두는 것보다
-- 짧고, 「한 거절에 이의가 둘」이라는 상태를 애초에 만들 수 없다.
CREATE TABLE "ClaimAppeal" (
    "claimId" UUID NOT NULL,
    "filedById" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" UUID,
    "outcome" "ClaimAppealOutcome",
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClaimAppeal_pkey" PRIMARY KEY ("claimId")
);

-- CreateIndex
--
-- **관리자의 대기열이 읽는 유일한 조회 조건이다** — 아직 결론이 없는 이의를 오래된
-- 것부터. 부분 인덱스로 좁히지 않는 것은 검토가 끝난 이의도 같은 목록에서 필터로
-- 읽히기 때문이다.
CREATE INDEX "ClaimAppeal_reviewedAt_createdAt_idx" ON "ClaimAppeal"("reviewedAt", "createdAt");

-- AddForeignKey
ALTER TABLE "ClaimAppeal" ADD CONSTRAINT "ClaimAppeal_claimId_fkey"
  FOREIGN KEY ("claimId") REFERENCES "ClaimRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
--
-- 둘 다 `RESTRICT` 다. 분쟁에서 읽히는 것이 「누가 말했나」이고, 그 이름이 탈퇴로
-- 사라지면 이의는 아무도 내지 않은 문장이 된다 (`ClaimRequest.requestedById` 와
-- 같은 판단이고, 탈퇴가 소프트 삭제라 실제로 끊기지도 않는다).
ALTER TABLE "ClaimAppeal" ADD CONSTRAINT "ClaimAppeal_filedById_fkey"
  FOREIGN KEY ("filedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimAppeal" ADD CONSTRAINT "ClaimAppeal_reviewedById_fkey"
  FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 근거 없는 이의는 관리자가 판단할 것이 없다 (`ClaimRequest_reason_check` 와 같은
-- 판단). 공백만 적은 문자열도 비어 있는 것으로 친다 — 계약의 `.trim()` 은 HTTP 로
-- 들어오는 길에만 걸리고, 표를 직접 쓰는 길은 그것을 지나지 않는다.
ALTER TABLE "ClaimAppeal" ADD CONSTRAINT "ClaimAppeal_reason_check"
  CHECK (btrim("reason") <> '');

-- **검토의 세 열은 함께 채워지거나 함께 빈다.**
--
-- 하나만 채워진 행은 전부 말이 안 된다 — 결론 없이 시각만 있으면 「검토했는데 뭐라고
-- 했는지 모르는」 이의이고, 시각 없이 결론만 있으면 언제 정해졌는지 모르는 결론이며,
-- 사람 없는 결론은 개입 이력이 답해야 할 「누가」를 잃는다. 그리고 **기각에는 사유가
-- 반드시 있다**: 인용의 근거는 개입 클레임의 이력에 적히지만, 기각은 그것이 없어
-- 여기 말고는 적힐 자리가 없다.
ALTER TABLE "ClaimAppeal" ADD CONSTRAINT "ClaimAppeal_review_check"
  CHECK (
    ("reviewedAt" IS NULL AND "reviewedById" IS NULL AND "outcome" IS NULL AND "reviewNote" IS NULL)
    OR
    ("reviewedAt" IS NOT NULL AND "reviewedById" IS NOT NULL AND "outcome" IS NOT NULL
     AND ("outcome" <> 'DISMISSED' OR btrim(COALESCE("reviewNote", '')) <> ''))
  );
