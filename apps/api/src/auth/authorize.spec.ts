import type { AuthorizationSubject, Permission, ResourceOwnership, Role } from '@shopping/shared'
import {
  authorizePermission,
  authorizeResource,
  canAccessResource,
  canPerform,
  grantedScopes,
  isPermission,
  isReadPermission,
  isRole,
  permissionAction,
  permissionResource,
  permissions,
  platformOwnership,
  rolePermissions,
  roles,
  scopeAdmits,
} from '@shopping/shared'
import { describe, expect, it } from 'vitest'

/**
 * The permission decision, exercised on its own.
 *
 * Q5 of the quality gates puts this file's subject in the "순수 로직" band —
 * branch coverage 100%, because a wrong branch here either leaks data or locks
 * a role out, and neither shows up as a crash.
 */

const SELLER_USER = 'user-seller'
const SELLER_STORE = 'store-seller'
const DEMO_USER = 'user-demo'
const OTHER_USER = 'user-other'

function subject(role: Role, overrides: Partial<AuthorizationSubject> = {}): AuthorizationSubject {
  return { userId: SELLER_USER, roles: [role], sellerId: SELLER_STORE, ...overrides }
}

/** One row of each kind a scope has to tell apart. */
const resources = {
  ownStore: { ownerUserId: SELLER_USER, ownerSellerId: SELLER_STORE, ownerIsDemo: false },
  otherStore: { ownerUserId: OTHER_USER, ownerSellerId: 'store-other', ownerIsDemo: false },
  demoStore: { ownerUserId: DEMO_USER, ownerSellerId: 'store-demo', ownerIsDemo: true },
  demoAccount: { ownerUserId: DEMO_USER, ownerSellerId: null, ownerIsDemo: true },
  realAccount: { ownerUserId: OTHER_USER, ownerSellerId: null, ownerIsDemo: false },
  seed: platformOwnership,
} satisfies Record<string, ResourceOwnership>

type ResourceName = keyof typeof resources

describe('permission vocabulary', () => {
  it('splits a permission into its resource and its action', () => {
    expect(permissionResource('settlement.approve')).toBe('settlement')
    expect(permissionAction('settlement.approve')).toBe('approve')
  })

  it('treats exactly the read actions as read-only', () => {
    const readable = permissions.filter((permission) => isReadPermission(permission))

    expect(readable).toEqual(permissions.filter((permission) => permission.endsWith('.read')))
    expect(isReadPermission('product.write')).toBe(false)
  })

  it('narrows unknown strings', () => {
    expect(isPermission('product.write')).toBe(true)
    expect(isPermission('product.launch')).toBe(false)
    expect(isPermission(7)).toBe(false)
    expect(isRole('ADMIN_SUPER')).toBe(true)
    expect(isRole('ADMIN')).toBe(false)
    expect(isRole(null)).toBe(false)
  })
})

describe('the role table', () => {
  it('grants every permission to ADMIN_SUPER, at `any`', () => {
    expect(rolePermissions.ADMIN_SUPER.map((entry) => entry.permission)).toEqual([...permissions])
    expect(rolePermissions.ADMIN_SUPER.every((entry) => entry.scope === 'any')).toBe(true)
  })

  it('derives DEMO_ADMIN from ADMIN_OPERATOR by narrowing only what writes', () => {
    // DECISIONS 2: "DEMO_ADMIN = ADMIN_OPERATOR + 스코프 demo", and erd.md 1:
    // "시드·실계정 데이터는 조회만". Both halves are asserted here so that the
    // derivation cannot be replaced by a hand written list that drifts.
    const expected = rolePermissions.ADMIN_OPERATOR.map((entry) =>
      isReadPermission(entry.permission) ? entry : { ...entry, scope: 'demo' },
    )

    expect(rolePermissions.DEMO_ADMIN).toEqual(expected)
  })

  it('never grants user.write to a role that could then escalate itself', () => {
    // `user.write` administers an account, roles included. A `:own` grant would
    // let its holder give themselves any role at all and pass the scope check.
    for (const role of roles) {
      const scopes = rolePermissions[role]
        .filter((entry) => entry.permission === 'user.write')
        .map((entry) => entry.scope)

      expect(scopes).toEqual(role === 'ADMIN_SUPER' ? ['any'] : [])
    }
  })

  it('grants only permissions that exist', () => {
    for (const role of roles) {
      for (const entry of rolePermissions[role]) {
        expect(isPermission(entry.permission)).toBe(true)
      }
    }
  })
})

