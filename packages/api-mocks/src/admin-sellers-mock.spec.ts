/**
 * The review double, checked against the contract it stands in for.
 *
 * A screen spec that drove this store would prove the *screen* right and say
 * nothing about whether the double is. So the four behaviours TASK-0110 leans on
 * — keyset paging, the status filter, the state machine and the optimistic lock
 * — are asserted here, through `createApiClient`, which parses every response
 * with the shared schema (gate C2 from the reading side).
 */

import type { ApiFieldError, Seller, SellerReviewListResponse } from '@shopping/shared'
import {
  createApiClient,
  isApiClientError,
  isApiFieldError,
  sellerResponseSchema,
  sellerReviewListResponseSchema,
} from '@shopping/shared'
import { beforeEach, describe, expect, it } from 'vitest'

import { adminSellerQueue, adminSellerQueueEmpty } from './fixtures/admin-sellers'
import { resetAdminSellerStore } from './handlers'
import { setupTestServer } from './node'

setupTestServer()

const client = createApiClient({ appId: 'admin', baseUrl: 'http://api.test.invalid' })

function list(search = ''): Promise<SellerReviewListResponse> {
  return client.request({
    path: `/admin/sellers${search}`,
    schema: sellerReviewListResponseSchema,
  })
}

function detail(id: string) {
  return client.request({ path: `/admin/sellers/${id}`, schema: sellerResponseSchema })
}

function decide(id: string, action: string, body: unknown) {
  return client.request({
    path: `/admin/sellers/${id}/${action}`,
    method: 'POST',
    body,
    schema: sellerResponseSchema,
  })
}

/** The failure a call produced, or `null` when it unexpectedly succeeded. */
async function refusalOf(work: Promise<unknown>): Promise<unknown> {
  return work.then(
    () => null,
    (error: unknown) => error,
  )
}

function statusOf(error: unknown): number | undefined {
  return isApiClientError(error) ? error.status : undefined
}

/** The entries of a refusal that name an input, typed so a spec can read them. */
function fieldErrorsOf(error: unknown): readonly ApiFieldError[] {
  const details = isApiClientError(error) ? (error.body?.error.details ?? []) : []

  return details.filter((entry): entry is ApiFieldError => isApiFieldError(entry))
}

const pendingSeller = (): Seller => {
  const row = adminSellerQueue.sellers.find((candidate) => candidate.status === 'PENDING')

  if (row === undefined) throw new Error('the queue fixture has no PENDING application')

  return row
}

const activeSeller = (): Seller => {
  const row = adminSellerQueue.sellers.find((candidate) => candidate.status === 'ACTIVE')

  if (row === undefined) throw new Error('the queue fixture has no ACTIVE store')

  return row
}

describe('the review queue', () => {
  it('answers the newest twenty by default', async () => {
    const page = await list()

    expect(page.sellers).toHaveLength(20)
    expect(page.sellers[0]?.id).toBe(adminSellerQueue.sellers[0]?.id)
    expect(page.nextCursor).toBe(page.sellers.at(-1)?.id)
  })

  it('pages forward without repeating or dropping a row', async () => {
    const seen: string[] = []
    let cursor: string | null = null

    for (let page = 0; page < 5; page += 1) {
      const answer: SellerReviewListResponse = await list(
        cursor === null ? '' : `?cursor=${cursor}`,
      )
      seen.push(...answer.sellers.map((row) => row.id))
      cursor = answer.nextCursor
    }

    expect(seen).toHaveLength(100)
    expect(new Set(seen).size).toBe(100)
    expect(cursor).toBeNull()
    // Newest first, which is `id DESC` because the ids are UUIDv7.
    expect(seen).toEqual([...seen].sort().reverse())
  })

  it('narrows to one status and keeps paging within it', async () => {
    const first = await list('?status=PENDING')
    const second = await list(`?status=PENDING&cursor=${String(first.nextCursor)}`)

    expect(first.sellers.every((row) => row.status === 'PENDING')).toBe(true)
    expect(second.sellers.every((row) => row.status === 'PENDING')).toBe(true)
    expect(second.nextCursor).toBeNull()
    expect(first.sellers).toHaveLength(20)
    expect(second.sellers).toHaveLength(20)
  })

  it('honours an explicit limit', async () => {
    await expect(list('?limit=100')).resolves.toEqual(adminSellerQueue)
  })

  it('refuses a limit past the contract maximum', async () => {
    expect(statusOf(await refusalOf(list('?limit=101')))).toBe(400)
  })

  it('can be seeded empty', async () => {
    resetAdminSellerStore(adminSellerQueueEmpty)

    await expect(list()).resolves.toEqual({ sellers: [], nextCursor: null })
  })
})

