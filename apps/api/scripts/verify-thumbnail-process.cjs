// Real decoder/network/process integration. Run after `pnpm --filter @shopping/api build`.
const assert = require('node:assert/strict')
const { createServer } = require('node:http')
const { readdir, mkdtemp } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const sharp = require('sharp')
const { THUMBNAIL_LIMITS } = require('../dist/thumbnails/thumbnail-limits.js')
const {
  ThumbnailProcess,
  cleanOrphanedThumbnails,
} = require('../dist/thumbnails/thumbnail-process.js')

async function main() {
  const fixture = await sharp({
    create: {
      width: 1600,
      height: 1000,
      channels: 4,
      background: { r: 40, g: 80, b: 100, alpha: 0.5 },
    },
  })
    .png()
    .toBuffer()
  const tooManyPixels = await sharp({
    create: { width: 5000, height: 4000, channels: 3, background: 'white' },
  })
    .png()
    .toBuffer()
  const jpeg = await sharp(fixture)
    .flatten({ background: 'white' })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer()
  const webp = await sharp(fixture).webp().toBuffer()
  const small = await sharp(fixture).resize(64, 40).png().toBuffer()
  const saved = new Map()
  const server = createServer((req, res) => {
    if (req.method === 'PUT' && req.url.startsWith('/reject')) {
      req.resume()
      res.statusCode = 403
      res.end()
      return
    }
    if (req.method === 'PUT') {
      const chunks = []
      req.on('data', (chunk) => chunks.push(chunk))
      req.on('end', () => {
        saved.set(req.url, Buffer.concat(chunks))
        res.end()
      })
      return
    }
    if (req.url === '/stall') return
    if (req.url === '/forbidden' || req.url === '/not-found') {
      res.statusCode = req.url === '/forbidden' ? 403 : 404
      res.end()
      return
    }
    if (req.url === '/stream') {
      res.write(Buffer.alloc(11 * 1024 * 1024))
      res.end()
      return
    }
    if (req.url === '/bytes') {
      res.setHeader('Content-Length', 11 * 1024 * 1024)
      res.flushHeaders()
      return
    }
    const data =
      req.url === '/jpeg'
        ? jpeg
        : req.url === '/webp'
          ? webp
          : req.url === '/small'
            ? small
            : req.url === '/pixels'
              ? tooManyPixels
              : req.url === '/bad'
                ? Buffer.from('not an image')
                : fixture
    res.setHeader('Content-Length', data.length)
    res.end(data)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const command = (source) => ({
    sourceUrl: base + source,
    targets: [256, 768].map((edge) => ({ edge, url: `${base}/${edge}` })),
  })
  const before = (await readdir(tmpdir()))
    .filter((name) => name.startsWith('shopping-thumbnail-'))
    .sort()
  try {
    const pool = new ThumbnailProcess()
    const result = await pool.run(command('/image'))
    const peakRssBytes = pool.peakRssBytes
    assert.ok(peakRssBytes > 0 && peakRssBytes <= THUMBNAIL_LIMITS.rssBytes)
    assert.deepEqual(
      result.map((x) => [x.edge, x.width, x.height]),
      [
        [256, 256, 160],
        [768, 768, 480],
      ],
    )
    for (const edge of [256, 768]) {
      const metadata = await sharp(saved.get(`/${edge}`)).metadata()
      assert.equal(metadata.format, 'webp')
      assert.equal(metadata.hasAlpha, true)
    }
    assert.equal((await pool.run(command('/jpeg')))[0].height, 256)
    assert.equal((await pool.run(command('/small')))[0].width, 64)
    assert.equal((await pool.run(command('/webp'))).length, 2)
    const times = []
    for (let i = 0; i < 20; i++) {
      const start = performance.now()
      await pool.run(command('/image'))
      times.push(performance.now() - start)
    }
    times.sort((a, b) => a - b)
    console.log(JSON.stringify({ samples: 20, p95Ms: times[18] }))
    for (const source of ['/bad', '/pixels', '/bytes', '/stream', '/forbidden', '/not-found'])
      await assert.rejects(pool.run(command(source)), /conversion_failed/)
    const abort = new AbortController()
    const held = pool.run(command('/stall'), abort.signal)
    await assert.rejects(pool.run(command('/image')), /pool_busy/)
    setTimeout(() => abort.abort(), 150)
    await assert.rejects(held, /conversion_failed/)
    assert.equal((await pool.run(command('/image'))).length, 2)
    const rssLimit = THUMBNAIL_LIMITS.rssBytes
    THUMBNAIL_LIMITS.rssBytes = 1
    await assert.rejects(pool.run(command('/image')), /conversion_failed/)
    THUMBNAIL_LIMITS.rssBytes = rssLimit
    const timeout = THUMBNAIL_LIMITS.timeoutMs
    THUMBNAIL_LIMITS.timeoutMs = 150
    await assert.rejects(pool.run(command('/stall')), /conversion_failed/)
    THUMBNAIL_LIMITS.timeoutMs = timeout
    assert.equal((await pool.run(command('/image'))).length, 2)
    console.log(JSON.stringify({ peakRssBytes }))
    await assert.rejects(
      pool.run({ ...command('/image'), targets: [{ edge: 256, url: base + '/reject' }] }),
      /conversion_failed/,
    )
    await mkdtemp(tmpdir() + '/shopping-thumbnail-999999999-')
    await cleanOrphanedThumbnails()
    const after = (await readdir(tmpdir()))
      .filter((name) => name.startsWith('shopping-thumbnail-'))
      .sort()
    assert.deepEqual(after, before)
    console.log(
      'PASS: real WebP/alpha/dimensions, byte/pixel/decode rejection, serial slot, abort/recovery, temporary-file cleanup',
    )
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
}
main().catch(() => {
  console.error('Thumbnail process verification failed')
  process.exitCode = 1
})
