-- 적립금 원장 (TASK-0076).
--
-- 생성물에서 이 변경과 무관한 두 줄을 **지우고** 커밋했다 — 앞선 마이그레이션들이
-- 같은 자리에서 같은 일을 했다:
--
--   * `Category_path_idx` 의 DROP + CREATE (`text_pattern_ops` 를 Prisma 가 모른다)
--   * `SellerOrder_trackingNumber_shipment_fkey` 의 DROP — 손으로 붙인 복합
--     외래키라 `migrate diff` 가 매번 없애려 든다
--
-- 둘 다 남겨 두면 배포가 이 기능과 아무 상관 없는 인덱스와 제약을 잠깐 없앤다.

-- CreateEnum
CREATE TYPE "PointTransactionType" AS ENUM ('EARN', 'USE', 'RESTORE', 'EXPIRE', 'ADJUST');

-- CreateEnum
CREATE TYPE "PointRefType" AS ENUM ('ORDER', 'SELLER_ORDER', 'CLAIM_REQUEST', 'POINT_TRANSACTION');

-- CreateTable
CREATE TABLE "PointPolicy" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "earnRateBp" INTEGER NOT NULL DEFAULT 100,
    "validityDays" INTEGER NOT NULL DEFAULT 365,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PointPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PointAccount" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PointAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PointTransaction" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "type" "PointTransactionType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "refType" "PointRefType",
    "refId" UUID,
    "reason" TEXT,
    "expiresAt" TIMESTAMP(3),
    "remainingAmount" INTEGER,
    "earnRateBp" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PointTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PointAccount_userId_key" ON "PointAccount"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PointTransaction_accountId_seq_key" ON "PointTransaction"("accountId", "seq");

-- AddForeignKey
ALTER TABLE "PointAccount" ADD CONSTRAINT "PointAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointTransaction" ADD CONSTRAINT "PointTransaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "PointAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- PSL 로 적을 수 없는 것들 — 그리고 **여기까지가 DB 가 지킬 수 있는 전부다**.
--
-- 요구사항은 「원장 합계와 잔액이 항상 일치한다」이고, 그 문장 자체는 아래에 없다.
-- 다른 행들에 대한 집계가 필요한데 CHECK 에는 집계를 쓸 수 없기 때문이다 — 재고
-- 원장이 L1~L4 에서 멈춘 것과 같은 자리다(TASK-0036 4.12). 그래서 일치는
-- `PointsService` 가 계정 행의 잠금 안에서 지키고 `reconcile()` 이 깨진 것을 세며,
-- 아래 제약들은 **그 잠금을 안 쓰는 코드가 하나 생기는 날** 남는 방어선이다.
--
-- 두 층이 지키는 것이 다르다는 것을 TASK-0065 4.1 이 음성 대조로 확인했다:
-- 제약은 **데이터**를 지키고 서비스는 **답**을 지킨다. 잠금을 지우면 잔액은 여전히
-- 음수가 되지 않지만(아래 CHECK 이 잡는다) 진 쪽이 409 대신 500 을 받는다.
-- ---------------------------------------------------------------------------

-- 정책은 한 행이다.
--
-- 「행이 하나뿐인가」를 애플리케이션이 확인하면 동시에 들어온 두 요청이 각자
-- 「없다」를 읽고 각자 만든다. 기본키에 값을 못박으면 둘째 행이 **표현 불가능**해진다
-- — 카테고리 트리에서 순환을 검사 대상이 아니라 표현 불가능으로 만든 것과 같은 수법.
ALTER TABLE "PointPolicy" ADD CONSTRAINT "PointPolicy_singleton_check"
  CHECK ("id" = 1);

