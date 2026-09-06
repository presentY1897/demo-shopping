import type {
  PointReconciliationFault,
  PointRefType,
  PointTransactionType,
  PricingDiscount,
} from '@shopping/shared'
import { POINT_MAX_MOVEMENT } from '@shopping/shared'

/**
 * 적립금 원장의 규칙 — 데이터베이스를 보지 않는 부분 전부 (TASK-0076).
 *
 * 다섯 가지 질문이 여기 살고, 어느 것도 연결을 필요로 하지 않는다.
 *
 * **이 사건을 적어도 되는가?** 0원은 사건이 아니고, 부호는 종류가 정하고, 참조는
 * 두 칸 다이거나 아무것도 아니며, 조정은 이유를 말해야 한다. 전부 마이그레이션의
 * 제약이기도 하다 — 여기가 더하는 것은 **어느 입력이 잘못됐는지 이름을 부르는 답**
 * 이다. 제약 이름은 폼이 필드 밑에 붙일 수 있는 것이 아니다(`error-contract.md` 1).
 *
 * **얼마가 적립되는가?** 실결제금액 × 적립률(bp), 내림. 부동소수를 쓰지 않는다.
 *
 * **이 사용이 어느 통에서 나가는가?** 먼저 사라질 통부터다. 잔액이 모자라면
 * 거절이고, 그 거절이 **지금 쓸 수 있는 금액**을 함께 든다.
 *
 * **잔액이 얼마가 되는가?** 덧셈, 그리고 거절 하나 — 음수가 될 수 없다.
 *
 * **원장이 아직 잔액을 설명하는가?** 다섯 진술 중 무엇이 깨졌는지를
 * {@link reconciliationFaults} 가 말한다. 「합계가 다르다」만으로는 행을 잃은 것과
 * 잠금 밖에서 쓴 것과 잔액을 잘못 적은 것을 가를 수 없다.
 *
 * I/O 가 없으므로 모든 분기가 단위 테스트에서 닿고, 그래서 이 파일의 게이트는
 * 분기 커버리지 100% 다 (QUALITY-GATES Q5 — 순수 로직 · TASK-0076 6.2).
 */

/** 그 종류가 잔액을 어느 쪽으로 움직일 수 있는가. */
export type PointDirection = 'in' | 'out' | 'either'

/**
 * 종류마다의 방향, **빠짐없는 레코드로.**
 *
 * `switch` 가 아니라 레코드인 이유는 재고 원장과 같다 — `@shopping/shared` 에 종류를
 * 하나 더하고 방향을 정하지 않으면 **컴파일이 멈춘다.** 새 사건이 아무 규칙도 없이
 * 도착하는 것을 막는 유일한 방법이고, `PointTransaction_direction_check` 가 같은
 * 표를 데이터베이스에 적어 둔 것이다.
 */
export const pointDirections: Readonly<Record<PointTransactionType, PointDirection>> = {
  EARN: 'in',
  RESTORE: 'in',
  USE: 'out',
  EXPIRE: 'out',
  // 유일한 양방향이고, 그래서 이유를 말해야 하는 유일한 종류다.
  ADJUST: 'either',
}

export type PointIssueCode =
  /** 0원짜리 사건. */
  | 'zero_amount'
  /** 요청한 사용 금액이 원 단위 양수가 아니다. */
  | 'not_positive'
  /** 부호가 종류와 어긋난다 — 잔액을 늘리는 `USE`. */
  | 'wrong_direction'
  /** 한도를 넘는 자릿수. */
  | 'amount_too_large'
  /** 참조의 반쪽만 왔다. */
  | 'unpaired_reference'
  /** 이유 없는 `ADJUST`. */
  | 'reason_required'
  /** 공백뿐인 이유. */
  | 'blank_reason'

/**
 * 거절 하나와, 그것이 가리키는 입력.
 *
 * 문장이 아니라 필드 이름인 이유는 부르는 쪽이 이것을 `details[].field` 로 바꾸고,
 * 저쪽 폼이 **사람이 실제로 만진 칸** 밑에 문장을 붙이기 때문이다.
 */
