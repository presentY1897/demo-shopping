-- 쿠폰의 발행자 (TASK-0073)
--
-- 권한 층이 「이 쿠폰은 어느 그룹의 것인가」에 답하려면 **주인이 있어야 한다.**
-- 판매자 쿠폰의 주인은 `sellerId` 가 가리키는 스토어이고 스코프가 거기에 닿지만,
-- 플랫폼 쿠폰에는 소유하는 스토어가 없다. 그래서 데모 관리자가 낸 쿠폰과 진짜
-- 관리자가 낸 쿠폰이 지금까지 구분되지 않았고, 그것이 「데모 관리자는 플랫폼 쿠폰을
-- 아예 낼 수 없다」로 나타났다 — 발행 화면이 방문자에게 읽기 전용 껍데기가 된다.
--
-- `NULL` 은 **이 컬럼이 생기기 전에 발행된 행**이다. `couponOwnership` 이 그것을
-- 플랫폼 소유로 읽으므로 그때까지의 동작이 그대로 유지된다 — 기본값을 지어내
-- 아무 관리자에게 남의 쿠폰을 붙이는 것보다, 「모른다」를 모른다고 두는 편이 맞다.
ALTER TABLE "Coupon" ADD COLUMN "issuedByUserId" UUID;

-- `RESTRICT`: 쿠폰을 낸 계정은 그 정책이 남아 있는 한 지워지지 않는다. 탈퇴는
-- 소프트 삭제이고 데모 만료도 툼스톤을 남기므로(`demo-cleanup-plan.ts`) 이 참조가
-- 끊길 일은 없다 — 끊긴다면 그것은 「누가 냈는지 모르는 쿠폰」이 생기는 일이다.
ALTER TABLE "Coupon" ADD CONSTRAINT "Coupon_issuedByUserId_fkey"
  FOREIGN KEY ("issuedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 「내가 낸 쿠폰」 목록. 관리자·판매자 콘솔이 자기 것부터 최신순으로 읽는다.
CREATE INDEX "Coupon_issuedByUserId_createdAt_idx"
  ON "Coupon"("issuedByUserId", "createdAt" DESC);
