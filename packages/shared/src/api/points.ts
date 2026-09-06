import { z } from 'zod'

import { wonSchema } from '../pricing/types.js'

/**
 * 적립금 원장, 계약으로 (TASK-0076).
 *
 * `PointAccount.balance` 가 현재값이고 이 표가 그것을 **설명한다** — 「잔액이 있는
 * 것은 원장을 두고, 현재값은 원장의 결과이며 대사가 가능해야 한다」(CLAUDE.md 6장).
 * 재고(`stock.ts`)·가상카드가 앞선 둘이고 이것이 셋째다.
 *
 * **적립금이 앞의 둘과 다른 점 하나: 유효기간이 있다.** 그래서 `EARN` 한 줄은
 * 사건이면서 동시에 **잔고를 담은 통**이다 — 언제 사라지는지(`expiresAt`)와 아직
 * 얼마가 남았는지(`remainingAmount`)를 그 줄이 들고, 사용은 먼저 사라질 통부터
 * 비운다. 통을 두지 않으면 만료가 계산될 수 없다: 1,000원을 적립받아 전부 쓴 뒤
 * 유효기간이 지났을 때 「무엇이 만료되는가」에 답할 방법이 없고, 순진하게 적립액을
 * 만료시키면 잔액이 음수가 된다.
 */

/**
 * 원장에 남는 사건의 종류.
 *
 * 종류가 **부호**를 정하고 `PointTransaction_direction_check` 가 그것을 DB 에서
 * 지킨다 — 뒤집힌 행 하나는 잘못된 행이 아니라 **원장을 읽는 모든 사람을 틀리게
 * 만드는 행**이고, 그것은 대사할 때가 되어서야 보인다.
 */
export const pointTransactionTypes = [
  /** 구매확정으로 지급됐다. 유효기간을 갖는 유일한 종류다. */
  'EARN',
  /** 주문에 썼다. */
  'USE',
  /** 환불로 되돌아왔다 (TASK-0078). */
  'RESTORE',
  /** 유효기간이 지나 사라졌다. */
  'EXPIRE',
  /** 사람이 고쳤다. 양방향이고, 그래서 사유가 필수인 유일한 종류다. */
  'ADJUST',
] as const

export type PointTransactionType = (typeof pointTransactionTypes)[number]

export const pointTransactionTypeSchema = z.enum(pointTransactionTypes)

/**
 * 원장 행의 `refId` 가 가리키는 표.
 *
 * 자유 문자열이 아니라 열거형인 이유는 재고 원장과 같다 — 참조가 **멱등의 열쇠**
 * (`PointTransaction_ref_key`)이고, 오타 난 문자열은 그 인덱스를 조용히 비껴간다.
 * 재시도가 두 번 기록되는데 원장은 멀쩡해 보인다.
 *
 * `POINT_TRANSACTION` 이 자기 자신을 가리키는 것이 이상해 보이지만 정확히 맞다 —
 * 만료는 **어느 통이 사라졌는가**를 말하는 사건이고, 그 통은 원장의 `EARN` 한
 * 줄이다. 그 덕분에 만료 배치도 다른 것들과 같은 인덱스로 멱등해진다.
 */
export const pointRefTypes = [
  /** 사용 — 어느 주문에 썼나. */
  'ORDER',
  /** 적립 — 어느 판매자 몫의 구매확정인가. 적립의 방아쇠가 그 단위다. */
  'SELLER_ORDER',
  /** 복구 — 어느 클레임이 되돌렸나 (TASK-0078). */
  'CLAIM_REQUEST',
  /** 만료 — 어느 통이 사라졌나. */
  'POINT_TRANSACTION',
] as const

export type PointRefType = (typeof pointRefTypes)[number]

export const pointRefTypeSchema = z.enum(pointRefTypes)

/**
 * 한 번에 움직일 수 있는 금액의 상한.
 *
 * 자릿수 하나가 잘못 들어간 요청을 **사람이 아직 볼 수 있는 자리에서** 거절하기
 * 위한 것이지 정책이 아니다. 재고의 `STOCK_MAX_MOVEMENT` 와 같은 성격이다.
 */
export const POINT_MAX_MOVEMENT = 100_000_000

export const POINT_REASON_MAX_LENGTH = 200

export const pointReasonSchema = z.string().trim().min(1).max(POINT_REASON_MAX_LENGTH)

/**
 * 적립률은 **basis point 정수**다 (1bp = 0.01%, 10000 = 100%).
 *
 * 금액이 정수(원)인데 비율만 부동소수면 `0.1 + 0.2` 류의 오차가 다시 들어온다 —
 * `Seller.commissionRateBp` 가 같은 이유로 같은 단위다(`erd.md` 1장). 범위를 DB 가
 * 지키는 것도 같은 이유다: 이 값은 **곱해지므로**, 음수나 100% 초과가 들어가면
 * 산 금액보다 많은 적립금이 지급되고 아무도 눈치채지 못한다.
 */
