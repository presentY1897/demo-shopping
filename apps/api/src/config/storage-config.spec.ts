import { describe, expect, it } from 'vitest'

import { resolveObjectStorageConfig } from './storage-config.js'

/**
 * The three states of TASK-0011 4.5, and the reason the middle one exists.
 *
 * The API ships before the R2 account does, so "nothing configured" has to boot.
 * "Half configured" must not — a deployment missing only the bucket name does
 * not fail to upload, it uploads somewhere else.
 */

const COMPLETE = {
  R2_ACCOUNT_ID: 'abc123def456abc123def456abc123de',
  R2_BUCKET: 'shopping-dev',
  R2_ACCESS_KEY_ID: 'access-key-id',
  R2_SECRET_ACCESS_KEY: 'secret-access-key',
  R2_PUBLIC_BASE_URL: 'https://cdn.demo-shopping.com',
} as const

function resolve(overrides: Record<string, string | undefined> = {}) {
  return resolveObjectStorageConfig({ ...COMPLETE, ...overrides })
}

/** The variables an issue list names, without their reasons. */
function offenders(source: Record<string, string | undefined>): string[] {
  return resolveObjectStorageConfig(source)
    .issues.map((issue) => issue.variable)
    .sort()
}

describe('when nothing is configured', () => {
  it('reports no storage and no problem', () => {
    expect(resolveObjectStorageConfig({})).toEqual({ config: null, issues: [] })
  })

  it('treats a blank value as unset, the way an env file leaves one', () => {
    expect(resolveObjectStorageConfig({ R2_BUCKET: '   ', R2_ACCOUNT_ID: '' })).toEqual({
      config: null,
      issues: [],
    })
  })
})

describe('when everything is configured', () => {
  it('derives the S3 endpoint from the account id', () => {
    expect(resolve().config).toEqual({
      endpoint: `https://${COMPLETE.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      bucket: 'shopping-dev',
      region: 'auto',
      accessKeyId: 'access-key-id',
      secretAccessKey: 'secret-access-key',
      publicBaseUrl: 'https://cdn.demo-shopping.com',
    })
  })

  it('lets an explicit endpoint win, which is how a local S3 server is reached', () => {
    expect(resolve({ R2_ENDPOINT: 'http://127.0.0.1:9040' }).config).toMatchObject({
      endpoint: 'http://127.0.0.1:9040',
    })
  })

  it('accepts an endpoint on its own, without an account id', () => {
    const { config, issues } = resolveObjectStorageConfig({
      ...COMPLETE,
      R2_ACCOUNT_ID: undefined,
      R2_ENDPOINT: 'http://127.0.0.1:9040',
    })

    expect(issues).toEqual([])
    expect(config).toMatchObject({ endpoint: 'http://127.0.0.1:9040' })
  })

  it('drops a trailing slash from the public base URL', () => {
    expect(resolve({ R2_PUBLIC_BASE_URL: 'https://cdn.demo-shopping.com/' }).config).toMatchObject({
      publicBaseUrl: 'https://cdn.demo-shopping.com',
    })
  })

  it('takes the region when one is given', () => {
    expect(resolve({ R2_REGION: 'apac' }).config).toMatchObject({ region: 'apac' })
  })
})

describe('when only part of it is configured', () => {
  it('names every variable that is missing, not just the first', () => {
    expect(offenders({ R2_BUCKET: 'shopping-dev' })).toEqual([
      'R2_ACCESS_KEY_ID',
      'R2_ACCOUNT_ID',
      'R2_PUBLIC_BASE_URL',
      'R2_SECRET_ACCESS_KEY',
    ])
  })

  it('refuses to hand back a partial configuration', () => {
    expect(resolveObjectStorageConfig({ R2_BUCKET: 'shopping-dev' }).config).toBeNull()
  })

  it.each([
    ['R2_ACCOUNT_ID', 'Account ID With Spaces'],
    ['R2_BUCKET', 'Shopping_Dev'],
    ['R2_REGION', 'AUTO'],
  ])('rejects a malformed %s', (variable, value) => {
    expect(offenders({ ...COMPLETE, [variable]: value })).toEqual([variable])
  })

  it.each([
    ['not a URL at all', 'cdn.demo-shopping.com'],
    ['a non-http scheme', 's3://shopping-prod'],
    ['an origin carrying a path', 'https://cdn.demo-shopping.com/images'],
  ])('rejects a public base URL that is %s', (_case, value) => {
    expect(offenders({ ...COMPLETE, R2_PUBLIC_BASE_URL: value })).toEqual(['R2_PUBLIC_BASE_URL'])
  })

  it('rejects a malformed explicit endpoint', () => {
    expect(offenders({ ...COMPLETE, R2_ENDPOINT: 'localhost:9040' })).toEqual(['R2_ENDPOINT'])
  })

  it('reports a missing URL once, not twice', () => {
    // Absent and malformed are different problems; saying both about one blank
    // makes a boot failure list look longer than the number of things to fix.
    const { issues } = resolveObjectStorageConfig({ ...COMPLETE, R2_PUBLIC_BASE_URL: '' })

    expect(issues).toEqual([{ variable: 'R2_PUBLIC_BASE_URL', reason: '설정되지 않았습니다' }])
  })
})

describe('what an issue is allowed to say', () => {
  it('never quotes the value, because half of these are credentials', () => {
    const secret = 'super-secret-value'
    const { issues } = resolveObjectStorageConfig({
      ...COMPLETE,
      R2_SECRET_ACCESS_KEY: secret,
      R2_BUCKET: 'INVALID_BUCKET',
    })

    expect(issues).not.toEqual([])
    expect(JSON.stringify(issues)).not.toContain(secret)
  })
})
