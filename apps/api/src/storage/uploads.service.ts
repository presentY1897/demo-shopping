import { randomUUID } from 'node:crypto'

import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import type { PresignUploadRequest, PresignUploadResponse } from '@shopping/shared'
import { UPLOAD_URL_TTL_SECONDS } from '@shopping/shared'

import { assertResourceAccess } from '../auth/access-denied.js'
import type { AccountRow, SellerRow } from '../auth/resource-ownership.js'
import {
  accountOwnership,
  accountOwnershipSelect,
  sellerOwnership,
  sellerOwnershipSelect,
} from '../auth/resource-ownership.js'
import type { RequestPrincipal } from '../auth/request-principal.js'
import type { Clock } from '../common/clock.js'
import { CLOCK } from '../common/clock.js'
import { PrismaService } from '../prisma/prisma.service.js'
import type { ObjectStorage } from './object-storage.js'
import { OBJECT_STORAGE } from './object-storage.js'
import { productImageKey, resolveUploadExtension, returnPhotoKey } from './upload-rules.js'

/**
 * Handing out one presigned upload (TASK-0011 · TASK-0067).
 *
 * The service does three things in order, and the order is the design:
 *
 * 1. **Decide the extension** from the filename and the declared type. Cheap,
 *    needs nothing, and refuses a bad request before it costs a query.
 * 2. **Authorise an owner and build the key from it** — {@link keyFor}. The
 *    service does not decide what `own` means and never reads an owner itself;
 *    an ownership mapper maps the row and `assertResourceAccess` decides.
 * 3. **Sign.** The key is assembled from the row that was just authorised, never
 *    from the request.
 *
 * A store that does not exist answers 404 while someone else's answers 403. That
 * distinction leaks nothing: storefronts are public and every role holds
 * `seller.read`, so store ids are not a secret to begin with.
 *
 * ## Why a purpose is a branch and not a parameter
 *
 * `upload-rules.ts` said it before there was a second purpose: the prefix and the
 * owner that authorises it go together. `product-image` is authorised against a
 * **store** and lands under `products/{sellerId}/…`; `return-photo` is authorised
 * against the **caller's own account** and lands under `returns/{userId}/…`. One
 * builder taking a purpose would let those two halves be paired wrongly, and the
 * wrong pairing is exactly the bug worth preventing — a key inside somebody
 * else's prefix.
 *
 * **The return prefix carries no id from the request** (`presignUploadRequestSchema`
 * has no owner field for it). That is what keeps ownership decidable from the key
 * alone later on, with no second lookup: `isOwnPhotoKey` compares the prefix with
 * the person filing the claim, and a key this endpoint issued can only ever name
 * the person it issued it to (TASK-0067 F2).
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

    const key = await this.keyFor(principal, request, resolved.extension)

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

  /**
   * The owner is authorised and the key is built from that same row, in one
   * place per purpose.
   *
   * Splitting the two steps would make it possible to authorise one row and
   * build a key from another; keeping them adjacent is what makes "the key is
   * never taken from the request" checkable by reading four lines.
   */
  private async keyFor(
    principal: RequestPrincipal,
    request: PresignUploadRequest,
    extension: string,
  ): Promise<string> {
    if (request.purpose === 'return-photo') {
      const account = await this.account(principal.userId)

      assertResourceAccess(principal, 'media.upload', accountOwnership(account))

      return returnPhotoKey(account.id, randomUUID(), extension)
    }

    const seller = await this.store(request.sellerId)

    assertResourceAccess(principal, 'media.upload', sellerOwnership(seller))

    return productImageKey(seller.id, randomUUID(), extension)
  }

  private async store(sellerId: string): Promise<SellerRow> {
    const seller = await this.prisma.seller.findUnique({
      where: { id: sellerId },
      select: sellerOwnershipSelect,
    })

    if (seller === null) throw new NotFoundException('스토어를 찾을 수 없습니다.')

    return seller
  }

  /**
   * The caller's own account row.
   *
   * Read rather than assembled from the principal, because `own` is not the only
   * scope that can reach it: a demo administrator holds `media.upload:demo`, and
   * that scope is resolved against facts the ownership mapper reads off the row.
   * A token carries roles and a store and nothing else — `AuthorizationSubject`
   * says why, and this service never looks at those facts itself.
   */
  private async account(userId: string): Promise<AccountRow> {
    const account = await this.prisma.user.findUnique({
      where: { id: userId },
      select: accountOwnershipSelect,
    })

    if (account === null) throw new NotFoundException('계정을 찾을 수 없습니다.')

    return account
  }
}
