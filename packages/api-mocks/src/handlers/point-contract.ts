import type { PointBalance, PointLedgerEntry } from '@shopping/shared'

/**
 * 적립금 대역의 씨앗 (TASK-0077).
 *
 * `fixtures/` 밖에 있는 이유는 `coupon-box-contract.ts` 와 같다 — 그 디렉터리는 C2
 * 레지스트리이고 씨앗과 상수는 그 규칙을 지날 수 없는데, 픽스처와 핸들러가 **함께**
 * 읽어야 한다.
 *
 * ## 씨앗이 대사되는 원장인 것이 요점이다
 *
 * 이 화면이 존재하는 이유가 「왜 줄었지」에 답하는 것이고(TASK-0077 4장), 그 답은
 * `balanceAfter` 의 사슬이다. 그래서 씨앗은 다섯 진술을 전부 만족한다 — 합계가
 * 잔액과 같고, 각 줄의 `balanceAfter` 가 직전 값 + 자기 금액이며, 마지막 줄이 지금
 * 잔액이고, `seq` 가 1..n 이고, 남은 통의 합이 잔액과 같다
 * (`pointReconciliationFaults` 의 다섯).
 *
 * 어긋난 씨앗을 쓰면 화면은 자기가 그린 사슬이 끊긴 것을 알 방법이 없고, 검사는
 * 「숫자가 보인다」만 확인하게 된다.
 */

/**
 * 이 대역의 「지금」. 쿠폰함과 같은 순간이다.
 *
 * 시계에서 읽지 않는 이유는 `MOCK_COUPON_BOX_NOW` 와 같고, 여기서는 한 겹 더 있다 —
 * 만료 예정(`expiringSoon`)은 **서버가 이미 판정해서 보내는 값**이라 화면이 다시
 * 계산하지 않지만, 씨앗의 만료 시각이 흘러가면 그 값과 원장의 통이 서로 다른 말을
 * 하게 된다.
 */
export const MOCK_POINT_NOW = '2026-09-07T00:00:00.000Z'

/**
 * 원장 한 쪽에 담기는 줄 수.
 *
 * 실제 기본값(`POINT_LEDGER_DEFAULT_LIMIT` 20)보다 작다. 씨앗이 일곱 줄이라 20으로
 * 자르면 한 쪽에 다 들어가고, 그러면 커서가 아무 일도 하지 않는데 검사가 초록이다.
 */
export const MOCK_POINT_LEDGER_PAGE_SIZE = 5

/** 적립의 근거가 된 판매자 몫들. 적립 줄이 가리키는 곳이다. */
const SELLER_ORDER_IDS = [
  '019596d0-1f1c-7c2e-9a0e-7d0000000001',
  '019596d0-1f1c-7c2e-9a0e-7d0000000002',
  '019596d0-1f1c-7c2e-9a0e-7d0000000003',
] as const

/**
 * 적립금을 쓴 주문. **F5 의 링크가 가리키는 곳**이다.
 *
 * `fixtures/orders.ts` 의 주문과 같은 id 는 아니다 — 이 대역의 원장은 주문 대역과
 * 다른 저장소를 보고, 링크가 실제로 열리는지는 주문 화면의 검사가 이미 답한다. 여기서
 * 재는 것은 「`refType` 이 `ORDER` 인 줄만 링크를 갖는가」다.
 */
export const MOCK_POINT_ORDER_ID = '019596d0-1f1c-7c2e-9a0e-7e0000000001'

/** 복구를 일으킨 클레임. 반품이 되돌린 적립금이 이것을 가리킨다. */
const CLAIM_REQUEST_ID = '019596d0-1f1c-7c2e-9a0e-7f0000000001'

/** 만료가 가리키는 통 — 사라진 `EARN` 한 줄. 참조가 자기 표를 가리키는 유일한 경우다. */
const EXPIRED_LOT_ID = '019596d0-1f1c-7c2e-9a0e-800000000001'

/**
 * 원장 일곱 줄 — **다섯 유형을 전부 채운다.**
 *
 * 유형마다 하나씩인 것은 화면이 유형별 라벨을 `Record<PointTransactionType, string>`
 * 으로 들고 있기 때문이다(R1). 하나가 비면 그 유형의 라벨은 아무 검사도 지나지 않은
 * 채 배포되고, 그 결함은 그 유형이 처음 생긴 사람의 화면에서 빈 칸으로 나타난다.
 *
 * `EARN` 이 셋인 것은 통이 세 가지 상태를 갖기 때문이다 — 만료로 비워진 통, 아직
 * 남아 있고 곧 사라지는 통, 넉넉히 남은 통. 「곧 사라진다」가 무엇을 가리키는지가 그
 * 셋 중 하나라는 것을 화면이 보여 줄 수 있어야 한다.
 *
 * **오래된 것부터 적혀 있다.** 응답은 최신순이라 핸들러가 뒤집는데, 씨앗을 시간순으로
 * 두는 이유는 사슬이 눈으로 읽히기 때문이다: 2,000 이 들어왔다가 만료되고, 3,000 이
 * 들어와 2,000 을 쓰고, 5,000 이 더 들어오고, 반품이 1,500 을 되돌리고, 잘못 지급된
 * 500 을 회수해 7,000 이 남는다.
 */
