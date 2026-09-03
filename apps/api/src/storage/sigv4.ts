import { createHash, createHmac } from 'node:crypto'

/**
 * AWS Signature Version 4, query-string form — what makes a presigned URL
 * (TASK-0011 4.1).
 *
 * Written here rather than taken from `@aws-sdk/s3-request-presigner` because
 * presigning is not a network operation: it canonicalises a request and chains
 * four HMAC-SHA256s over it. Ninety lines replace several dozen transitive
 * packages, and three things follow that the SDK could not give:
 *
 * - **It can be pinned.** The algorithm is a pure function, so a published
 *   input/output vector fixes it exactly (`sigv4.spec.ts`). With the SDK the
 *   strongest statement available is "the SDK is presumably right".
 * - **It is deterministic.** The instant is an argument, so a URL produced under
 *   a fixed `Clock` is byte-for-byte reproducible in a test.
 * - **It can carry a coverage floor.** QUALITY-GATES Q5 asks pure logic for 100%
 *   branch coverage; that cannot be asked of vendor code.
 *
 * Nothing in this file knows about R2, buckets or uploads. It signs a request.
 */

/** Only what this repository presigns. Extend when a use appears, not before. */
export type SignedMethod = 'GET' | 'PUT'

export interface PresignInput {
  readonly method: SignedMethod
  /** Absolute origin of the S3-compatible endpoint. Path parts are ignored. */
  readonly endpoint: string
  /** Decoded path below the origin, e.g. `/bucket/products/a/b.png`. */
  readonly path: string
  /**
   * Headers to bind into the signature, besides `host`.
   *
   * A header signed here must be reproduced exactly by the eventual request or
   * the storage refuses it — which is the whole mechanism behind the upload size
   * cap (TASK-0011 4.3).
   */
  readonly headers?: Readonly<Record<string, string>>
  readonly accessKeyId: string
  readonly secretAccessKey: string
  /** `auto` for R2; a real region name for S3. */
  readonly region: string
  readonly service?: string
  /** The instant the signature is dated. Injected, never read from the clock. */
  readonly signedAt: Date
  readonly expiresInSeconds: number
}

export interface PresignedRequest {
  readonly url: string
  /** After this instant the storage refuses the URL. */
  readonly expiresAt: Date
  /**
   * The two intermediate strings, returned rather than hidden.
   *
   * A signature mismatch is otherwise undebuggable — the server answers
   * `SignatureDoesNotMatch` and nothing else — and these are what a published
   * test vector actually pins.
   */
  readonly canonicalRequest: string
  readonly stringToSign: string
  readonly signature: string
}

const ALGORITHM = 'AWS4-HMAC-SHA256'

/**
 * Presigned URLs are signed without the body, which the signer has never seen.
 *
 * S3 spells that case with this literal in place of the payload hash.
 */
const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD'

/** S3 refuses anything longer than seven days. */
const MAX_EXPIRY_SECONDS = 7 * 24 * 60 * 60

const UNRESERVED = /^[A-Za-z0-9\-._~]$/

/**
 * RFC 3986 percent-encoding, over UTF-8 bytes.
 *
 * `encodeURIComponent` is close but leaves `!*'()` alone, and AWS's unreserved
 * set does not include them — a filename containing an apostrophe would then
 * canonicalise differently here and at the server, and the only symptom would be
 * a 403 on that one file.
 */
