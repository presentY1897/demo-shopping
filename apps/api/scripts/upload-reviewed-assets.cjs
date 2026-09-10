#!/usr/bin/env node
// Dry run by default. No environment mutation; no credentials or signed URLs in logs.
const fs = require('node:fs/promises')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { parseEnv } = require('node:util')
const ROOT = path.resolve(__dirname, '../../..')
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const fail = (message) => {
  throw new Error(message)
}
async function json(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'))
}
async function atomic(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.tmp`
  await fs.writeFile(temp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 })
  await fs.rename(temp, file)
}
async function request(url, init = {}) {
  try {
    return await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(120000) })
  } catch {
    fail('Object request failed (URL and transport details suppressed)')
  }
}
async function verifyBody(response, asset) {
  const digest = createHash('sha256')
  let length = 0
  for await (const chunk of response.body) {
    length += chunk.length
    if (length > asset.sizeBytes) fail('Remote object exceeds expected length')
    digest.update(chunk)
  }
  if (length !== asset.sizeBytes || digest.digest('hex') !== asset.sha256)
    fail('Remote object checksum mismatch; refusing overwrite or verification')
}
async function main() {
  const args = process.argv.slice(2)
  const options = {
    apply: false,
    input: 'product-images/reviewed-products-export.json',
    map: 'product-images/uploaded-assets.json',
  }
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--apply') options.apply = true
    else if (args[i] === '--dry-run') options.apply = false
    else if (
      ['--env-file', '--expect-bucket', '--input', '--map'].includes(args[i]) &&
      args[i + 1] &&
      !args[i + 1].startsWith('--')
    )
      options[args[i].slice(2)] = args[++i]
    else fail('Unknown or incomplete command argument')
  }
  if (!options['env-file']) fail('Explicit --env-file is required')
  if (options.apply && !options['expect-bucket']) fail('--apply requires --expect-bucket')
  const source = parseEnv(await fs.readFile(path.resolve(options['env-file']), 'utf8'))
  const { resolveObjectStorageConfig } = require('../dist/config/storage-config.js')
  const { presignS3Request } = require('../dist/storage/sigv4.js')
  const { productImageKey } = require('../dist/storage/upload-rules.js')
  const resolved = resolveObjectStorageConfig(source)
  if (!resolved.config || resolved.issues.length)
    fail('Storage configuration missing or invalid (values suppressed)')
  const config = resolved.config
  for (const field of ['endpoint', 'publicBaseUrl']) {
    const url = new URL(config[field])
    if (url.protocol !== 'https:' || url.username || url.password)
      fail('Storage endpoint and public base must be credential-free HTTPS origins')
  }
  if (options['expect-bucket'] && options['expect-bucket'] !== config.bucket)
    fail('Expected bucket does not match configuration')
  const exported = await json(path.resolve(ROOT, options.input))
  if (!Array.isArray(exported.products) || !Array.isArray(exported.assets))
    fail('Invalid export shape')
  const owners = new Map()
  for (const product of exported.products) {
    const refs = [...product.input.images]
    for (const option of product.input.options || [])
      for (const value of option.values || []) {
        const gallery = value.meta?.gallery
        if (gallery) refs.push(...(typeof gallery === 'string' ? JSON.parse(gallery) : gallery))
      }
    for (const ref of refs) {
      if (!ref || typeof ref.url !== 'string') fail('Invalid product image reference')
      const existing = owners.get(ref.url)
      if (existing && existing !== product.sourceSellerId)
        fail('Asset has ambiguous seller ownership')
      owners.set(ref.url, product.sourceSellerId)
    }
  }
  const allowed = await fs.realpath(path.join(ROOT, 'apps/shop/public/product-image-sets'))
  const planned = []
  const seen = new Set()
  const keys = new Map()
  for (const asset of exported.assets) {
    if (seen.has(asset.sourceUrl) || !owners.has(asset.sourceUrl))
      fail('Duplicate or unowned export asset')
    seen.add(asset.sourceUrl)
    if (
      !/^[a-f0-9]{64}$/.test(asset.sha256) ||
      !Number.isSafeInteger(asset.sizeBytes) ||
      asset.sizeBytes <= 0 ||
      asset.sizeBytes > 5 * 1024 * 1024
    )
      fail('Invalid asset metadata')
    const file = await fs.realpath(path.resolve(ROOT, asset.file))
    if (!file.startsWith(allowed + path.sep) || path.extname(file) !== '.png')
      fail('Asset path escapes reviewed PNG directory')
    const bytes = await fs.readFile(file)
    if (
      bytes.length !== asset.sizeBytes ||
      hash(bytes) !== asset.sha256 ||
      bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
    )
      fail('Local PNG checksum or signature mismatch')
    const h = asset.sha256
    const uuid = `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`
    const key = productImageKey(owners.get(asset.sourceUrl), uuid, 'png')
    if (keys.has(key) && keys.get(key) !== asset.sha256) fail('Deterministic object key collision')
    keys.set(key, asset.sha256)
    planned.push({ ...asset, file, key, publicUrl: `${config.publicBaseUrl}/${key}` })
  }
  if (owners.size !== seen.size) fail('Product references missing from asset export')
  console.log(
    JSON.stringify({
      mode: options.apply ? 'apply' : 'dry-run',
      bucket: config.bucket,
      assets: planned.length,
      totalBytes: planned.reduce((n, a) => n + a.sizeBytes, 0),
      credentialsValidated: false,
    }),
  )
  if (!options.apply) return
  const mapFile = path.resolve(ROOT, options.map)
  let map
  try {
    map = await json(mapFile)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    map = { assets: [] }
  }
  if (!Array.isArray(map.assets)) fail('Invalid resume map')
  let next = 0
  let stopped = false
  let saveQueue = Promise.resolve()
  const workers = Array.from({ length: 4 }, async () => {
    while (!stopped && next < planned.length) {
      const asset = planned[next++]
      try {
        const signed = (method, headers = {}) =>
          presignS3Request({
            method,
            endpoint: config.endpoint,
            path: `/${config.bucket}/${asset.key}`,
            headers,
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey,
            region: config.region,
            signedAt: new Date(),
            expiresInSeconds: 300,
          }).url
        const existing = await request(signed('GET'))
        if (existing.status === 200) await verifyBody(existing, asset)
        else if (existing.status === 404) {
          await existing.body?.cancel()
          const bytes = await fs.readFile(asset.file)
          if (bytes.length !== asset.sizeBytes || hash(bytes) !== asset.sha256)
            fail('Local asset changed after planning')
          // Conditional creation also protects against a writer racing the GET.
          const headers = {
            'content-type': 'image/png',
            'content-length': String(bytes.length),
            'if-none-match': '*',
          }
          const put = await request(signed('PUT', headers), { method: 'PUT', headers, body: bytes })
          await put.body?.cancel()
          if (!put.ok) fail(`Conditional object creation failed with HTTP ${put.status}`)
        } else {
          await existing.body?.cancel()
          fail(`Existing-object read failed with HTTP ${existing.status}`)
        }
        const publicRead = await request(asset.publicUrl)
        if (!publicRead.ok) {
          await publicRead.body?.cancel()
          fail(`Public object verification failed with HTTP ${publicRead.status}`)
        }
        await verifyBody(publicRead, asset)
        saveQueue = saveQueue.then(async () => {
          map.assets = map.assets.filter((entry) => entry.sourceUrl !== asset.sourceUrl)
          map.assets.push({
            sourceUrl: asset.sourceUrl,
            publicUrl: asset.publicUrl,
            sha256: asset.sha256,
            sizeBytes: asset.sizeBytes,
            verified: true,
          })
          await atomic(mapFile, map)
          if (map.assets.length % 20 === 0 || map.assets.length === planned.length)
            console.log(JSON.stringify({ verified: map.assets.length, total: planned.length }))
        })
        await saveQueue
      } catch (error) {
        stopped = true
        throw error
      }
    }
  })
  const results = await Promise.allSettled(workers)
  const failed = results.find((result) => result.status === 'rejected')
  if (failed) throw failed.reason
}
main().catch(() => {
  console.error(
    'Reviewed asset upload stopped; validation or request failed. No credentials, signed URLs, or server response bodies are logged.',
  )
  process.exitCode = 1
})
