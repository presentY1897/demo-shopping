import type { PointLedgerEntry, PointSummaryResponse } from '@shopping/shared'
import {
  pointLedgerQueryParamsSchema,
  pointLedgerResponseSchema,
  pointSummaryResponseSchema,
} from '@shopping/shared'
import type { RequestHandler } from 'msw'
import { http, HttpResponse } from 'msw'

import { defineFixture } from '../define'
import { shopperPointSummary } from '../fixtures/points'
import { mockPaths } from '../paths'
import {
  MOCK_POINT_LEDGER_PAGE_SIZE,
  mockPointLedgerSeeds,
  sortPointEntries,
} from './point-contract'
import { answering } from './refusal'

/**
 * 내 적립금 — 잔액과 원장 (TASK-0077 의 화면이 읽는다).
 *
 * **쓰기가 없다.** 적립도 사용도 사람이 부르는 것이 아니라 주문이 일으키는 일이라
 * (`point.controller.ts`), 이 대역에 `POST` 가 없는 것이 그 구조가 밖에서 보이는
 * 자리다. 잔액을 손으로 옮기는 문을 목이 만들어 두면, 그 문에 기대는 화면이 실제
 * 서버에는 없는 동작을 갖게 된다.
 *
 * 그래서 저장소도 갈아 끼우는 용도로만 있다 — 빈 계정과 오류를 그리는 검사가 씨앗을
 * 바꿀 수 있으면 되고, 그 밖에 이 대역의 상태를 움직이는 것은 없다.
 *
 * ## 원장은 서버처럼 자른다
 *
 * 커서는 `seq` 이고 서버가 `seq: { lt: cursor }` 로 다음 쪽을 뜬다. 최신순이므로 그
 * 방향이 「더 오래된 쪽」이다 — 미리 잘라 둔 두 쪽을 번갈아 주면 그 방향이 맞는지를
 * 잴 수 없다.
 */

interface PointStore {
  readonly summary: PointSummaryResponse
  readonly entries: readonly PointLedgerEntry[]
}

const INITIAL: PointStore = { summary: shopperPointSummary, entries: mockPointLedgerSeeds }

let store: PointStore = INITIAL

export const pointHandlers: readonly RequestHandler[] = [
  /**
   * 원장 한 쪽. **컬렉션보다 먼저 등록된다** — msw 는 먼저 맞는 것을 쓰고, 옆의
   * 라우트들이 전부 그 순서로 서 있다.
   */
  http.get(mockPaths.mePointTransactions, ({ request }) =>
    answering(() => {
      const url = new URL(request.url)
      const query = pointLedgerQueryParamsSchema.parse(
        Object.fromEntries(url.searchParams.entries()),
      )
      const limit = query.limit ?? MOCK_POINT_LEDGER_PAGE_SIZE
      const rows = sortPointEntries(store.entries).filter(
        (entry) => query.cursor === undefined || entry.seq < query.cursor,
      )
      const page = rows.slice(0, limit)

      return HttpResponse.json(
        defineFixture(pointLedgerResponseSchema, {
          // 잔액이 원장과 **같은 저장소에서** 나온다. 따로 들고 있으면 씨앗을 바꾼
          // 검사가 대사 깨진 계정을 만들고, 화면은 그것을 그대로 그린다.
          account: store.summary.account,
          entries: [...page],
          nextCursor: rows.length > limit ? (page.at(-1)?.seq ?? null) : null,
        }),
      )
    }),
  ),

  /** 잔액과 그 주변 — 마이페이지 요약과 적립금 화면 머리가 읽는다. */
  http.get(mockPaths.mePoints, () =>
    answering(() => HttpResponse.json(defineFixture(pointSummaryResponseSchema, store.summary))),
  ),
]

/**
 * 이 목의 적립금을 처음 상태로.
 *
 * 잔액과 원장을 **함께** 받는다. 하나만 갈아 끼우면 「잔액은 0인데 원장에 일곱 줄이
 * 있는」 계정이 만들어지고, 그것은 이 화면이 절대 만나서는 안 되는 상태다 — 대사가
 * 가능해야 한다는 것이 원장을 두는 이유 전부이기 때문이다.
 */
export function resetPointStore(
  summary: PointSummaryResponse = shopperPointSummary,
  entries: readonly PointLedgerEntry[] = mockPointLedgerSeeds,
): void {
  store = { summary, entries }
}
