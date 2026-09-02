import { describe, expect, it, vi } from 'vitest'

import type { AppConfig } from '../config/app-config.js'
import { PrismaService } from './prisma.service.js'

/** Port 1 is never listening, so nothing here can reach a real database. */
const CONFIG = {
  database: {
    url: 'postgresql://shopping:shopping@localhost:1/shopping',
    poolSize: 3,
    connectTimeoutMs: 100,
    healthTimeoutMs: 100,
  },
} as AppConfig

describe('PrismaService', () => {
  it('opens the pool on module init', async () => {
    const service = new PrismaService(CONFIG)
    const connect = vi.spyOn(service, '$connect').mockResolvedValue(undefined)

    await service.onModuleInit()

    expect(connect).toHaveBeenCalledTimes(1)
  })

  it('keeps booting when the database is unreachable', async () => {
    // The API must come up and report `database: down`; refusing to boot would
    // turn every restart against a sleeping database into a failed deploy.
    const service = new PrismaService(CONFIG)
    vi.spyOn(service, '$connect').mockRejectedValue(new Error('ECONNREFUSED'))

    await expect(service.onModuleInit()).resolves.toBeUndefined()
  })

  it('closes the pool on shutdown', async () => {
    const service = new PrismaService(CONFIG)
    const disconnect = vi.spyOn(service, '$disconnect').mockResolvedValue(undefined)

    await service.onApplicationShutdown('SIGTERM')

    expect(disconnect).toHaveBeenCalledTimes(1)
  })

  it('closes the pool even when no signal was delivered', async () => {
    const service = new PrismaService(CONFIG)
    const disconnect = vi.spyOn(service, '$disconnect').mockResolvedValue(undefined)

    await service.onApplicationShutdown()

    expect(disconnect).toHaveBeenCalledTimes(1)
  })
})
