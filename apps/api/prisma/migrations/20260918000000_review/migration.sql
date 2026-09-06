-- 리뷰 (TASK-0083)
--
-- **구매 검증을 애플리케이션이 아니라 스키마가 강제한다** (`erd.md` 9장). 코드 검사는
-- 우회 경로가 생기면 뚫리지만, `orderItemId` 를 필수 유니크로 두면 **구매하지 않은
-- 사람은 참조할 행이 없어 애초에 만들 수 없다.** 중복도 같은 제약이 막는다.

CREATE TYPE "ReviewStatus" AS ENUM ('PUBLISHED', 'HIDDEN', 'DELETED');

-- **어느 상품을 샀나**를 주문 항목에 적는다.
--
-- 조합(`variantId`)에서 조인으로 알 수 있는 값이지만, 리뷰가 「이 상품을 샀다」를
-- **조회 없이 증명**하려면 그 사실이 한 표 안에 있어야 한다. 아래 복합 외래키 둘이
-- 이어져 `Review.productId` 는 그 주문 항목의 상품일 수밖에 없게 된다.
--
-- 있는 행은 조합에서 채운다 — 지금까지도 참이었던 사실을 규칙이 아니라 데이터로
-- 옮기는 것뿐이다.
ALTER TABLE "OrderItem" ADD COLUMN "productId" UUID;

UPDATE "OrderItem" oi
   SET "productId" = pv."productId"
  FROM "ProductVariant" pv
 WHERE pv."id" = oi."variantId";

ALTER TABLE "OrderItem" ALTER COLUMN "productId" SET NOT NULL;

-- 조합 외래키를 복합으로 바꾼다. **자기 조합의 상품이 아닌 값은 이 칸에 들어올 수
-- 없다** — 사본이 원본과 갈라지지 않는 것은 규율이 아니라 이 제약이 지킨다.
ALTER TABLE "OrderItem" DROP CONSTRAINT "OrderItem_variantId_fkey";

ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_variantId_productId_fkey"
  FOREIGN KEY ("variantId", "productId") REFERENCES "ProductVariant"("id", "productId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- 리뷰가 가리킬 자리. 주문 항목마다 인덱스 하나를 더 쓰는 값이고, 그 값으로 사는
-- 것은 **거짓말할 수 없는 사본**이다.
CREATE UNIQUE INDEX "OrderItem_id_productId_key" ON "OrderItem"("id", "productId");

CREATE TABLE "Review" (
    "id" UUID NOT NULL,
    "orderItemId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "rating" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "status" "ReviewStatus" NOT NULL DEFAULT 'PUBLISHED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReviewImage" (
    "id" UUID NOT NULL,
    "reviewId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewImage_pkey" PRIMARY KEY ("id")
);

-- **이 한 줄이 구매 검증이자 중복 방지다** (F1 · F2).
CREATE UNIQUE INDEX "Review_orderItemId_key" ON "Review"("orderItemId");

-- 상품 상세의 리뷰 목록: 이 상품의 보이는 리뷰를 최신순으로. 정렬 축이 `id` 인 것은
-- UUIDv7 이라 시간순이기 때문이다 — `createdAt` 으로 정렬하면 같은 밀리초에 쓰인 두
-- 리뷰에서 커서가 한 건을 건너뛰거나 두 번 보여 준다.
CREATE INDEX "Review_productId_status_id_idx" ON "Review"("productId", "status", "id" DESC);
CREATE INDEX "Review_userId_id_idx" ON "Review"("userId", "id" DESC);

-- 복합 외래키를 쓰기 위한 형식. `orderItemId` 만으로도 이미 유니크이므로 더 막는
-- 것은 없다.
CREATE UNIQUE INDEX "Review_orderItemId_productId_key" ON "Review"("orderItemId", "productId");

CREATE UNIQUE INDEX "ReviewImage_reviewId_key_key" ON "ReviewImage"("reviewId", "key");
CREATE UNIQUE INDEX "ReviewImage_reviewId_position_key" ON "ReviewImage"("reviewId", "position");

-- **리뷰의 상품 = 그 주문 항목의 상품.** 이 한 줄이 「이 상품의 리뷰」를 조회 없이
-- 참으로 만든다 — 사지 않은 상품의 리뷰는 가리킬 행이 없어 저장될 수 없다.
ALTER TABLE "Review" ADD CONSTRAINT "Review_orderItemId_productId_fkey"
  FOREIGN KEY ("orderItemId", "productId") REFERENCES "OrderItem"("id", "productId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Review" ADD CONSTRAINT "Review_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Review" ADD CONSTRAINT "Review_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ReviewImage" ADD CONSTRAINT "ReviewImage_reviewId_fkey"
  FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 1~5 별. 범위를 DB 가 강제하는 이유는 **평균이 이 값을 나누기** 때문이다 — 0이나
-- 6이 섞이면 `Product.ratingAvg` 가 0~500 범위를 벗어나고, 그것을 막는 제약이
-- 저쪽에 이미 있어서 **집계가 통째로 실패한다.**
ALTER TABLE "Review" ADD CONSTRAINT "Review_rating_check"
  CHECK ("rating" BETWEEN 1 AND 5);

-- 빈 리뷰는 리뷰가 아니다. 공백만 적고 넘어갈 수 있으면 별점만 남기는 길이 열리고,
-- 그것은 평균을 움직이면서 아무 근거도 남기지 않는다.
ALTER TABLE "Review" ADD CONSTRAINT "Review_content_check"
  CHECK (btrim("content") <> '');

-- 사진의 자리는 0부터. 음수 자리는 정렬을 뒤집는다.
ALTER TABLE "ReviewImage" ADD CONSTRAINT "ReviewImage_position_check"
  CHECK ("position" >= 0);

-- **열쇠의 접두어가 쓴 사람이다.** 열쇠 하나만 보고 누구 것인지 말할 수 있어야
-- 남의 사진을 자기 리뷰에 붙이는 요청이 조용히 통과하지 않는다 (`uploads.ts` 의
-- `returnPhotoKeyPattern` 과 같은 판단). 그 판정이 믿는 모양을 DB 가 함께 지킨다.
ALTER TABLE "ReviewImage" ADD CONSTRAINT "ReviewImage_key_format_check"
  CHECK ("key" ~ '^reviews/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpeg|jpg|png|webp)$');
