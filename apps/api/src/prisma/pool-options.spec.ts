import { describe, expect, it } from 'vitest'

import type { AppConfig } from '../config/app-config.js'
import { databasePoolOptions } from './pool-options.js'

const CONFIG = {
  database: {
    url: 'postgresql://shopping:shopping@localhost:5482/shopping',
    poolSize: 7,
    connectTimeoutMs: 2_500,
    healthTimeoutMs: 800,
  },
} as AppConfig

describe('databasePoolOptions', () => {
  it('sizes the pool from the configured value rather than a driver default', () => {
    expect(databasePoolOptions(CONFIG).max).toBe(7)
  })

  it('bounds how long acquiring a connection may take', () => {
    // `pg` waits forever without this, which would hang a request against a
    // suspended Neon compute instead of failing it.
    expect(databasePoolOptions(CONFIG).connectionTimeoutMillis).toBe(2_500)
  })

  it('passes the configured URL through untouched', () => {
    expect(databasePoolOptions(CONFIG).connectionString).toBe(CONFIG.database.url)
  })
})
