import type {
  ApiClient,
  BrandNameAvailabilityResponse,
  Seller,
  SellerApplicationRequest,
  SellerResponse,
  SellerReviewListResponse,
  SellerStatus,
} from '@shopping/shared'
import {
  APP_ID_HEADER,
  ApiClientError,
  brandNameAvailabilityResponseSchema,
  sellerResponseSchema,
  sellerReviewListResponseSchema,
} from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import { SellerService } from '../../src/sellers/seller.service.js'
import { useApiApp } from '../support/api-app.js'
import { useDatabase } from '../support/database.js'
import { createUser } from '../support/factories.js'
import type { TestCaller } from '../support/principal.js'
import { callerHeaders, callers } from '../support/principal.js'

/**
 * The onboarding endpoints over real HTTP, against this worker's real database.
 *
 * Every response goes through `createApiClient` from `@shopping/shared`, which
 * parses it with the schema TASK-0109 and TASK-0110 will type themselves
 * against. Gate C3 therefore holds structurally: a renamed or missing field
 * fails these specs as `malformed_response` whether or not an assertion happens
 * to mention it.
 *
 * There is no client method per endpoint here, unlike the catalogue specs.
 * `ApiClient` is `packages/shared/src/api/client.ts`, which belongs to no task
 * in this wave, so the calls go through its public `request` with the same
 * schemas a method would have named — the contract being checked is identical
 * and nothing outside this task's files had to move for it.
 */

const db = useDatabase()
const api = useApiApp({ database: db, authenticate: true })

/** A brand name nothing else in this run holds. */
let names = 0

function unique(prefix: string): string {
  names += 1
  return `${prefix}-${String(names)}-${String(process.env.VITEST_POOL_ID ?? '1')}`
}

/** A signed-in buyer with a real account row — an application needs one (FK). */
async function applicant(options: { readonly isDemo?: boolean } = {}): Promise<TestCaller> {
  const user = await createUser(db, { isDemo: options.isDemo ?? false })

  return { userId: user.id, roles: ['BUYER'] }
}

function client(caller: TestCaller): ApiClient {
  return api.clientAs(caller)
}

function form(overrides: Partial<SellerApplicationRequest> = {}): SellerApplicationRequest {
  return {
    brandName: unique('브랜드'),
    slug: unique('store').toLowerCase(),
    introduction: '가상 브랜드의 소개문입니다.',
    ...overrides,
  }
}

function applyAs(
  caller: TestCaller,
  body: SellerApplicationRequest = form(),
): Promise<SellerResponse> {
  return client(caller).request({
    path: '/sellers/applications',
    method: 'POST',
    body,
    schema: sellerResponseSchema,
  })
}

function meAs(caller: TestCaller): Promise<SellerResponse> {
  return client(caller).request({ path: '/sellers/me', schema: sellerResponseSchema })
}

function patchMe(caller: TestCaller, body: unknown): Promise<SellerResponse> {
  return client(caller).request({
    path: '/sellers/me',
    method: 'PATCH',
    body,
    schema: sellerResponseSchema,
  })
}

function availability(caller: TestCaller, value: string): Promise<BrandNameAvailabilityResponse> {
  return client(caller).request({
    path: `/sellers/brand-name-availability?value=${encodeURIComponent(value)}`,
    schema: brandNameAvailabilityResponseSchema,
  })
}

function reviewList(caller: TestCaller, search = ''): Promise<SellerReviewListResponse> {
  return client(caller).request({
    path: `/admin/sellers${search}`,
    schema: sellerReviewListResponseSchema,
  })
}

function reviewOne(caller: TestCaller, id: string): Promise<SellerResponse> {
  return client(caller).request({ path: `/admin/sellers/${id}`, schema: sellerResponseSchema })
}

type Decision = 'approve' | 'reject' | 'suspend' | 'reinstate'

function decide(
  caller: TestCaller,
  id: string,
  action: Decision,
  body: unknown,
): Promise<SellerResponse> {
  return client(caller).request({
    path: `/admin/sellers/${id}/${action}`,
    method: 'POST',
    body,
    schema: sellerResponseSchema,
  })
}

interface HttpFailure {
  readonly status: number
  readonly code: string
  readonly details: readonly unknown[]
}