describe('grantedScopes', () => {
  it('is empty when no role grants the permission — deny by default', () => {
    expect(grantedScopes(subject('BUYER'), 'settlement.pay')).toEqual([])
    expect(canPerform(subject('BUYER'), 'settlement.pay')).toBe(false)
  })

  it('is empty for a subject with no roles at all', () => {
    expect(grantedScopes({ userId: 'u', roles: [], sellerId: null }, 'catalog.read')).toEqual([])
  })

  it('unions the scopes of every role held, in own → demo → any order', () => {
    const both = {
      userId: SELLER_USER,
      roles: ['SELLER_OWNER', 'DEMO_ADMIN'],
      sellerId: SELLER_STORE,
    } satisfies AuthorizationSubject

    expect(grantedScopes(both, 'product.write')).toEqual(['own', 'demo'])
  })

  it('collapses a scope granted twice', () => {
    const twice = {
      userId: 'u',
      roles: ['ADMIN_OPERATOR', 'ADMIN_SUPER'],
      sellerId: null,
    } satisfies AuthorizationSubject

    expect(grantedScopes(twice, 'catalog.write')).toEqual(['any'])
  })
})

describe('scopeAdmits', () => {
  const seller = subject('SELLER_OWNER')

  it('lets `any` through for every row', () => {
    for (const resource of Object.values(resources)) {
      expect(scopeAdmits('any', seller, resource)).toBe(true)
    }
  })

  it('matches `own` on the store or on the account', () => {
    expect(scopeAdmits('own', seller, resources.ownStore)).toBe(true)
    expect(scopeAdmits('own', seller, resources.otherStore)).toBe(false)
    expect(
      scopeAdmits('own', { userId: OTHER_USER, roles: [], sellerId: null }, resources.realAccount),
    ).toBe(true)
  })

  it('refuses platform data to a caller who happens to own no store', () => {
    // Both sides are null here. A plain `===` would call that a match and hand
    // every seed row to every account without a store.
    const storeless = { userId: 'nobody', roles: [], sellerId: null } satisfies AuthorizationSubject

    expect(scopeAdmits('own', storeless, resources.seed)).toBe(false)
  })

  it('matches `demo` on rows a demo account created, and on nothing else', () => {
    expect(scopeAdmits('demo', seller, resources.demoStore)).toBe(true)
    expect(scopeAdmits('demo', seller, resources.demoAccount)).toBe(true)
    expect(scopeAdmits('demo', seller, resources.seed)).toBe(false)
    expect(scopeAdmits('demo', seller, resources.realAccount)).toBe(false)
    expect(scopeAdmits('demo', seller, resources.ownStore)).toBe(false)
  })
})

describe('authorizePermission', () => {
  it('reports the scopes when the permission is held', () => {
    expect(authorizePermission(subject('SELLER_OWNER'), 'product.write')).toEqual({
      allowed: true,
      scopes: ['own'],
    })
  })

  it('reports a missing permission', () => {
    expect(authorizePermission(subject('BUYER'), 'product.write')).toEqual({
      allowed: false,
      reason: 'missing_permission',
    })
  })
})