-- 적립률은 0~10000 bp.
--
-- **이 값은 실결제금액에 곱해진다.** 음수면 구매확정이 잔액을 깎고, 10000 을 넘으면
-- 산 금액보다 많은 적립금이 지급된다. 둘 다 아무 요청도 실패시키지 않으므로 눈에
-- 띄지 않는다 — `Seller_commissionRateBp_check` 가 정산에 대해 적어 둔 것과 같은
-- 이유이고, 이 값을 `AppMeta`(문자열 표)에 두지 않은 이유이기도 하다.
ALTER TABLE "PointPolicy" ADD CONSTRAINT "PointPolicy_earnRateBp_check"
  CHECK ("earnRateBp" >= 0 AND "earnRateBp" <= 10000);

-- 유효기간은 하루 이상 10년 이하. 0일이면 지급되는 순간 만료되고, 10년 넘게 사는
-- 적립금은 혜택이 아니라 장부에 남는 부채다.
ALTER TABLE "PointPolicy" ADD CONSTRAINT "PointPolicy_validityDays_check"
  CHECK ("validityDays" >= 1 AND "validityDays" <= 3650);

-- 정책 행을 지금 만든다.
--
-- **열쇠만 넣고 나머지는 컬럼 기본값에 맡긴다.** 값을 여기 적으면 `schema.prisma` 의
-- `@default` 와 두 곳이 되고, 두 곳에 적힌 기본값은 반드시 한쪽이 낡는다.
INSERT INTO "PointPolicy" ("id", "updatedAt") VALUES (1, now());

-- **잔액은 음수가 될 수 없다. 이것이 마지막 방어선이다.**
--
-- 서비스가 계정 행을 잠그고 먼저 판단하지만, 동시에 들어온 두 사용이 그 판단을
-- 비껴가는 경로가 생기는 날 — 잠금을 안 쓰는 코드가 하나 추가되는 날 — 지는 쪽을
-- 최종적으로 거절하는 것은 이 줄이다. `ProductVariant_reserved_check` ·
-- `Payment_canceledAmount_check` 와 같은 성격이다: 돈이 걸린 자리에서 방어선이
-- 하나뿐이면 안 된다.
ALTER TABLE "PointAccount" ADD CONSTRAINT "PointAccount_balance_check"
  CHECK ("balance" >= 0);

-- 0원짜리 사건은 사건이 아니다.
--
-- 방향 검사와 따로 둔 이유는 위반이 각각 한 규칙을 가리키게 하기 위해서다 —
-- 0원은 종류와 무관하게 여기서 걸리고, 방향 검사는 `ADJUST` 의 크기에 대해 아무
-- 말도 하지 않는다 (`StockLedger_quantity_check` 와 같은 판단).
ALTER TABLE "PointTransaction" ADD CONSTRAINT "PointTransaction_amount_check"
  CHECK ("amount" <> 0);

-- 종류가 부호를 정한다.
--
-- 부호가 뒤집힌 행은 「고치면 되는 행」이 아니라 **원장을 읽는 모든 사람을 틀리게
-- 만드는 행**이다: 합계가 어긋나고, 그 사실은 대사할 때가 되어서야 보인다.
-- `ADJUST` 만 양방향이고, 그래서 이유를 말해야 하는 유일한 종류다.
ALTER TABLE "PointTransaction" ADD CONSTRAINT "PointTransaction_direction_check"
  CHECK (
    CASE "type"
      WHEN 'EARN'    THEN "amount" > 0
      WHEN 'RESTORE' THEN "amount" > 0
      WHEN 'USE'     THEN "amount" < 0
      WHEN 'EXPIRE'  THEN "amount" < 0
      WHEN 'ADJUST'  THEN TRUE
    END
  );

-- 잔액은 **과거의 어느 시점에도** 음수가 아니었다.
--
-- 위의 `PointAccount_balance_check` 는 오늘에 대해 같은 말을 한다. 이 줄이 없으면
-- 「그때 얼마였나」의 답이 불가능한 값일 수 있고, 그러면 `balanceAfter` 를 저장하는
-- 의미가 사라진다.
ALTER TABLE "PointTransaction" ADD CONSTRAINT "PointTransaction_balance_check"
  CHECK ("balanceAfter" >= 0);

