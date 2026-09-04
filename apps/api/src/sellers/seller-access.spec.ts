import { ForbiddenException } from '@nestjs/common'
import { sellerStatuses } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import { assertSellerActive, sellerInactiveMessage } from './seller-access.js'
import { sellerCapabilities, sellerStatusAllows } from './seller-status.js'

/**
 * The guard, over the whole table.
 *
 * The interesting property is not that it throws — it is that it throws
 * **exactly** where {@link sellerStatusAllows} says no and nowhere else. A
 * guard that disagreed with the table it is built on would be a second opinion,
 * and the two would drift the first time somebody edited one of them.
 */

describe('assertSellerActive — 표와 어긋나지 않는다', () => {
  it('throws for every refused cell and passes every allowed one', () => {
    for (const status of sellerStatuses) {
      for (const capability of sellerCapabilities) {
        const call = (): void => {
          assertSellerActive(status, capability)
        }

        if (sellerStatusAllows(status, capability)) {
          expect(call).not.toThrow()
        } else {
          expect(call).toThrow(ForbiddenException)
        }
      }
    }
  })

  it('lets a suspended store keep processing orders', () => {
    expect(() => {
      assertSellerActive('SUSPENDED', 'order.write')
    }).not.toThrow()
  })

  it('refuses a suspended store the catalogue', () => {
    expect(() => {
      assertSellerActive('SUSPENDED', 'product.write')
    }).toThrow(sellerInactiveMessage('SUSPENDED', 'product.write'))
  })

  it('carries the reason in the payload the envelope forwards', () => {
    // `ForbiddenException` with a string lands in `details` as one entry —
    // `AllExceptionsFilter` copies strings only — so the console has something
    // to say beside the greyed-out button (TASK-0105 R2).
    const thrown = (): never => {
      assertSellerActive('PENDING', 'product.write')
      throw new Error('refusal 을 기대했습니다.')
    }

    expect(thrown).toThrow(ForbiddenException)

    try {
      thrown()
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenException)
      expect((error as ForbiddenException).getStatus()).toBe(403)
      expect((error as ForbiddenException).getResponse()).toMatchObject({
        message: sellerInactiveMessage('PENDING', 'product.write'),
      })
    }
  })
})

describe('sellerInactiveMessage — 왜 거절됐는지 구분된다', () => {
  it('tells a pending applicant apart from a suspended seller', () => {
    // Both are "상품을 등록할 수 없다", and the two people need different next
    // actions: one waits for a decision, the other talks to an operator.
    expect(sellerInactiveMessage('PENDING', 'product.write')).not.toBe(
      sellerInactiveMessage('SUSPENDED', 'product.write'),
    )
  })

  it('says something about orders that is not about the catalogue', () => {
    expect(sellerInactiveMessage('PENDING', 'order.write')).toContain('주문')
    expect(sellerInactiveMessage('REJECTED', 'order.write')).toContain('주문')
  })
})
