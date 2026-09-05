import type { CartGroup, CartItem, CartResponse } from '@shopping/shared'

/**
 * 무엇이 선택됐나 (TASK-0046 F2 · F3 · F5).
 *
 * 순수 함수다. 화면이 하는 일은 **세 층이 서로를 어긋나게 하지 않는 것**이고 —
 * 전체·그룹·개별 — 그것이 틀리면 사람은 자기가 무엇을 사는지 모르는 채로 결제
 * 버튼을 누른다.
 *
 * 선택은 **살 수 있는 줄에만** 붙는다. 품절이나 판매 중단인 줄은 고를 수 없고, 그
 * 규칙이 여기 한 곳에 있는 이유는 「전체 선택」이 그것을 빠뜨리기 가장 쉬운
 * 자리이기 때문이다.
 */

/** 고른 줄의 id. */
export type Selection = ReadonlySet<string>

/** 체크박스 하나가 그릴 수 있는 세 가지 모습. */
export type CheckState = 'checked' | 'indeterminate' | 'unchecked'

/**
 * 이 줄을 고를 수 있나.
 *
 * 품절과 판매 중단이 여기 함께 있다. 화면에는 다른 문장이 나가지만 — 하나는
 * 기다리면 오고 하나는 오지 않는다 — **고를 수 없다는 점은 같다.**
 */
export function isSelectable(item: CartItem): boolean {
  return !item.notices.includes('sold_out') && !item.notices.includes('unavailable')
}

/** 지금 고를 수 있는 줄 전부. */
export function selectableIds(cart: CartResponse): readonly string[] {
  return cart.groups.flatMap((group) => group.items.filter(isSelectable).map((item) => item.id))
}

/**
 * 처음 보여 줄 선택 — **고를 수 있는 것 전부**.
 *
 * 아무것도 안 골라 둔 채로 열면 합계가 0원이고, 사람이 할 일이 「전부 다시
 * 고르기」가 된다. 담아 둔 것을 사러 온 사람에게 기본값은 「전부」다.
 */
export function initialSelection(cart: CartResponse): Selection {
  return new Set(selectableIds(cart))
}

/**
 * 사라진 줄을 선택에서 뺀다.
 *
 * 수량을 바꾸거나 한 줄을 지우면 응답이 새로 온다. 그때 선택을 그대로 두면 없는
 * 줄의 id 가 남고, **합계가 그 줄을 계속 세거나 세지 않는다** — 어느 쪽이든 화면과
 * 다른 숫자다. 새로 생긴 줄은 고른 것으로 치지 않는다: 사람이 고른 적이 없다.
 */
export function reconcile(cart: CartResponse, selection: Selection): Selection {
  const alive = new Set(selectableIds(cart))

  return new Set([...selection].filter((id) => alive.has(id)))
}

/** 한 줄을 켜고 끈다. 고를 수 없는 줄은 켜지지 않는다. */
export function toggleItem(selection: Selection, item: CartItem): Selection {
  const next = new Set(selection)

  if (next.delete(item.id)) return next
  if (!isSelectable(item)) return next

  next.add(item.id)

  return next
}

/**
 * 한 그룹을 통째로 켜고 끈다.
 *
 * **일부만 골라 둔 그룹을 누르면 전부 켜진다.** 끄는 쪽이 아닌 이유는, 그 상태에서
 * 사람이 원하는 것이 「나머지도」이지 「방금 고른 것도 취소」인 경우가 드물기
 * 때문이다.
 */
export function toggleGroup(selection: Selection, group: CartGroup): Selection {
  const ids = group.items.filter(isSelectable).map((item) => item.id)
  const next = new Set(selection)

  if (groupState(group, selection) === 'checked') {
    for (const id of ids) next.delete(id)

    return next
  }

  for (const id of ids) next.add(id)

  return next
}

/** 전체를 켜고 끈다. 그룹과 같은 규칙이다. */
export function toggleAll(selection: Selection, cart: CartResponse): Selection {
  if (allState(cart, selection) === 'checked') return new Set()

  return new Set(selectableIds(cart))
}

/** 고를 수 있는 줄들에 대해, 몇 개가 켜져 있나. */
function stateOf(ids: readonly string[], selection: Selection): CheckState {
  if (ids.length === 0) return 'unchecked'

  const chosen = ids.filter((id) => selection.has(id)).length

  if (chosen === 0) return 'unchecked'

  return chosen === ids.length ? 'checked' : 'indeterminate'
}

/**
 * 이 그룹의 체크박스가 그릴 모습.
 *
 * **고를 수 없는 줄은 세지 않는다.** 품절 하나가 섞인 그룹에서 나머지를 전부
 * 골랐다면 그 그룹은 「전체 선택」이다 — 품절을 세면 그 체크박스는 영원히 절반만
 * 켜진 채로 남고, 그것을 채우려는 사람은 방법이 없다.
 */
export function groupState(group: CartGroup, selection: Selection): CheckState {
  return stateOf(
    group.items.filter(isSelectable).map((item) => item.id),
    selection,
  )
}

/** 맨 위 체크박스가 그릴 모습. */
export function allState(cart: CartResponse, selection: Selection): CheckState {
  return stateOf(selectableIds(cart), selection)
}
