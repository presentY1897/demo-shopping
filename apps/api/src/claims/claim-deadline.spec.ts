import { describe, expect, it } from 'vitest'

import {
  addBusinessDays,
  CLAIM_HANDLING_BUSINESS_DAYS,
  CLAIM_HANDLING_DEMO_MS,
  claimDueAt,
  claimDueAtOf,
  claimEarliestDueMs,
  isBusinessDay,
  isClaimOverdue,
  kstDayIndex,
  kstDayOfWeek,
} from './claim-deadline.js'

/**
 * 처리 기한의 순수 판단 (TASK-0070 4장 · Q5 강화 — **분기 커버리지 100%**).
 *
 * **날짜를 KST 로 적는다.** `2026-09-04T09:00:00+09:00` 은 UTC 로는 전날 자정이고,
 * 영업일을 세는 축은 KST 달력이다 — UTC 로 적으면 스펙을 읽는 사람이 매번 아홉
 * 시간을 암산해야 하고, 그 암산이 한 번 틀리면 「금요일 신청」을 「목요일 신청」으로
 * 검증하게 된다.
 *
 * 2026년 9월의 요일: 4일 금 · 5일 토 · 6일 일 · 7일 월 · 8일 화 · 9일 수 · 10일 목.
 */
const kst = (value: string): Date => new Date(value)

describe('KST 달력', () => {
  it('puts an instant on the Korean calendar day, not the UTC one', () => {
    // UTC 로는 9월 3일 15시, KST 로는 9월 4일 자정이다.
    expect(kstDayIndex(kst('2026-09-04T00:00:00+09:00'))).toBe(
      kstDayIndex(kst('2026-09-04T23:59:59.999+09:00')),
    )
    expect(kstDayIndex(kst('2026-09-05T00:00:00+09:00'))).toBe(
      kstDayIndex(kst('2026-09-04T00:00:00+09:00')) + 1,
    )
  })

  it('counts the weekday from a Thursday epoch, and does it for negative days too', () => {
    // 1970-01-01 은 목요일. `getDay()` 를 쓰지 않는 이유가 이 상수다 — 그쪽은
    // 프로세스의 시간대를 읽고, 컨테이너의 시간대는 UTC 다.
    expect(kstDayOfWeek(0)).toBe(4)
    // 1970 이전은 음수 일수다. `%` 가 음수를 그대로 돌려주므로 보정이 없으면
    // 요일이 입력의 부호에 따라 달라진다.
    expect(kstDayOfWeek(-1)).toBe(3)
    expect(kstDayOfWeek(-7)).toBe(4)
  })

  it('calls Saturday and Sunday non-business days and the rest business days', () => {
    const dayOf = (value: string): number => kstDayIndex(kst(value))

    expect(isBusinessDay(dayOf('2026-09-04T12:00:00+09:00'))).toBe(true) // 금
    expect(isBusinessDay(dayOf('2026-09-05T12:00:00+09:00'))).toBe(false) // 토
    expect(isBusinessDay(dayOf('2026-09-06T12:00:00+09:00'))).toBe(false) // 일
    expect(isBusinessDay(dayOf('2026-09-07T12:00:00+09:00'))).toBe(true) // 월
  })
})

describe('영업일 세기', () => {
  const dayOf = (value: string): number => kstDayIndex(kst(`${value}T12:00:00+09:00`))

  it('counts no steps as no movement', () => {
    expect(addBusinessDays(dayOf('2026-09-04'), 0)).toBe(dayOf('2026-09-04'))
  })

  it('skips the weekend rather than counting it', () => {
    // 수 → 목(1) → 금(2)
    expect(addBusinessDays(dayOf('2026-09-09'), 2)).toBe(dayOf('2026-09-11'))
    // 금 → (토·일 건너뛰고) 월(1) → 화(2). 실제로는 4일이 지난다
    expect(addBusinessDays(dayOf('2026-09-04'), 2)).toBe(dayOf('2026-09-08'))
    // 토에 들어온 것도 다음 영업일부터 센다 — 월(1) → 화(2)
    expect(addBusinessDays(dayOf('2026-09-05'), 2)).toBe(dayOf('2026-09-08'))
    expect(addBusinessDays(dayOf('2026-09-06'), 2)).toBe(dayOf('2026-09-08'))
  })

  it('never counts the request day itself', () => {
    // 「신청 **후** 2영업일」이므로 신청 다음 영업일이 1영업일이다.
    expect(addBusinessDays(dayOf('2026-09-07'), 1)).toBe(dayOf('2026-09-08'))
  })
})

