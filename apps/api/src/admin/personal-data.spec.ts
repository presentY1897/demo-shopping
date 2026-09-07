/**
 * 가리기 규칙 (TASK-0093 F6).
 *
 * 틀렸을 때 조용하다 — 화면은 멀쩡히 그려지고, 다만 가려야 할 것이 그대로 나간다.
 */

import { describe, expect, it } from 'vitest'

import { maskEmail, maskName } from './personal-data'

describe('maskEmail', () => {
  it('keeps enough to tell two accounts apart', () => {
    expect(maskEmail('hong@example.com')).toBe('hon*@example.com')
    expect(maskEmail('honggildong@example.com')).toBe('hon*@example.com')
  })

  /**
   * **도메인을 남긴다.** 같은 이름이 여럿일 때 구별되는 것은 도메인 쪽인 경우가
   * 많고, 목록에서 계정을 지목할 수 없으면 사람이 상세를 더 자주 열게 된다 —
   * 가리기가 열람을 늘리는 셈이 된다.
   */
  it('keeps the domain', () => {
    expect(maskEmail('a@corp.example.com')).toContain('@corp.example.com')
  })

  it('does not leak the length of a short local part', () => {
    // 남길 것이 없는데 별만 늘리면 길이가 새어 나간다.
    expect(maskEmail('ab@example.com')).toBe('ab*@example.com')
    expect(maskEmail('a@example.com')).toBe('a*@example.com')
  })

  /** 값이 이메일이 아니어도 **던지지 않는다** — 한 줄 때문에 목록 전체가 실패한다. */
  it('falls back to the name rule for something that is not an email', () => {
    expect(maskEmail('그냥이름')).toBe('그**름')
    // 이름 규칙은 별 개수로 길이를 유지한다 (D-246). 이메일이 아닌 값에 그것이
    // 적용되는 것은 의도한 대비책이고, 이 줄이 그 사실을 못 박는다.
    expect(maskEmail('@only-domain')).toBe('@**********n')
  })
})

describe('maskName', () => {
  /** 리뷰와 **같은 함수**다. 규칙이 둘이면 두 화면이 같은 사람을 다르게 가린다. */
  it('is the rule reviews already use', () => {
    expect(maskName('홍길동')).toBe('홍*동')
    expect(maskName('김철')).toBe('김*')
    expect(maskName('이')).toBe('이')
  })
})
