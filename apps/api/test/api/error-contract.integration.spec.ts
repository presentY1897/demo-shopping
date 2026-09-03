import 'reflect-metadata'

import { appendFileSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

import type { INestApplication, LoggerService } from '@nestjs/common'
import { Controller, Get, Module } from '@nestjs/common'
import { APP_FILTER, APP_GUARD, NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import type { ApiClient } from '@shopping/shared'
import {
  ApiClientError,
  apiErrorSchema,
  isApiFieldError,
  REQUEST_ID_HEADER,
} from '@shopping/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AnonymousPrincipalResolver } from '../../src/auth/anonymous-principal.resolver.js'
import { PermissionGuard } from '../../src/auth/permission.guard.js'
import { PRINCIPAL_RESOLVER } from '../../src/auth/principal-resolver.js'
import { configureApp } from '../../src/bootstrap/configure-app.js'
import { AllExceptionsFilter } from '../../src/common/all-exceptions.filter.js'
import { APP_CONFIG } from '../../src/config/app-config.js'
import { useApiApp } from '../support/api-app.js'
import { testAppConfig } from '../support/app-config.js'
import { useDatabase } from '../support/database.js'
import { callers } from '../support/principal.js'

/**
 * The error contract itself (TASK-0117), over real HTTP.
 *
 * The other integration specs check that each endpoint refuses what it should.
 * This one checks the thing *between* them: that a refusal says what happened in
 * a form a machine can act on, that it never says more than it should, and that
 * the number it hands a person leads back to the request in the log.
 *
 * Written against `error.code` and `details[].field` throughout — never against
 * the Korean. That is not stylistic: TASK-0117 4.8's negative control rewrites
 * every server sentence and re-runs the suite, and a spec that quoted one would
 * be the thing that fails.
 */

const db = useDatabase()
const api = useApiApp({ database: db, authenticate: true })

function operator(): ApiClient {
  return api.clientAs(callers.operator)
}

function superAdmin(): ApiClient {
  return api.clientAs(callers.superAdmin)
}

interface Refusal {
  readonly status: number
  readonly code: string
  readonly message: string
  readonly details: readonly unknown[]
  readonly requestId: string | null
  readonly body: unknown
}

async function refuse(work: Promise<unknown>): Promise<Refusal> {
  const error: unknown = await work.then(
    () => null,
    (reason: unknown) => reason,
  )

  if (!(error instanceof ApiClientError) || error.kind !== 'http') {
    throw new Error(`HTTP 오류를 기대했지만 다른 결과가 나왔습니다: ${String(error)}`)
  }

  const parsed = apiErrorSchema.safeParse(error.body)

  expect(parsed.success).toBe(true)
  if (!parsed.success) throw new Error('에러 응답이 공통 포맷이 아닙니다.')

  return {
    status: error.status ?? 0,
    code: parsed.data.error.code,
    message: parsed.data.error.message,
    details: parsed.data.error.details,
    requestId: error.requestId,
    body: error.body,
  }
}

/** 의류 > 상의, plus a second root, which is enough for every case below. */
async function fixture(): Promise<{ root: number; child: number; version: number }> {
  const client = operator()
  const { category: root } = await client.createCategory({
    parentId: null,
    name: '의류',
    slug: 'clothing',
  })
  const { category: child } = await client.createCategory({
    parentId: root.id,
    name: '상의',
    slug: 'tops',
  })

  return { root: root.id, child: child.id, version: root.version }
}

describe('one endpoint, different failures, different codes (F1)', () => {
  it('answers the three category 409s with three codes', async () => {
    const { root, child, version } = await fixture()

    const slugTaken = await refuse(
      operator().createCategory({ parentId: null, name: '의류2', slug: 'clothing' }),
    )
    const staleVersion = await refuse(
      operator().updateCategory(child, { version: version + 5, name: '겉옷' }),
    )
    const hasChildren = await refuse(superAdmin().deleteCategory(root))

    for (const refusal of [slugTaken, staleVersion, hasChildren]) {
      expect(refusal.status).toBe(409)
    }

    expect(slugTaken.code).toBe('CATEGORY_SLUG_TAKEN')
    expect(staleVersion.code).toBe('CATEGORY_VERSION_CONFLICT')
    expect(hasChildren.code).toBe('CATEGORY_HAS_CHILDREN')

    // The measurement TASK-0117 F1 states: three, all different.
    expect(new Set([slugTaken.code, staleVersion.code, hasChildren.code]).size).toBe(3)
  })

  it('separates the two 400s a move can produce', async () => {
    const { root, child } = await fixture()

    const intoSelf = await refuse(operator().moveCategory(root, { parentId: child }))
    const gone = await refuse(operator().moveCategory(child, { parentId: 9_999 }))

    expect(intoSelf.code).toBe('CATEGORY_MOVE_INTO_SELF')
    expect(gone.code).toBe('CATEGORY_PARENT_MISSING')
  })
})

describe('a failure names the input it is about (F2)', () => {
  it('reports the offending field on a malformed slug', async () => {
    const refusal = await refuse(
      operator().createCategory({ parentId: null, name: '의류', slug: 'Not A Slug' }),
    )

    const [first] = refusal.details

    expect(isApiFieldError(first)).toBe(true)
    expect(first).toMatchObject({ field: 'slug', code: 'INVALID' })
  })

  it('reports a domain conflict on the field that caused it', async () => {
    await fixture()

    const refusal = await refuse(
      operator().createCategory({ parentId: null, name: '의류2', slug: 'clothing' }),
    )

    expect(refusal.details).toMatchObject([{ field: 'slug', code: 'CATEGORY_SLUG_TAKEN' }])
  })

  it('carries the values a reader has to interpolate, rather than a finished sentence', async () => {
    const { child } = await fixture()
    const { category: leaf } = await operator().createCategory({
      parentId: child,
      name: '티셔츠',
      slug: 'tees',
    })

    const refusal = await refuse(
      operator().createCategory({ parentId: leaf.id, name: '반팔', slug: 'short-sleeve' }),
    )

    expect(refusal.details).toMatchObject([{ field: 'parentId', params: { max: 3 } }])
  })

  it('leaves a failure about no input without a field (F2 boundary)', async () => {
    const { root } = await fixture()

    const refusal = await refuse(superAdmin().deleteCategory(root))

    // A delete refused because of what is under it is not about anything the
    // operator typed. Hanging it on a control would be worse than saying nothing.
    expect(refusal.details).toEqual([])
    expect(refusal.code).toBe('CATEGORY_HAS_CHILDREN')
  })
})

describe('details that carry no code still work (F9)', () => {
  it('answers with the plain string the endpoint sent', async () => {
    const refusal = await refuse(
      operator().createAttribute({
        categoryId: 9_999,
        key: 'brand',
        label: '브랜드',
        type: 'TEXT',
      }),
    )

    expect(refusal.status).toBe(400)
    expect(refusal.details).toHaveLength(1)
    expect(typeof refusal.details[0]).toBe('string')
    // The envelope still parses, and the reader still has a code to fall back on.
    expect(refusal.code).toBe('BAD_REQUEST')
  })

  it('lets a reader tell the two shapes apart with one predicate', async () => {
    const untyped = await refuse(
      operator().createAttribute({
        categoryId: 9_999,
        key: 'brand',
        label: '브랜드',
        type: 'TEXT',
      }),
    )
    const typed = await refuse(
      operator().createCategory({ parentId: null, name: '의류', slug: 'Not A Slug' }),
    )

    expect(untyped.details.map(isApiFieldError)).toEqual([false])
    expect(typed.details.map(isApiFieldError)).toEqual([true])
  })
})

describe('what a 4xx body may contain (F10)', () => {
  /** Anything that would tell a reader about the inside of this process. */
  const FORBIDDEN = [
    /\bat\s+\w+.*\(.*:\d+:\d+\)/, // a stack frame
    /\bstack\b/i,
    /\b(SELECT|INSERT|UPDATE|DELETE)\s+.*\b(FROM|INTO|SET)\b/i,
    /"Category"|"AttributeDefinition"/, // a quoted table name
    /\/(home|usr|var|app)\//, // an absolute path
    /node_modules/,
    /postgres(ql)?:\/\//,
    /\bPrisma\w*/,
    /\bP\d{4}\b/, // a Prisma error code
    /\b23505\b/, // a SQLSTATE
  ]

  it('never leaks internals on any of the refusals this API can produce', async () => {
    const { root, child, version } = await fixture()

    const refusals = [
      await refuse(operator().createCategory({ parentId: null, name: '', slug: 'Not A Slug' })),
      await refuse(operator().createCategory({ parentId: null, name: '의류2', slug: 'clothing' })),
      await refuse(operator().createCategory({ parentId: 9_999, name: '고아', slug: 'orphan' })),
      await refuse(operator().updateCategory(child, { version: version + 5, name: '겉옷' })),
      await refuse(operator().moveCategory(root, { parentId: child })),
      await refuse(operator().reorderCategories({ parentId: null, orderedIds: [child] })),
      await refuse(superAdmin().deleteCategory(root)),
      await refuse(operator().deleteCategory(9_999)),
      await refuse(api.client.getCategoryTree()),
    ]

    for (const refusal of refusals) {
      const text = JSON.stringify(refusal.body)

      for (const pattern of FORBIDDEN) {
        expect(`${String(refusal.status)} ${refusal.code}: ${text}`).not.toMatch(pattern)
      }
    }
  })
})

/**
 * Gate P2 — the error paths, timed.
 *
 * Refusals are measured separately from successes because they take different
 * routes through the application: a 409 on a delete has already counted
 * children inside the tree lock, and a 400 from `parseInput` never reaches the
 * database at all. A success budget says nothing about either.
 */
describe('오류 경로의 응답 시간 (P2)', () => {
  /** The 95th percentile of `runs` timings of `work`, in milliseconds. */
  async function p95Of(runs: number, work: () => Promise<unknown>): Promise<number> {
    const durations: number[] = []

    for (let index = 0; index < runs; index += 1) {
      const started = performance.now()

      await work()
      durations.push(performance.now() - started)
    }
    durations.sort((left, right) => left - right)

    return durations[Math.floor(durations.length * 0.95)] ?? Number.POSITIVE_INFINITY
  }

  /** Reports the number as well as gating on it, so the value is in the log. */
  function within(label: string, measured: number): void {
    console.log(`[P2] ${label} p95 = ${measured.toFixed(1)}ms`)
    expect(measured).toBeLessThan(300)
  }

  it('answers a rejected input well inside 300ms at p95', async () => {
    within(
      '400 검증 실패',
      await p95Of(50, () =>
        refuse(operator().createCategory({ parentId: null, name: '', slug: 'Not A Slug' })),
      ),
    )
  })

  it('answers a conflict well inside 300ms at p95', async () => {
    await fixture()

    within(
      '409 주소 중복',
      await p95Of(50, () =>
        refuse(operator().createCategory({ parentId: null, name: '의류2', slug: 'clothing' })),
      ),
    )
  })

  it('answers a refused delete — the slowest refusal — well inside 300ms at p95', async () => {
    const { root } = await fixture()

    // The one that does real work before refusing: tree lock, then a count.
    within('409 하위 존재', await p95Of(30, () => refuse(superAdmin().deleteCategory(root))))
  })
})

describe('every error carries a request id', () => {
  it('puts the same id in the header and in the envelope', async () => {
    const refusal = await refuse(
      operator().createCategory({ parentId: null, name: '', slug: 'nope' }),
    )
    const parsed = apiErrorSchema.parse(refusal.body)

    expect(refusal.requestId).toBe(parsed.error.requestId)
    expect(parsed.error.requestId).not.toBe('')
  })

  it('honours an id the caller supplied, so a trace spans both sides', async () => {
    const response = await fetch(`${api.baseUrl}/api/v1/categories/not-a-number`, {
      method: 'DELETE',
      headers: {
        'x-request-id': 'caller-supplied-id',
        'x-test-user': callers.superAdmin.userId,
        'x-test-roles': 'ADMIN_SUPER',
      },
    })

    expect(response.headers.get(REQUEST_ID_HEADER)).toBe('caller-supplied-id')
    expect(await response.json()).toMatchObject({
      error: { requestId: 'caller-supplied-id' },
    })
  })
})

/**
 * A handler with no permission decorator — what somebody's forgotten `@Get()`
 * looks like from outside.
 *
 * There is deliberately no such endpoint in the shipped API
 * (`endpoint-coverage.spec.ts` fails the build if one appears), so reproducing
 * the 500 needs one here.
 */
@Controller({ path: 'boom', version: '1' })
class BoomController {
  @Get()
  boom(): { ok: true } {
    return { ok: true }
  }
}

/** Appends every log line to a file, so the assertion can be a real grep. */
function fileLogger(path: string): LoggerService {
  const write = (level: string, message: unknown): void => {
    appendFileSync(path, `[${level}] ${String(message)}\n`, 'utf8')
  }

  return {
    log: (message: unknown) => {
      write('log', message)
    },
    error: (message: unknown) => {
      write('error', message)
    },
    warn: (message: unknown) => {
      write('warn', message)
    },
    debug: (message: unknown) => {
      write('debug', message)
    },
    verbose: (message: unknown) => {
      write('verbose', message)
    },
  }
}

describe('the number on the screen finds the request in the log (F6)', () => {
  const logPath = join(mkdtempSync(join(tmpdir(), 'errctr-log-')), 'api.log')

  let app: INestApplication | null = null
  let baseUrl = ''

  beforeAll(async () => {
    const config = testAppConfig({ databaseUrl: db.url })

    @Module({
      controllers: [BoomController],
      providers: [
        { provide: APP_CONFIG, useValue: config },
        { provide: PRINCIPAL_RESOLVER, useClass: AnonymousPrincipalResolver },
        { provide: APP_GUARD, useClass: PermissionGuard },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
      ],
    })
    class BoomModule {}

    const created = await NestFactory.create<NestExpressApplication>(BoomModule, {
      logger: fileLogger(logPath),
    })

    await configureApp(created, config)
    await created.listen(0, '127.0.0.1')

    app = created
    const address = created.getHttpServer().address() as AddressInfo

    baseUrl = `http://127.0.0.1:${String(address.port)}`
  })

  afterAll(async () => {
    await app?.close()
    app = null
  })

  it('answers a forgotten declaration with a 500 that explains nothing (F8)', async () => {
    const response = await fetch(`${baseUrl}/api/v1/boom`)
    const body: unknown = await response.json()

    expect(response.status).toBe(500)
    expect(apiErrorSchema.parse(body).error).toMatchObject({
      code: 'INTERNAL_ERROR',
      details: [],
    })
    // The reason a developer needs is in the log; the caller is told none of it.
    expect(JSON.stringify(body)).not.toContain('퍼미션')
    expect(JSON.stringify(body)).not.toContain('BoomController')
  })

  it('logs that request under the id the caller was given', async () => {
    const response = await fetch(`${baseUrl}/api/v1/boom`)
    const requestId = response.headers.get(REQUEST_ID_HEADER)
    const fromBody = apiErrorSchema.parse(await response.json()).error.requestId

    expect(requestId).toBe(fromBody)
    expect(requestId).not.toBeNull()

    // The grep QA would run, against a file the server actually wrote.
    const lines = readFileSync(logPath, 'utf8')
      .split('\n')
      .filter((line) => line.includes(requestId ?? 'never'))

    // Two lines for one request, both about it: the filter's record of the
    // failure and the middleware's record of how the request ended.
    expect(lines).toHaveLength(2)
    expect(lines.filter((line) => line.startsWith('[error]'))).toHaveLength(2)
    expect(lines.every((line) => line.includes('/api/v1/boom'))).toBe(true)
    expect(lines.some((line) => line.includes('500'))).toBe(true)
  })

  it('gives a different request a different id, so a grep finds one request', async () => {
    const ids = await Promise.all(
      [1, 2, 3].map(async () =>
        (await fetch(`${baseUrl}/api/v1/boom`)).headers.get(REQUEST_ID_HEADER),
      ),
    )

    expect(new Set(ids).size).toBe(3)

    const log = readFileSync(logPath, 'utf8').split('\n')

    for (const id of ids) {
      expect(log.filter((line) => line.includes(id ?? 'never'))).toHaveLength(2)
    }
  })
})
