import type { CommissionRate } from '@shopping/shared'

/**
 * 「어느 자리의 요율인가」 — 화면이 들고 다니는 한 값.
 *
 * 계약은 그 자리를 **두 칸의 조합**으로 말한다: `sellerId` 와 `categoryId` 중 많아야
 * 하나만 채워지고, 둘 다 비면 전역이다(`setCommissionRateRequestSchema`). 그것을
 * 화면 상태로 그대로 쓰면 「둘 다 채워진」 상태가 타입상 표현 가능해지고, 그 상태를
 * 만들지 않기 위한 검사가 폼·질의·목록에 세 벌 생긴다.
 *
 * 그래서 화면은 **셋 중 하나**를 들고, 계약이 쓰는 두 칸으로 펴는 일을
 * {@link scopeIds} 한 곳에서만 한다. 나갈 수 있는 요청의 모양이 하나로 줄어든다.
 */
export type CommissionScopeSelection =
  | { readonly kind: 'global' }
  | { readonly kind: 'category'; readonly categoryId: number }
  | { readonly kind: 'seller'; readonly sellerId: string }

export const GLOBAL_SCOPE: CommissionScopeSelection = { kind: 'global' }

/** 계약이 쓰는 두 칸. `PUT` 의 몸통도 목록 질의도 이 두 값이 전부다. */
export interface CommissionScopeIds {
  readonly sellerId: string | null
  readonly categoryId: number | null
}

export function scopeIds(scope: CommissionScopeSelection): CommissionScopeIds {
  if (scope.kind === 'seller') return { sellerId: scope.sellerId, categoryId: null }
  if (scope.kind === 'category') return { sellerId: null, categoryId: scope.categoryId }

  return { sellerId: null, categoryId: null }
}

/**
 * 폼의 세 칸이 가리키는 범위, 또는 **아직 고르지 않았다**는 `null`.
 *
 * 「카테고리별」을 고르고 아직 카테고리를 안 골랐을 때가 `null` 이다. 그 상태를
 * 전역으로 접으면 미리보기는 전역 요율의 영향을 계산하고 저장은 전역 요율을 바꾼다 —
 * 아무도 그렇게 하려던 적이 없는데도.
 *
 * 마지막 줄이 「그 밖의 값」까지 겸한다. 라디오가 내는 값은 셋뿐이고 초기값도 그중
 * 하나라 다른 문자열은 오지 않으므로, 오지 않는 값을 위한 갈래를 따로 두지 않는다.
 */
export function selectedScope(
  kind: string,
  categoryId: string,
  sellerId: string,
): CommissionScopeSelection | null {
  if (kind === 'seller') return sellerId === '' ? null : { kind: 'seller', sellerId }

  if (kind === 'category') {
    const id = Number.parseInt(categoryId, 10)

    return Number.isNaN(id) ? null : { kind: 'category', categoryId: id }
  }

  return GLOBAL_SCOPE
}

/**
 * 효과에서 이 범위를 다시 읽어야 하는지 판단할 때 쓰는 이름.
 *
 * 객체를 의존성으로 두면 렌더마다 새 객체라 요청이 끝없이 다시 나간다. 부르는 쪽이
 * `useMemo` 로 객체를 붙잡아 두더라도, 이력·미리보기가 같은 범위를 가리키는지를
 * 문자열 하나로 말할 수 있으면 검사가 그것을 읽을 수 있다.
 */
export function scopeKey(scope: CommissionScopeSelection): string {
  const { sellerId, categoryId } = scopeIds(scope)

  return `${sellerId ?? ''}:${categoryId === null ? '' : String(categoryId)}`
}

/**
 * 질의 문자열의 범위 부분. 전역이고 덧붙일 것이 없으면 빈 문자열이다.
 *
 * **전역을 가리키는 방법이 빈칸이다** (`commissionRateListQueryParamsSchema`).
 * 그래서 이력 요청에서 `?history=true` 하나는 「전역의 이력」을 뜻하고, 목록
 * 요청에서 아무것도 없는 것은 「열려 있는 것 전부」를 뜻한다 — 같은 빈칸이 라우트에
 * 따라 다른 것을 가리키므로, 부르는 쪽이 무엇을 물었는지는 `console-api.ts` 의 함수
 * 이름이 말한다.
 */
