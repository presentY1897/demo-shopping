/**
 * Where a sign-in comes back to (TASK-0023 F2).
 *
 * Pure logic, so it is checked by input and output. The interesting cases are
 * the refusals: `next` arrives in a URL anybody can write, and each of the three
 * shapes below is a real open-redirect trick rather than a hypothetical one.
 */

import { describe, expect, it } from 'vitest'

import {
  HOME_PATH,
  rememberNextPath,
  safeNextPath,
  signInHref,
  takeNextPath,
} from '@/lib/auth/next-path'

describe('safeNextPath', () => {
  it('accepts a path inside this app', () => {
    expect(safeNextPath('/mypage/orders/3')).toBe('/mypage/orders/3')
  })

  it.each([
    ['an absolute URL', 'https://evil.example/steal'],
    ['a protocol-relative URL', '//evil.example/steal'],
    ['the backslash spelling of the same trick', '/\\evil.example/steal'],
    ['a relative path, which resolves against whatever page is open', 'mypage'],
    ['nothing at all', null],
    ['a value that is not a string', undefined],
  ])('refuses %s', (_name, value) => {
    expect(safeNextPath(value)).toBeNull()
  })
})

describe('signInHref', () => {
  it('carries the path, escaped exactly once', () => {
    expect(signInHref('/login', '/mypage/orders')).toBe('/login?next=%2Fmypage%2Forders')
  })

  it('leaves the query off entirely when there is nothing safe to carry', () => {
    expect(signInHref('/login', 'https://evil.example')).toBe('/login')
    expect(signInHref('/login', null)).toBe('/login')
  })
})

/**
 * The round trip cannot carry a parameter of ours — `GET /auth/google` declares
 * `?app=` and zod strips the rest, and the callback rebuilds the return address
 * from its own allow list. So the path waits here instead.
 */
describe('the remembered path', () => {
  it('comes back once and only once', () => {
    rememberNextPath('/mypage/orders')

    expect(takeNextPath()).toBe('/mypage/orders')
    expect(takeNextPath()).toBeNull()
  })

  it('is checked on the way out as well as on the way in', () => {
    // Somebody who wrote to storage directly — an extension, an older build —
    // must not get a redirect the URL check would have refused.
    sessionStorage.setItem('shopping.auth.next', 'https://evil.example')

    expect(takeNextPath()).toBeNull()
  })

  it('answers nothing when the tab never remembered anything', () => {
    sessionStorage.clear()

    expect(takeNextPath()).toBeNull()
  })

  it('has a home to fall back to', () => {
    expect(HOME_PATH).toBe('/')
  })
})