export function uriEncode(value: string): string {
  let encoded = ''

  for (const byte of new TextEncoder().encode(value)) {
    const character = String.fromCharCode(byte)

    encoded += UNRESERVED.test(character)
      ? character
      : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`
  }

  return encoded
}

/** Each segment encoded, the separators left alone — S3 does not double-encode. */
function encodePath(path: string): string {
  return path.split('/').map(uriEncode).join('/')
}

/** `20260903T000000Z`. */
export function amzDate(instant: Date): string {
  return `${instant.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`
}

/** `20260903` — the date half of {@link amzDate}. */
function dateStamp(instant: Date): string {
  return amzDate(instant).slice(0, 8)
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function hmac(key: Buffer, value: string): Buffer {
  return createHmac('sha256', key).update(value, 'utf8').digest()
}

/** The four-step derivation: date → region → service → `aws4_request`. */
function signingKey(secretAccessKey: string, scopeParts: readonly string[]): Buffer {
  let key: Buffer = Buffer.from(`AWS4${secretAccessKey}`, 'utf8')

  for (const part of scopeParts) key = hmac(key, part)

  return key
}

/**
 * Code-unit ordering, which is what AWS means by "sorted".
 *
 * Written without a comparison operator returning a literal so that the function
 * carries no branch: `Array.prototype.sort`'s default is lexicographic already,
 * but sorting entry pairs needs a comparator, and a ternary one would leave a
 * branch that no input can exercise both ways.
 */
function compareCodeUnits(left: string, right: string): number {
  return Number(left > right) - Number(left < right)
}

function sortedEntries(
  source: ReadonlyMap<string, string>,
): readonly (readonly [string, string])[] {
  return [...source].sort(([left], [right]) => compareCodeUnits(left, right))
}

/**
 * `name:value\n` per header, sorted by name, plus the signed-header list.
 *
 * The caller may not pass `host`: it is derived from the endpoint, and letting
 * the two disagree would produce a URL that is valid against a host nobody is
 * going to send it to.
 */
function canonicalHeaders(
  host: string,
  headers: Readonly<Record<string, string>>,
): { readonly block: string; readonly signed: string } {
  const collected = new Map<string, string>([['host', host]])

  for (const [name, value] of Object.entries(headers)) {
    const lowered = name.toLowerCase()

    if (collected.has(lowered)) {
      throw new Error(`서명할 헤더 ${lowered} 이(가) 중복되었습니다.`)
    }
    collected.set(lowered, value.trim())
  }

  const entries = sortedEntries(collected)

  return {
    block: entries.map(([name, value]) => `${name}:${value}\n`).join(''),
    signed: entries.map(([name]) => name).join(';'),
  }
}

/** Sorted by key, both halves percent-encoded. */
function canonicalQuery(parameters: ReadonlyMap<string, string>): string {
  return sortedEntries(parameters)
    .map(([key, value]) => `${uriEncode(key)}=${uriEncode(value)}`)
    .join('&')
}

/**
 * Signs a request into a URL that stands on its own until it expires.
 *
 * Everything the storage will check is fixed here: the method, the exact path,
 * the values of every signed header, and the deadline. A request that differs in
 * any of them is refused with 403 rather than partially honoured.
 */
export function presignS3Request(input: PresignInput): PresignedRequest {
  const {
    method,
    endpoint,
    path,
    headers = {},
    accessKeyId,
    secretAccessKey,
    region,
    service = 's3',
    signedAt,
    expiresInSeconds,
  } = input

  if (Number.isNaN(signedAt.getTime())) {
    throw new RangeError('서명 시각이 올바른 날짜가 아닙니다.')
  }
  if (
    !Number.isInteger(expiresInSeconds) ||
    expiresInSeconds < 1 ||
    expiresInSeconds > MAX_EXPIRY_SECONDS
  ) {
    throw new RangeError(`만료 시간은 1~${String(MAX_EXPIRY_SECONDS)}초 사이의 정수여야 합니다.`)
  }
  if (!path.startsWith('/')) {
    throw new RangeError('경로는 / 로 시작해야 합니다.')
  }

  const endpointUrl = new URL(endpoint)
  const stamp = dateStamp(signedAt)
  const scope = `${stamp}/${region}/${service}/aws4_request`
  // `host` omits the port when it is the protocol's default, which is exactly
  // what a client will put in the Host header — and therefore what has to be
  // signed.
  const { block, signed } = canonicalHeaders(endpointUrl.host, headers)

  const query = canonicalQuery(
    new Map([
      ['X-Amz-Algorithm', ALGORITHM],
      ['X-Amz-Credential', `${accessKeyId}/${scope}`],
      ['X-Amz-Date', amzDate(signedAt)],
      ['X-Amz-Expires', String(expiresInSeconds)],
      ['X-Amz-SignedHeaders', signed],
    ]),
  )

  const canonicalRequest = [method, encodePath(path), query, block, signed, UNSIGNED_PAYLOAD].join(
    '\n',
  )

  const stringToSign = [ALGORITHM, amzDate(signedAt), scope, sha256Hex(canonicalRequest)].join('\n')
  const signature = hmac(
    signingKey(secretAccessKey, [stamp, region, service, 'aws4_request']),
    stringToSign,
  ).toString('hex')

  return {
    url: `${endpointUrl.origin}${encodePath(path)}?${query}&X-Amz-Signature=${signature}`,
    expiresAt: new Date(signedAt.getTime() + expiresInSeconds * 1_000),
    canonicalRequest,
    stringToSign,
    signature,
  }
}
