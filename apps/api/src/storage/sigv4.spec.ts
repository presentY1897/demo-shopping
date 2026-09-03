import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import type { PresignedRequest, PresignInput } from './sigv4.js'
import { amzDate, presignS3Request, uriEncode } from './sigv4.js'

/**
 * The signature, pinned against a value this repository did not compute.
 *
 * TASK-0011 4.1 chose to implement SigV4 rather than take it from the AWS SDK,
 * and that choice is only defensible if the result can be shown to be right
 * without an account. AWS publishes a worked example for exactly this case —
 * a presigned `GET` on `examplebucket/test.txt` — including the intermediate
 * canonical-request hash, so all three stages are fixed here and not just the
 * final hex.
 *
 * Source: AWS *Signature Version 4* documentation, "Example: Signature
 * calculation for a presigned URL". The credentials in it are the well known
 * `AKIAIOSFODNN7EXAMPLE` pair used throughout that documentation; they are not
 * real and grant nothing.
 *
 * The second, independent oracle is a round trip against a real S3
 * implementation — `apps/api/scripts/verify-presign-roundtrip.mjs`, which is run
 * by hand because QUALITY-GATES 6장 keeps R2 out of the suite.
 */

const AWS_EXAMPLE = {
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  region: 'us-east-1',
  endpoint: 'https://examplebucket.s3.amazonaws.com',
  path: '/test.txt',
  signedAt: new Date('2013-05-24T00:00:00.000Z'),
  expiresInSeconds: 86_400,
} as const

/** Credentials for the cases that only need *some* key material. */
const CREDENTIALS = {
  accessKeyId: 'r2accesskeyid0000000',
  secretAccessKey: 'r2secretaccesskey00000000000000000000000',
  region: 'auto',
} as const

const INSTANT = new Date('2026-09-03T00:00:00.000Z')

function presignUpload(overrides: Partial<PresignInput> = {}): PresignedRequest {
  return presignS3Request({
    method: 'PUT',
    endpoint: 'https://account.r2.cloudflarestorage.com',
    path: '/shopping-dev/products/store/object.png',
    headers: { 'content-length': '1024', 'content-type': 'image/png' },
    signedAt: INSTANT,
    expiresInSeconds: 300,
    ...CREDENTIALS,
    ...overrides,
  })
}

describe("AWS's published presigned URL example (F7)", () => {
  const signed = presignS3Request({ method: 'GET', ...AWS_EXAMPLE })

  it('builds the documented canonical request', () => {
    expect(signed.canonicalRequest).toBe(
      [
        'GET',
        '/test.txt',
        'X-Amz-Algorithm=AWS4-HMAC-SHA256&' +
          'X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&' +
          'X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host',
        'host:examplebucket.s3.amazonaws.com\n',
        'host',
        'UNSIGNED-PAYLOAD',
      ].join('\n'),
    )
  })

  it('hashes it to the documented digest', () => {
    // The documentation quotes this hash on its own, one stage before the
    // signature — so a mismatch says *which* half is wrong.
    expect(createHash('sha256').update(signed.canonicalRequest, 'utf8').digest('hex')).toBe(
      '3bfa292879f6447bbcda7001decf97f4a54dc650c8942174ae0a9121cf58ad04',
    )
  })

  it('produces the documented signature', () => {
    expect(signed.signature).toBe(
      'aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404',
    )
  })

  it('assembles the URL from the query it signed', () => {
    expect(signed.url).toBe(
      `https://examplebucket.s3.amazonaws.com/test.txt?` +
        `X-Amz-Algorithm=AWS4-HMAC-SHA256&` +
        `X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&` +
        `X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host&` +
        `X-Amz-Signature=${signed.signature}`,
    )
  })
})

