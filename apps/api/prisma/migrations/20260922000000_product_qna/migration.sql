-- 상품 문의 (TASK-0088)
--
-- **비공개 문의의 접근 제어는 API 가 한다** (4장). 목록은 조건으로 거르고 상세는
-- 다시 확인한다 — 화면에서 숨기는 방식은 응답에 이미 실려 나간 것을 가리는 일이라
-- 개발자 도구 하나로 뚫린다. DB 가 할 수 있는 것은 그 판단이 읽을 사실을 정직하게
-- 들고 있는 것뿐이고, 그것이 `isPublic` 한 칸이다.

CREATE TABLE "ProductQuestion" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductQuestion_pkey" PRIMARY KEY ("id")
);

-- 정렬 축이 `id` 인 것은 UUIDv7 이라 시간순이기 때문이다 — `createdAt` 으로 정렬하면
-- 같은 밀리초에 쓰인 두 문의에서 커서가 한 건을 건너뛰거나 두 번 보여 준다.
CREATE INDEX "ProductQuestion_productId_id_idx" ON "ProductQuestion"("productId", "id" DESC);
CREATE INDEX "ProductQuestion_userId_id_idx" ON "ProductQuestion"("userId", "id" DESC);

CREATE TABLE "ProductAnswer" (
    "questionId" UUID NOT NULL,
    "sellerId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductAnswer_pkey" PRIMARY KEY ("questionId")
);

CREATE INDEX "ProductAnswer_sellerId_createdAt_idx" ON "ProductAnswer"("sellerId", "createdAt" DESC);

ALTER TABLE "ProductQuestion" ADD CONSTRAINT "ProductQuestion_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductQuestion" ADD CONSTRAINT "ProductQuestion_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductAnswer" ADD CONSTRAINT "ProductAnswer_questionId_fkey"
  FOREIGN KEY ("questionId") REFERENCES "ProductQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductAnswer" ADD CONSTRAINT "ProductAnswer_sellerId_fkey"
  FOREIGN KEY ("sellerId") REFERENCES "Seller"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductAnswer" ADD CONSTRAINT "ProductAnswer_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 빈 문의도 빈 답변도 없다. 공백만 적고 넘어갈 수 있으면 「답변 완료」로 세어지는
-- 빈칸이 생기고, 미답변 목록에서 사라지는데 물어본 사람에게는 아무 말도 도착하지 않는다.
ALTER TABLE "ProductQuestion" ADD CONSTRAINT "ProductQuestion_content_check"
  CHECK (btrim("content") <> '');
ALTER TABLE "ProductAnswer" ADD CONSTRAINT "ProductAnswer_content_check"
  CHECK (btrim("content") <> '');
