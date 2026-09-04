import { describe, expect, it } from 'vitest'

import { fill, remainingOf } from '@/lib/demo/remaining'

/**
 * How much of a demo is left, and how the sentence is filled in (TASK-0024 4.6).
 *
 * Pure, and the reason it is pure is that the banner recomputes it every minute
 * for a day: a function that read the clock could only be tested by moving the
 * process clock, which is the device `docs/tasks/QUALITY-GATES.md` 6장 rules out.
 */

const AT = Date.parse('2026-09-05T00:00:00.000Z')

function inMs(hours: number, minutes: number): string {
  return new Date(AT + (hours * 60 + minutes) * 60_000).toISOString()
}

describe('남은 시간', () => {
  it('시간과 분으로 나눈다', () => {
    expect(remainingOf(inMs(23, 12), AT)).toEqual({ expired: false, hours: 23, minutes: 12 })
  })

  it('한 시간이 안 남으면 시간은 0 이다', () => {
    expect(remainingOf(inMs(0, 12), AT)).toEqual({ expired: false, hours: 0, minutes: 12 })
  })

  it('분 미만은 버린다', () => {
    // The banner shows minutes; a rounding that displayed a minute that has not
    // arrived would count down to "1분 남음" and stay there.
    expect(remainingOf(new Date(AT + 59_000).toISOString(), AT)).toEqual({
      expired: false,
      hours: 0,
      minutes: 0,
    })
  })

  it('지났으면 만료다', () => {
    expect(remainingOf(inMs(0, 0), AT).expired).toBe(true)
    expect(remainingOf(new Date(AT - 1).toISOString(), AT).expired).toBe(true)
  })

  it('읽을 수 없는 값도 만료로 답한다', () => {
    // The safer of the two mistakes: "끝났어요" is a sentence a visitor can act
    // on, while "23시간 남음" about a NaN is a promise nothing keeps.
    expect(remainingOf('언젠가', AT).expired).toBe(true)
  })
})

describe('문장 채우기', () => {
  it('자리를 값으로 바꾼다', () => {
    expect(fill('{hours}시간 {minutes}분 남음', { hours: 3, minutes: 7 })).toBe('3시간 7분 남음')
  })

  it('같은 자리가 여러 번 나와도 전부 바꾼다', () => {
    expect(fill('{n}/{n}', { n: 2 })).toBe('2/2')
  })

  it('모르는 자리는 그대로 둔다', () => {
    // Visible in the screen rather than silently blank, which is what a reader
    // needs in order to notice that a catalog and a component disagree.
    expect(fill('{hours}시간 {unknown}', { hours: 1 })).toBe('1시간 {unknown}')
  })
})
