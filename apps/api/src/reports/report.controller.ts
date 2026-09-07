import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common'
import type { ReportListResponse, ReportResponse } from '@shopping/shared'
import {
  createReportRequestSchema,
  handleReportRequestSchema,
  reportListQueryParamsSchema,
} from '@shopping/shared'
import { z } from 'zod'

import { Principal } from '../auth/principal.decorator.js'
import { RequirePermission } from '../auth/require-permission.decorator.js'
import type { RequestPrincipal } from '../auth/request-principal.js'
import { parseInput } from '../common/parse-input.js'
import { ReportService } from './report.service.js'

const reportIdSchema = z.uuid()

/**
 * 신고 (TASK-0091).
 *
 * ## 신고하는 문과 처리하는 문의 퍼미션이 다르다
 *
 * 신고는 로그인한 누구나 할 수 있고(`report.write`), 처리는 관리자만
 * 한다(`content.moderate`). 한 이름으로 묶으면 신고할 수 있는 모든 사람이 남의 글을
 * 가릴 수 있게 된다.
 */
@Controller({ version: '1' })
export class ReportController {
  constructor(private readonly reports: ReportService) {}

  /** 신고한다 (F1 · F2 · F3). */
  @Post('reports')
  @RequirePermission('report.write')
  async create(
    @Principal() principal: RequestPrincipal,
    @Body() body: unknown,
  ): Promise<ReportResponse> {
    const request = parseInput(createReportRequestSchema, body)

    return { report: await this.reports.create(principal.userId, request) }
  }

  /** 관리자 목록. 처리 대기부터. */
  @Get('reports')
  @RequirePermission('content.moderate')
  list(@Query() query: unknown): Promise<ReportListResponse> {
    return this.reports.list(parseInput(reportListQueryParamsSchema, query))
  }

  /** 처리한다 (F4 · F5 · F6 · F7). **반려도 처리다** — 임시 숨김이 풀린다. */
  @Post('reports/:id/handle')
  @RequirePermission('content.moderate')
  async handle(
    @Principal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<ReportResponse> {
    const reportId = parseInput(reportIdSchema, id, 'id')
    const request = parseInput(handleReportRequestSchema, body)

    return { report: await this.reports.handle(principal, reportId, request) }
  }
}
