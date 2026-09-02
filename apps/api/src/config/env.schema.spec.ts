import { describe, expect, it } from 'vitest'

import { parseEnv } from './env.schema.js'

/** A complete environment; individual cases break exactly one thing. */
const COMPLETE = {
  API_PORT: '4040',
  DATABASE_URL: 'postgresql://shopping:shopping@localhost:5472/shopping',
  MEILI_HOST: 'http://localhost:7740',
  MEILI_MASTER_KEY: 'local_dev_master_key_change_me',
} as const

function variablesOf(source: Record<string, string | undefined>): string[] {
  const result = parseEnv(source)
  return result.ok ? [] : result.issues.map((issue) => issue.variable)
}

describe('parseEnv', () => {
  it('fills in every optional variable when only the required ones are set', () => {
    const result = parseEnv({ ...COMPLETE })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.env.NODE_ENV).toBe('development')
    expect(result.env.API_HOST).toBe('0.0.0.0')
    expect(result.env.LOG_LEVEL).toBe('log')
    expect(result.env.MEILI_HEALTH_TIMEOUT_MS).toBe(1500)
    expect(result.env.DATABASE_POOL_SIZE).toBe(10)
    expect(result.env.DATABASE_CONNECT_TIMEOUT_MS).toBe(5000)
    expect(result.env.DATABASE_HEALTH_TIMEOUT_MS).toBe(1000)
    expect(result.env.CORS_ORIGINS).toBe('')
    expect(result.env.API_PORT).toBe(4040)
  })

  it('names every missing variable rather than only the first', () => {
    expect(variablesOf({})).toEqual(['API_PORT', 'DATABASE_URL', 'MEILI_HOST', 'MEILI_MASTER_KEY'])
  })

  it('treats an empty value as missing', () => {
    const result = parseEnv({ ...COMPLETE, MEILI_MASTER_KEY: '   ' })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues).toEqual([{ variable: 'MEILI_MASTER_KEY', reason: '설정되지 않았습니다' }])
  })

  it('rejects a port that is not a number, and never echoes the value', () => {
    const result = parseEnv({ ...COMPLETE, API_PORT: 'not-a-port' })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues[0]?.variable).toBe('API_PORT')
    expect(result.issues[0]?.reason).not.toContain('not-a-port')
  })

  it('rejects a port outside the valid range', () => {
    expect(variablesOf({ ...COMPLETE, API_PORT: '70000' })).toEqual(['API_PORT'])
  })

  it('rejects a search host that is not an http(s) URL', () => {
    expect(variablesOf({ ...COMPLETE, MEILI_HOST: 'localhost:7740' })).toEqual(['MEILI_HOST'])
    expect(variablesOf({ ...COMPLETE, MEILI_HOST: 'ftp://localhost:7740' })).toEqual(['MEILI_HOST'])
  })

  it('rejects a pool size that would exhaust a small managed database', () => {
    expect(variablesOf({ ...COMPLETE, DATABASE_POOL_SIZE: '0' })).toEqual(['DATABASE_POOL_SIZE'])
    expect(variablesOf({ ...COMPLETE, DATABASE_POOL_SIZE: '101' })).toEqual(['DATABASE_POOL_SIZE'])
    expect(variablesOf({ ...COMPLETE, DATABASE_POOL_SIZE: '4.5' })).toEqual(['DATABASE_POOL_SIZE'])
  })

  it('rejects a database timeout outside the supported range', () => {
    expect(variablesOf({ ...COMPLETE, DATABASE_CONNECT_TIMEOUT_MS: '10' })).toEqual([
      'DATABASE_CONNECT_TIMEOUT_MS',
    ])
    expect(variablesOf({ ...COMPLETE, DATABASE_HEALTH_TIMEOUT_MS: '99999' })).toEqual([
      'DATABASE_HEALTH_TIMEOUT_MS',
    ])
  })

  it('rejects an unknown NODE_ENV', () => {
    expect(variablesOf({ ...COMPLETE, NODE_ENV: 'staging' })).toEqual(['NODE_ENV'])
  })

  it('rejects a master key that is too short to be a real secret', () => {
    const result = parseEnv({ ...COMPLETE, MEILI_MASTER_KEY: 'short' })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues[0]?.variable).toBe('MEILI_MASTER_KEY')
    expect(result.issues[0]?.reason).not.toContain('short')
  })
})
