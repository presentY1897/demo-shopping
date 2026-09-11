import { describe, expect, it } from 'vitest'
import { availableBytes, thumbnailMemoryAvailable } from './thumbnail-memory.js'
describe('container memory budget', () => {
  it('subtracts current container usage and floors exhausted budgets', () => {
    expect(availableBytes('536870912', '134217728')).toBe(402653184)
    expect(availableBytes('100', '101')).toBe(0)
  })
  it('fails closed for missing, corrupt and negative counters', () => {
    for (const [limit, used] of [
      ['', '10'],
      ['invalid', '10'],
      ['100', 'NaN'],
      ['100', '-1'],
    ])
      expect(availableBytes(limit!, used!)).toBe(0)
  })
})

const reader = (files: Record<string, string>) => (path: string) => {
  if (files[path] !== undefined) return Promise.resolve(files[path])
  return Promise.reject(Object.assign(new Error('missing'), { code: 'ENOENT' }))
}
it('honours a capped enclosing v2 group when the leaf is unlimited', async () => {
  const free = await thumbnailMemoryAvailable(
    reader({
      '/proc/self/cgroup': '0::/parent/leaf',
      '/sys/fs/cgroup/parent/leaf/memory.max': 'max',
      '/sys/fs/cgroup/parent/leaf/memory.current': '10',
      '/sys/fs/cgroup/parent/memory.max': '500',
      '/sys/fs/cgroup/parent/memory.current': '300',
    }),
    () => 1000,
  )
  expect(free).toBe(200)
})
it('uses the v1 memory controller and fails closed when no counter is readable', async () => {
  expect(
    await thumbnailMemoryAvailable(
      reader({
        '/proc/self/cgroup': '5:memory:/app',
        '/sys/fs/cgroup/memory/app/memory.limit_in_bytes': '400',
        '/sys/fs/cgroup/memory/app/memory.usage_in_bytes': '150',
      }),
      () => 1000,
    ),
  ).toBe(250)
  expect(await thumbnailMemoryAvailable(reader({ '/proc/self/cgroup': '0::/' }), () => 1000)).toBe(
    0,
  )
})
