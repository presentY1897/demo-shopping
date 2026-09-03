#!/usr/bin/env node
// Proves a presigned URL against a real S3 implementation (TASK-0011 4.6).
//
//   pnpm --filter @shopping/api storage:roundtrip --minio   # 계정 없이
//   pnpm --filter @shopping/api storage:roundtrip           # .env 의 실 R2 로
//
// `pnpm test` cannot do this. QUALITY-GATES 6장 lists Cloudflare R2 as a mocked
// dependency, and a check that needs a container has no business in the unit
// suite — so the signature is pinned in the suite against AWS's published vector
// (`src/storage/sigv4.spec.ts`) and the *round trip* lives here.
//
// The two answer different questions:
//
//   the vector  — do we compute the signature the specification describes?
//   this script — does a real server accept it, and enforce what we signed?
//
// Everything below goes through the shipped code — `resolveObjectStorageConfig`
// reads the environment, `createObjectStorage` builds the port, and the port
// signs. A copy of the algorithm here would prove only that the copy works.

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

import { loadLocalEnv, resolveOffset } from '../../../scripts/ports.mjs'

const API_ROOT = join(import.meta.dirname, '..')
const REPO_ROOT = join(API_ROOT, '..', '..')

/**
 * MinIO's port, offset like everything else so two worktrees can check at once.
 *
 * Deliberately not in `scripts/ports.mjs`: that file describes the ports of the
 * development stack, and this container exists for the length of one command. If
 * MinIO ever joins `docker-compose.yml`, the base port moves there.
 */
const MINIO_BASE_PORT = 9000

const MINIO_IMAGE = 'minio/minio:latest'
const MINIO_BUCKET = 'shopping-check'
const MINIO_USER = 'presigncheck'
const MINIO_PASSWORD = 'presigncheck-secret'

/** A 1×1 PNG — small, but a real image with a real content type. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

function fail(message) {
  console.error(`\n  ${message}\n`)
  process.exit(1)
}

function docker(args, options = {}) {
  const output = execFileSync('docker', args, { encoding: 'utf8', ...options })

  // `stdio: 'ignore'` makes execFileSync answer null rather than a string.
  return typeof output === 'string' ? output.trim() : ''
}

/** Loads the shipped configuration reader and storage port from `dist`. */
async function loadStorageModules() {
  const built = join(API_ROOT, 'dist', 'storage', 'object-storage.js')

  if (!existsSync(built)) {
    fail(
      'apps/api/dist 가 없습니다. 이 스크립트는 배포되는 코드로 검증하므로 먼저 빌드해야 합니다:\n' +
        '  pnpm --filter @shopping/api build',
    )
  }

  const storage = await import(built)
  const config = await import(join(API_ROOT, 'dist', 'config', 'storage-config.js'))
  const sigv4 = await import(join(API_ROOT, 'dist', 'storage', 'sigv4.js'))

  return {
    createObjectStorage: storage.createObjectStorage,
    resolveObjectStorageConfig: config.resolveObjectStorageConfig,
    presignS3Request: sigv4.presignS3Request,
  }
}

async function waitForMinio(origin) {
  const deadline = Date.now() + 30_000

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/minio/health/live`)
      if (response.ok) return
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  fail('MinIO 가 30초 안에 기동하지 않았습니다.')
}

/**
 * Starts a throwaway MinIO and points the environment at it.
 *
 * The bucket is created by making its directory: MinIO's filesystem backend
 * treats every top level directory under `/data` as a bucket, which avoids
 * pulling a second image just to run one `mc mb`.
 */
async function startMinio(offset) {
  const port = MINIO_BASE_PORT + offset
  const name = `shopping-presign-check-${String(offset)}`
  const origin = `http://127.0.0.1:${String(port)}`

  try {
    docker(['rm', '--force', name], { stdio: 'ignore' })
  } catch {
    // Nothing to remove.
  }

  console.log(`  MinIO 기동 중 — ${origin} (컨테이너 ${name})`)
  docker([
    'run',
    '--detach',
    '--name',
    name,
    '--publish',
    `${String(port)}:9000`,
    '--env',
    `MINIO_ROOT_USER=${MINIO_USER}`,
    '--env',
    `MINIO_ROOT_PASSWORD=${MINIO_PASSWORD}`,
    MINIO_IMAGE,
    'server',
    '/data',
  ])

  await waitForMinio(origin)
  docker(['exec', name, 'mkdir', '-p', `/data/${MINIO_BUCKET}`])

  process.env.R2_ENDPOINT = origin
  process.env.R2_BUCKET = MINIO_BUCKET
  process.env.R2_ACCESS_KEY_ID = MINIO_USER
  process.env.R2_SECRET_ACCESS_KEY = MINIO_PASSWORD
  // MinIO serves nothing anonymously by default, which is the honest state:
  // public read is B5 in TASK-0011 6.4 and needs the R2 account.
  process.env.R2_PUBLIC_BASE_URL = origin

  return name
}

const results = []

async function check(label, run) {
  try {
    const detail = await run()

    results.push({ label, ok: true, detail })
  } catch (error) {
    results.push({ label, ok: false, detail: error.message })
  }
}

function expect(condition, message) {
  if (!condition) throw new Error(message)
}

async function statusOf(url, init) {
  const response = await fetch(url, init)

  // Drain, so the connection is reusable and the server logs a complete request.
  await response.arrayBuffer()
  return response.status
}

