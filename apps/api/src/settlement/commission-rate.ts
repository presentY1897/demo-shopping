/**
 * 수수료율의 순수 판단 (TASK-0079 6.2, Q5 강화).
 *
 * `pricing.md` 6장이 「수수료율은 **판매자 개별율 > 카테고리 기본율** 순으로
 * 적용한다」고 적어 두었다. 여기 있는 것은 그 한 줄과, 그 줄이 답하지 않는 둘이다 —
 * **아무 설정도 없으면 무엇을 쓰나**, 그리고 **카테고리 요율이 조상에도 걸려 있으면
 * 어느 것을 쓰나**.
 *
 * **여기가 틀리면 조용하다.** 요율이 한 칸 높으면 판매자는 자기가 동의한 적 없는
 * 수수료를 물고, 그 차이는 정산서 한 줄의 숫자로만 나타난다 — 오류가 아니다. 낮으면
 * 플랫폼이 받아야 할 것을 못 받고, 그쪽은 아무도 신고하지 않는다.
 */

/**
 * 아무 요율도 설정되지 않았을 때 쓰는 값 — 10%.
 *
 * **0이 아닌 이유는 0이 뜻을 갖기 때문이다.** 「설정을 안 했다」와 「수수료를 받지
 * 않기로 했다」는 다른 결정이고, 폴백을 0으로 두면 설정을 잊은 카테고리에서 플랫폼이
 * 조용히 아무것도 받지 않는다. 눈에 띄는 값이라야 「이 카테고리 요율을 정해야
 * 한다」가 정산서에서 보인다.
 *
 * 전역 행(`CommissionRate` 의 `sellerId`·`categoryId` 가 둘 다 `NULL`)이 있으면 그것이
 * 먼저다. 이 상수는 그 행조차 없는 저장소를 위한 마지막 자리다.
 */
export const DEFAULT_COMMISSION_RATE_BP = 1_000

/** 요율 한 벌 — 결정에 필요한 것만. */
export interface CommissionRateRow {
  /** 스토어에 걸린 요율이면 그 id. */
  readonly sellerId: string | null
  /** 카테고리에 걸린 요율이면 그 id. */
  readonly categoryId: number | null
  readonly rateBp: number
}

/**
 * 요율이 걸릴 수 있는 자리 — **좁은 것부터**.
 *
 * 목록의 순서가 곧 우선순위이고, 그 순서를 함수 밖에 두는 이유는 그것이 **문서가
 * 정한 것**이기 때문이다 (`pricing.md` 6장). 코드 안에 `if` 로 흩어 두면 문서와
 * 견줄 자리가 없어진다.
 */
export const COMMISSION_SCOPES = ['seller', 'category', 'global'] as const

export type CommissionScope = (typeof COMMISSION_SCOPES)[number]

/** 이 요율이 걸린 자리. */
export function scopeOf(rate: CommissionRateRow): CommissionScope {
  if (rate.sellerId !== null) return 'seller'

  return rate.categoryId === null ? 'global' : 'category'
}

/** 요율을 정하는 데 필요한 사실 — 파는 사람과 파는 물건. */
export interface CommissionSubject {
  readonly sellerId: string
  /**
   * 이 항목의 카테고리와 그 조상들 — **잎에서 뿌리 순서**.
   *
   * 조상까지 보는 이유는 요율을 잎마다 설정하게 두면 아무도 다 채우지 못하기
   * 때문이다. 「의류 3%」를 걸어 두면 그 아래 전부에 걸리고, 「반팔 셔츠 2%」를
   * 따로 걸면 **그 잎만** 2%다.
   */
  readonly categoryPath: readonly number[]
}

/** 결정된 요율과, 그것이 어디서 왔는가. */
export interface ResolvedCommission {
  readonly rateBp: number
  readonly scope: CommissionScope
  /**
   * 이 요율을 만든 행. **아무 설정도 없어 폴백을 쓴 경우에만 `null`** 이다.
   *
   * 「폴백인가」를 참·거짓으로 따로 두지 않는 이유는 **같은 사실을 두 벌로 적으면
   * 갈라지기** 때문이다. 그리고 미리보기(F6)가 필요로 하는 것은 참·거짓이 아니라
   * 「어느 행이 이겼나」다 — 카테고리 요율을 바꿀 때, 판매자 개별율이 이미 이기고
   * 있는 항목은 그 변경에 아무 영향도 받지 않으므로 미리보기에서 빠져야 한다.
   */
  readonly matched: CommissionRateRow | null
}

