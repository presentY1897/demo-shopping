import { ServiceUnavailableException } from '@nestjs/common'

import type { ObjectStorageConfig } from '../config/storage-config.js'
import { presignS3Request } from './sigv4.js'

/**
 * The seam every upload goes through (QUALITY-GATES 6장 — "모킹 대상은 전부
 * 포트 뒤에 둔다").
 *
 * R2 is a mocked dependency in the test band, and this is where a replacement
 * would go. In practice nothing needs replacing yet: presigning makes no network
 * call, so the production implementation runs unchanged in every spec and there
 * is nothing to stub. The port earns its place on the other side — the moment a
 * caller needs `delete` or `head`, that *is* I/O, and the seam already exists.
 */
export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE')

export interface PresignUploadCommand {
  /** Full object key, already validated against the key rule. */
  readonly key: string
  readonly contentType: string
  /** Exact byte length. Signed, so the upload cannot be any other size. */
  readonly contentLength: number
  /** From the injected `Clock`; never read here. */
  readonly now: Date
  readonly expiresInSeconds: number
}

export interface PresignedUploadTarget {
  readonly uploadUrl: string
  readonly publicUrl: string
  /** Headers the upload must reproduce exactly; they are part of the signature. */
  readonly headers: Readonly<Record<string, string>>
  readonly expiresAt: Date
}

export interface ObjectStorage {
  presignUpload: (command: PresignUploadCommand) => PresignedUploadTarget
  publicUrl: (key: string) => string
}

/**
 * Cloudflare R2, and any other S3-compatible endpoint.
 *
 * Path-style addressing (`/<bucket>/<key>`) because that is what R2 documents;
 * virtual-host style would also work but would put the bucket name into the
 * signed `host`, which makes a bucket rename a signing change as well.
 */
export class S3CompatibleObjectStorage implements ObjectStorage {
  constructor(private readonly config: ObjectStorageConfig) {}

  presignUpload(command: PresignUploadCommand): PresignedUploadTarget {
    const headers = {
      // Both are signed on purpose: the API never sees the body, so binding the
      // declared length and type into the signature is the only thing that
      // actually enforces them (TASK-0011 4.3).
      'content-length': String(command.contentLength),
      'content-type': command.contentType,
    }

    const signed = presignS3Request({
      method: 'PUT',
      endpoint: this.config.endpoint,
      path: `/${this.config.bucket}/${command.key}`,
      headers,
      accessKeyId: this.config.accessKeyId,
      secretAccessKey: this.config.secretAccessKey,
      region: this.config.region,
      signedAt: command.now,
      expiresInSeconds: command.expiresInSeconds,
    })

    return {
      uploadUrl: signed.url,
      publicUrl: this.publicUrl(command.key),
      // Sent back in the casing a caller writes, minus `Content-Length`, which a
      // browser sets from the body and refuses to let script set.
      headers: { 'Content-Type': command.contentType },
      expiresAt: signed.expiresAt,
    }
  }

  /**
   * Where the object will be readable once uploaded.
   *
   * No encoding: keys are produced by `productImageKey`, whose pattern admits
   * only hex, hyphens and a known extension. Encoding a key that cannot need it
   * would only invite someone to pass a key that does.
   */
  publicUrl(key: string): string {
    return `${this.config.publicBaseUrl}/${key}`
  }
}

/**
 * What is bound when no R2 variable is set (TASK-0011 4.5).
 *
 * The API has to boot and serve everything else while the storage account does
 * not exist yet, so "not configured" is a supported state rather than a startup
 * failure — and the honest answer for an endpoint that depends on it is 503,
 * not a 500 from an undefined credential three frames down.
 *
 * It throws Nest's exception directly rather than a domain error the service
 * would translate: there is exactly one caller, and the extra layer would only
 * move the same sentence to a different file.
 */
export class UnconfiguredObjectStorage implements ObjectStorage {
  presignUpload(): never {
    return this.refuse()
  }

  publicUrl(): never {
    return this.refuse()
  }

  private refuse(): never {
    throw new ServiceUnavailableException(
      '이미지 저장소가 설정되지 않아 업로드를 사용할 수 없습니다.',
    )
  }
}

/** Picks the implementation the configuration calls for. */
export function createObjectStorage(config: ObjectStorageConfig | null): ObjectStorage {
  return config === null ? new UnconfiguredObjectStorage() : new S3CompatibleObjectStorage(config)
}
