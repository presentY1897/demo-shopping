import { canStartThumbnail, mustStopThumbnail } from './thumbnail-memory.js'
import { fork } from 'node:child_process'
import { readFile, mkdtemp, rm, readdir, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  THUMBNAIL_LIMITS,
  type ThumbnailCommand,
  type ThumbnailOutput,
} from './thumbnail-limits.js'

/** One local slot, even if the scheduler accidentally calls run more than once. */
export class ThumbnailProcess {
  private busy = false
  peakRssBytes = 0

  async run(command: ThumbnailCommand, signal?: AbortSignal): Promise<readonly ThumbnailOutput[]> {
    if (process.platform !== 'linux') throw new Error('thumbnail_memory_monitor_unavailable')
    if (this.busy) throw new Error('thumbnail_pool_busy')
    if (signal?.aborted) throw new Error('thumbnail_aborted')
    this.busy = true
    this.peakRssBytes = 0
    let directory: string | undefined
    try {
      if (!(await canStartThumbnail())) throw new Error('thumbnail_memory_budget_unavailable')
      directory = await mkdtemp(join(tmpdir(), `shopping-thumbnail-${process.pid}-`))
      return await this.execute({ ...command, directory }, signal)
    } finally {
      try {
        if (directory !== undefined) await rm(directory, { recursive: true, force: true })
      } finally {
        this.busy = false
      }
    }
  }

  private execute(
    command: ThumbnailCommand,
    signal?: AbortSignal,
  ): Promise<readonly ThumbnailOutput[]> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error('thumbnail_aborted'))
        return
      }
      const child = fork(join(__dirname, 'thumbnail-child.js'), [], {
        execArgv: ['--max-old-space-size=64'],
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, MALLOC_ARENA_MAX: '2' },
      })
      let outputs: readonly ThumbnailOutput[] | undefined
      let failed = false
      const stop = () => {
        failed = true
        child.kill('SIGKILL')
      }
      const timer = setTimeout(stop, THUMBNAIL_LIMITS.timeoutMs)
      const monitor = setInterval(() => {
        if (child.pid === undefined) return
        void mustStopThumbnail().then((stopNeeded) => {
          if (stopNeeded) stop()
        })
        void readFile(`/proc/${child.pid}/status`, 'utf8').then(
          (status) => {
            const rss = /^VmRSS:\s+(\d+) kB/m.exec(status)?.[1]
            if (rss !== undefined) {
              this.peakRssBytes = Math.max(this.peakRssBytes, Number(rss) * 1024)
              if (this.peakRssBytes > THUMBNAIL_LIMITS.rssBytes) stop()
            }
          },
          (error: NodeJS.ErrnoException) => {
            // Missing /proc entry can mean the child just exited; other errors disable monitoring.
            if (error.code !== 'ENOENT') stop()
          },
        )
      }, 25)
      signal?.addEventListener('abort', stop, { once: true })
      child.on('message', (message: { ok?: boolean; outputs?: readonly ThumbnailOutput[] }) => {
        if (message.ok === true) outputs = message.outputs
        else failed = true
      })
      child.once('error', () => {
        failed = true
      })
      child.once('close', (code) => {
        clearTimeout(timer)
        clearInterval(monitor)
        signal?.removeEventListener('abort', stop)
        // Only a closed process frees the slot: a timeout alone is not completion.
        if (!failed && code === 0 && outputs !== undefined) resolve(outputs)
        else reject(new Error('thumbnail_conversion_failed'))
      })
      child.send(command)
    })
  }
}

/** A killed parent cannot run finally. Reclaim only directories whose owning process is gone. */
export async function cleanOrphanedThumbnails(): Promise<void> {
  if (process.platform !== 'linux') return
  for (const name of await readdir(tmpdir())) {
    const owner = /^shopping-thumbnail-([0-9]+)-[A-Za-z0-9]+$/.exec(name)?.[1]
    if (owner === undefined) continue
    try {
      await access(`/proc/${owner}`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        await rm(join(tmpdir(), name), { recursive: true, force: true })
      }
    }
  }
}
