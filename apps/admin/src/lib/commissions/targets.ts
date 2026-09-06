import type { CategoryChoice } from '@/lib/attributes/categories'

import type { SellerChoice } from './use-sellers'

/**
 * 요율이 걸린 자리를 **이름으로** 부르는 두 함수.
 *
 * 계약이 싣는 것은 id 뿐이다(`commissionRateSchema`). 카테고리 이름은 카테고리
 * 트리가, 스토어 이름은 심사 큐가 들고 있으므로, 화면은 두 목록을 이미 읽은 뒤에
 * 이 표를 만든다.
 *
 * **못 찾았을 때 빈칸으로 두지 않는다.** 요율은 걸려 있는데 어디에 걸렸는지 화면이
 * 말하지 못하면, 그것을 고칠 방법도 없다. id 는 그 자리에 남는 마지막 단서이고,
 * 스토어 목록이 첫 페이지뿐이라(`use-sellers.ts`) 실제로 일어나는 일이다.
 */

export interface CommissionTargetCopy {
  /** `여성 › 아우터 › 코트` 의 구분자. */
  readonly categorySeparator: string
  /** `{id}` 를 품은 한 줄. */
  readonly unknownTarget: string
}

export function categoryTargetName(
  choices: readonly CategoryChoice[],
  id: number,
  copy: CommissionTargetCopy,
): string {
  const choice = choices.find((candidate) => candidate.id === id)

  if (choice === undefined) return copy.unknownTarget.replace('{id}', String(id))

  // 잎의 이름만으로는 「코트」가 어느 갈래의 코트인지 알 수 없다. 요율은 하위
  // 카테고리 전체에 내려가므로, 어디에 걸렸는지가 곧 얼마나 넓게 걸렸는지다.
  return choice.path.join(copy.categorySeparator)
}

export function sellerTargetName(
  choices: readonly SellerChoice[],
  id: string,
  copy: CommissionTargetCopy,
): string {
  const choice = choices.find((candidate) => candidate.id === id)

  return choice === undefined ? copy.unknownTarget.replace('{id}', id) : choice.name
}
