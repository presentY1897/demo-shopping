-- 알림 (TASK-0090)
--
-- **알림 생성이 원래 작업을 지연시키지 않는다** (F6). 주문 상태 변경 트랜잭션에 알림
-- 생성이 끼면 실패 지점이 늘어나고, 그 실패는 「배송 처리가 안 됐다」로 나타난다 —
-- 알림을 못 받는 것과 물건이 안 가는 것은 다른 일이다.

CREATE TYPE "NotificationType" AS ENUM (
  'ORDER_STATUS',
  'CLAIM_STATUS',
  'REVIEW_REPLY',
  'QUESTION_ANSWER',
  'RESTOCK',
  'NEW_PRODUCT',
  'SELLER_SETTLEMENT',
  'SELLER_ORDER',
  'SELLER_CLAIM',
  'ADMIN_SELLER_APPLICATION'
);

CREATE TABLE "Notification" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- 알림함과 **미읽음 배지**가 같은 인덱스를 쓴다. `readAt` 이 가운데인 것은 배지가
-- 「안 읽은 것」만 세기 때문이다.
CREATE INDEX "Notification_userId_readAt_id_idx"
  ON "Notification"("userId", "readAt", "id" DESC);
-- 오래된 알림 정리 배치가 읽는다.
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");

ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 빈 알림은 알림이 아니다. 제목만 있고 본문이 빈 알림은 배지를 올리면서 아무것도
-- 말하지 않는다.
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_text_check"
  CHECK (btrim("title") <> '' AND btrim("body") <> '');

-- **링크는 앱 안의 경로다.** 전체 주소를 넣으면 배포마다 달라지는 값이 데이터에
-- 굳고, 도메인을 옮기는 날 지난 알림이 전부 남의 사이트를 가리킨다.
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_link_check"
  CHECK ("link" IS NULL OR "link" ~ '^/[^\s]*$');
