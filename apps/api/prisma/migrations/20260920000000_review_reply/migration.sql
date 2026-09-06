-- 리뷰에 대한 판매자의 답변 (TASK-0085)
--
-- **리뷰당 하나**이고, 그것을 기본키가 만든다 — `reviewId` 자체가 열쇠라 두 번째
-- 답변은 저장될 자리가 없다 (F3). 「두 번 쓰면 400」과 「두 번 쓰면 수정」 중 무엇을
-- 고르든 그 판단이 애플리케이션에 있으면 우회 경로가 생기는 날 뚫린다.

CREATE TABLE "ReviewReply" (
    "reviewId" UUID NOT NULL,
    "sellerId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewReply_pkey" PRIMARY KEY ("reviewId")
);

CREATE INDEX "ReviewReply_sellerId_createdAt_idx" ON "ReviewReply"("sellerId", "createdAt" DESC);

ALTER TABLE "ReviewReply" ADD CONSTRAINT "ReviewReply_reviewId_fkey"
  FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReviewReply" ADD CONSTRAINT "ReviewReply_sellerId_fkey"
  FOREIGN KEY ("sellerId") REFERENCES "Seller"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReviewReply" ADD CONSTRAINT "ReviewReply_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 빈 답변은 답변이 아니다. 공백만 적고 넘어갈 수 있으면 「답변 완료」로 세어지는
-- 빈칸이 생기고, 미답변 뱃지가 0이 되는데 구매자에게는 아무 말도 도착하지 않는다.
ALTER TABLE "ReviewReply" ADD CONSTRAINT "ReviewReply_content_check"
  CHECK (btrim("content") <> '');