export interface PointIssue {
  readonly code: PointIssueCode
  readonly field: 'amount' | 'refType' | 'refId' | 'reason'
}

/** 사건 하나, 서비스가 정규화한 뒤의 모양: 선택값이 전부 결정돼 있다. */
export interface PointMovementDraft {
  readonly type: PointTransactionType
  /** 부호가 있다. 종류가 그 부호를 정한다. */
  readonly amount: number
  readonly refType: PointRefType | null
  readonly refId: string | null
  readonly reason: string | null
}

/**
 * 한 번에 움직일 수 있는 금액.
 *
 * 계약에 선언된 값을 **가져다 쓴다.** 옮겨 적으면 한쪽만 바뀌는 날이 오고, 그때
 * 서버가 받아 준 금액을 화면의 스키마가 거절한다.
 */
export const POINT_MOVEMENT_LIMIT = POINT_MAX_MOVEMENT

/** 그 금액이 그 방향에 맞는가. */
function admits(direction: PointDirection, amount: number): boolean {
  if (direction === 'either') return true

  return direction === 'in' ? amount > 0 : amount < 0
}

/**
 * 이 사건이 잘못된 점 전부, 또는 빈 목록.
 *
 * 첫 번째가 아니라 전부인 이유는 재고 원장과 같다 — 폼을 채우는 사람이 네 가지를
 * 듣기 위해 네 번 보내야 할 이유가 없다.
 */
export function movementIssues(draft: PointMovementDraft): readonly PointIssue[] {
  const issues: PointIssue[] = []

  if (draft.amount === 0) {
    issues.push({ code: 'zero_amount', field: 'amount' })
  } else if (!admits(pointDirections[draft.type], draft.amount)) {
    issues.push({ code: 'wrong_direction', field: 'amount' })
  } else if (Math.abs(draft.amount) > POINT_MOVEMENT_LIMIT) {
    issues.push({ code: 'amount_too_large', field: 'amount' })
  }

  // 반쪽 참조는 따라갈 수도 멱등의 열쇠로 쓸 수도 없고, 부분 유니크 인덱스가
  // `refId` 를 열쇠로 삼으므로 `refType` 만 든 행은 그 규칙에서 조용히 빠진다.
  if ((draft.refType === null) !== (draft.refId === null)) {
    issues.push({
      code: 'unpaired_reference',
      field: draft.refId === null ? 'refId' : 'refType',
    })
  }

  if (draft.reason !== null && draft.reason.trim() === '') {
    issues.push({ code: 'blank_reason', field: 'reason' })
  } else if (draft.reason === null && draft.type === 'ADJUST') {
    issues.push({ code: 'reason_required', field: 'reason' })
  }

  return issues
}

/**
 * 사용 **요청**의 금액이 잘못됐는가. 잘못이 없으면 `null`.
 *
 * {@link movementIssues} 와 따로 있는 이유는 **재는 대상이 다르기 때문**이다. 저쪽은
 * 원장에 적힐 행(부호가 이미 붙은 것)을 보고, 이쪽은 부르는 쪽이 보낸 숫자를 본다 —
 * 「1,000원을 쓴다」의 1,000이다. 이 검사가 없으면 음수 요청이 그대로 계획으로 들어가
 * **통의 잔고를 늘린다**: `Math.min(remaining, -5)` 는 -5 이고, 그것을 빼면 통이
 * 커진다. 원장 행은 그 뒤에 부호 검사에 걸리겠지만, 그때는 이미 그 트랜잭션이
 * 통들을 손본 뒤다.
 */
export function usageAmountIssue(amount: number): PointIssue | null {
  if (!Number.isInteger(amount) || amount <= 0) return { code: 'not_positive', field: 'amount' }
  if (amount > POINT_MOVEMENT_LIMIT) return { code: 'amount_too_large', field: 'amount' }

  return null
}