describe('one application', () => {
  it('comes back in the `{ seller }` envelope', async () => {
    const wanted = pendingSeller()

    await expect(detail(wanted.id)).resolves.toEqual({ seller: wanted })
  })

  it('is a 404 when no such store exists', async () => {
    const missing = '019596e0-0001-7000-8000-0000000fffff'

    expect(statusOf(await refusalOf(detail(missing)))).toBe(404)
  })
})

describe('deciding', () => {
  let waiting: Seller

  beforeEach(() => {
    waiting = pendingSeller()
  })

  it('approves a pending application and raises its lock', async () => {
    const { seller } = await decide(waiting.id, 'approve', { version: waiting.version })

    expect(seller.status).toBe('ACTIVE')
    expect(seller.version).toBe(waiting.version + 1)
    expect(seller.statusChangedAt).not.toBe(waiting.statusChangedAt)
  })

  it('keeps the decision, so the list shows it', async () => {
    await decide(waiting.id, 'approve', { version: waiting.version })
    const page = await list('?status=ACTIVE')

    expect(page.sellers.some((row) => row.id === waiting.id)).toBe(true)
  })

  it('stores the reason a rejection carries', async () => {
    const { seller } = await decide(waiting.id, 'reject', {
      version: waiting.version,
      reason: '사업자 정보가 확인되지 않습니다.',
    })

    expect(seller.status).toBe('REJECTED')
    expect(seller.statusReason).toBe('사업자 정보가 확인되지 않습니다.')
  })

  it('clears the previous reason when a decision carries none', async () => {
    const suspended = await decide(activeSeller().id, 'suspend', {
      version: activeSeller().version,
      reason: '정지 사유입니다.',
    })
    const { seller } = await decide(suspended.seller.id, 'reinstate', {
      version: suspended.seller.version,
    })

    expect(seller.status).toBe('ACTIVE')
    expect(seller.statusReason).toBeNull()
  })

  it('refuses a rejection with no reason, naming the field', async () => {
    const error = await refusalOf(decide(waiting.id, 'reject', { version: waiting.version }))

    expect(statusOf(error)).toBe(400)
    expect(fieldErrorsOf(error).map((entry) => [entry.field, entry.code])).toEqual([
      ['reason', 'INVALID'],
    ])
  })

  it('refuses a rejection whose reason is only whitespace', async () => {
    const error = await refusalOf(
      decide(waiting.id, 'reject', { version: waiting.version, reason: '   ' }),
    )

    expect(statusOf(error)).toBe(400)
  })

  it('refuses a move the state machine does not have, and says what was possible', async () => {
    const error = await refusalOf(
      decide(waiting.id, 'suspend', { version: waiting.version, reason: '정지합니다.' }),
    )

    expect(statusOf(error)).toBe(400)
    const entry = fieldErrorsOf(error).find((candidate) => candidate.field === 'status')
    expect(entry?.params?.allowed).toBe('approve,reject')
  })

  it('refuses a stale version with a 409', async () => {
    await decide(waiting.id, 'approve', { version: waiting.version })
    // 정지 is a legal move from `ACTIVE`, so the only thing left to refuse is the
    // version the caller was looking at — which the approval has moved past.
    const error = await refusalOf(
      decide(waiting.id, 'suspend', { version: waiting.version, reason: '정지합니다.' }),
    )

    expect(statusOf(error)).toBe(409)
  })

  /**
   * The order the service uses, and the reason TASK-0108 gives for it: reading
   * again would not make an impossible move possible, so 409 — "read again and
   * retry" — would be a lie.
   */
  it('prefers the 400 when the move is impossible *and* the version is stale', async () => {
    await decide(waiting.id, 'approve', { version: waiting.version })
    const error = await refusalOf(
      decide(waiting.id, 'approve', { version: waiting.version, reason: '한 번 더' }),
    )

    expect(statusOf(error)).toBe(400)
  })

  it('is a 404 for a fifth verb nobody defined', async () => {
    const error = await refusalOf(decide(waiting.id, 'archive', { version: waiting.version }))

    expect(statusOf(error)).toBe(404)
  })

  it('starts each test from the fixture', async () => {
    const page = await list('?status=PENDING')

    expect(page.sellers.some((row) => row.id === waiting.id)).toBe(true)
  })
})