export const mockPointLedgerSeeds: readonly PointLedgerEntry[] = [
  {
    seq: 1,
    type: 'EARN',
    amount: 2_000,
    balanceAfter: 2_000,
    refType: 'SELLER_ORDER',
    refId: SELLER_ORDER_IDS[0],
    reason: null,
    expiresAt: '2026-08-31T14:59:59.000Z',
    // 만료로 비워진 통. 0 이 「지급된 적이 없다」가 아니라 「남은 것이 없다」다.
    remainingAmount: 0,
    earnRateBp: 100,
    createdAt: '2026-05-02T01:00:00.000Z',
  },
  {
    seq: 2,
    type: 'EXPIRE',
    amount: -2_000,
    balanceAfter: 0,
    // 사라진 통을 가리킨다. 참조가 자기 표를 가리키는 것이 이상해 보이지만 정확히
    // 맞다 — 만료는 「어느 통이 사라졌는가」를 말하는 사건이다.
    refType: 'POINT_TRANSACTION',
    refId: EXPIRED_LOT_ID,
    reason: null,
    expiresAt: null,
    remainingAmount: null,
    earnRateBp: null,
    createdAt: '2026-08-31T15:00:00.000Z',
  },
  {
    seq: 3,
    type: 'EARN',
    amount: 3_000,
    balanceAfter: 3_000,
    refType: 'SELLER_ORDER',
    refId: SELLER_ORDER_IDS[1],
    reason: null,
    // 지금(9월 7일)에서 13일 뒤 — 30일 안이라 **곧 사라질 통**이다.
    expiresAt: '2026-09-20T14:59:59.000Z',
    remainingAmount: 2_000,
    earnRateBp: 100,
    createdAt: '2026-09-01T02:00:00.000Z',
  },
  {
    seq: 4,
    type: 'USE',
    amount: -2_000,
    balanceAfter: 1_000,
    refType: 'ORDER',
    refId: MOCK_POINT_ORDER_ID,
    reason: null,
    expiresAt: null,
    remainingAmount: null,
    earnRateBp: null,
    createdAt: '2026-09-02T03:30:00.000Z',
  },
  {
    seq: 5,
    type: 'EARN',
    amount: 5_000,
    balanceAfter: 6_000,
    refType: 'SELLER_ORDER',
    refId: SELLER_ORDER_IDS[2],
    reason: null,
    expiresAt: '2026-12-31T14:59:59.000Z',
    remainingAmount: 5_000,
    earnRateBp: 100,
    createdAt: '2026-09-03T04:00:00.000Z',
  },
  {
    seq: 6,
    type: 'RESTORE',
    amount: 1_500,
    balanceAfter: 7_500,
    refType: 'CLAIM_REQUEST',
    refId: CLAIM_REQUEST_ID,
    reason: null,
    expiresAt: null,
    remainingAmount: null,
    earnRateBp: null,
    createdAt: '2026-09-04T06:00:00.000Z',
  },
  {
    seq: 7,
    type: 'ADJUST',
    amount: -500,
    balanceAfter: 7_000,
    refType: null,
    refId: null,
    // 사유가 필수인 유일한 유형이다. 사람이 고친 것이라 「왜」가 행 안에 없으면
    // 아무도 답할 수 없다.
    reason: '중복 지급분 회수',
    expiresAt: null,
    remainingAmount: null,
    earnRateBp: null,
    createdAt: '2026-09-05T08:00:00.000Z',
  },
]

/**
 * 씨앗이 말하는 잔액.
 *
 * 세 수를 손으로 적지 않고 원장에서 **유도한다.** 적어 두면 씨앗을 한 줄 고친 날
 * 잔액이 따라오지 않고, 그러면 이 대역은 「대사가 깨진 계정」을 정상으로 답하게 된다 —
 * 화면은 그 어긋남을 그릴 뿐이라 검사는 초록이다.
 */
export const mockPointBalance: PointBalance = {
  balance: mockPointLedgerSeeds.reduce((sum, entry) => sum + entry.amount, 0),
  ledgerBalance: mockPointLedgerSeeds.reduce((sum, entry) => sum + entry.amount, 0),
  lotBalance: mockPointLedgerSeeds.reduce((sum, entry) => sum + (entry.remainingAmount ?? 0), 0),
  entryCount: mockPointLedgerSeeds.length,
  nextExpiresAt: '2026-09-20T14:59:59.000Z',
}

/** 최신순 — `seq` 내림차순. 서버가 그렇게 답한다(`PointsService.ledger`). */
export function sortPointEntries(
  entries: readonly PointLedgerEntry[],
): readonly PointLedgerEntry[] {
  return [...entries].sort((left, right) => right.seq - left.seq)
}
