import { Logger } from '@nestjs/common'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AppConfig } from '../config/app-config.js'
import type { PrismaService } from '../prisma/prisma.service.js'
import { ThumbnailService } from './thumbnail.service.js'

const mocks = vi.hoisted(() => ({
  claim: vi.fn(),
  memory: vi.fn(),
  cleanup: vi.fn(),
  log: vi.fn(),
  warn: vi.fn(),
}))
vi.mock('./thumbnail-queue.js', () => ({
  ThumbnailQueue: class {
    claim = mocks.claim
  },
}))
vi.mock('./thumbnail-process.js', () => ({
  ThumbnailProcess: class {},
  cleanOrphanedThumbnails: mocks.cleanup,
}))
vi.mock('./thumbnail-memory.js', () => ({
  thumbnailMemoryAvailable: mocks.memory,
  THUMBNAIL_START_BYTES: 256 * 1024 * 1024,
}))

let service: ThumbnailService
const start = (overrides: Partial<AppConfig> = {}) => {
  service = new ThumbnailService({} as PrismaService, { now: () => new Date(0) }, {
    nodeEnv: 'production',
    thumbnailGeneration: true,
    storage: {},
    ...overrides,
  } as AppConfig)
  service.onApplicationBootstrap()
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
  mocks.claim.mockResolvedValue(null)
  mocks.memory.mockResolvedValue(300 * 1024 * 1024)
  mocks.cleanup.mockResolvedValue(undefined)
  vi.spyOn(Logger.prototype, 'log').mockImplementation(mocks.log)
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(mocks.warn)
})
afterEach(async () => {
  await service?.onModuleDestroy()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

it.each([
  [{ thumbnailGeneration: false }, 'THUMBNAIL_GENERATION=off'],
  [{ storage: null }, '이미지 저장소 설정 없음'],
] as const)('reports why the worker does not start: %s', async (config, reason) => {
  start(config)
  await vi.advanceTimersByTimeAsync(2000)
  const messages = [...mocks.log.mock.calls, ...mocks.warn.mock.calls]
  expect(messages.some(([message]) => String(message).includes(reason))).toBe(true)
  expect(mocks.cleanup).not.toHaveBeenCalled()
  expect(mocks.claim).not.toHaveBeenCalled()
})

it('starts polling after cleanup and stops on shutdown', async () => {
  start()
  await vi.advanceTimersByTimeAsync(2000)
  expect(mocks.cleanup).toHaveBeenCalledOnce()
  expect(mocks.claim).toHaveBeenCalledTimes(2)
  await service.onModuleDestroy()
  await vi.advanceTimersByTimeAsync(5000)
  expect(mocks.claim).toHaveBeenCalledTimes(2)
})

it('does not claim while memory is low; repeats the warning at most once per minute and resumes', async () => {
  mocks.memory.mockResolvedValue(100)
  start()
  await vi.advanceTimersByTimeAsync(60_000)
  expect(mocks.claim).not.toHaveBeenCalled()
  expect(mocks.warn).toHaveBeenCalledTimes(1)
  expect(mocks.warn).toHaveBeenCalledWith(
    expect.stringContaining('availableBytes=100 requiredBytes=268435456'),
  )
  await vi.advanceTimersByTimeAsync(1000)
  expect(mocks.warn).toHaveBeenCalledTimes(2)
  mocks.memory.mockResolvedValue(300 * 1024 * 1024)
  await vi.advanceTimersByTimeAsync(1000)
  expect(mocks.claim).toHaveBeenCalledOnce()
  expect(mocks.log).toHaveBeenCalledWith(expect.stringContaining('메모리 대기 해제'))
})

it('does not start background polling in the test environment', async () => {
  start({ nodeEnv: 'test' })
  await vi.advanceTimersByTimeAsync(2000)
  expect(mocks.cleanup).not.toHaveBeenCalled()
  expect(mocks.claim).not.toHaveBeenCalled()
})