export const POINT_EARN_RATE_MAX_BP = 10_000

export const pointEarnRateBpSchema = z.int().min(0).max(POINT_EARN_RATE_MAX_BP)

/** 유효기간의 상한. 10년 넘게 사는 적립금은 부채이지 혜택이 아니다. */
export const POINT_VALIDITY_MAX_DAYS = 3650

export const pointValidityDaysSchema = z.int().min(1).max(POINT_VALIDITY_MAX_DAYS)

/**
 * 적립 정책 — 관리자가 정하는 값들 (`PointPolicy` 한 행).
 *
 * **`AppMeta` 가 아니다.** 저 표는 배치가 자기 실행을 적는 운영 표이고 값이 전부
 * 문자열이라 범위를 DB 가 지킬 수 없는데, 여기 두 값은 각각 곱해지고(적립률)
 * 더해진다(유효기간). 근거는 `points.service.ts` 의 주석에 적었다.
 */
export const pointPolicySchema = z.object({
  earnRateBp: pointEarnRateBpSchema,
  validityDays: pointValidityDaysSchema,
})

export type PointPolicy = z.infer<typeof pointPolicySchema>

/** 원장 한 줄, 밖에서 보는 모양. */
export const pointLedgerEntrySchema = z.object({
  /**
   * 이 계정의 원장에서 이 사건이 몇 번째인가. 1부터.
   *
   * **계정 행의 잠금 아래에서 `직전 max + 1`** 로 정해지므로 사건이 실제로 일어난
   * 순서다 — UUIDv7 은 같은 밀리초 안에서 무작위로 갈려 잔액 사슬이 거꾸로 그려진다
   * (`StockLedger.seq` 와 같은 판단).
   */
  seq: z.int().min(1),
  type: pointTransactionTypeSchema,
  /** 부호가 있다. 부호는 종류가 정한다. */
  amount: z.int(),
  /** 이 사건 직후의 잔액. 음수가 될 수 없다. */
  balanceAfter: z.int().min(0),
  /** 무엇 때문인가. 둘 다 있거나 둘 다 없다. */
  refType: pointRefTypeSchema.nullable(),
  refId: z.uuid().nullable(),
  /** 왜, 사람의 말로. `ADJUST` 에는 반드시 있다. */
  reason: z.string().nullable(),
  /**
   * 이 통이 사라지는 시각. `EARN` 에만 있다.
   *
   * 적립 **시점의** 정책으로 계산된 값이고, 정책이 바뀌어도 이미 지급된 적립금의
   * 수명은 바뀌지 않는다.
   */
  expiresAt: z.iso.datetime().nullable(),
  /** 이 통에 아직 남은 금액. `EARN` 에만 있다. */
  remainingAmount: z.int().min(0).nullable(),
  /**
   * 적립 시점의 적립률 (bp). `EARN` 에만 있다 (TASK-0076 R2).
   *
   * 정책 행을 나중에 읽어 되짚으면 **적립률을 바꾼 날 과거가 전부 바뀐다.** 「왜
   * 이만큼 받았나」에 답할 수 있어야 하고, 그 답은 지급 시점에만 참이다.
   */
  earnRateBp: pointEarnRateBpSchema.nullable(),
  createdAt: z.iso.datetime(),
})

export type PointLedgerEntry = z.infer<typeof pointLedgerEntrySchema>

/**
 * 계정의 지금, 그리고 원장이 말하는 지금.
 *
 * 둘을 함께 싣는 이유는 재고와 같다 — 숫자 하나만 보여 주는 화면은 그 숫자가
 * 설명되는지를 읽는 사람에게 말해 줄 수 없다. 「대사가 가능해야 한다」가 배치의
 * 성질이 아니라 **사람이 볼 수 있는 것**이 되려면 둘 다 나가야 한다.
 */
export const pointBalanceSchema = z.object({
  /** `PointAccount.balance` — 현재값. */
  balance: z.int().min(0),
  /** 원장 전체의 합. 건강하면 위의 `balance` 와 같다. */
  ledgerBalance: z.int(),
  /** 아직 남아 있는 통들의 합. 이것도 같아야 한다. */
  lotBalance: z.int(),
  entryCount: z.int().min(0),
  /** 가장 먼저 사라질 통의 시각. 남은 통이 없으면 `null`. */
  nextExpiresAt: z.iso.datetime().nullable(),
})

export type PointBalance = z.infer<typeof pointBalanceSchema>

export const POINT_LEDGER_MAX_LIMIT = 100

export const POINT_LEDGER_DEFAULT_LIMIT = 20

/** 원장 한 쪽, 최신순. 커서는 `seq` 다 — 재고 원장과 같은 이유로. */
export const pointLedgerResponseSchema = z.object({
  account: pointBalanceSchema,
  entries: z.array(pointLedgerEntrySchema),
  nextCursor: z.int().min(1).nullable(),
})