describe('처리 기한', () => {
  it('keeps the time of day and moves only the date', () => {
    // 금 15:00 신청 → 화 15:00. 시각을 날짜 끝으로 올리면 09시에 신청한 사람과
    // 17시에 신청한 사람이 같은 기한을 받아 먼저 신청한 쪽이 손해를 본다.
    expect(claimDueAt(kst('2026-09-04T15:00:00+09:00'), 'realistic').toISOString()).toBe(
      kst('2026-09-08T15:00:00+09:00').toISOString(),
    )
    expect(claimDueAt(kst('2026-09-09T09:30:00+09:00'), 'realistic').toISOString()).toBe(
      kst('2026-09-11T09:30:00+09:00').toISOString(),
    )
  })

  it('compresses to a fixed window in the demo pace instead of counting calendar days', () => {
    // 압축된 시간에 달력의 주말을 얹으면 「10분 뒤인데 월요일까지」가 나온다.
    const requestedAt = kst('2026-09-05T12:00:00+09:00')

    expect(claimDueAt(requestedAt, 'demo').getTime()).toBe(
      requestedAt.getTime() + CLAIM_HANDLING_DEMO_MS,
    )
  })

  it('reads the pace from the configuration, like every other compressed window', () => {
    const requestedAt = kst('2026-09-04T15:00:00+09:00')

    expect(claimDueAtOf(requestedAt, { fulfillmentPace: 'demo' })).toEqual(
      claimDueAt(requestedAt, 'demo'),
    )
    expect(claimDueAtOf(requestedAt, { fulfillmentPace: 'realistic' })).toEqual(
      claimDueAt(requestedAt, 'realistic'),
    )
  })

  it('is two business days, not two days', () => {
    expect(CLAIM_HANDLING_BUSINESS_DAYS).toBe(2)
  })
})

describe('지연 판정', () => {
  const dueAt = kst('2026-09-08T15:00:00+09:00')

  it('treats the deadline instant itself as still inside the deadline', () => {
    // 기한은 「그 순간까지」다. 정각에 처리한 사람을 지연으로 표시하는 것은 하루를
    // 빼앗는 것이다.
    expect(isClaimOverdue(dueAt, dueAt)).toBe(false)
    expect(isClaimOverdue(dueAt, new Date(dueAt.getTime() - 1))).toBe(false)
  })

  it('is late one millisecond after it', () => {
    expect(isClaimOverdue(dueAt, new Date(dueAt.getTime() + 1))).toBe(true)
  })
})

describe('가장 이른 기한 — 지연 목록의 컷오프가 기대는 하한', () => {
  const DAY_MS = 24 * 60 * 60 * 1_000

  it('is exactly the compressed window in the demo pace', () => {
    expect(claimEarliestDueMs('demo')).toBe(CLAIM_HANDLING_DEMO_MS)
  })

  it('is two calendar days in the realistic pace', () => {
    expect(claimEarliestDueMs('realistic')).toBe(CLAIM_HANDLING_BUSINESS_DAYS * DAY_MS)
  })

  /**
   * **이 부등식이 지연 목록의 근거다** (TASK-0071 `adminOverdueScanBefore`).
   *
   * 영업일 계산을 SQL 로 내려보내지 않으려면 「이보다 나중에 신청된 것은 아직 기한
   * 안」이라고 확실히 말할 수 있어야 하고, 그 말은 정확히 「기한 ≥ 신청 + 이 값」이다.
   * 한 해의 매 시각을 돌아 그것이 참인지 센다 — 주말을 건너뛰는 걸음이 하루보다 짧게
   * 잡히는 날 이 단언이 먼저 빨개진다.
   */
  it('is never more than the actual deadline, at any hour of the year', () => {
    const HOUR = 60 * 60 * 1_000
    const violations: string[] = []

    for (let hour = 0; hour < 365 * 24; hour += 1) {
      const requestedAt = new Date(Date.parse('2026-01-01T00:00:00.000Z') + hour * HOUR)
      const slack = claimDueAt(requestedAt, 'realistic').getTime() - requestedAt.getTime()

      if (slack < claimEarliestDueMs('realistic')) violations.push(requestedAt.toISOString())
    }

    expect(violations).toEqual([])
  })
})
