-- 검색어 로그 (TASK-0039 「검색어 로깅」)
--
-- 계정을 적지 않는다. 이 표가 답하려는 것은 「무엇이 인기인가」라는 집계이고,
-- 누가 쳤는지를 적으면 그건 **검색 기록**이 된다 — 아무도 요구하지 않은 용도를
-- 위해 훨씬 민감한 것을 보관하게 된다.
--
-- `resultCount` 가 이 데이터를 쓸모 있게 만드는 절반이다. 결과가 0인 인기
-- 검색어는 이 표에서 가장 유용한 행이다 — 카탈로그에 없는 상품이거나, 동의어
-- 사전이 알아야 할 단어다.
--
-- 생성물에서 이 변경과 무관한 `Category_path_idx` 의 DROP + CREATE 를 뺐다.
-- `@@index([path(ops: raw("text_pattern_ops"))])` 가 Prisma 에서 왕복하지 않아
-- **모든** 새 마이그레이션에 섞인다. 같은 정의로 다시 만드는 no-op 이고 큰
-- 테이블에서는 잠금이다.

-- CreateTable
CREATE TABLE "SearchLog" (
    "id" BIGSERIAL NOT NULL,
    "term" TEXT NOT NULL,
    "resultCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SearchLog_pkey" PRIMARY KEY ("id")
);

-- 「무엇이 인기인가」는 `GROUP BY "term"`, 「최근 일주일」이 그것을 자른다.
CREATE INDEX "SearchLog_term_idx" ON "SearchLog"("term");
CREATE INDEX "SearchLog_createdAt_idx" ON "SearchLog"("createdAt");

-- 결과 수는 음수가 될 수 없다.
ALTER TABLE "SearchLog" ADD CONSTRAINT "SearchLog_resultCount_check"
  CHECK ("resultCount" >= 0);

-- 빈 검색어는 기록하지 않는다. 애플리케이션이 거르지만, 거르지 않았다는 것이
-- 나중에 드러나는 것보다 여기서 막히는 편이 낫다.
ALTER TABLE "SearchLog" ADD CONSTRAINT "SearchLog_term_check"
  CHECK (length("term") > 0);
