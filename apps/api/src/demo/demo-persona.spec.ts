import { appIds, demoRoles } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import {
  DEMO_GRANTS,
  DEMO_ROLE_BY_APP,
  demoRoleMatchesApp,
  demoRoleOfGrants,
} from './demo-persona.js'

/**
 * The pairing that decides a 400 and the grant that decides what a visitor may
 * do — both with no I/O, so every cell is reachable from here.
 *
 * What fails silently if a cell is wrong: a persona paired with the wrong app
 * issues a session into a cookie its console never reads, and the visitor lands
 * signed in with nowhere to go — no error, no log line, nothing red.
 */

describe('앱과 페르소나', () => {
  it('세 앱이 각각 하나씩 발급한다', () => {
    expect(DEMO_ROLE_BY_APP).toEqual({ shop: 'BUYER', seller: 'SELLER', admin: 'ADMIN' })
    // Every app has a persona and every persona has an app: a table missing a
    // row is an app whose demo button can never work.
    expect(new Set(Object.values(DEMO_ROLE_BY_APP)).size).toBe(appIds.length)
  })

  it('짝이 맞는 조합만 통과시킨다', () => {
    for (const app of appIds) {
      for (const role of demoRoles) {
        expect(demoRoleMatchesApp(app, role)).toBe(DEMO_ROLE_BY_APP[app] === role)
      }
    }
  })
})

describe('발급 시 부여하는 역할', () => {
  it('구매자와 관리자는 발급이 직접 부여하고, 판매자는 스토어가 부여한다', () => {
    expect(DEMO_GRANTS.BUYER).toEqual(['BUYER'])
    expect(DEMO_GRANTS.ADMIN).toEqual(['DEMO_ADMIN'])
    // Empty on purpose: `SELLER_OWNER` is what approving a store *is*, and
    // granting it here would produce a seller with no store to own.
    expect(DEMO_GRANTS.SELLER).toEqual([])
  })

  it('관리자 데모에 BUYER 를 얹지 않는다', () => {
    // `BUYER` carries `seller.write:own` — the ability to apply as a seller —
    // which is not what somebody who opened the admin console asked for.
    expect(DEMO_GRANTS.ADMIN).not.toContain('BUYER')
  })
})

describe('역할에서 페르소나를 되읽기', () => {
  it('관리자 · 판매자 · 구매자 순으로 판정한다', () => {
    expect(demoRoleOfGrants(['DEMO_ADMIN'])).toBe('ADMIN')
    expect(demoRoleOfGrants(['SELLER_OWNER'])).toBe('SELLER')
    expect(demoRoleOfGrants(['BUYER'])).toBe('BUYER')
  })

  it('역할이 겹치면 넓은 쪽을 답한다', () => {
    expect(demoRoleOfGrants(['BUYER', 'SELLER_OWNER'])).toBe('SELLER')
    expect(demoRoleOfGrants(['DEMO_ADMIN', 'SELLER_OWNER'])).toBe('ADMIN')
  })

  it('역할이 하나도 없어도 답을 낸다', () => {
    // The banner is drawn on every page for a day; a demo whose roles were
    // changed underneath it must still get a sentence rather than a crash.
    expect(demoRoleOfGrants([])).toBe('BUYER')
  })
})
