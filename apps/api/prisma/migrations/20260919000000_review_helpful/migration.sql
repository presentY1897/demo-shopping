-- 도움돼요 (TASK-0084)
--
-- **한 사람이 한 리뷰에 한 번**이고, 그것을 복합 기본키가 만든다. 따로 id 를 두지
-- 않는 이유는 이 행이 가리키는 것이 곧 그 두 값이기 때문이다 — 「누가 무엇에
-- 눌렀나」 말고 이 표에 다른 사실이 없다.

CREATE TABLE "ReviewHelpful" (
    "reviewId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewHelpful_pkey" PRIMARY KEY ("reviewId","userId")
);

CREATE INDEX "ReviewHelpful_userId_idx" ON "ReviewHelpful"("userId");

ALTER TABLE "ReviewHelpful" ADD CONSTRAINT "ReviewHelpful_reviewId_fkey"
  FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReviewHelpful" ADD CONSTRAINT "ReviewHelpful_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 「도움순」 정렬의 축. `ReviewHelpful` 을 매번 세는 정렬은 목록 한 장에 상관
-- 부질의를 리뷰 수만큼 만든다.
ALTER TABLE "Review" ADD COLUMN "helpfulCount" INTEGER NOT NULL DEFAULT 0;

-- 캐시라 어긋날 수 있고, **마지막 방어선은 DB** 다. 음수가 되면 「도움순」 정렬이
-- 뒤집히고, 그 증상은 오류가 아니라 이상한 순서다.
ALTER TABLE "Review" ADD CONSTRAINT "Review_helpfulCount_check"
  CHECK ("helpfulCount" >= 0);

-- 정렬 축마다 인덱스가 있다. 커서가 `(정렬 값, id)` 두 칸을 굳히므로 인덱스도 두
-- 칸이어야 하고, 그러지 않으면 페이지를 넘길 때마다 정렬 전체를 다시 한다.
CREATE INDEX "Review_productId_status_helpfulCount_id_idx"
  ON "Review"("productId", "status", "helpfulCount" DESC, "id" DESC);
CREATE INDEX "Review_productId_status_rating_id_idx"
  ON "Review"("productId", "status", "rating" DESC, "id" DESC);
