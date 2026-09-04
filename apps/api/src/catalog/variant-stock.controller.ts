import { Body, Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common'
import type { StockAdjustResponse } from '@shopping/shared'
import { stockAdjustRequestSchema, variantIdSchema } from '@shopping/shared'

import { Principal } from '../auth/principal.decorator.js'
import { RequirePermission } from '../auth/require-permission.decorator.js'
import type { RequestPrincipal } from '../auth/request-principal.js'
import { parseInput } from '../common/parse-input.js'
import { SellerProductService } from './seller-product.service.js'

/**
 * Recording a stock movement (TASK-0115).
 *
 * **Under `variants` and not under `/seller`,** for the reason TASK-0036 wrote
 * on the ledger's own controller: stock is the variant's data, not the
 * console's. Who may move it is decided by `product.write` and the row's
 * ownership, not by the shape of the path — and when an operator's correction
 * arrives (M14) it will be the same route.
 *
 * **A separate controller from `StockController`,** which serves the read at
 * `GET /variants/:id/ledger`. That file belongs to TASK-0036 and says in its
 * own header that the console's write route is this task's; two controllers may
 * share a path prefix as long as no handler collides, which is what keeps this
 * task inside `apps/api/src/catalog` without inventing a path for it.
 *
 * **The delta goes straight through.** Nothing here decides whether there is
 * enough, what position the movement takes or what the balance becomes — those
 * are read under the variant's row lock by `StockService`, and a second opinion
 * formed out here would be formed from a value that is already stale.
 */
@Controller({ path: 'variants', version: '1' })
export class VariantStockController {
  constructor(private readonly console: SellerProductService) {}

  /**
   * Adds `delta` to a variant's stock and records why.
   *
   * 201: a ledger row is created, and it is the thing that happened. The answer
   * carries its `seq`, which is the row's identity and the ledger page's cursor.
   */
  @Post(':id/stock-adjustments')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('product.write')
  adjust(
    @Principal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<StockAdjustResponse> {
    return this.console.adjust(
      principal,
      parseInput(variantIdSchema, id, 'id'),
      parseInput(stockAdjustRequestSchema, body),
    )
  }
}