-- 자리는 1부터다. 0 이하의 행이 있으면 「seq 가 1..n 이고 빈칸이 없다」(P4)를 셀 수
-- 없고, P4 는 잠금 밖에서 쓰인 행이 드러나는 유일한 자리다.
ALTER TABLE "PointTransaction" ADD CONSTRAINT "PointTransaction_seq_check"
  CHECK ("seq" >= 1);

-- 참조는 두 칸 다이거나 아무것도 아니다.
--
-- 반쪽 참조는 따라갈 수도, 멱등의 열쇠로 쓸 수도 없다 — 아래 부분 유니크 인덱스가
-- `refId` 를 열쇠로 삼으므로, `refType` 만 든 행은 자기가 참여하는 것처럼 보이는
-- 규칙에서 조용히 빠진다.
ALTER TABLE "PointTransaction" ADD CONSTRAINT "PointTransaction_ref_pair_check"
  CHECK (("refType" IS NULL) = ("refId" IS NULL));

-- 적은 사유는 진짜 사유다.
ALTER TABLE "PointTransaction" ADD CONSTRAINT "PointTransaction_reason_blank_check"
  CHECK ("reason" IS NULL OR btrim("reason") <> '');

-- 조정은 왜인지 말한다. 나머지는 이름이 스스로를 설명하지만 조정은 사람의 판단이고,
-- 설명 없는 조정은 나중에 아무도 감사할 수 없다.
ALTER TABLE "PointTransaction" ADD CONSTRAINT "PointTransaction_adjust_reason_check"
  CHECK ("type" <> 'ADJUST' OR "reason" IS NOT NULL);

-- 통(lot) 의 세 칸은 **정확히 `EARN` 에만** 있다.
--
-- 적립 사건과 통이 같은 것이라서 표를 나누지 않았고(나누면 1:1 로 붙어 다니는 두
-- 표가 어긋난 상태가 표현 가능해진다), 그 대가로 「사용 행에 남은 금액이 적혀
-- 있다」 같은 무의미한 행이 가능해진다. 그것을 막는 것이 이 줄이다 — 세 칸이 함께
-- 있고 함께 없다.
ALTER TABLE "PointTransaction" ADD CONSTRAINT "PointTransaction_lot_check"
  CHECK (
    ("type" = 'EARN') = ("expiresAt" IS NOT NULL)
    AND ("type" = 'EARN') = ("remainingAmount" IS NOT NULL)
    AND ("type" = 'EARN') = ("earnRateBp" IS NOT NULL)
  );

-- 통에 남은 것은 0 이상 적립액 이하다.
--
-- 위쪽이 없으면 쓰지도 않은 적립금이 늘어나고, 아래쪽이 없으면 만료가 음수를
-- 기록한다. `VirtualCard_usedAmount_check` 가 한도에 대해 하는 말과 같은 모양이다.
ALTER TABLE "PointTransaction" ADD CONSTRAINT "PointTransaction_remaining_check"
  CHECK ("remainingAmount" IS NULL OR ("remainingAmount" >= 0 AND "remainingAmount" <= "amount"));

-- 원장에 박제된 적립률도 정책과 같은 범위 안이다. 정책 행의 CHECK 이 오늘을 지키고
-- 이 줄이 과거를 지킨다.
ALTER TABLE "PointTransaction" ADD CONSTRAINT "PointTransaction_earnRateBp_check"
  CHECK ("earnRateBp" IS NULL OR ("earnRateBp" >= 0 AND "earnRateBp" <= 10000));

-- 한 참조에 한 사건 — **멱등이 여기서 만들어진다** (F6).
--
-- 구매확정 이벤트는 두 번 도착할 수 있고(수동 확정과 자동 확정이 같은 몫을 스치는
-- 경우), 주문 생성은 재시도되는 경로이며, 만료 배치는 겹쳐 돌 수 있다. 「이미
-- 적립했나」를 애플리케이션이 확인하면 동시에 들어온 둘이 **둘 다 없다를 읽고 둘 다
-- 적립한다.** 둘째 행을 표현 불가능하게 만드는 것만이 그 순간에 알아채는 방법이다.
--
-- 부분 인덱스인 이유는 참조 없는 사건이 정당하게 반복되기 때문이다 — 관리자의
-- 조정 두 번은 조정 두 번이지 중복이 아니다.
CREATE UNIQUE INDEX "PointTransaction_ref_key"
  ON "PointTransaction" ("accountId", "type", "refType", "refId") WHERE "refId" IS NOT NULL;

