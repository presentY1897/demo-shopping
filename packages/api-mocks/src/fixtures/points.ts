import { pointLedgerResponseSchema, pointSummaryResponseSchema } from '@shopping/shared'

import { defineFixture } from '../define'
import {
  MOCK_POINT_LEDGER_PAGE_SIZE,
  mockPointBalance,
  mockPointLedgerSeeds,
  sortPointEntries,
} from '../handlers/point-contract'

/**
 * 내 적립금 (TASK-0077 의 화면이 읽는다).
 *
 * 씨앗과 조립기는 `handlers/point-contract.ts` 에 있고, 왜 픽스처 밖에 있는지는 거기
 * 적혀 있다. 이 파일은 그것을 **응답의 모양**으로 한 번 파싱해 둘 뿐이다.
 */

/**
 * 잔액과 그 주변 — 적립 예정과 만료 예정.
 *
 * **`pendingEarn` 이 0이 아닌 것이 이 픽스처의 요점이다** (F6). 적립은 구매확정
 * 시점에 일어나므로 배송완료된 주문은 아직 아무것도 적립하지 않았고, 그 사실을 말해
 * 주지 않으면 사는 사람은 「샀는데 왜 적립이 안 됐지」로 읽는다. 0을 넣어 두면 화면이
 * 그 줄을 그리는지 물어볼 자리가 사라진다.
 *
 * `expiringSoon` 도 같은 이유로 `null` 이 아니다. 그 값이 서버의 판정이라는 것이
 * 계약이고(30일은 서버가 이미 적용한다), 화면은 그것을 그리기만 한다 — 그리는지
 * 확인하려면 올 것이 있어야 한다.
 */
export const shopperPointSummary = defineFixture(pointSummaryResponseSchema, {
  account: mockPointBalance,
  // 배송완료된 몫 하나에서 들어올 적립금. 준비중·배송중 몫은 세지 않는다.
  pendingEarn: 1_200,
  // `mockPointLedgerSeeds` 의 9월 20일 통에 남은 2,000원. 원장과 같은 수여야 한다.
  expiringSoon: { amount: 2_000, at: '2026-09-20T14:59:59.000Z' },
})

/** 원장 첫 쪽 — 최신순 다섯 줄. 나머지 두 줄은 커서 뒤에 있다. */
export const shopperPointLedger = defineFixture(pointLedgerResponseSchema, {
  account: mockPointBalance,
  entries: [...sortPointEntries(mockPointLedgerSeeds)].slice(0, MOCK_POINT_LEDGER_PAGE_SIZE),
  nextCursor: sortPointEntries(mockPointLedgerSeeds)[MOCK_POINT_LEDGER_PAGE_SIZE - 1]?.seq ?? null,
})

/**
 * 아직 아무 일도 없었던 계정.
 *
 * 잔액이 0인 것과 원장이 빈 것이 **같은 사실**이라 둘을 함께 비운다. 잔액만 0으로
 * 두고 원장을 채우면 대사가 깨진 계정이 되고, 그것은 이 화면이 절대 만나서는 안 되는
 * 상태다.
 */
export const emptyPointSummary = defineFixture(pointSummaryResponseSchema, {
  account: { balance: 0, ledgerBalance: 0, lotBalance: 0, entryCount: 0, nextExpiresAt: null },
  pendingEarn: 0,
  expiringSoon: null,
})

export const emptyPointLedger = defineFixture(pointLedgerResponseSchema, {
  account: { balance: 0, ledgerBalance: 0, lotBalance: 0, entryCount: 0, nextExpiresAt: null },
  entries: [],
  nextCursor: null,
})