describe('authorizeResource', () => {
  it('separates "never allowed to" from "not to this row"', () => {
    expect(authorizeResource(subject('BUYER'), 'product.write', resources.ownStore)).toEqual({
      allowed: false,
      reason: 'missing_permission',
    })
    expect(
      authorizeResource(subject('SELLER_OWNER'), 'product.write', resources.otherStore),
    ).toEqual({ allowed: false, reason: 'out_of_scope' })
  })

  it('reports which scopes admitted the row', () => {
    const both = {
      userId: SELLER_USER,
      roles: ['SELLER_OWNER', 'DEMO_ADMIN'],
      sellerId: SELLER_STORE,
    } satisfies AuthorizationSubject

    expect(authorizeResource(both, 'product.write', resources.ownStore)).toEqual({
      allowed: true,
      scopes: ['own'],
    })
    expect(authorizeResource(both, 'product.write', resources.demoStore)).toEqual({
      allowed: true,
      scopes: ['demo'],
    })
  })
})

/**
 * The table TASK-0105 asks for: five roles against every kind of row, for a
 * mutating permission and a reading one.
 *
 * Written out as expectations rather than computed from the same table the code
 * reads, so that a change to a grant has to be restated here on purpose.
 */
describe('five roles × every resource kind', () => {
  const order: readonly ResourceName[] = [
    'ownStore',
    'otherStore',
    'demoStore',
    'demoAccount',
    'realAccount',
    'seed',
  ]

  const subjects: Readonly<Record<Role, AuthorizationSubject>> = {
    BUYER: { userId: SELLER_USER, roles: ['BUYER'], sellerId: null },
    SELLER_OWNER: { userId: SELLER_USER, roles: ['SELLER_OWNER'], sellerId: SELLER_STORE },
    ADMIN_OPERATOR: { userId: 'admin', roles: ['ADMIN_OPERATOR'], sellerId: null },
    ADMIN_SUPER: { userId: 'root', roles: ['ADMIN_SUPER'], sellerId: null },
    DEMO_ADMIN: { userId: 'demo-admin', roles: ['DEMO_ADMIN'], sellerId: null },
  }

  interface MatrixCase {
    readonly permission: Permission
    readonly byRole: Readonly<Record<Role, readonly boolean[]>>
  }

  // own store · other store · demo store · demo account · real account · seed
  const cases: readonly MatrixCase[] = [
    {
      permission: 'product.write',
      byRole: {
        BUYER: [false, false, false, false, false, false],
        SELLER_OWNER: [true, false, false, false, false, false],
        ADMIN_OPERATOR: [true, true, true, true, true, true],
        ADMIN_SUPER: [true, true, true, true, true, true],
        DEMO_ADMIN: [false, false, true, true, false, false],
      },
    },
    {
      permission: 'product.read',
      byRole: {
        BUYER: [true, true, true, true, true, true],
        SELLER_OWNER: [true, false, false, false, false, false],
        ADMIN_OPERATOR: [true, true, true, true, true, true],
        ADMIN_SUPER: [true, true, true, true, true, true],
        DEMO_ADMIN: [true, true, true, true, true, true],
      },
    },
    {
      permission: 'seller.approve',
      byRole: {
        BUYER: [false, false, false, false, false, false],
        SELLER_OWNER: [false, false, false, false, false, false],
        ADMIN_OPERATOR: [true, true, true, true, true, true],
        ADMIN_SUPER: [true, true, true, true, true, true],
        DEMO_ADMIN: [false, false, true, true, false, false],
      },
    },
    {
      permission: 'catalog.delete',
      byRole: {
        BUYER: [false, false, false, false, false, false],
        SELLER_OWNER: [false, false, false, false, false, false],
        ADMIN_OPERATOR: [false, false, false, false, false, false],
        ADMIN_SUPER: [true, true, true, true, true, true],
        DEMO_ADMIN: [false, false, false, false, false, false],
      },
    },
  ]

  for (const { permission, byRole } of cases) {
    for (const role of roles) {
      it(`${role} · ${permission}`, () => {
        const actual = order.map((name) =>
          canAccessResource(subjects[role], permission, resources[name]),
        )

        expect(actual).toEqual(byRole[role])
      })
    }
  }
})
