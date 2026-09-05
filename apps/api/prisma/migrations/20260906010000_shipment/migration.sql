-- 배송 · 운송장 (TASK-0061).
--
-- 운송사에 연동하지 않는다. 도메인과 상태 전이는 실제와 같게 두고 운송장·추적만
-- 가상으로 만든다 (CLAUDE.md 5장). 그래서 이 마이그레이션이 실제로 지키는 것은
-- **「진짜 운송장과 헷갈리지 않는다」**와 **「발송했는데 운송장이 없는 상태가 만들어질
-- 수 없다」** 둘이고, 둘 다 아래 손으로 쓴 SQL 이 맡는다.
--
-- 생성물에서 이 변경과 무관한 `Category_path_idx` 의 DROP + CREATE 를 뺐다.

-- CreateEnum
CREATE TYPE "ShipmentStatus" AS ENUM ('READY', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED');

-- CreateEnum
CREATE TYPE "TrackingEventKind" AS ENUM ('PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED');

-- CreateTable
CREATE TABLE "Shipment" (
    "id" UUID NOT NULL,
    "sellerOrderId" UUID NOT NULL,
    "carrierCode" TEXT NOT NULL,
    "carrierName" TEXT NOT NULL,
    "trackingNumber" TEXT NOT NULL,
    "status" "ShipmentStatus" NOT NULL DEFAULT 'READY',
    "shippedAt" TIMESTAMP(3) NOT NULL,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipmentTrackingEvent" (
    "id" UUID NOT NULL,
    "shipmentId" UUID NOT NULL,
    "kind" "TrackingEventKind" NOT NULL,
    "location" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShipmentTrackingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_sellerOrderId_key" ON "Shipment"("sellerOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_trackingNumber_key" ON "Shipment"("trackingNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_sellerOrderId_trackingNumber_key" ON "Shipment"("sellerOrderId", "trackingNumber");

-- CreateIndex
CREATE INDEX "ShipmentTrackingEvent_shipmentId_occurredAt_idx" ON "ShipmentTrackingEvent"("shipmentId", "occurredAt");

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_sellerOrderId_fkey" FOREIGN KEY ("sellerOrderId") REFERENCES "SellerOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentTrackingEvent" ADD CONSTRAINT "ShipmentTrackingEvent_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 운송사 코드는 대문자 두 글자다. 길이가 자유로우면 아래 번호 형식이 사실상
-- 검사하지 않는 것이 된다 — `DEMO--000000000001` 도 「접두어 + 코드 + 12자리」다.
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_carrierCode_format_check"
  CHECK ("carrierCode" ~ '^[A-Z]{2}$');

-- **운송장 번호가 실제 번호와 구분되는 것은 이 줄이 지킨다** (F2 · R1).
--
-- 접두어를 애플리케이션만 붙이면, 생성기가 하나가 아니게 되는 날 — 시드, 백필,
-- 나중의 배송 시뮬레이터(TASK-0062) — 형식이 조용히 갈라진다. 그때 잃는 것은
-- 「이것은 진짜 운송장이 아니다」라는 성질 하나뿐이고, 화면의 「가상 배송 정보」
-- 안내는 스크린샷 한 장이 지나가는 순간 사라진다.
--
-- 가운데 칸을 상수가 아니라 **그 행의 `carrierCode`** 로 쓰는 것이 이 CHECK 의
-- 절반이다. 번호와 운송사 컬럼이 서로 다른 운송사를 가리키면 조회 화면은 한
-- 배송에 대해 두 가지를 말하게 되고, 어느 쪽이 맞는지 아무도 모른다.
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_trackingNumber_format_check"
  CHECK ("trackingNumber" ~ ('^DEMO-' || "carrierCode" || '-[0-9]{12}$'));

-- 배송완료와 완료 시각은 함께 있거나 함께 없다. 한쪽만 있는 행은 「끝났는데 언제
-- 끝났는지 모르는 배송」이거나 「끝난 시각이 있는데 진행 중인 배송」이다.
-- `PaymentEvent_transition_check` 가 같은 모양이다.
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_delivered_check"
  CHECK (("deliveredAt" IS NULL) = ("status" <> 'DELIVERED'));

-- 완료가 발송보다 앞설 수 없다. 시뮬레이터(TASK-0062)가 시각을 거꾸로 적으면
-- 타임라인이 뒤집히는데, 그것은 빨간 테스트가 아니라 이상한 화면으로 나타난다.
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_deliveredAt_check"
  CHECK ("deliveredAt" IS NULL OR "deliveredAt" >= "shippedAt");

-- 장소와 문장은 비어 있을 수 없다. 추적 이력의 한 줄이 답해야 하는 것이
-- 「언제·어디서·무슨 일」 셋인데, 빈 문자열은 답이 아니라 빈 칸이다.
ALTER TABLE "ShipmentTrackingEvent" ADD CONSTRAINT "ShipmentTrackingEvent_text_check"
  CHECK (btrim("location") <> '' AND btrim("description") <> '');

-- **운송장 번호의 단일 출처를 `Shipment` 로 옮기는 줄이다** (TASK-0059 가 예고한 것).
--
-- `SellerOrder.trackingNumber` 를 지우지 않고 남긴 이유는 전이를 판정하는 자리
-- 때문이다. `SellerOrderService.lock()` 은 잠근 **그 행의 컬럼만** 읽는 한 문장이라
-- 잠금을 기다린 뒤 앞사람이 커밋한 값을 다시 읽는데, 다른 표를 함께 읽으면 문장이
-- 시작할 때의 스냅샷을 들고 와 **낡은 상태로 판단한다.** 사실을 `Shipment` 로
-- 옮기면 그 한 문장이 조인이 되므로, 판정이 읽는 사실만 그 자리에 남기고 번호가
-- 뜻하는 나머지 전부(운송사·상태·시각·추적)를 옮겼다.
--
-- 남은 사본이 원본과 갈라지지 않게 하는 것이 이 외래키다. 가리키는 것이
-- `Shipment(sellerOrderId, trackingNumber)` 라서 **자기 배송의 번호가 아닌 값은 이
-- 칸에 들어올 수 없다** — 시드가 손으로 번호를 적어 넣는 것도, 나중에 다른 코드가
-- 남의 번호를 복사하는 것도 DB 가 거절한다. 그래서 「발송됐는데 운송장이 없다」는
-- 애플리케이션의 약속이 아니라 구조가 된다.
--
-- MATCH SIMPLE(기본)이라 `trackingNumber` 가 NULL 인 동안은 아무것도 요구하지
-- 않는다. 발송 전에는 배송 행이 없어야 하므로 그 성질이 필요하다.
--
-- Prisma 는 이 외래키를 모른다(PSL 로 두 열짜리 참조를 적을 수 없다). 다음 사람이
-- `migrate diff` 를 돌리면 생성물에 이 제약의 DROP 이 섞여 나올 수 있으니,
-- `Category_path_idx` 와 같은 방식으로 **지우고** 커밋한다.
ALTER TABLE "SellerOrder" ADD CONSTRAINT "SellerOrder_trackingNumber_shipment_fkey"
  FOREIGN KEY ("id", "trackingNumber") REFERENCES "Shipment"("sellerOrderId", "trackingNumber")
  ON DELETE RESTRICT ON UPDATE CASCADE;
