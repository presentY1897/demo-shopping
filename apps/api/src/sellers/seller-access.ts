import { ForbiddenException } from '@nestjs/common'
import type { SellerStatus } from '@shopping/shared'

import type { SellerCapability } from './seller-status.js'
import { sellerStatusAllows } from './seller-status.js'

/**
 * The guard every seller endpoint puts in front of itself (TASK-0108 4장).
 *
 * `assertResourceAccess` answers "is this row yours"; this answers "is your
 * store in a state that may do this at all", and the two are genuinely
 * different questions — a suspended seller still owns their products, they
 * simply may not add to them.
 *
 * **It lives here and is exported rather than being attached to the product and
 * order endpoints by this task.** Those endpoints belong to other tasks
 * (TASK-0032 today, M09's order handling later), and a task that reaches into
 * another's files is how a wave turns one agent's work into a revert of
 * another's (CLAUDE.md 2장). What this task owes is the decision in one place,
 * with its table proved exhaustively; attaching it is a line in the endpoint
 * that needs it — `await this.sellers.assertCapability(principal,
 * 'product.write')`.
 */

/**
 * The sentence a refusal carries, exported so that a spec can name **which**
 * refusal it expects without quoting the wording.
 *
 * The same device `deniedMessage` is for: reword the copy and a dozen
 * assertions would otherwise go red without a single behaviour having changed.
 */
export function sellerInactiveMessage(status: SellerStatus, capability: SellerCapability): string {
  if (capability === 'order.write') {
    return '주문을 처리하려면 스토어가 승인된 상태여야 해요.'
  }

  return status === 'SUSPENDED'
    ? '정지된 스토어에서는 상품을 등록하거나 수정할 수 없어요.'
    : '승인된 스토어만 상품을 등록하거나 수정할 수 있어요.'
}

/**
 * Refuses the request unless the store's state admits the capability.
 *
 * **403 and not 409**, which is a change from what TASK-0032 shipped for
 * product creation. A 409 says "try again once this resolves", and a seller
 * whose application is still pending has nothing to retry — the state is not a
 * transient collision, it is the platform saying no for now. The envelope is
 * the ordinary `FORBIDDEN` one, with the reason in `details` where a console
 * reads it to explain a disabled button rather than only greying it out
 * (TASK-0108 F3·F5).
 */
export function assertSellerActive(status: SellerStatus, capability: SellerCapability): void {
  if (sellerStatusAllows(status, capability)) return

  throw new ForbiddenException(sellerInactiveMessage(status, capability))
}