async function main() {
  const minio = process.argv.includes('--minio')

  loadLocalEnv(REPO_ROOT)
  const envFile = join(REPO_ROOT, '.env')
  if (existsSync(envFile)) process.loadEnvFile(envFile)

  const offset = resolveOffset()
  let container = null

  if (minio) container = await startMinio(offset)

  try {
    const { createObjectStorage, resolveObjectStorageConfig, presignS3Request } =
      await loadStorageModules()
    const resolved = resolveObjectStorageConfig(process.env)

    if (resolved.config === null) {
      const reasons = resolved.issues.map((issue) => `${issue.variable}: ${issue.reason}`)

      fail(
        reasons.length === 0
          ? 'R2 환경변수가 하나도 설정되어 있지 않습니다. --minio 로 로컬 S3 서버에 대고 검증하거나, .env 에 R2_* 를 채우세요.'
          : `R2 설정이 불완전합니다.\n  ${reasons.join('\n  ')}`,
      )
    }

    const config = resolved.config
    const storage = createObjectStorage(config)
    const key = `products/${randomUUID()}/${randomUUID()}.png`

    console.log(`\n  엔드포인트 ${config.endpoint} · 버킷 ${config.bucket}`)
    console.log(`  키 ${key}\n`)

    const upload = storage.presignUpload({
      key,
      contentType: 'image/png',
      contentLength: PNG.byteLength,
      now: new Date(),
      expiresInSeconds: 300,
    })

    await check('발급된 URL 로 PUT 하면 저장된다 (F2)', async () => {
      const status = await statusOf(upload.uploadUrl, {
        method: 'PUT',
        headers: upload.headers,
        body: PNG,
      })

      expect(status === 200, `200 을 기대했지만 ${String(status)}`)
      return '200'
    })

    await check('올린 바이트가 그대로 돌아온다', async () => {
      const readBack = presignS3Request({
        method: 'GET',
        endpoint: config.endpoint,
        path: `/${config.bucket}/${key}`,
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
        region: config.region,
        signedAt: new Date(),
        expiresInSeconds: 300,
      })
      const response = await fetch(readBack.url)
      const bytes = Buffer.from(await response.arrayBuffer())

      expect(response.status === 200, `200 을 기대했지만 ${String(response.status)}`)
      expect(bytes.equals(PNG), '내용이 다릅니다')
      expect(
        response.headers.get('content-type') === 'image/png',
        `content-type 이 ${String(response.headers.get('content-type'))}`,
      )
      return `${String(bytes.byteLength)} 바이트 · image/png`
    })

    await check('선언한 것보다 큰 본문은 거부된다 (F9)', async () => {
      const understated = storage.presignUpload({
        key: `${key}.understated`,
        contentType: 'image/png',
        contentLength: 10,
        now: new Date(),
        expiresInSeconds: 300,
      })
      const status = await statusOf(understated.uploadUrl, {
        method: 'PUT',
        headers: understated.headers,
        body: PNG,
      })

      expect(status === 403, `403 을 기대했지만 ${String(status)}`)
      return `10바이트로 서명하고 ${String(PNG.byteLength)}바이트를 보냄 → 403`
    })

    await check('선언한 것과 다른 형식은 거부된다 (F9)', async () => {
      const status = await statusOf(upload.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/pdf' },
        body: PNG,
      })

      expect(status === 403, `403 을 기대했지만 ${String(status)}`)
      return 'image/png 로 서명하고 application/pdf 로 보냄 → 403'
    })

    await check('만료된 URL 은 거부된다 (F6)', async () => {
      const expired = storage.presignUpload({
        key: `${key}.expired`,
        contentType: 'image/png',
        contentLength: PNG.byteLength,
        // Signed ten minutes ago with a five minute lifetime.
        now: new Date(Date.now() - 600_000),
        expiresInSeconds: 300,
      })
      const status = await statusOf(expired.uploadUrl, {
        method: 'PUT',
        headers: expired.headers,
        body: PNG,
      })

      expect(status === 403, `403 을 기대했지만 ${String(status)}`)
      return '5분 만료 URL 을 10분 뒤에 사용 → 403'
    })

    await check('서명을 한 글자 바꾸면 거부된다', async () => {
      const tampered = upload.uploadUrl.replace(/.$/u, (last) => (last === 'a' ? 'b' : 'a'))
      const status = await statusOf(tampered, {
        method: 'PUT',
        headers: upload.headers,
        body: PNG,
      })

      expect(status === 403, `403 을 기대했지만 ${String(status)}`)
      return '403'
    })

    // Reported, never asserted: anonymous read needs the public bucket domain,
    // which is B5 in TASK-0011 6.4 and cannot exist without the account.
    const publicStatus = await statusOf(upload.publicUrl, { method: 'GET' })

    console.log(
      publicStatus === 200
        ? `  공개 읽기 (F3): ${upload.publicUrl} → 200`
        : `  공개 읽기 (F3): 미확인 — ${upload.publicUrl} → ${String(publicStatus)}` +
            ' (공개 도메인은 R2 계정이 있어야 붙는다. TASK-0011 6.4 B5)',
    )
  } finally {
    if (container !== null) {
      docker(['rm', '--force', container], { stdio: 'ignore' })
      console.log(`\n  MinIO 컨테이너 ${container} 를 정리했습니다.`)
    }
  }

  console.log('')
  for (const { label, ok, detail } of results) {
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail === undefined ? '' : ` — ${detail}`}`)
  }

  const failed = results.filter((result) => !result.ok)

  console.log(`\n  ${String(results.length - failed.length)}/${String(results.length)} 통과\n`)
  if (failed.length > 0) process.exit(1)
}

await main()
