import { createReadStream, createWriteStream } from 'node:fs'
import { rm, open } from 'node:fs/promises'
import { join } from 'node:path'
import { Transform, Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import sharp from 'sharp'
import {
  THUMBNAIL_LIMITS,
  type ThumbnailCommand,
  type ThumbnailOutput,
} from './thumbnail-limits.js'

/** Invoked in a fresh process. No application/DB module is loaded here. */
async function convert(command: ThumbnailCommand): Promise<readonly ThumbnailOutput[]> {
  sharp.cache(false)
  sharp.concurrency(1)
  const directory = command.directory
  if (directory === undefined) throw new Error('missing_directory')
  try {
    const input = join(directory, 'input')
    const response = await fetch(command.sourceUrl, {
      redirect: 'error',
      signal: AbortSignal.timeout(THUMBNAIL_LIMITS.timeoutMs),
    })
    if (!response.ok || response.body === null) throw new Error('source_unavailable')
    const length = Number(response.headers.get('content-length'))
    if (length > THUMBNAIL_LIMITS.inputBytes) {
      await response.body.cancel()
      throw new Error('input_too_large')
    }
    let received = 0
    const bound = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        received += chunk.length
        callback(
          received > THUMBNAIL_LIMITS.inputBytes ? new Error('input_too_large') : null,
          chunk,
        )
      },
    })
    await pipeline(Readable.fromWeb(response.body), bound, createWriteStream(input))
    const file = await open(input, 'r')
    const header = Buffer.alloc(12)
    try {
      await file.read(header, 0, 12, 0)
    } finally {
      await file.close()
    }
    const raster =
      header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      (header[0] === 255 && header[1] === 216 && header[2] === 255) ||
      (header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WEBP')
    if (!raster) throw new Error('unsupported_image')
    const options = {
      limitInputPixels: THUMBNAIL_LIMITS.pixels,
      limitInputChannels: 4,
      sequentialRead: true,
      failOn: 'warning' as const,
    }
    const metadata = await sharp(input, options).metadata()
    if (!['jpeg', 'png', 'webp'].includes(metadata.format) || (metadata.pages ?? 1) !== 1)
      throw new Error('unsupported_image')
    const results: ThumbnailOutput[] = []
    for (const target of command.targets) {
      if (!(THUMBNAIL_LIMITS.edges as readonly number[]).includes(target.edge))
        throw new Error('invalid_edge')
      const output = join(directory, `${target.edge}.webp`)
      const info = await sharp(input, options)
        .rotate()
        .resize({
          width: target.edge,
          height: target.edge,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: 80 })
        .toFile(output)
      const upload = await fetch(target.url, {
        method: 'PUT',
        redirect: 'error',
        headers: { 'Content-Type': 'image/webp', 'Content-Length': String(info.size) },
        body: createReadStream(output) as unknown as NonNullable<
          Parameters<typeof fetch>[1]
        >['body'],
        ...{ duplex: 'half' },
        signal: AbortSignal.timeout(THUMBNAIL_LIMITS.timeoutMs),
      })
      if (!upload.ok) throw new Error('upload_failed')
      await upload.body?.cancel()
      results.push({ edge: target.edge, width: info.width, height: info.height, bytes: info.size })
    }
    return results
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

// The supervisor owns a second deadline, including native calls and network stalls.
const deadline = setTimeout(() => process.exit(1), THUMBNAIL_LIMITS.timeoutMs)
let completed = false
process.once('disconnect', () => {
  if (!completed) process.exit(1)
})
process.once('message', (command: ThumbnailCommand) => {
  void convert(command).then(
    (outputs) => {
      completed = true
      process.send?.({ ok: true, outputs }, () => process.exit(0))
      clearTimeout(deadline)
    },
    () => {
      process.send?.({ ok: false }, () => process.exit(1))
      clearTimeout(deadline)
    },
  )
})
