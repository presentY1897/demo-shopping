-- 신고 (TASK-0091)
--
-- **자동 임시 숨김이 이 표의 존재 이유다.** 관리자가 즉시 대응할 수 없는 시간대에
-- 악성 콘텐츠가 노출된 채 남는 것을 막는다 — 임계치를 넘으면 일단 가리고, 반려하면
-- 복구된다. 그래서 「가려진 이유」가 신고 수에 있고, 그것을 세려면 신고가 행이어야
-- 한다.

CREATE TYPE "ReportTargetType" AS ENUM ('REVIEW', 'QUESTION', 'ANSWER', 'PRODUCT');
CREATE TYPE "ReportReason" AS ENUM ('ABUSE', 'SPAM', 'FALSE_INFO', 'PRIVACY', 'OTHER');
CREATE TYPE "ReportStatus" AS ENUM ('PENDING', 'HIDDEN', 'REMOVED', 'REJECTED');

CREATE TABLE "Report" (
    "id" UUID NOT NULL,
    "targetType" "ReportTargetType" NOT NULL,
    "targetId" UUID NOT NULL,
    "reporterId" UUID NOT NULL,
    "reason" "ReportReason" NOT NULL,
    "detail" TEXT,
    "status" "ReportStatus" NOT NULL DEFAULT 'PENDING',
    "handledById" UUID,
    "handledAt" TIMESTAMP(3),
    "handledNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- **같은 사람이 같은 대상을 두 번 신고할 수 없다** (F2). 막지 않으면 한 사람이
-- 임계치를 혼자 채우고, 그러면 자동 임시 숨김이 신고 버튼을 연타할 수 있는 사람의
-- 도구가 된다.
CREATE UNIQUE INDEX "Report_targetType_targetId_reporterId_key"
  ON "Report"("targetType", "targetId", "reporterId");

-- 관리자 목록: 처리 대기부터. 정렬 축이 `id` 인 것은 UUIDv7 이라 시간순이기 때문이다.
CREATE INDEX "Report_status_id_idx" ON "Report"("status", "id" DESC);
-- **이 대상이 몇 번 신고됐나** — 임시 숨김의 임계치가 세는 값이다.
CREATE INDEX "Report_targetType_targetId_status_idx"
  ON "Report"("targetType", "targetId", "status");

ALTER TABLE "Report" ADD CONSTRAINT "Report_reporterId_fkey"
  FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Report" ADD CONSTRAINT "Report_handledById_fkey"
  FOREIGN KEY ("handledById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 「기타」로 신고하면 **무엇이 문제인지 적어야 한다.** 사유 목록을 고정한 것은
-- 분류를 위해서인데, 분류되지 않는 신고에 설명까지 없으면 관리자가 판단할 근거가
-- 하나도 없다.
ALTER TABLE "Report" ADD CONSTRAINT "Report_detail_check"
  CHECK ("reason" <> 'OTHER' OR btrim(COALESCE("detail", '')) <> '');

-- 처리한 신고에는 **누가 언제**가 있다. 반려도 처리다 — 「아무 일도 없었다」가
-- 아니라 「보고 아니라고 판단했다」이고, 그 판단에도 사람과 시각이 있다.
ALTER TABLE "Report" ADD CONSTRAINT "Report_handled_check"
  CHECK (
    ("status" = 'PENDING' AND "handledById" IS NULL AND "handledAt" IS NULL)
    OR ("status" <> 'PENDING' AND "handledById" IS NOT NULL AND "handledAt" IS NOT NULL)
  );

-- 신고로 가려진 시각 (TASK-0091). 상태 열거형이 아니라 시각인 이유는 **언제
-- 가려졌나가 답이어야 하는 질문**이기 때문이다.
ALTER TABLE "ProductQuestion" ADD COLUMN "hiddenAt" TIMESTAMP(3);
ALTER TABLE "ProductAnswer" ADD COLUMN "hiddenAt" TIMESTAMP(3);
