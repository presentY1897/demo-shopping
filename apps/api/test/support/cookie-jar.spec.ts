import { describe, expect, it } from 'vitest'

import { createCookieJar, parseSetCookie } from './cookie-jar.js'

/**
 * The jar is harness code, so it gets tested like anything else: a bug here
 * would make a session test pass while the browser rejected the cookie.
 */

function responseWith(...setCookie: string[]): Response {
  const headers = new Headers()

  for (const value of setCookie) headers.append('set-cookie', value)
  return new Response(null, { headers })
}

describe('parseSetCookie', () => {
  it('keeps the attributes TASK-0022 has to assert', () => {
    const cookie = parseSetCookie(
      'refresh_token=abc.def; Path=/api/v1/auth; Max-Age=1209600; HttpOnly; Secure; SameSite=Lax',
    )

    expect(cookie).toEqual({
      name: 'refresh_token',
      value: 'abc.def',
      attributes: {
        path: '/api/v1/auth',
        'max-age': '1209600',
        httponly: '',
        secure: '',
        samesite: 'Lax',
      },
    })
  })

  it('rejects a header that carries no name=value pair', () => {
    expect(parseSetCookie('HttpOnly')).toBeNull()
    expect(parseSetCookie('=orphan')).toBeNull()
  })

  it('keeps a value that contains an equals sign', () => {
    expect(parseSetCookie('t=a=b; Path=/')?.value).toBe('a=b')
  })
})

describe('cookie jar', () => {
  it('is empty until something is captured', () => {
    expect(createCookieJar().header()).toBeUndefined()
  })

  it('sends back what a response set, in one header', () => {
    const jar = createCookieJar()

    jar.capture(responseWith('a=1; Path=/', 'b=2; Path=/'))

    expect(jar.header()).toBe('a=1; b=2')
    expect(jar.names()).toEqual(['a', 'b'])
  })

  it('replaces a cookie that is set again, rather than sending both', () => {
    const jar = createCookieJar()

    jar.capture(responseWith('session=old; Path=/'))
    jar.capture(responseWith('session=new; Path=/'))

    expect(jar.header()).toBe('session=new')
  })

  it('drops a cookie the server expired, so a logout test cannot pass by replay', () => {
    const jar = createCookieJar()

    jar.capture(responseWith('session=live; Path=/'))
    jar.capture(responseWith('session=; Path=/; Max-Age=0'))

    expect(jar.header()).toBeUndefined()
  })

  it('exposes the stored attributes for assertions', () => {
    const jar = createCookieJar()

    jar.capture(responseWith('session=v; HttpOnly; SameSite=Strict'))

    expect(jar.get('session')?.attributes).toEqual({ httponly: '', samesite: 'Strict' })
  })

  it('clears on request', () => {
    const jar = createCookieJar()

    jar.capture(responseWith('a=1'))
    jar.clear()

    expect(jar.header()).toBeUndefined()
  })
})