/** Asserts the call failed over HTTP and returns the shared error envelope. */
async function failure(work: Promise<unknown>): Promise<HttpFailure> {
  const error: unknown = await work.then(
    () => null,
    (reason: unknown) => reason,
  )

  if (!(error instanceof ApiClientError) || error.kind !== 'http') {
    throw new Error(`HTTP 오류를 기대했지만 다른 결과가 나왔습니다: ${String(error)}`)
  }

  return {
    status: error.status ?? 0,
    code: error.body?.error.code ?? '',
    details: error.body?.error.details ?? [],
  }
}

/** The `field` of every structured entry in an error envelope. */
function fieldsOf(details: readonly unknown[]): readonly string[] {
  return details
    .filter(
      (entry): entry is { field: string } =>
        typeof entry === 'object' && entry !== null && 'field' in entry,
    )
    .map((entry) => entry.field)
}

/** The raw status code, for the few assertions that are about the code itself. */
async function rawPost(
  caller: TestCaller,
  path: string,
  body: unknown,
): Promise<{ status: number }> {
  const response = await fetch(`${api.baseUrl}/api/v1${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [APP_ID_HEADER]: 'seller',
      ...callerHeaders(caller),
    },
    body: JSON.stringify(body),
  })

  await response.text()
  return { status: response.status }
}

/** The roles an account actually holds, read straight from the table. */
async function rolesOf(userId: string): Promise<readonly string[]> {
  const rows = await db.query<{ role: string }>(
    'SELECT "role"::text AS role FROM "UserRole" WHERE "userId" = $1 ORDER BY "role"',
    [userId],
  )

  return rows.map((row) => row.role)
}

async function statusOf(sellerId: string): Promise<SellerStatus> {
  const row = await db.one<{ status: SellerStatus }>(
    'SELECT "status"::text AS status FROM "Seller" WHERE "id" = $1',
    [sellerId],
  )

  return row.status
}

/** A store in `PENDING`, freshly applied for. */
async function pending(): Promise<{ caller: TestCaller; seller: Seller }> {
  const caller = await applicant()
  const { seller } = await applyAs(caller)

  return { caller, seller }
}

/** A store that has been approved, and the seller who now owns it. */
async function approved(): Promise<{ caller: TestCaller; seller: Seller }> {
  const { caller, seller } = await pending()
  const { seller: active } = await decide(callers.operator, seller.id, 'approve', {
    version: seller.version,
  })

  return {
    caller: { userId: caller.userId, roles: ['SELLER_OWNER'], sellerId: active.id },
    seller: active,
  }
}

describe('F1 — 입점 신청', () => {
  it('creates one PENDING store and answers 201', async () => {
    const caller = await applicant()
    const body = form()

    const { status } = await rawPost(caller, '/sellers/applications', body)

    expect(status).toBe(201)

    const { seller } = await meAs(caller)

    expect(seller.status).toBe('PENDING')
    expect(seller.brandName).toBe(body.brandName)
    expect(seller.userId).toBe(caller.userId)
    // The application is a status change, so the queue can sort by wait time.
    expect(seller.statusChangedAt).not.toBeNull()

    const rows = await db.query('SELECT "id" FROM "Seller" WHERE "userId" = $1', [caller.userId])

    expect(rows).toHaveLength(1)
  })

  it('does not grant SELLER_OWNER for merely applying', async () => {
    const { caller } = await pending()

    expect(await rolesOf(caller.userId)).toEqual([])
  })
})

describe('F2 — 승인과 역할 부여', () => {
  it('turns the store ACTIVE and grants SELLER_OWNER', async () => {
    const { caller, seller } = await pending()

    const { seller: active } = await decide(callers.operator, seller.id, 'approve', {
      version: seller.version,
    })

    expect(active.status).toBe('ACTIVE')
    expect(active.version).toBe(seller.version + 1)
    expect(active.statusChangedAt).not.toBeNull()
    expect(await rolesOf(caller.userId)).toEqual(['SELLER_OWNER'])
  })

  it('leaves the rejection reason behind once the store is approved', async () => {
    const { seller } = await pending()

    const { seller: rejected } = await decide(callers.operator, seller.id, 'reject', {
      version: seller.version,
      reason: '사업자 정보가 확인되지 않았어요.',
    })
    const { seller: reapplied } = await applyAs(
      { userId: rejected.userId, roles: ['BUYER'] },
      form(),
    )
    const { seller: active } = await decide(callers.operator, reapplied.id, 'approve', {
      version: reapplied.version,
    })

    expect(active.statusReason).toBeNull()
  })
})

describe('F4 — 반려와 재신청', () => {
  it('shows the reason to the seller and lets them apply again', async () => {
    const { caller, seller } = await pending()

    await decide(callers.operator, seller.id, 'reject', {
      version: seller.version,
      reason: '로고 이미지가 브랜드와 무관해 보여요.',
    })

    const { seller: seen } = await meAs(caller)

    expect(seen.status).toBe('REJECTED')
    expect(seen.statusReason).toBe('로고 이미지가 브랜드와 무관해 보여요.')

    const nextForm = form()
    const { seller: again } = await applyAs(caller, nextForm)

    expect(again.status).toBe('PENDING')
    expect(again.brandName).toBe(nextForm.brandName)
    // The reason answered by this submission stops being the store's reason.
    expect(again.statusReason).toBeNull()
    // Still one store: re-applying moves the row, it does not add another.
    expect(again.id).toBe(seller.id)
  })

  it('refuses a rejection with no reason, naming the field', async () => {
    const { seller } = await pending()

    const refusal = await failure(
      decide(callers.operator, seller.id, 'reject', { version: seller.version }),
    )

    expect(refusal.status).toBe(400)
    expect(fieldsOf(refusal.details)).toContain('reason')
    expect(await statusOf(seller.id)).toBe('PENDING')
  })
})

describe('F6 — 브랜드명·slug 중복', () => {
  it('refuses a taken brand name with a 409 naming the field', async () => {
    const first = form()
    await applyAs(await applicant(), first)

    const refusal = await failure(applyAs(await applicant(), form({ brandName: first.brandName })))

    expect(refusal.status).toBe(409)
    expect(fieldsOf(refusal.details)).toEqual(['brandName'])
  })

  it('refuses a taken slug with a 409 naming the field', async () => {
    const first = form()
    await applyAs(await applicant(), first)

    const refusal = await failure(applyAs(await applicant(), form({ slug: first.slug })))

    expect(refusal.status).toBe(409)
    expect(fieldsOf(refusal.details)).toEqual(['slug'])
  })

  it('answers the availability question before the form is submitted', async () => {
    const caller = await applicant()
    const body = form()

    expect(await availability(caller, body.brandName)).toEqual({
      value: body.brandName,
      available: true,
    })

    await applyAs(caller, body)

    expect(await availability(await applicant(), body.brandName)).toEqual({
      value: body.brandName,
      available: false,
    })
  })
})

describe('F7 — 데모 판매자', () => {
  it('opens an ACTIVE store with no review call at all', async () => {
    const demo = await createUser(db, { isDemo: true })
    const sellers = api.resolve<SellerService>(SellerService)

    const seller = await sellers.openDemoStore({
      userId: demo.id,
      brandName: unique('데모브랜드'),
      slug: unique('demo-store').toLowerCase(),
    })

    expect(seller.status).toBe('ACTIVE')
    expect(seller.statusChangedAt).not.toBeNull()
    // The same pair an approval produces — the demo path cannot make a shape
    // the reviewed path never makes.
    expect(await rolesOf(demo.id)).toEqual(['SELLER_OWNER'])
  })

  it('refuses a second store for the same demo account', async () => {
    const demo = await createUser(db, { isDemo: true })
    const sellers = api.resolve<SellerService>(SellerService)
    const open = (): Promise<unknown> =>
      sellers.openDemoStore({
        userId: demo.id,
        brandName: unique('데모브랜드'),
        slug: unique('demo-store').toLowerCase(),
      })

    await open()
    await expect(open()).rejects.toThrow()
  })
})

describe('F8 — 스토어 설정 수정', () => {
  it('changes the brand name, raises the version and shows it on re-read', async () => {
    const { caller, seller } = await approved()
    const renamed = unique('새브랜드')

    const { seller: saved } = await patchMe(caller, {
      brandName: renamed,
      introduction: '문구를 고쳤습니다.',
      version: seller.version,
    })

    expect(saved.brandName).toBe(renamed)
    expect(saved.version).toBe(seller.version + 1)

    const { seller: reread } = await meAs(caller)

    expect(reread.brandName).toBe(renamed)
    expect(reread.introduction).toBe('문구를 고쳤습니다.')
    // The URL is not the brand name's to move (R4).
    expect(reread.slug).toBe(seller.slug)
  })

  it('lets a rejected applicant fix the copy before applying again', async () => {
    const { caller, seller } = await pending()

    const { seller: rejected } = await decide(callers.operator, seller.id, 'reject', {
      version: seller.version,
      reason: '브랜드명이 실제 상표와 유사해요.',
    })
    const { seller: fixed } = await patchMe(caller, {
      brandName: unique('고친브랜드'),
      version: rejected.version,
    })

    // Editing the store is not selling; the state gate is a different question.
    expect(fixed.status).toBe('REJECTED')
  })

  it('refuses a taken brand name on an edit too', async () => {
    const rival = form()
    await applyAs(await applicant(), rival)

    const { caller, seller } = await approved()
    const refusal = await failure(
      patchMe(caller, { brandName: rival.brandName, version: seller.version }),
    )

    expect(refusal.status).toBe(409)
    expect(fieldsOf(refusal.details)).toEqual(['brandName'])
  })
})

describe('F9 — 낙관적 잠금', () => {
  it('refuses the second save of the same version and keeps the first', async () => {
    const { caller, seller } = await approved()
    const first = unique('먼저')

    await patchMe(caller, { brandName: first, version: seller.version })

    const refusal = await failure(
      patchMe(caller, { brandName: unique('나중'), version: seller.version }),
    )

    expect(refusal.status).toBe(409)
    expect(fieldsOf(refusal.details)).toEqual(['version'])

    const { seller: reread } = await meAs(caller)

    // The point of the lock: the first change is still there.
    expect(reread.brandName).toBe(first)
    expect(reread.version).toBe(seller.version + 1)
  })

  it('refuses a review decision written against a stale version', async () => {
    const { caller, seller } = await pending()

    // The applicant edits their store while the operator has the queue open.
    // The transition itself is still legal — PENDING may be approved — so what
    // stops the decision is the version, and the operator has to look again.
    await patchMe(caller, { brandName: unique('수정중'), version: seller.version })

    const refusal = await failure(
      decide(callers.operator, seller.id, 'approve', { version: seller.version }),
    )

    expect(refusal.status).toBe(409)
    expect(fieldsOf(refusal.details)).toEqual(['version'])
    expect(await statusOf(seller.id)).toBe('PENDING')
  })

  it('answers 400 rather than 409 when the move is impossible whatever the version', async () => {
    const { seller } = await pending()
    const { seller: rejected } = await decide(callers.operator, seller.id, 'reject', {
      version: seller.version,
      reason: '보완이 필요해요.',
    })

    // Reloading would not help: approving a REJECTED store is not a move at
    // any version, so the refusal is about the state and not about the race.
    const refusal = await failure(
      decide(callers.operator, rejected.id, 'approve', { version: rejected.version }),
    )

    expect(refusal.status).toBe(400)
    expect(fieldsOf(refusal.details)).toEqual(['status'])
  })
})

describe('F10 — 정의되지 않은 전이', () => {
  it('answers 400 and names the moves that were available', async () => {
    const { seller } = await pending()
    const { seller: rejected } = await decide(callers.operator, seller.id, 'reject', {
      version: seller.version,
      reason: '보완이 필요해요.',
    })

    const refusal = await failure(
      decide(callers.superAdmin, rejected.id, 'suspend', {
        version: rejected.version,
        reason: '정지 사유',
      }),
    )

    expect(refusal.status).toBe(400)
    expect(fieldsOf(refusal.details)).toEqual(['status'])
    // The list is what makes the refusal actionable rather than merely a no.
    expect(JSON.stringify(refusal.details)).toContain('apply')
    expect(await statusOf(rejected.id)).toBe('REJECTED')
  })

  it('answers 400 when an approved store is applied for again', async () => {
    const { caller, seller } = await approved()

    const refusal = await failure(applyAs({ ...caller, roles: ['SELLER_OWNER'] }, form()))

    expect(refusal.status).toBe(400)
    expect(fieldsOf(refusal.details)).toEqual(['status'])
    expect(await statusOf(seller.id)).toBe('ACTIVE')
  })

  it('walks the whole legal path and refuses every illegal step on the way', async () => {
    const { caller, seller } = await pending()

    const approve = await decide(callers.operator, seller.id, 'approve', {
      version: seller.version,
    })

    expect(approve.seller.status).toBe('ACTIVE')

    // ACTIVE cannot be approved again, nor rejected.
    expect(
      (await failure(decide(callers.operator, seller.id, 'approve', { version: 1 }))).status,
    ).toBe(400)
    expect(
      (
        await failure(
          decide(callers.operator, seller.id, 'reject', { version: 1, reason: '아니오' }),
        )
      ).status,
    ).toBe(400)

    const suspended = await decide(callers.superAdmin, seller.id, 'suspend', {
      version: 1,
      reason: '반복 배송 지연.',
    })

    expect(suspended.seller.status).toBe('SUSPENDED')
    expect(suspended.seller.statusReason).toBe('반복 배송 지연.')

    const reinstated = await decide(callers.superAdmin, seller.id, 'reinstate', { version: 2 })

    expect(reinstated.seller.status).toBe('ACTIVE')
    // The suspension's reason does not survive the reinstatement.
    expect(reinstated.seller.statusReason).toBeNull()
    expect(await rolesOf(caller.userId)).toEqual(['SELLER_OWNER'])
  })
})

describe('F11 — 정지 권한 분리', () => {
  it('refuses an everyday operator the suspension', async () => {
    const { seller } = await approved()

    const refusal = await failure(
      decide(callers.operator, seller.id, 'suspend', { version: seller.version, reason: '점검' }),
    )

    expect(refusal.status).toBe(403)
    expect(refusal.code).toBe('FORBIDDEN')
    expect(await statusOf(seller.id)).toBe('ACTIVE')
  })

  it('refuses an everyday operator the reinstatement too', async () => {
    const { seller } = await approved()
    const { seller: suspended } = await decide(callers.superAdmin, seller.id, 'suspend', {
      version: seller.version,
      reason: '점검',
    })

    // Undoing a suspension with a lesser permission would be a way around it.
    const refusal = await failure(
      decide(callers.operator, suspended.id, 'reinstate', { version: suspended.version }),
    )

    expect(refusal.status).toBe(403)
  })
})

describe('F12 — 데모 관리자의 스코프', () => {
  it('refuses a demo administrator a real applicant', async () => {
    const { seller } = await pending()

    const refusal = await failure(
      decide(callers.demoAdmin, seller.id, 'approve', { version: seller.version }),
    )

    expect(refusal.status).toBe(403)
    expect(await statusOf(seller.id)).toBe('PENDING')
  })

  it('lets a demo administrator approve a demo applicant', async () => {
    const demo = await applicant({ isDemo: true })
    const { seller } = await applyAs(demo)

    const { seller: active } = await decide(callers.demoAdmin, seller.id, 'approve', {
      version: seller.version,
    })

    expect(active.status).toBe('ACTIVE')
    expect(await rolesOf(demo.userId)).toEqual(['SELLER_OWNER'])
  })

  it('still lets a demo administrator read the whole queue', async () => {
    // Reading is not narrowed to demo rows (`docs/design/erd.md` 1); acting is.
    const { seller } = await pending()
    const { sellers } = await reviewList(callers.demoAdmin)

    expect(sellers.map((entry) => entry.id)).toContain(seller.id)
  })
})

describe('심사 목록과 상세', () => {
  it('filters by status and pages by cursor', async () => {
    const stores: Seller[] = []

    for (let index = 0; index < 5; index += 1) {
      const { seller } = await pending()

      stores.push(seller)
    }

    const { seller: firstOfAll } = await decide(callers.operator, stores[0]?.id ?? '', 'approve', {
      version: 0,
    })

    expect(firstOfAll.status).toBe('ACTIVE')

    const pendingOnly = await reviewList(callers.operator, '?status=PENDING')

    expect(pendingOnly.sellers).toHaveLength(4)
    expect(pendingOnly.sellers.every((entry) => entry.status === 'PENDING')).toBe(true)

    const firstPage = await reviewList(callers.operator, '?limit=2')

    expect(firstPage.sellers).toHaveLength(2)
    expect(firstPage.nextCursor).not.toBeNull()

    const secondPage = await reviewList(
      callers.operator,
      `?limit=2&cursor=${firstPage.nextCursor ?? ''}`,
    )

    expect(secondPage.sellers).toHaveLength(2)
    // Ids are UUIDv7, so `id DESC` is newest first and the pages never overlap.
    const seen = new Set([...firstPage.sellers, ...secondPage.sellers].map((entry) => entry.id))

    expect(seen.size).toBe(4)

    const lastPage = await reviewList(callers.operator, '?limit=10')

    expect(lastPage.nextCursor).toBeNull()
  })

  it('answers the detail an operator opens from the queue', async () => {
    const { seller } = await pending()

    const { seller: detail } = await reviewOne(callers.operator, seller.id)

    expect(detail.id).toBe(seller.id)
    // Who applied, which a queue without it cannot say.
    expect(detail.userId).toBe(seller.userId)
  })

  it('answers 404 for a store id nobody holds', async () => {
    const refusal = await failure(
      reviewOne(callers.operator, '0192f0c1-0000-7000-8000-0000000affff'),
    )

    expect(refusal.status).toBe(404)
  })

  it('refuses a buyer the review queue', async () => {
    // Every BUYER holds `seller.read:any` — a storefront is public — so the
    // queue is guarded by `seller.approve` instead (9장, 2026-09-04).
    const { seller } = await pending()
    const buyer = await applicant()

    expect((await failure(reviewList(buyer))).status).toBe(403)
    expect((await failure(reviewOne(buyer, seller.id))).status).toBe(403)
  })
})

describe('A2 — 입력 검증', () => {
  it('refuses a one-character brand name and names the field', async () => {
    const caller = await applicant()
    const refusal = await failure(applyAs(caller, form({ brandName: '루' })))

    expect(refusal.status).toBe(400)
    expect(fieldsOf(refusal.details)).toEqual(['brandName'])
  })

  it('refuses a brand name padded with spaces', async () => {
    const caller = await applicant()
    const refusal = await failure(applyAs(caller, form({ brandName: '  루미에르  ' })))

    expect(refusal.status).toBe(400)
    expect(fieldsOf(refusal.details)).toEqual(['brandName'])
  })

  it('refuses a slug that would not survive a URL path', async () => {
    const caller = await applicant()
    const refusal = await failure(applyAs(caller, form({ slug: 'Store Front' })))

    expect(refusal.status).toBe(400)
    expect(fieldsOf(refusal.details)).toEqual(['slug'])
  })

  it('refuses an unknown status filter on the review queue', async () => {
    const refusal = await failure(reviewList(callers.operator, '?status=ARCHIVED'))

    expect(refusal.status).toBe(400)
    expect(fieldsOf(refusal.details)).toEqual(['status'])
  })

  it('refuses a decision with no version at all', async () => {
    const { seller } = await pending()
    const refusal = await failure(decide(callers.operator, seller.id, 'approve', {}))

    expect(refusal.status).toBe(400)
    expect(fieldsOf(refusal.details)).toEqual(['version'])
  })
})

describe('A3 · A4 — 권한과 인증', () => {
  it('refuses a buyer the approval endpoint', async () => {
    const { seller } = await pending()
    const buyer = await applicant()

    const refusal = await failure(decide(buyer, seller.id, 'approve', { version: seller.version }))

    expect(refusal.status).toBe(403)
    expect(refusal.code).toBe('FORBIDDEN')
  })

  it('refuses an anonymous caller every endpoint', async () => {
    const { seller } = await pending()
    const anonymous = api.client

    const paths = [
      { path: '/sellers/me', method: 'GET' as const },
      { path: '/sellers/applications', method: 'POST' as const },
      { path: '/admin/sellers', method: 'GET' as const },
      { path: `/admin/sellers/${seller.id}/approve`, method: 'POST' as const },
    ]

    for (const { path, method } of paths) {
      const refusal = await failure(
        anonymous.request({
          path,
          method,
          ...(method === 'POST' ? { body: {} } : {}),
          schema: sellerResponseSchema,
        }),
      )

      expect.soft(refusal.status).toBe(401)
      expect.soft(refusal.code).toBe('AUTH_REQUIRED')
    }
  })

  it('answers 404 to a caller who has never applied', async () => {
    const caller = await applicant()

    expect((await failure(meAs(caller))).status).toBe(404)
  })
})
