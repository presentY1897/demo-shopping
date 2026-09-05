/**
 * 콘솔은 색인하지 않는다 (TASK-0102 F5, DECISIONS 1장).
 *
 * **둘 다 확인한다.** `robots.txt` 의 `Disallow` 는 크롤러가 그것을 읽고 따를 때만
 * 듣고, 레이아웃의 `noindex` 는 페이지를 **가져온 뒤에야** 읽힌다. 하나만 있으면
 * 각각 빈틈이 있다 — 무시하는 크롤러와, 오지 않는 크롤러.
 */

import { describe, expect, it } from 'vitest'

import robots from '@/app/robots'
import { metadata } from '@/app/layout'

describe('robots.txt', () => {
  it('disallows everything', () => {
    const { rules } = robots()
    const first = Array.isArray(rules) ? rules[0] : rules

    expect(first?.disallow).toBe('/')
  })
})

describe('레이아웃 메타데이터', () => {
  it('says noindex for a crawler that never read robots.txt', () => {
    expect(metadata.robots).toEqual({ index: false, follow: false })
  })
})
