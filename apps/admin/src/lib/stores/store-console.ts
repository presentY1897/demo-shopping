import type {
  AdminSellerListQueryParams,
  SellerSortKey,
  SellerStatus,
  SellerStatusEvent,
} from '@shopping/shared'

/**
 * 스토어 화면의 순수 판단 — **무엇을 묻고, 이력을 어떻게 읽는가** (TASK-0094).
 *
 * `lib/users/user-console.ts` 와 같은 자리에 같은 이유로 있다: 여기 있는 것들은 전부
 * **틀려도 조용하다.**
 *
 * | 무엇이 틀리면 | 화면은 |
 * | --- | --- |
 * | 필터 → 질의 | 「이 조건에 스토어가 없어요」를 멀쩡히 그린다. 못 찾는 것이 아니라 **다른 것을 찾아 준다** |
 * | 정렬 키 | 클레임률 높은 순으로 보려던 사람에게 **최근 순**을 그려 주고, 봐야 할 스토어는 세 페이지 뒤에 남는다 (F2) |
 * | 이력의 갈래 | 정지와 해제가 같은 줄로 보이고, 그러면 **반복 위반과 한 번의 실수를 구별할 수 없다** (F6 · 4.6) |
 *
 * I/O 도 렌더도 없다 (QUALITY-GATES 순수 로직 — `vitest.config.mjs` 가 이 파일을
 * 분기 100% 로 잡고 있다).
 */

/* --------------------------------------------------------------- 필터 -- */

/**
 * 목록이 들고 있는 것.
 *
 * `status` 와 `isDemo` 는 `null` 이 「전체」다. `sort` 만 `null` 이 없는데, 목록에는
 * 언제나 어떤 순서가 있기 때문이다 — 「정렬 안 함」은 화면이 그릴 수 있는 상태가
 * 아니고, 서버도 아무것도 안 보내면 `recent` 로 답한다 (`admin-seller.service.ts`).
 */
export interface StoreFilters {
  readonly status: SellerStatus | null
  readonly isDemo: boolean | null
  readonly sort: SellerSortKey
}

export const EMPTY_STORE_FILTERS: StoreFilters = { status: null, isDemo: null, sort: 'recent' }

/**
 * 하나라도 **좁혔는가.** 빈 목록이 「없다」인지 「이 조건에 없다」인지를 가른다.
 *
 * 정렬은 여기 없다. 순서를 바꾼다고 줄이 사라지지는 않으므로, 클레임률 순으로 보다가
 * 만난 빈 목록은 「조건을 지워 보세요」가 아니라 「아직 스토어가 없어요」다.
 */
export function isNarrowed(filters: StoreFilters): boolean {
  return filters.status !== null || filters.isDemo !== null
}

/**
 * 필터를 계약의 질의로. 커서와 개수는 부르는 쪽이 얹는다.
 *
 * 값이 없는 축은 **키 자체를 넣지 않는다.** `undefined` 를 실어 보내면
 * `URLSearchParams` 가 `status=undefined` 를 만들고, 서버는 그것을 잘못된 상태로 읽어
 * 400 으로 답한다 (`user-console.ts` 의 같은 규약).
 *
 * 정렬만 언제나 실린다. 서버의 기본값과 같은 값이라도 보내는 이유는 **화면이 고른
 * 순서와 서버가 쓴 순서가 같다는 것을 요청 하나로 볼 수 있게** 하기 위해서다 —
 * 기본값일 때만 생략하면, 순서가 이상할 때 어느 쪽이 정했는지 알 수 없다.
 */
export function queryOf(filters: StoreFilters): AdminSellerListQueryParams {
  return {
    ...(filters.status === null ? {} : { status: filters.status }),
    ...(filters.isDemo === null ? {} : { isDemo: filters.isDemo }),
    sort: filters.sort,
  }
}

/* --------------------------------------------------------------- 이력 -- */

/**
 * 이력 한 줄이 **무슨 일**이었나 (F6).
 *
 * 상태 두 칸을 그대로 그리면 「SUSPENDED → ACTIVE」가 되고, 그것을 읽는 사람은 매번
 * 머릿속에서 「아, 해제구나」로 옮긴다. 표의 뜻이 읽는 사람의 번역에 달려 있으면 그
 * 번역은 언젠가 틀린다.
 *
 * 그리고 이 갈래가 {@link sanctionCount} 의 정의이기도 하다 — 「몇 번 정지됐나」는
 * 정지로 **들어간** 줄의 수이지, 정지를 스쳐 간 줄의 수가 아니다.
 */
export const storeEventKinds = ['sanction', 'lift', 'approval', 'rejection', 'filed'] as const

export type StoreEventKind = (typeof storeEventKinds)[number]

export function eventKind(event: SellerStatusEvent): StoreEventKind {
  // 정지로 **들어간** 것이 제재다. 먼저 보는 이유는 이 갈래가 이 표의 존재 이유이기
  // 때문이고(4.6), 나중에 보면 `PENDING → SUSPENDED` 같은 줄이 다른 갈래로 샌다.
  if (event.toStatus === 'SUSPENDED') return 'sanction'
  // 정지에서 **나온** 것이 해제다. 도착지가 아니라 출발지로 판정하는 이유는, 해제의
  // 도착지가 승인과 같은 `ACTIVE` 라 도착지만으로는 둘을 가를 수 없기 때문이다.
  if (event.fromStatus === 'SUSPENDED') return 'lift'
  if (event.toStatus === 'ACTIVE') return 'approval'
  if (event.toStatus === 'REJECTED') return 'rejection'

  // 남는 것은 `PENDING` 으로 들어온 줄 — 신청이 접수된 순간이다.
  return 'filed'
}

/**
 * 몇 번 정지됐나 (F6).
 *
 * `Seller` 는 **지금** 상태와 사유만 들고 있어, 정지와 해제를 반복하면 앞의 것이
 * 덮인다. 그 수를 셀 수 있게 하는 것이 이력 표가 생긴 이유이고, 그 수가 없으면
 * **반복 위반과 한 번의 실수를 구별할 수 없다** (4.6).
 */
export function sanctionCount(events: readonly SellerStatusEvent[]): number {
  return events.filter((event) => eventKind(event) === 'sanction').length
}
