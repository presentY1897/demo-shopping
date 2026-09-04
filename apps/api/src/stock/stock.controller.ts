import { Controller, Get, Param, Query } from '@nestjs/common'
import type { StockLedgerResponse } from '@shopping/shared'
import { stockLedgerQueryParamsSchema, variantIdSchema } from '@shopping/shared'

import { Principal } from '../auth/principal.decorator.js'
import { RequirePermission } from '../auth/require-permission.decorator.js'
import type { RequestPrincipal } from '../auth/request-principal.js'
import { parseInput } from '../common/parse-input.js'
import { StockService } from './stock.service.js'

/**
 * The stock ledger over HTTP (TASK-0036).
 *
 * **Not under `/seller`,** unlike the console's own list and aggregates
 * (TASK-0115). The ledger is not the console's data, it is the variant's: "재고가
 * 왜 줄었나" is asked by an operator investigating a complaint as often as by
 * the seller, and the answer does not change with who is asking. Ownership
 * narrows *which* variants a caller reaches, not what the response contains —
 * a seller holds `product.read:own`, an operator `any`.
 *
 * There is no adjustment endpoint here. Recording a movement is what
 * `StockService` does, and the console route that calls it belongs to
 * TASK-0115 (TASK-0036 4.8).
 */
@Controller({ path: 'variants', version: '1' })
export class StockController {
  constructor(private readonly stock: StockService) {}

  @Get(':id/ledger')
  @RequirePermission('product.read')
  ledger(
    @Principal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Query() query: unknown,
  ): Promise<StockLedgerResponse> {
    return this.stock.history(
      principal,
      parseInput(variantIdSchema, id, 'id'),
      parseInput(stockLedgerQueryParamsSchema, query),
    )
  }
}
