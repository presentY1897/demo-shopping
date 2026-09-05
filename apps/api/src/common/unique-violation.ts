/**
 * 유니크 위반이 **어느 열에서** 났는가.
 *
 * TASK-0049 가 `orders/order.service.ts` 안에서 만든 판정이고, TASK-0061 이 운송장
 * 번호에도 같은 재시도가 필요해지면서 이리로 옮겼다. 사본을 만들지 않은 이유는 이
 * 판정이 **틀려도 조용하기** 때문이다 — 겹치는 일이 없으면 「안 도는 코드」와 「못 도는
 * 코드」가 똑같이 보인다. 실제로 그 일이 한 번 있었다(아래).
 */

/** 유니크 위반의 Prisma 코드. */
export const UNIQUE_VIOLATION = 'P2002'

/**
 * 어느 컬럼에서 난 유니크 위반인가.
 *
 * **자리를 둘 보는 이유는 드라이버 어댑터다.** 어댑터 없이 돌 때 Prisma 는 위반된
 * 컬럼을 `meta.target` 에 담지만, 어댑터를 끼우면 그 자리가 비고 원본 오류가
 * `meta.driverAdapterError` 아래에 **인덱스 이름**(`Order_checkoutId_key`)으로 온다.
 * `target` 만 보던 판정은 이 배포에서 한 번도 참이 된 적이 없었다 — 그래서 주문번호
 * 재시도도 여태 돌지 않았고, 아무도 몰랐다.
 *
 * 이제는 두 곳이 실제로 이 판정을 지난다(주문번호 · 운송장 번호). 모양이 또 바뀌면
 * 그때는 조용하지 않고 빨개진다.
 */
export function isUniqueViolationOn(error: unknown, column: string): boolean {
  if (error === null || typeof error !== 'object') return false

  const failure = error as {
    readonly code?: unknown
    readonly meta?: {
      readonly target?: unknown
      readonly driverAdapterError?: { readonly cause?: { readonly constraint?: unknown } }
    }
  }

  if (failure.code !== UNIQUE_VIOLATION) return false

  const constraint = failure.meta?.driverAdapterError?.cause?.constraint as
    { readonly index?: unknown; readonly fields?: unknown } | undefined

  return [
    ...namesOf(failure.meta?.target),
    ...namesOf(constraint?.index),
    ...namesOf(constraint?.fields),
  ].some((name) => name.includes(column))
}

/** 이름 하나이거나 목록이거나, 아니면 아무것도 아니거나. */
function namesOf(value: unknown): readonly string[] {
  if (typeof value === 'string') return [value]
  if (!Array.isArray(value)) return []

  return value.filter((name): name is string => typeof name === 'string')
}
