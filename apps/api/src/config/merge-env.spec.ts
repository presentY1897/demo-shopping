import { describe, expect, it } from 'vitest'

import { mergeEnv } from './merge-env.js'

const DERIVED = {
  API_PORT: '4040',
  MEILI_HOST: 'http://localhost:7740',
  DATABASE_URL: 'postgresql://shopping:shopping@localhost:5472/shopping',
  CORS_ORIGINS: 'http://localhost:3040',
} as const

describe('mergeEnv', () => {
  it('uses the derived value when the variable is not set', () => {
    expect(mergeEnv({}, DERIVED)).toMatchObject(DERIVED)
  })

  it('keeps an explicitly set value', () => {
    const merged = mergeEnv({ MEILI_HOST: 'https://search.example.com' }, DERIVED)

    expect(merged.MEILI_HOST).toBe('https://search.example.com')
    expect(merged.API_PORT).toBe('4040')
  })

  it('treats a blank value as unset', () => {
    expect(mergeEnv({ API_PORT: '' }, DERIVED).API_PORT).toBe('4040')
  })

  it('falls back to PORT, which hosting platforms inject', () => {
    expect(mergeEnv({ PORT: '10000' }, DERIVED).API_PORT).toBe('10000')
  })

  it('prefers API_PORT over PORT when both are set', () => {
    expect(mergeEnv({ API_PORT: '4000', PORT: '10000' }, DERIVED).API_PORT).toBe('4000')
  })

  it('leaves unrelated variables untouched', () => {
    expect(mergeEnv({ POSTGRES_USER: 'shopping' }, DERIVED).POSTGRES_USER).toBe('shopping')
  })
})