/**
 * 이 사건 뒤의 잔액, 또는 음수가 될 때 `null`.
 *
 * 던지지 않고 `null` 인 이유는 재고 원장과 같다 — 부르는 쪽은 트랜잭션 안에서 행
 * 잠금을 쥔 채 이 거절로 무엇을 할지 정해야 하고, 실패할 수 없는 함수는 테스트가
 * 남김없이 훑을 수 있는 함수다.
 */
export function nextBalance(current: number, amount: number): number | null {
  const balance = current + amount

  return balance < 0 ? null : balance
}

/**
 * 실결제금액에 적립률을 적용한 금액. **내림이다.**
 *
 * 정수 나눗셈으로 끝내는 이유는 금액 규칙 그대로다 — 부동소수를 쓰면 1원이 어긋나고
 * 그 1원은 실제 돈이다(`pricing.md` 원칙). 올림이 아니라 내림인 것은 플랫폼이
 * 부담하는 값이기 때문이다: 반올림으로 1원을 더 주는 정책은 누구도 동의한 적이 없다.
 *
 * 0원이 나오는 것은 정상이다 — 적립률이 0이거나 결제액이 100원 미만이면 그렇고,
 * 그때 원장에는 아무 행도 생기지 않는다(0원짜리 사건은 사건이 아니다).
 */
export function earnedAmount(paidAmount: number, earnRateBp: number): number {
  if (paidAmount <= 0 || earnRateBp <= 0) return 0

  return Math.floor((paidAmount * earnRateBp) / 10_000)
}

/**
 * 지급 시각으로부터 유효기간이 지난 시각.
 *
 * 시계를 읽지 않고 **인자로 받는다** — 순수 로직은 현재 시각을 인자로 받는다는
 * 규약이고(QUALITY-GATES 6장), 그래야 「지급일이 언제였든 같은 수명」이 테스트에서
 * 실제로 재진다.
 */
export function expiryFrom(issuedAt: Date, validityDays: number): Date {
  return new Date(issuedAt.getTime() + validityDays * 24 * 60 * 60 * 1000)
}

/** 아직 남아 있는 통 하나, 사용이 알아야 하는 만큼. */
export interface PointLot {
  readonly id: string
  readonly remainingAmount: number
}

/** 한 통에서 얼마를 뺄 것인가. */
export interface LotDraw {
  readonly lotId: string
  readonly amount: number
  /** 뺀 뒤 그 통에 남는 금액. 서비스가 이 값을 **대입한다.** */
  readonly remainingAfter: number
}

export type ConsumptionPlan =
  | { readonly outcome: 'refused'; readonly available: number }
  | { readonly outcome: 'planned'; readonly draws: readonly LotDraw[] }

/**
 * 이 사용이 어느 통에서 얼마씩 나가는가 — **먼저 사라질 통부터.**
 *
 * 부르는 쪽이 `expiresAt` 오름차순(같으면 `seq` 오름차순)으로 정렬해 넘긴다.
 * 순서가 정책이다: 나중에 사라질 통을 먼저 쓰면 앞의 통이 만료로 사라지고, 산 사람은
 * 쓸 수 있었던 적립금을 잃는다.
 *
 * **거절이 `available` 을 함께 든다.** 「잔액이 부족합니다」만으로는 다음에 무엇을
 * 할지 정할 수 없고, 화면이 자기가 마지막으로 읽은 잔액을 적으면 방금 다른 탭에서
 * 쓴 금액을 모른 채 거짓을 말한다 — 거절을 만든 쪽이 그 순간의 값을 함께 보내야
 * 참인 문장이 된다(`ReservationService` 가 진 쪽에게 지금의 잔여를 답하는 것과 같다).
 *
 * 남는 통까지 훑지 않고 다 채우면 멈춘다. 통이 수백 개인 계정에서 1원을 쓰는 일이
 * 전체 스캔이 될 이유가 없다.
 */
export function planConsumption(lots: readonly PointLot[], amount: number): ConsumptionPlan {
  const draws: LotDraw[] = []
  let left = amount

  for (const lot of lots) {
    if (left === 0) break

    const drawn = Math.min(lot.remainingAmount, left)

    draws.push({ lotId: lot.id, amount: drawn, remainingAfter: lot.remainingAmount - drawn })
    left -= drawn
  }

  if (left > 0) {
    return { outcome: 'refused', available: amount - left }
  }

  return { outcome: 'planned', draws }
}