-- 만료 배치가 훑는 자리 — **아직 남아 있는 통만.**
--
-- 부분 인덱스라 이미 비워진 통이 인덱스에 들어가지 않는다. 원장은 계속 자라지만
-- 이 인덱스는 「살아 있는 적립금」만큼만 자라고, 그것이 배치가 매 분 도는 질의의
-- 크기를 정한다.
CREATE INDEX "PointTransaction_lot_expiry_idx"
  ON "PointTransaction" ("expiresAt") WHERE "remainingAmount" > 0;

-- 원장은 한 번 쓰이고 다시 쓰이지 않는다 — **단 하나의 예외를 빼고.**
--
-- 그 예외가 `remainingAmount` 이고, 줄어들기만 한다. 통이 비어 가는 것은 원장의
-- 수정이 아니라 그 통의 상태이며, 그것을 별도 표로 빼면 1:1 로 붙어 다니는 두 표가
-- 어긋난 상태가 생긴다. 나머지 칸은 전부 잠긴다 — 금액을 고치면 P1 이 깨지고,
-- `balanceAfter` 를 고치면 P2·P3 이 깨지는데, 둘 다 대사할 때가 되어서야 보인다.
--
-- 잘못 적힌 적립금은 반대 방향 `ADJUST` 로 상쇄한다. 누가 무엇을 되돌렸는지가
-- 원장에 남아야 하기 때문이다 (`StockLedger_append_only` 와 같은 판단).
--
-- `RESTRICT` 의 SQLSTATE(23001)와 제약 이름을 함께 실어, 부르는 쪽이 외래키 위반과
-- 같은 모양으로 읽고 검사가 문장이 아니라 규칙 이름을 단언할 수 있게 한다.
-- `TRUNCATE` 는 행 트리거를 실행하지 않으므로 테스트 격리는 영향을 받지 않는다.
CREATE FUNCTION "point_transaction_append_only"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW."id"              IS NOT DISTINCT FROM OLD."id"
     AND NEW."accountId"       IS NOT DISTINCT FROM OLD."accountId"
     AND NEW."seq"             IS NOT DISTINCT FROM OLD."seq"
     AND NEW."type"            IS NOT DISTINCT FROM OLD."type"
     AND NEW."amount"          IS NOT DISTINCT FROM OLD."amount"
     AND NEW."balanceAfter"    IS NOT DISTINCT FROM OLD."balanceAfter"
     AND NEW."refType"         IS NOT DISTINCT FROM OLD."refType"
     AND NEW."refId"           IS NOT DISTINCT FROM OLD."refId"
     AND NEW."reason"          IS NOT DISTINCT FROM OLD."reason"
     AND NEW."expiresAt"       IS NOT DISTINCT FROM OLD."expiresAt"
     AND NEW."earnRateBp"      IS NOT DISTINCT FROM OLD."earnRateBp"
     AND NEW."createdAt"       IS NOT DISTINCT FROM OLD."createdAt"
     AND NEW."remainingAmount" < OLD."remainingAmount"
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION USING
    ERRCODE = '23001',
    MESSAGE = '적립금 원장은 수정하거나 삭제할 수 없습니다. 반대 방향 ADJUST 로 상쇄하세요.',
    CONSTRAINT = 'PointTransaction_append_only',
    TABLE = 'PointTransaction';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PointTransaction_append_only"
  BEFORE UPDATE OR DELETE ON "PointTransaction"
  FOR EACH ROW EXECUTE FUNCTION "point_transaction_append_only"();
