/**
 * 「곧 만료된다」의 판정 (TASK-0077 F2).
 *
 * **시각은 인자다.** `vi.setSystemTime` 을 쓰지 않는 것이 이 저장소의 규약이고
 * (QUALITY-GATES 6장 「시간: 주입」), 그래야 경계에 앉은 하루를 검사가 고를 수 있다 —
 * 지금을 함수 안에서 읽으면 「6일 23시간 뒤」와 「7일 1시간 뒤」를 가르는 검사를 쓸
 * 방법이 아예 없다.
 *
 * 경계를 이 파일이 다시 적지 않고 `COUPON_EXPIRING_SOON_DAYS` 에서 읽는 이유도 같다.
 * 7을 손으로 적어 두면 계약이 그 수를 옮기는 날 **검사가 옛 규칙을 지키며 초록**이 되고,
 * 그때 화면과 계약이 갈렸다는 사실은 아무 데서도 드러나지 않는다.
 */

import { COUPON_EXPIRING_SOON_DAYS } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import { daysUntilExpiry, isExpiringSoon } from '@/lib/coupons/expiring'

const NOW = new Date('2026-09-07T00:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1_000

/** 지금으로부터 이만큼 뒤의 ISO 시각. 검사가 경계를 밀리초로 고른다. */
function after(ms: number): string {
  return new Date(NOW.getTime() + ms).toISOString()
}

describe('만료 임박', () => {
  it('is on for a coupon that dies inside the window', () => {
    expect(isExpiringSoon(after(3 * DAY_MS), NOW)).toBe(true)
  })

  it('is on right up to the last millisecond of the window', () => {
    expect(isExpiringSoon(after(COUPON_EXPIRING_SOON_DAYS * DAY_MS), NOW)).toBe(true)
  })

  it('is off one millisecond past it', () => {
    expect(isExpiringSoon(after(COUPON_EXPIRING_SOON_DAYS * DAY_MS + 1), NOW)).toBe(false)
  })

  it('is off for a coupon that has already expired', () => {
    // 만료 탭의 장에 「곧 만료」를 붙이면 강조가 「이미 늦었습니다」를 뜻하게 된다.
    // 배치가 아직 상태를 옮기지 않아 `ISSUED` 인 채 기간이 지난 장이 실제로 있으므로
    // (`coupon-expiry.service.ts`), 이 갈래는 이론이 아니다.
    expect(isExpiringSoon(after(-1), NOW)).toBe(false)
  })

  it('is off at the very instant of expiry', () => {
    expect(isExpiringSoon(after(0), NOW)).toBe(false)
  })
})

describe('남은 날', () => {
  it('rounds up, so a coupon dying tonight still has a day', () => {
    // 내림이면 「0일 남음」이 되고, 그것은 사람에게 「이미 끝났다」로 읽힌다. 아직
    // 오늘이 남아 있는 사람에게 하는 틀린 말이다.
    expect(daysUntilExpiry(after(1), NOW)).toBe(1)
    expect(daysUntilExpiry(after(DAY_MS), NOW)).toBe(1)
  })

  it('counts the days that are left', () => {
    expect(daysUntilExpiry(after(DAY_MS + 1), NOW)).toBe(2)
    expect(daysUntilExpiry(after(7 * DAY_MS), NOW)).toBe(7)
  })

  it('never goes negative', () => {
    expect(daysUntilExpiry(after(-5 * DAY_MS), NOW)).toBe(0)
    expect(daysUntilExpiry(after(0), NOW)).toBe(0)
  })
})