export type PointLedgerResponse = z.infer<typeof pointLedgerResponseSchema>

/**
 * 대사가 찾아낼 수 있는 어긋남.
 *
 * 「합계가 다르다」 하나로 뭉뚱그리지 않는 이유는 재고 원장과 같다 — 어느 진술이
 * 깨졌는지가 **행을 잃은 것**과 **잠금 밖에서 쓴 것**과 **잔액을 잘못 적은 것**을
 * 가른다. 다섯 번째(`lot_mismatch`)가 적립금에만 있는데, 통이라는 두 번째 표현이
 * 여기에만 있기 때문이다.
 */
export const pointReconciliationFaults = [
  /** P1 — `balance` 가 원장 합계와 다르다. */
  'sum_mismatch',
  /** P2 — 어떤 행의 `balanceAfter` 가 직전 값 + 자기 금액이 아니다. */
  'chain_break',
  /** P3 — 가장 최근 행의 `balanceAfter` 가 지금 잔액이 아니다. */
  'endpoint_mismatch',
  /** P4 — `seq` 가 1..n 이 아니다. 행이 사라졌거나 잠금 없이 쓰였다. */
  'seq_gap',
  /** P5 — 남은 통들의 합이 잔액과 다르다. 사용이 통을 비우지 않았다는 뜻이다. */
  'lot_mismatch',
] as const

export type PointReconciliationFault = (typeof pointReconciliationFaults)[number]

// ---------------------------------------------------------------------------
// 적립금 화면 (TASK-0077)
//
// 원장은 이미 위에 있다. 여기 더해지는 것은 **화면이 원장만으로는 답할 수 없는 둘**
// 이다 — 「곧 들어올 것」과 「곧 사라질 것」. 둘 다 아직 일어나지 않은 일이라 원장에
// 행이 없고, 그래서 사는 사람은 그것을 볼 방법이 없었다.
// ---------------------------------------------------------------------------

/**
 * 「곧 사라진다」의 경계 — 30일.
 *
 * 잔액 화면이 경고를 그리는 기준이고, 만료 배치가 실제로 지우는 순간
 * (`PointTransaction.expiresAt`)과는 무관하다. 30일인 것은 **사람이 그 사이에 쓸 수
 * 있는 기간**이라서다: 일주일이면 알아차렸을 때 이미 늦은 사람이 생기고, 석 달이면
 * 경고가 늘 켜져 있어 아무도 보지 않는다.
 */
export const POINT_EXPIRING_SOON_DAYS = 30

/** 곧 사라질 적립금 한 덩이. */
export const pointExpiringSoonSchema = z.object({
  /** 그 기간 안에 사라질 통들의 합. */
  amount: z.int().min(1),
  /** 그중 **가장 이른** 시각. 화면이 「9월 30일까지」라고 적는 값이다. */
  at: z.iso.datetime(),
})

export type PointExpiringSoon = z.infer<typeof pointExpiringSoonSchema>

/**
 * `GET /api/v1/me/points` — 잔액과 그 주변.
 *
 * 원장(`GET /me/points/transactions`)과 라우트를 나눈 이유는 **읽는 빈도가 다르기**
 * 때문이다. 마이페이지 요약과 적립금 화면 머리는 이 하나만 필요하고, 원장은 그
 * 화면에 들어간 사람만 넘긴다.
 */
export const pointSummaryResponseSchema = z.object({
  account: pointBalanceSchema,
  /**
   * 구매확정을 기다리는 주문에서 **들어올** 적립금 (F6).
   *
   * 적립은 구매확정 시점에 일어나므로(`pricing.md` 5장) 배송완료된 주문은 아직
   * 아무것도 적립하지 않았다. 그 사실을 말해 주지 않으면 사는 사람은 「샀는데 왜
   * 적립이 안 됐지」로 읽는다 — 이 값의 존재 이유가 그 문장 하나다.
   *
   * **배송완료된 몫만 센다.** 준비중·배송중까지 세면 취소 한 번에 사라지는 수를
   * 「들어올 것」이라고 적게 되고, 그때 그 화면은 없어진 돈을 설명해야 한다.
   */
  pendingEarn: wonSchema,
  /** 곧 사라질 것. 없으면 `null` 이고, 그때 화면은 아무 경고도 그리지 않는다. */
  expiringSoon: pointExpiringSoonSchema.nullable(),
})

export type PointSummaryResponse = z.infer<typeof pointSummaryResponseSchema>

/** `GET /api/v1/me/points/transactions` 의 쿼리. 커서는 `seq` 다. */
export const pointLedgerQueryParamsSchema = z.object({
  cursor: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(POINT_LEDGER_MAX_LIMIT).optional(),
})

export type PointLedgerQueryParams = z.infer<typeof pointLedgerQueryParamsSchema>
