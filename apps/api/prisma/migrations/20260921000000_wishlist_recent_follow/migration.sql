-- 찜 · 최근 본 상품 · 팔로우 (TASK-0086 · 0087 · 0089)
--
-- 셋 다 「사람이 무엇을 가리킨다」 하나뿐인 표이고, 그래서 **복합 기본키**를 쓴다.
-- 따로 id 를 두면 같은 짝이 두 번 들어올 수 있고 그것을 막는 유니크가 다시
-- 필요해진다 — 열쇠가 곧 그 사실이면 막을 것이 없다.

CREATE TABLE "Wishlist" (
    "userId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "addedPrice" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Wishlist_pkey" PRIMARY KEY ("userId","productId")
);

CREATE INDEX "Wishlist_userId_createdAt_idx" ON "Wishlist"("userId", "createdAt" DESC);

CREATE TABLE "RecentlyViewed" (
    "userId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "viewedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecentlyViewed_pkey" PRIMARY KEY ("userId","productId")
);

-- 「최근 본 상품」과 **정리 대상 찾기**가 같은 인덱스를 쓴다 (TASK-0087 F5).
CREATE INDEX "RecentlyViewed_userId_viewedAt_idx" ON "RecentlyViewed"("userId", "viewedAt" DESC);

CREATE TABLE "SellerFollow" (
    "userId" UUID NOT NULL,
    "sellerId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SellerFollow_pkey" PRIMARY KEY ("userId","sellerId")
);

CREATE INDEX "SellerFollow_userId_createdAt_idx" ON "SellerFollow"("userId", "createdAt" DESC);
-- 「이 브랜드의 팔로워」 — 신상품 알림이 읽는다 (TASK-0090).
CREATE INDEX "SellerFollow_sellerId_idx" ON "SellerFollow"("sellerId");

ALTER TABLE "Wishlist" ADD CONSTRAINT "Wishlist_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Wishlist" ADD CONSTRAINT "Wishlist_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RecentlyViewed" ADD CONSTRAINT "RecentlyViewed_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecentlyViewed" ADD CONSTRAINT "RecentlyViewed_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SellerFollow" ADD CONSTRAINT "SellerFollow_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SellerFollow" ADD CONSTRAINT "SellerFollow_sellerId_fkey"
  FOREIGN KEY ("sellerId") REFERENCES "Seller"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 담을 때의 가격은 음수가 아니다. 「가격이 내렸다」를 그리는 값이라, 음수가 섞이면
-- 그 화면이 말이 안 되는 변동폭을 그린다.
ALTER TABLE "Wishlist" ADD CONSTRAINT "Wishlist_addedPrice_check"
  CHECK ("addedPrice" IS NULL OR "addedPrice" >= 0);

-- 팔로워 수 (TASK-0089 F3). **매번 세지 않는 이유는 브랜드관이 이 값을 그리기**
-- 때문이다. 캐시라 어긋날 수 있고, **마지막 방어선은 DB** 다 — 음수 팔로워 수는
-- 오류가 아니라 이상한 숫자로만 나타난다.
ALTER TABLE "Seller" ADD COLUMN "followerCount" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Seller" ADD CONSTRAINT "Seller_followerCount_check"
  CHECK ("followerCount" >= 0);
