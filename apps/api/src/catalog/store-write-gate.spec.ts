import { ForbiddenException } from '@nestjs/common'
import type { SellerStatus } from '@shopping/shared'
import { sellerStatuses } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import type { RequestPrincipal } from '../auth/request-principal.js'
import { assertSellerActive, sellerInactiveMessage } from '../sellers/seller-access.js'
import { assertStoreMayWrite } from './store-write-gate.js'

const STORE = '0192f0c1-0000-7000-8000-0000000a0001'
const OTHER = '0192f0c1-0000-7000-8000-0000000a0002'

function principal(sellerId: string | null): RequestPrincipal {
  return {
    userId: '0192f0c1-0000-7000-8000-0000000b0001',
    roles: ['SELLER_OWNER'],
    sellerId,
    app: 'seller',
  }
}

function seller(status: SellerStatus): { id: string; status: SellerStatus } {
  return { id: STORE, status }
}

/** Whether the gate refused, without asserting on the wording. */
function refused(subject: RequestPrincipal, status: SellerStatus): boolean {
  try {
    assertStoreMayWrite(subject, seller(status))
    return false
  } catch {
    return true
  }
}

describe('assertStoreMayWrite', () => {
  it('lets an approved store write its own listing', () => {
    expect(() => {
      assertStoreMayWrite(principal(STORE), seller('ACTIVE'))
    }).not.toThrow()
  })

  it.each(sellerStatuses)(
    'refuses a %s store writing its own listing when the table does',
    (status) => {
      // The table is TASK-0108's and is proved there. What this asserts is that
      // the gate refuses in exactly the cells `assertSellerActive` refuses in —
      // the two must never disagree, because the second one is what other seller
      // endpoints call.
      let expected = false

      try {
        assertSellerActive(status, 'product.write')
      } catch {
        expected = true
      }

      expect(refused(principal(STORE), status)).toBe(expected)
    },
  )

  it('carries the domain code, so a screen can tell it from an ownership 403', () => {
    try {
      assertStoreMayWrite(principal(STORE), seller('PENDING'))
      expect.unreachable('거절될 것으로 기대했습니다.')
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenException)
      expect((error as ForbiddenException).getResponse()).toMatchObject({
        code: 'PRODUCT_SELLER_INACTIVE',
        message: sellerInactiveMessage('PENDING', 'product.write'),
      })
    }
  })

  it.each(sellerStatuses)('leaves an operator alone against a %s store', (status) => {
    // Not the store trading. Refusing here would make a suspended store's
    // catalogue unmanageable by the people who suspended it.
    expect(refused(principal(null), status)).toBe(false)
    expect(refused(principal(OTHER), status)).toBe(false)
  })
})
