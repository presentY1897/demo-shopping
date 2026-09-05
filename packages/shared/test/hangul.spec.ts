/**
 * 자모 분해와 유형 판별 (TASK-0103 F4, Q5 강화 — 분기 커버리지 100%).
 *
 * 한글 처리는 경계가 많다. 받침이 있는 글자와 없는 글자, 겹받침, 호환 자모, 한글이 아닌 글자,
 * 그리고 그 전부가 섞인 실제 상품명 — 하나라도 빠뜨리면 그 입력을 친 사람에게만 검색이 안 되고,
 * 그 사람은 그것을 신고하지 않는다.
 */

import { describe, expect, it } from 'vitest'

import {
  CHOSUNG_MIN_LENGTH,
  chosungOf,
  classifyHangulQuery,
  decomposeChar,
  decomposeHangul,
  hangulIndexFields,
  hangulQueryFor,
} from '../src/hangul.js'

describe('자모 분해', () => {
  it('splits a syllable with a final consonant into three', () => {
    expect(decomposeChar('울')).toBe('ㅇㅜㄹ')
  })

  it('splits one without into two', () => {
    expect(decomposeChar('코')).toBe('ㅋㅗ')
  })

  it('keeps a compound final as the one letter it is written with', () => {
    // 「닭」의 받침은 `ㄺ` 하나다. `ㄹ`+`ㄱ` 으로 쪼개면 색인과 검색어가 서로 다른 모양이 된다.
    expect(decomposeChar('닭')).toBe('ㄷㅏㄺ')
  })

  it.each(['A', '7', ' ', '·', 'ㅌ'])('leaves %s alone', (char) => {
    // 한글이 아닌 것을 버리면 영문 상품명이 통째로 사라지고, 「나이ㅋ」가 아무것도 못 찾는다.
    expect(decomposeChar(char)).toBe(char)
  })

  it('handles the ends of the syllable block', () => {
    expect(decomposeChar('가')).toBe('ㄱㅏ')
    expect(decomposeChar('힣')).toBe('ㅎㅣㅎ')
  })

  it('leaves the characters just outside it alone', () => {
    // `가` 바로 앞과 `힣` 바로 뒤. 구간을 한 칸 넓게 잡으면 여기서 깨진다.
    expect(decomposeChar('\u{ABFF}')).toBe('\u{ABFF}')
    expect(decomposeChar('\u{D7A4}')).toBe('\u{D7A4}')
  })

  it('answers for an empty string rather than throwing', () => {
    expect(decomposeChar('')).toBe('')
  })

  it('spreads a whole name, spaces and all', () => {
    expect(decomposeHangul('울 롱코트')).toBe('ㅇㅜㄹ ㄹㅗㅇㅋㅗㅌㅡ')
  })
})

describe('초성', () => {
  it('keeps one letter per syllable', () => {
    // 「롱코트」는 세 음절이므로 세 글자다.
    expect(chosungOf('울 롱코트')).toBe('ㅇ ㄹㅋㅌ')
  })

  it('leaves everything that is not a syllable where it is', () => {
    expect(chosungOf('나이키 270')).toBe('ㄴㅇㅋ 270')
  })

  it('is empty for an empty name', () => {
    expect(chosungOf('')).toBe('')
  })
})

describe('F4 유형 판별', () => {
  it.each([
    ['코트', 'complete'],
    ['nike', 'complete'],
    ['', 'complete'],
    ['   ', 'complete'],
  ])('reads %s as %s', (term, kind) => {
    expect(classifyHangulQuery(term)).toBe(kind)
  })

  it('reads a mid-composition term as jamo', () => {
    // 「코ㅌ」는 완성형 `코` + 호환 자모 `ㅌ` 다. 「코트」와 한 글자도 겹치지 않는다.
    expect(classifyHangulQuery('코ㅌ')).toBe('jamo')
    expect(classifyHangulQuery('나이ㅋ')).toBe('jamo')
  })

  it('reads consonants alone as a chosung search', () => {
    expect(classifyHangulQuery('ㅋㅌ')).toBe('chosung')
    expect(classifyHangulQuery('ㅇㄹㅋㅌ')).toBe('chosung')
  })

  it('does not turn one consonant into a chosung search (R1)', () => {
    // 초성 검색은 후보가 넓다. 한 글자면 카탈로그의 절반이 걸린다.
    expect(CHOSUNG_MIN_LENGTH).toBe(2)
    expect(classifyHangulQuery('ㅋ')).toBe('jamo')
  })

  it('reads a lone vowel as jamo, not as a chosung search', () => {
    // 「ㅏㅓ」는 자음이 아니므로 초성일 수 없다.
    expect(classifyHangulQuery('ㅏㅓ')).toBe('jamo')
  })

  it('reads consonants mixed with a syllable as jamo', () => {
    expect(classifyHangulQuery('코ㅌㅡ')).toBe('jamo')
  })
})

describe('검색어 변환', () => {
  it('spreads a jamo term the same way the index was built', () => {
    expect(hangulQueryFor('코ㅌ', 'jamo')).toBe('ㅋㅗㅌ')
  })

  it('sends a chosung term as typed', () => {
    expect(hangulQueryFor(' ㅋㅌ ', 'chosung')).toBe('ㅋㅌ')
  })

  it('sends a complete term as typed', () => {
    expect(hangulQueryFor(' 코트 ', 'complete')).toBe('코트')
  })
})

describe('색인 보조 필드', () => {
  it('makes one entry per word, not one for the whole name (4.1)', () => {
    const fields = hangulIndexFields(['울 롱코트'])

    // 「ㅋㅌ」가 「ㄹㅋㅌ」의 가운데라 안 걸리는 것은 알고 있는 한계다. 낱말로 나누지 *않으면*
    // 「ㅇㄹㅋㅌ」 한 덩어리가 되어 그마저도 못 찾는다.
    expect(fields.jamo).toEqual(['ㅇㅜㄹ', 'ㄹㅗㅇㅋㅗㅌㅡ'])
    expect(fields.chosung).toEqual(['ㅇ', 'ㄹㅋㅌ'])
  })

  it('collapses a word that appears twice', () => {
    const fields = hangulIndexFields(['코트 코트', '코트'])

    expect(fields.chosung).toEqual(['ㅋㅌ'])
  })

  it('drops the gaps that repeated spaces leave', () => {
    const fields = hangulIndexFields(['  울   코트  '])

    expect(fields.chosung).toEqual(['ㅇ', 'ㅋㅌ'])
  })

  it('is empty for a name that is nothing but spaces', () => {
    expect(hangulIndexFields(['   '])).toEqual({ jamo: [], chosung: [] })
  })

  it('takes several fields at once — name and brand (R2)', () => {
    const fields = hangulIndexFields(['롱코트', '해뜰녘'])

    expect(fields.chosung).toEqual(['ㄹㅋㅌ', 'ㅎㄸㄴ'])
  })
})