export function commissionSearch(
  scope: CommissionScopeSelection,
  extra: Readonly<Record<string, string>> = {},
): string {
  const params = new URLSearchParams(extra)
  const { sellerId, categoryId } = scopeIds(scope)

  if (sellerId !== null) params.set('sellerId', sellerId)
  if (categoryId !== null) params.set('categoryId', String(categoryId))

  const search = params.toString()

  return search === '' ? '' : `?${search}`
}

/**
 * 카테고리에 걸린 요율 — **`categoryId` 가 있다는 것이 타입으로 남는다.**
 *
 * 계약에서는 두 id 가 모두 `nullable` 이다. 「카테고리 요율인데 카테고리가 없다」는
 * 서버가 만들 수 없는 값이지만(`scopeOf` 가 id 에서 범위를 정한다), 화면이 그것을
 * 타입으로 알지 못하면 표를 그리는 자리마다 **닿지 않는 빈칸 갈래**가 하나씩 생긴다.
 */
export type CategoryScopedRate = CommissionRate & { readonly categoryId: number }

export type SellerScopedRate = CommissionRate & { readonly sellerId: string }

/** 지금 열려 있는 요율들을 화면이 그리는 세 덩어리로. */
export interface OpenCommissionRates {
  /** 전역은 많아야 하나다 (`CommissionRate_open_global_key`). 없으면 폴백이 쓰인다. */
  readonly global: CommissionRate | null
  readonly category: readonly CategoryScopedRate[]
  readonly seller: readonly SellerScopedRate[]
}

/**
 * 범위별로 나눈다 — **화면의 절 제목이 곧 우선순위의 역순**이다.
 *
 * 목록을 한 표로 그리면 「판매자 개별율이 카테고리 기본율을 이긴다」가 어디에도
 * 나타나지 않는다. 세 덩어리로 서면 그 순서가 화면의 구조가 된다.
 *
 * 나누는 기준이 `scope` 가 아니라 **id 가 채워졌는가**인 것은 그 판정이 좁히기도
 * 함께 하기 때문이다. 둘은 같은 것을 말한다 — 서버가 `scope` 를 id 에서 만든다.
 */
export function groupOpenRates(rates: readonly CommissionRate[]): OpenCommissionRates {
  return {
    global: rates.find((rate) => rate.scope === 'global') ?? null,
    category: rates.filter((rate): rate is CategoryScopedRate => rate.categoryId !== null),
    seller: rates.filter((rate): rate is SellerScopedRate => rate.sellerId !== null),
  }
}

/** 이 범위에 지금 열려 있는 요율, 또는 아무것도 설정되지 않았다는 `null`. */
export function openRateFor(
  rates: readonly CommissionRate[],
  scope: CommissionScopeSelection,
): CommissionRate | null {
  const wanted = scopeIds(scope)

  return (
    rates.find(
      (rate) => rate.sellerId === wanted.sellerId && rate.categoryId === wanted.categoryId,
    ) ?? null
  )
}

/** 이력 한 줄 — 이 요율과, **그 직전에 적용되던** 요율. */
export interface CommissionChange {
  readonly rate: CommissionRate
  /** 처음 설정된 줄이면 `null`. 「무엇에서」가 없으므로 화살표도 없다. */
  readonly previousRateBp: number | null
}

/**
 * 「누가 언제 몇 퍼센트에서 몇 퍼센트로」 (F5).
 *
 * 서버는 **한 범위의 행들을 최신순으로** 준다(`CommissionService.list`). 행이 곧
 * 이력이므로 「무엇에서 바뀌었나」는 따로 저장된 값이 아니라 **바로 다음 줄의
 * 요율**이다 — 이 목록에서 다음 줄은 시간상 앞선 줄이기 때문이다.
 *
 * 마지막 줄에는 다음 줄이 없고, 그것이 「처음 설정」이다. 그 자리에 폴백 요율을
 * 적으면 「기본율 3%에서 4%로 올렸다」는 없던 사건이 이력에 생긴다 — 그때 요율은
 * 설정된 적이 없었을 뿐 3%였던 적은 없다.
 */
export function commissionChanges(rates: readonly CommissionRate[]): readonly CommissionChange[] {
  return rates.map((rate, index) => {
    const earlier = rates[index + 1]

    return { rate, previousRateBp: earlier === undefined ? null : earlier.rateBp }
  })
}
