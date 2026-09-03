import { randomUUID } from 'node:crypto'

import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import type { PresignUploadRequest, PresignUploadResponse } from '@shopping/shared'
import { UPLOAD_URL_TTL_SECONDS } from '@shopping/shared'

import { assertResourceAccess } from '../auth/access-denied.js'
import type { SellerRow } from '../auth/resource-ownership.js'
import { sellerOwnership, sellerOwnershipSelect } from '../auth/resource-ownership.js'
import type { RequestPrincipal } from '../auth/request-principal.js'
import type { Clock } from '../common/clock.js'
import { CLOCK } from '../common/clock.js'
import { PrismaService } from '../prisma/prisma.service.js'
import type { ObjectStorage } from './object-storage.js'
import { OBJECT_STORAGE } from './object-storage.js'
import { productImageKey, resolveUploadExtension } from './upload-rules.js'

/**
 * Handing out one presigned upload (TASK-0011).
 *
 * The service does four things in order, and the order is the design:
 *
 * 1. **Decide the extension** from the filename and the declared type. Cheap,
 *    needs nothing, and refuses a bad request before it costs a query.
 * 2. **Load the store** the caller named.
 * 3. **Ask the permission layer** whether this caller may write there. The
 *    service does not decide what `own` means and never reads an owner itself —
 *    `sellerOwnership` maps the row and `assertResourceAccess` decides.
 * 4. **Build the key and sign.** The key is assembled here from the store that
 *    was just authorised, never from the request.
 *
 * A store that does not exist answers 404 while someone else's answers 403. That
 * distinction leaks nothing: storefronts are public and every role holds
 * `seller.read`, so store ids are not a secret to begin with.
 */
@Injectable()
export class UploadsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async presign(
    principal: RequestPrincipal,
    request: PresignUploadRequest,
  ): Promise<PresignUploadResponse> {
    const resolved = resolveUploadExtension(request.filename, request.contentType)

    if (!resolved.ok) throw new BadRequestException({ message: [resolved.reason] })

    const seller = await this.store(request.sellerId)

    assertResourceAccess(principal, 'media.upload', sellerOwnership(seller))

    // `products/…` is the only key shape today; a second `purpose` brings its own
    // builder rather than a parameter on this one, because the prefix and the
    // owner that authorises it go together.
    const key = productImageKey(seller.id, randomUUID(), resolved.extension)

    const target = this.storage.presignUpload({
      key,
      contentType: request.contentType,
      contentLength: request.size,
      // The one place the time enters. Injected, so the deadline a spec asserts
      // is the deadline the signature carries.
      now: this.clock.now(),
      expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
    })

    return {
      upload: {
        key,
        uploadUrl: target.uploadUrl,
        publicUrl: target.publicUrl,
        method: 'PUT',
        headers: target.headers,
        contentLength: request.size,
        expiresAt: target.expiresAt.toISOString(),
      },
    }
  }

  private async store(sellerId: string): Promise<SellerRow> {
    const seller = await this.prisma.seller.findUnique({
      where: { id: sellerId },
      select: sellerOwnershipSelect,
    })

    if (seller === null) throw new NotFoundException('스토어를 찾을 수 없습니다.')

    return seller
  }
}
