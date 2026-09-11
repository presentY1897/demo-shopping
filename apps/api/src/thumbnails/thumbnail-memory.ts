import { readFile } from 'node:fs/promises'
import { freemem } from 'node:os'
import { dirname, join } from 'node:path'
import { THUMBNAIL_LIMITS } from './thumbnail-limits.js'

const RESERVE = 64 * 1024 * 1024
export const THUMBNAIL_START_BYTES = THUMBNAIL_LIMITS.rssBytes + RESERVE

/** Include enclosing groups: the leaf can be unlimited inside a capped parent. */
export async function thumbnailMemoryAvailable(
  read: (path: string) => Promise<string> = (path) => readFile(path, 'utf8'),
  free: () => number = freemem,
): Promise<number> {
  try {
    const membership = await read('/proc/self/cgroup')
    const relative = membership
      .split('\n')
      .find((line) => line.startsWith('0::'))
      ?.slice(3)
    const root = '/sys/fs/cgroup'
    const paths = new Set([root])
    if (relative !== undefined) {
      let path = join(root, relative)
      while (path.startsWith(`${root}/`)) {
        paths.add(path)
        path = dirname(path)
      }
    }
    let available = free(),
      observed = false
    for (const path of paths) {
      try {
        const [limit, used] = await Promise.all([
          read(join(path, 'memory.max')),
          read(join(path, 'memory.current')),
        ])
        observed = true
        if (limit.trim() !== 'max') available = Math.min(available, availableBytes(limit, used))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return 0
      }
    }
    if (observed) return available
    // Legacy cgroup v1, including a host process's memory-controller membership.
    const group =
      membership
        .split('\n')
        .find((line) => line.split(':')[1]?.split(',').includes('memory'))
        ?.split(':')[2] ?? '/'
    const base = '/sys/fs/cgroup/memory'
    const legacy = new Set([base])
    let path = join(base, group)
    while (path.startsWith(`${base}/`)) {
      legacy.add(path)
      path = dirname(path)
    }
    for (const directory of legacy) {
      try {
        const [limit, used] = await Promise.all([
          read(join(directory, 'memory.limit_in_bytes')),
          read(join(directory, 'memory.usage_in_bytes')),
        ])
        observed = true
        available = Math.min(available, availableBytes(limit, used))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return 0
      }
    }
    return observed ? available : 0
  } catch {
    return 0
  }
}

export function availableBytes(limit: string, used: string): number {
  if (!limit.trim() || !used.trim()) return 0
  const maximum = Number(limit),
    current = Number(used)
  return Number.isFinite(maximum) && Number.isFinite(current) && maximum > 0 && current >= 0
    ? Math.max(0, maximum - current)
    : 0
}
export async function canStartThumbnail(): Promise<boolean> {
  return (await thumbnailMemoryAvailable()) >= THUMBNAIL_START_BYTES
}
export async function mustStopThumbnail(): Promise<boolean> {
  return (await thumbnailMemoryAvailable()) < RESERVE
}
