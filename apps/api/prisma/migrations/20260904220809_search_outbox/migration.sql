-- 검색 인덱스 아웃박스 (TASK-0038 4장)
--
-- 상품 저장 트랜잭션 **안에서** 행이 생기고, 트랜잭션 **밖에서** 워커가 처리한다.
-- 한 트랜잭션에 묶으면 검색 엔진 장애가 상품 등록을 막고, 트랜잭션 밖에서 직접
-- 부르면 커밋이 실패했을 때 유령 문서가 남는다. 아웃박스는 둘 다 피한다.
--
-- 이 파일은 `prisma migrate dev` 가 만든 것을 손본 것이다. 생성물에는 이 변경과
-- 무관한 `Category_path_idx` 의 DROP + CREATE 가 함께 들어 있었다 —
-- `@@index([path(ops: raw("text_pattern_ops"))])` 가 Prisma 에서 왕복하지 않아
-- **모든** 새 마이그레이션에 같은 것이 섞인다. 같은 정의로 다시 만드는 no-op 이고,
-- 큰 테이블에서는 잠금이므로 뺐다.

-- CreateEnum
--
-- 동사가 둘뿐인 이유: 「생성 · 수정 · 재고 변동 · 가격 변동」은 전부 같은 곳에서
-- 끝난다 — 문서를 지금의 행에서 다시 만든다. 어느 것이었는지 적어 두면 아무도
-- 읽지 않는 것을 적는 것이다. REMOVE 만 다르다. 읽을 행이 없다.
CREATE TYPE "SearchOutboxKind" AS ENUM ('UPSERT', 'REMOVE');

-- CreateTable
CREATE TABLE "SearchOutbox" (
    "id" BIGSERIAL NOT NULL,
    "productId" UUID NOT NULL,
    "kind" "SearchOutboxKind" NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SearchOutbox_pkey" PRIMARY KEY ("id")
);

-- 큐의 읽기는 `WHERE "nextAttemptAt" <= now() ORDER BY "nextAttemptAt"` 하나다.
-- 거르는 열과 정렬하는 열이 같으므로 인덱스도 하나면 된다.
--
-- `productId` 에는 인덱스를 두지 않는다. 워커는 **이미 읽어 온 배치 안에서**
-- 중복을 접으므로 그 열로 조회하지 않고, 인덱스를 하나 더 두면 상품을 쓸 때마다
-- 일어나지 않는 조회의 값을 치르게 된다 (TASK-0030 이 `(categoryId, sortOrder)` 를
-- 뺀 것과 같은 이유).
CREATE INDEX "SearchOutbox_nextAttemptAt_idx" ON "SearchOutbox"("nextAttemptAt");

-- 시도 횟수는 음수가 될 수 없다. 워커가 감소시키는 경로는 없지만, 없다는 것을
-- 데이터베이스가 알고 있는 편이 낫다.
ALTER TABLE "SearchOutbox" ADD CONSTRAINT "SearchOutbox_attempts_check"
  CHECK ("attempts" >= 0);

-- `productId` 에 외래키를 걸지 않는다.
--
-- REMOVE 이벤트는 **행이 사라진 뒤에** 처리된다. 외래키가 있으면 상품을 지우는
-- 순간 그 이벤트도 함께 사라지고(Cascade), 인덱스에는 문서가 남는다 — 이 테이블이
-- 막으려던 바로 그 유령이다. Restrict 로 두면 상품을 지울 수 없게 된다.
COMMENT ON COLUMN "SearchOutbox"."productId" IS
  '검색 문서의 id. 외래키가 아니다 — REMOVE 는 행이 사라진 뒤에 처리된다.';
