import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common'
import type { PresignUploadResponse } from '@shopping/shared'
import { presignUploadRequestSchema } from '@shopping/shared'

import { Principal } from '../auth/principal.decorator.js'
import { RequirePermission } from '../auth/require-permission.decorator.js'
import type { RequestPrincipal } from '../auth/request-principal.js'
import { parseInput } from '../common/parse-input.js'
import { UploadsService } from './uploads.service.js'

/**
 * Presigned uploads over HTTP (TASK-0011).
 *
 * Not mounted under `/seller` even though a seller is who calls it: which roles
 * may upload is stated once, in the permission table, and a URL that implied it
 * a second time would eventually disagree with the table.
 *
 * The body is parsed with the schema from `@shopping/shared` that the
 * front-ends are typed against, so what this accepts and what they send are the
 * same object (gate C1).
 */
@Controller({ path: 'uploads', version: '1' })
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  /**
   * 200, not 201: nothing is created. The bucket is untouched until the browser
   * PUTs to the URL this hands back, and it may never do so.
   */
  @Post('presign')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('media.upload')
  presign(
    @Principal() principal: RequestPrincipal,
    @Body() body: unknown,
  ): Promise<PresignUploadResponse> {
    return this.uploads.presign(principal, parseInput(presignUploadRequestSchema, body))
  }
}
