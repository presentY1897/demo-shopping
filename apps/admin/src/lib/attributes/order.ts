import type { EffectiveAttribute } from '@shopping/shared'

export const MOVE_DIRECTIONS = ['up', 'down'] as const

export type MoveDirection = (typeof MOVE_DIRECTIONS)[number]

/** The two rows whose `sortOrder` a move exchanges. */
export interface SwapPlan {
  readonly moved: EffectiveAttribute
  readonly displaced: EffectiveAttribute
}

/**
 * The definitions this category owns, in the order they are shown.
 *
 * Inherited rows are excluded rather than skipped over. The list is sorted by
 * the **depth of the owning category** first, so an inherited definition is
 * always above every owned one whatever its `sortOrder` — there is no position
 * an owned row could move into that would put it above one (TASK-0031 4.6).
 */
export function ownAttributes(
  attributes: readonly EffectiveAttribute[],
): readonly EffectiveAttribute[] {
  return attributes.filter((attribute) => !attribute.inherited)
}

/**
 * What moving `id` one place would exchange, or `null` when it cannot move.
 *
 * `null` for an inherited row, for an unknown id, and at either end of the list.
 * The buttons are disabled in those cases, and a keystroke can still ask — a
 * plan of `null` is what lets the caller answer "nothing to do" rather than
 * report a failure for a move that was never possible.
 */
export function planSwap(
  attributes: readonly EffectiveAttribute[],
  id: number,
  direction: MoveDirection,
): SwapPlan | null {
  const own = ownAttributes(attributes)
  const index = own.findIndex((attribute) => attribute.id === id)

  if (index === -1) return null

  const target = index + (direction === 'up' ? -1 : 1)
  const moved = own[index]
  const displaced = own[target]

  if (moved === undefined || displaced === undefined) return null

  return { moved, displaced }
}

/**
 * The list as it will look once the swap lands — drawn before the API is asked.
 *
 * Exchanging `sortOrder` rather than positions is what makes the optimistic
 * frame and the server's answer the same thing: the two `PATCH`es send exactly
 * these two numbers, so a screen that re-read afterwards would see what it had
 * already drawn.
 *
 * `version` is left alone. It belongs to the server, and guessing it would make
 * the next save carry a number nobody issued.
 */
export function applySwap(
  attributes: readonly EffectiveAttribute[],
  plan: SwapPlan,
): readonly EffectiveAttribute[] {
  const orders = new Map([
    [plan.moved.id, plan.displaced.sortOrder],
    [plan.displaced.id, plan.moved.sortOrder],
  ])

  const swapped = attributes.map((attribute) => {
    const sortOrder = orders.get(attribute.id)

    return sortOrder === undefined ? attribute : { ...attribute, sortOrder }
  })

  // Partitioned rather than sorted with a compound comparator: the inherited
  // rows are untouched by the swap and already arrive in the order the API
  // resolved them into, so putting them through a sort would only risk
  // disagreeing with it.
  return [
    ...swapped.filter((attribute) => attribute.inherited),
    ...swapped
      .filter((attribute) => !attribute.inherited)
      .sort((left, right) => left.sortOrder - right.sortOrder || left.id - right.id),
  ]
}
