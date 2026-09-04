import { ForbiddenException } from '@nestjs/common'
import type { SellerStatus } from '@shopping/shared'

import type { RequestPrincipal } from '../auth/request-principal.js'
import { domainFailure } from '../common/domain-failure.js'
import { sellerInactiveMessage } from '../sellers/seller-access.js'
import { sellerStatusAllows } from '../sellers/seller-status.js'

/**
 * The store's own state gate, with a code a console can read.
 *
 * Written by TASK-0113 for the product editor and lifted here by TASK-0115,
 * which needed the identical judgement in three more places — a stock
 * adjustment, a bulk status change, and a duplication. A copy in each of them
 * is how the four end up disagreeing within a release, which is the argument
 * TASK-0108 made for `sellerStatusAllows` in the first place.
 *
 * **Only when the caller is the store.** "지금 이 스토어가 상품을 등록할 수 있는
 * 상태인가" is a question about the seller acting on their own listing; an
 * operator editing somebody's product is not that store trading, and refusing
 * them would make a suspended store's catalogue unmanageable by the very people
 * who suspended it.
 *
 * **Why not `assertSellerActive` itself.** The decision is not repeated here —
 * the table it consults and the sentence it words are both imported from
 * TASK-0108's module, and a spec pins this to refuse in exactly the cells
 * `assertSellerActive` refuses in. What it adds is the domain code: that
 * function throws a bare `FORBIDDEN`, which a screen cannot tell from "this is
 * not your product" — and those two 403s need opposite advice. Giving it a code
 * would mean editing a file this task does not own, for a payload only these
 * callers need.
 *
 * **403 and not 409**, which is where TASK-0032 had it. A 409 says "try again
 * once this resolves", and a seller whose application is still pending has
 * nothing to retry — the state is not a transient collision, it is the platform
 * saying no for now (TASK-0026 F3 · TASK-0108 F3).
 *
 * A decision with no I/O, so the gate on this file is branch coverage 100%
 * (QUALITY-GATES Q5 — 순수 로직), the same floor `seller-access.ts` carries:
 * a branch nothing reaches here is a cell of the capability table that nobody
 * ever refused from.
 */
export function assertStoreMayWrite(
  principal: RequestPrincipal,
  seller: { readonly id: string; readonly status: SellerStatus },
): void {
  if (principal.sellerId !== seller.id) return
  if (sellerStatusAllows(seller.status, 'product.write')) return

  throw new ForbiddenException(
    domainFailure('PRODUCT_SELLER_INACTIVE', sellerInactiveMessage(seller.status, 'product.write')),
  )
}
