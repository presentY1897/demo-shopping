import { ForbiddenException } from '@nestjs/common'
import type { AuthorizationSubject } from '@shopping/shared'
import { platformOwnership } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import { accessDenied, assertResourceAccess } from './access-denied.js'

const seller: AuthorizationSubject = {
  userId: 'user-1',
  roles: ['SELLER_OWNER'],
  sellerId: 'store-1',
}

const ownProduct = { ownerUserId: 'user-1', ownerSellerId: 'store-1', ownerIsDemo: false }
const rivalProduct = { ownerUserId: 'user-2', ownerSellerId: 'store-2', ownerIsDemo: false }

function messageOf(error: unknown): unknown {
  if (!(error instanceof ForbiddenException)) throw error

  const payload: unknown = error.getResponse()

  return typeof payload === 'object' && payload !== null && 'message' in payload
    ? payload.message
    : payload
}

describe('accessDenied', () => {
  it('distinguishes the two refusals in the message', () => {
    expect(messageOf(accessDenied('product.write', 'missing_permission'))).toBe(
      'product.write 퍼미션이 없습니다.',
    )
    expect(messageOf(accessDenied('product.write', 'out_of_scope'))).toBe(
      'product.write 퍼미션으로 접근할 수 없는 리소스입니다.',
    )
  })

  it('answers 403', () => {
    expect(accessDenied('user.delete', 'missing_permission').getStatus()).toBe(403)
  })
})

describe('assertResourceAccess', () => {
  it('passes silently for a row inside the scope', () => {
    expect(() => {
      assertResourceAccess(seller, 'product.write', ownProduct)
    }).not.toThrow()
  })

  it('refuses a row belonging to another store', () => {
    expect(() => {
      assertResourceAccess(seller, 'product.write', rivalProduct)
    }).toThrow(ForbiddenException)
  })

  it('refuses platform data, which belongs to nobody', () => {
    expect(() => {
      assertResourceAccess(seller, 'product.write', platformOwnership)
    }).toThrow(ForbiddenException)
  })

  it('refuses a permission the subject never holds', () => {
    try {
      assertResourceAccess(seller, 'settlement.pay', ownProduct)
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(messageOf(error)).toBe('settlement.pay 퍼미션이 없습니다.')
    }
  })
})