/**
 * 대사가 한 계정에 대해 읽는 것.
 *
 * 여섯 개 전부 집계이고, 그것이 아래 규칙 중 어느 것도 CHECK 이 될 수 없는 이유다
 * (`20260909100000_point_ledger/migration.sql` 의 같은 문단).
 */
export interface PointLedgerAudit {
  /** `PointAccount.balance` — 현재값. */
  readonly balance: number
  /** 원장이 든 행의 수. */
  readonly entries: number
  /** 모든 행의 `amount` 합. */
  readonly sum: number
  /** 가장 최근 행의 `balanceAfter`. 행이 없으면 0. */
  readonly lastBalanceAfter: number
  /** 가장 큰 `seq`. 행이 없으면 0. */
  readonly maxSeq: number
  /** 직전 `balanceAfter` + 자기 금액이 아닌 행의 수. */
  readonly chainBreaks: number
  /** 아직 남아 있는 통들의 합. */
  readonly lotRemaining: number
}

/**
 * 이 계정이 다섯 진술 중 무엇을 어기는가.
 *
 * 빈 목록은 원장이 잔액을 남김없이 설명하는 계정이다 — 사건이 하나도 없는 계정도
 * 포함이고, 그때 잔액은 0이어야 한다.
 */
export function reconciliationFaults(audit: PointLedgerAudit): readonly PointReconciliationFault[] {
  const faults: PointReconciliationFault[] = []

  // P1. 모두가 기대하는 그것. 잃어버린 갱신이 이것을 깬다.
  if (audit.balance !== audit.sum) faults.push('sum_mismatch')
  // P2. 이것이 없으면 `balanceAfter` 는 장식이고, 저장할 이유가 없다.
  if (audit.chainBreaks > 0) faults.push('chain_break')
  // P3. 「지금 얼마인가」를 원장의 마지막 행만 읽고 답할 수 있는가.
  if (audit.balance !== audit.lastBalanceAfter) faults.push('endpoint_mismatch')
  // P4. 빈칸은 행이 지워졌거나 `seq` 를 나눠 주는 행 잠금 없이 쓰였다는 뜻이다 —
  // 사건이 원장을 통째로 빠져나가는 두 가지 길이다.
  if (audit.maxSeq !== audit.entries) faults.push('seq_gap')
  // P5. 적립금에만 있는 다섯째. 사용이 통을 비우지 않았다면 만료가 이미 쓴 돈을
  // 한 번 더 없앤다 — 그 순간 잔액이 음수가 되려 하고 CHECK 이 배치를 세운다.
  if (audit.balance !== audit.lotRemaining) faults.push('lot_mismatch')

  return faults
}

/**
 * 계산 엔진이 받는 모양으로 (`packages/shared/src/pricing`).
 *
 * **엔진을 다시 만들지 않는다** (D-036). M07 이 「할인은 목록으로 받는다」로 열어 둔
 * 자리에 꽂기만 하는 것이고, 그래서 적립금이 배송비까지 낼 수 있다는 것도, 낼 돈보다
 * 많이 깎지 않는다는 것도 이미 그쪽이 정해 두었다(`calculate.ts` 의 ⑤).
 *
 * `scope: 'ORDER'` — 적립금은 주문 전체에 붙고 항목마다 안분된다(`pricing.md` 2장).
 * `bearer: 'PLATFORM'` — 정산이 읽는 값이다. 적립금은 플랫폼 부담이라 판매자 정산에서
 * 차감되지 않는다(`pricing.md` 6장). 이 한 칸이 틀리면 판매자가 자기가 주지도 않은
 * 할인을 물어낸다.
 */
export function pointDiscount(amount: number): PricingDiscount {
  return { id: 'point', type: 'POINT', scope: 'ORDER', amount, bearer: 'PLATFORM' }
}