describe('signing an upload', () => {
  it('is byte for byte reproducible from the same instant (F8)', () => {
    expect(presignUpload().url).toBe(presignUpload().url)
  })

  it('signs content-length and content-type alongside host', () => {
    const signed = presignUpload()

    expect(signed.canonicalRequest).toContain('content-length:1024\ncontent-type:image/png\nhost:')
    expect(signed.url).toContain('X-Amz-SignedHeaders=content-length%3Bcontent-type%3Bhost')
  })

  it('changes with the declared length, so a different size is a different URL', () => {
    expect(presignUpload({ headers: { 'content-length': '1025' } }).signature).not.toBe(
      presignUpload({ headers: { 'content-length': '1024' } }).signature,
    )
  })

  it('changes with the instant', () => {
    expect(presignUpload({ signedAt: new Date('2026-09-04T00:00:00.000Z') }).signature).not.toBe(
      presignUpload().signature,
    )
  })

  it('changes with the secret', () => {
    expect(
      presignUpload({ secretAccessKey: 'another-secret-0000000000000000000000000' }).signature,
    ).not.toBe(presignUpload().signature)
  })

  it('reports the deadline as the instant plus the lifetime', () => {
    expect(presignUpload({ expiresInSeconds: 300 }).expiresAt.toISOString()).toBe(
      '2026-09-03T00:05:00.000Z',
    )
  })

  it('trims a header value, because the canonical form is trimmed', () => {
    expect(
      presignUpload({ headers: { 'content-type': '  image/png  ' } }).canonicalRequest,
    ).toContain('content-type:image/png\n')
  })

  it('scopes the credential to the service it is told to sign for', () => {
    expect(presignUpload({ service: 'r2' }).url).toContain('%2Fauto%2Fr2%2Faws4_request')
    expect(presignUpload().url).toContain('%2Fauto%2Fs3%2Faws4_request')
  })
})

describe('the host that gets signed', () => {
  it('keeps a non-default port, which is what a local S3 server listens on', () => {
    expect(presignUpload({ endpoint: 'http://127.0.0.1:9040' }).canonicalRequest).toContain(
      'host:127.0.0.1:9040\n',
    )
  })

  it('drops the default port, because a client will not send it', () => {
    expect(
      presignUpload({ endpoint: 'https://account.r2.cloudflarestorage.com:443' }).canonicalRequest,
    ).toContain('host:account.r2.cloudflarestorage.com\n')
  })

  it('ignores any path on the endpoint', () => {
    const { url } = presignUpload({ endpoint: 'https://account.r2.cloudflarestorage.com/ignored' })

    expect(url.startsWith('https://account.r2.cloudflarestorage.com/shopping-dev/')).toBe(true)
  })
})

describe('percent encoding', () => {
  it('leaves the unreserved set alone', () => {
    expect(uriEncode('aZ09-._~')).toBe('aZ09-._~')
  })

  it('encodes the characters encodeURIComponent would not', () => {
    // The reason this function exists rather than a call to the built-in.
    expect(uriEncode("!*'()")).toBe('%21%2A%27%28%29')
    expect(encodeURIComponent("!*'()")).toBe("!*'()")
  })

  it('encodes a space and a slash', () => {
    expect(uriEncode('a b/c')).toBe('a%20b%2Fc')
  })

  it('encodes multi-byte characters one UTF-8 byte at a time', () => {
    expect(uriEncode('한')).toBe('%ED%95%9C')
  })

  it('keeps the separators of a path while encoding each segment', () => {
    expect(presignUpload({ path: '/bucket/a b/한글.png' }).url).toContain(
      '/bucket/a%20b/%ED%95%9C%EA%B8%80.png?',
    )
  })
})

describe('refusals', () => {
  it('refuses a caller-supplied host, which could disagree with the endpoint', () => {
    expect(() => presignUpload({ headers: { Host: 'elsewhere.example.com' } })).toThrow(
      /host 이\(가\) 중복/,
    )
  })

  it('refuses the same header twice under different casing', () => {
    expect(() =>
      presignUpload({ headers: { 'Content-Type': 'image/png', 'content-type': 'image/webp' } }),
    ).toThrow(/content-type 이\(가\) 중복/)
  })

  it('refuses an invalid instant', () => {
    expect(() => presignUpload({ signedAt: new Date('나쁜 날짜') })).toThrow(RangeError)
  })

  it.each([0, -1, 604_801, 1.5])('refuses %s as a lifetime', (expiresInSeconds) => {
    expect(() => presignUpload({ expiresInSeconds })).toThrow(RangeError)
  })

  it('accepts the seven day maximum', () => {
    expect(presignUpload({ expiresInSeconds: 604_800 }).url).toContain('X-Amz-Expires=604800')
  })

  it('refuses a path that is not rooted', () => {
    expect(() => presignUpload({ path: 'bucket/object.png' })).toThrow(/\/ 로 시작/)
  })
})

describe('amzDate', () => {
  it('renders the basic ISO 8601 form AWS asks for', () => {
    expect(amzDate(new Date('2026-09-03T04:05:06.789Z'))).toBe('20260903T040506Z')
  })
})
