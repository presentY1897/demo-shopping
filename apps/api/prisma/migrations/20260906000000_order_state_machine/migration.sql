-- 상태 전이에 주체를 적고, 발송이 요구하는 것을 담는다 (TASK-0059).
--
-- 두 가지가 모자랐다.
--
-- ① **이력이 「누가」에 답하지 못했다.** `actorId` 만 있어서 `null` 이 「스케줄러가
--    했다」와 「사람이 했는데 안 적었다」를 함께 뜻했다. 상태 머신의 주체는 역할이
--    아니라 「이 전이를 누가 일으켰는가」이고(`OrderActor`), 그것을 적지 않으면
--    「관리자가 확정했다」와 「D+7 이 지나 자동 확정됐다」가 이력에서 같아 보인다.
--
-- ② **`PREPARING → SHIPPED` 가 요구하는 것을 담을 곳이 없었다.** 「보냈다」는데
--    어디 있는지 모르는 상태를 막으려면 운송장이 붙었다는 사실이 행에 있어야 한다.
--    운송사와 추적 이벤트는 TASK-0061 의 `Shipment` 가 갖는다 — 여기 있는 것은
--    상태 머신이 읽는 **한 가지 사실**뿐이다.

-- CreateEnum
CREATE TYPE "OrderActor" AS ENUM ('BUYER', 'SELLER', 'ADMIN', 'SYSTEM');

-- AlterTable
--
-- 기본값을 **붙였다가 뗀다.** 이미 있는 행에 값을 주려면 붙여야 하고, 그대로 두면
-- 앞으로 이력을 쓰는 코드가 주체를 말하지 않아도 통과한다 — 그때 기록되는
-- `SYSTEM` 은 「모른다」가 아니라 「기계가 했다」는 거짓이다.
ALTER TABLE "OrderStatusHistory" ADD COLUMN "actor" "OrderActor" NOT NULL DEFAULT 'SYSTEM';

-- 지금까지 이 표에 줄을 쓴 것은 셋뿐이다: 주문 생성, `OrderService.markPaid`,
-- 예약 만료 스케줄러. 뒤의 둘은 사람이 없는 전이라 `SYSTEM` 이 맞고, 앞의 것은
-- **산 사람이 일으킨 것**이라 `BUYER` 다 — 그 줄은 `fromStatus` 가 없는 유일한
-- 줄이라 조건으로 그대로 쓸 수 있다.
UPDATE "OrderStatusHistory" SET "actor" = 'BUYER' WHERE "fromStatus" IS NULL;

ALTER TABLE "OrderStatusHistory" ALTER COLUMN "actor" DROP DEFAULT;

-- AlterTable
ALTER TABLE "SellerOrder" ADD COLUMN "trackingNumber" TEXT;