/**
 * 두 요율이 **같은 자리**를 가리키는가.
 *
 * 요율을 바꾸는 일은 그 자리의 행을 닫고 새 행을 여는 일이라, 「같은 자리」의 정의가
 * 곧 무엇을 닫을지의 정의다.
 */
export function sameScope(a: CommissionRateRow, b: CommissionRateRow): boolean {
  return a.sellerId === b.sellerId && a.categoryId === b.categoryId
}

/**
 * 이 항목에 적용될 요율 (F1 · F2 · F3).
 *
 * **판매자 개별율이 이긴다.** 그것이 개별 계약이고, 카테고리 요율은 계약이 없는
 * 스토어에 적용되는 기본값이기 때문이다.
 *
 * 카테고리끼리는 **잎이 이긴다.** 조상에 걸린 요율은 「이 아래 전부」라는 뜻이고,
 * 잎에 따로 건 것은 「이것만은 다르게」라는 뜻이다 — 뒤엣것이 앞엣것을 덮지 않으면
 * 그 설정은 아무 일도 하지 않는다.
 */
export function resolveCommission(
  subject: CommissionSubject,
  rates: readonly CommissionRateRow[],
): ResolvedCommission {
  const bySeller = rates.find((rate) => rate.sellerId === subject.sellerId)

  if (bySeller !== undefined) return { rateBp: bySeller.rateBp, scope: 'seller', matched: bySeller }

  for (const categoryId of subject.categoryPath) {
    const byCategory = rates.find((rate) => rate.categoryId === categoryId)

    if (byCategory !== undefined) {
      return { rateBp: byCategory.rateBp, scope: 'category', matched: byCategory }
    }
  }

  const global = rates.find((rate) => rate.sellerId === null && rate.categoryId === null)

  if (global !== undefined) return { rateBp: global.rateBp, scope: 'global', matched: global }

  return { rateBp: DEFAULT_COMMISSION_RATE_BP, scope: 'global', matched: null }
}

/**
 * 이 금액에서 플랫폼이 가져가는 몫.
 *
 * **내림이다.** 올림이면 1원짜리 판매에서 요율이 무엇이든 1원을 가져가고, 판매자
 * 몫이 0원이 된다. 반올림도 같은 자리에서 같은 일을 한다 — 나누어떨어지지 않는
 * 잔여는 파는 쪽이 갖는 것이 이 도메인의 관례이고, 무엇보다 **플랫폼이 스스로에게
 * 유리하게 반올림하지 않는다**는 것이 설명 가능한 규칙이다.
 */
export function commissionOf(amount: number, rateBp: number): number {
  return Math.floor((Math.max(0, amount) * rateBp) / 10_000)
}

/**
 * 저장된 카테고리 경로(`/1/5/12/`)를 **잎에서 뿌리 순서**의 id 목록으로.
 *
 * 경로를 문자열로 저장해 둔 것은 카테고리가 자기 조상을 매번 되짚지 않게 하려는
 * 것이고(`erd.md` 2장), 그 대가로 읽는 쪽마다 이 변환이 필요하다. 한 곳에 두는
 * 이유는 **뒤집는 것을 잊기 쉽기** 때문이다 — 저장된 순서는 뿌리부터인데 요율이
 * 묻는 것은 잎부터라, 뒤집지 않으면 「의류 3%」가 「반팔 셔츠 2%」를 덮는다.
 *
 * 빈 칸을 걸러 내는 것은 앞뒤의 `/` 때문이지 잘못된 입력을 막으려는 것이 아니다.
 * 경로는 데이터베이스가 만든 값이라 여기서 검증할 것이 없다.
 */
export function categoryPathIds(path: string): readonly number[] {
  return path
    .split('/')
    .filter((segment) => segment !== '')
    .map(Number)
    .reverse()
}
