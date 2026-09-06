import type {
  Claim,
  AdminClaimListResponse,
  ClaimableResponse,
  ClaimResponse,
} from '@shopping/shared'
import {
  adminClaimListResponseSchema,
  adminFailedRefundListResponseSchema,
  adminOverdueClaimsResponseSchema,
  claimableResponseSchema,
  claimResponseSchema,
  createApiClient,
  isApiClientError,
} from '@shopping/shared'
import { beforeEach, describe, expect, it } from 'vitest'

import { adminClaimHandlers } from './handlers/admin-claims'
import {
  MOCK_ADMIN_CLAIMABLE_IDS,
  MOCK_ADMIN_DEFECT_RETURN_ID,
  mockAdminClaimIdOf,
  mockAdminSellerIdOf,
} from './handlers/admin-claim-contract'
import { setupTestServer } from './node'

/**
 * 관리자 클레임 대역이 **실제 API 와 같은 것을 답하는가** (TASK-0071, C2).
 *
 * 응답이 계약을 지나는지는 `registry.spec.ts` 와 클라이언트의 파싱이 이미 본다.
 * 여기서 재는 것은 **대역이 상태를 옳게 다루는가**이고, 그것이 얼어붙은 픽스처와
 * 다른 점이다 — 화면이 묻는 질문이 전부 상태에 대한 것이기 때문이다.
 */

const { server } = setupTestServer()

const client = createApiClient({ appId: 'admin', baseUrl: 'http://api.test.invalid' })

function list(query = ''): Promise<AdminClaimListResponse> {
  return client.request({ path: `/admin/claims${query}`, schema: adminClaimListResponseSchema })
}

async function statusOfFailure(work: () => Promise<unknown>): Promise<number | undefined> {
  try {
    await work()
  } catch (error) {
    if (isApiClientError(error)) return error.status

    throw error
  }

  throw new Error('요청이 거절되지 않았습니다.')
}

/**
 * 거절의 **상태와 코드**.
 *
 * 사진의 거절은 다섯이 저마다 다른 코드로 나가고(TASK-0067 F2), 화면은 그 코드로
 * 갈린다 — 상태만 재면 「사진이 없다」와 「사진을 붙일 수 없다」가 같은 400 이 된다.
 */
async function refusalOf(
  work: () => Promise<unknown>,
): Promise<{ readonly status: number | undefined; readonly code: string | undefined }> {
  try {
    await work()
  } catch (error) {
    if (!isApiClientError(error)) throw error

    return { status: error.status, code: error.body?.error.code }
  }

  throw new Error('요청이 거절되지 않았습니다.')
}

/** 로그인하지 않은 이 스펙에서 대역이 개입자로 삼는 계정이 올린 사진 한 장. */
const ADMIN_PHOTO =
  'returns/019597a0-0007-7000-8000-0000000000a1/019597a0-0009-7000-8000-000000000001.png'

describe('전체 조회', () => {
  it('answers newest first, which is the axis the cursor rides', async () => {
    const { claims } = await list()

    expect(claims.map((claim) => claim.id)).toEqual(
      [...claims].map((claim) => claim.id).toSorted((left, right) => right.localeCompare(left)),
    )
  })

  it('narrows by seller and by pending appeal', async () => {
    const bySeller = await list(`?sellerId=${mockAdminSellerIdOf(1)}`)
    const appealed = await list('?appealed=true')

    expect(bySeller.claims.every((claim) => claim.sellerId === mockAdminSellerIdOf(1))).toBe(true)
    expect(appealed.claims.map((claim) => claim.id)).toEqual([
      mockAdminClaimIdOf(3),
      mockAdminClaimIdOf(2),
    ])
  })

  it('pages through every row exactly once', async () => {
    const all = await list()
    const walked: string[] = []
    let cursor: string | null = null

    do {
      const page: AdminClaimListResponse = await list(
        `?limit=5${cursor === null ? '' : `&cursor=${cursor}`}`,
      )

      walked.push(...page.claims.map((claim) => claim.id))
      cursor = page.nextCursor
    } while (cursor !== null)

    expect(walked).toEqual(all.claims.map((claim) => claim.id))
  })
})

describe('지연과 실패한 환불', () => {
  it('lists only the claims whose deadline has passed while they wait', async () => {
    const overdue = await client.request({
      path: '/admin/claims/overdue',
      schema: adminOverdueClaimsResponseSchema,
    })

    expect(overdue.claims.every((claim) => claim.overdue && claim.stage === 'WAITING')).toBe(true)
    expect(overdue.claims.length).toBeGreaterThan(0)
    expect(overdue.truncated).toBe(false)
  })

  it('shows the two kinds of failure a refund can be stuck in', async () => {
    const failed = await client.request({
      path: '/admin/claim-refunds/failed',
      schema: adminFailedRefundListResponseSchema,
    })

    // 다시 시도하면 사라질 실패와 사람이 손대야 할 실패. `attempts` 가 그 둘을 가른다.
    expect(failed.refunds.map((refund) => refund.attempts)).toEqual([1, 9])
  })
})

describe('클레임 하나', () => {
  /*
   * `/claims/:id` 는 구매자 대역도 여는 문이고, 기본 목록에서는 **그쪽이 먼저**
   * 등록된다. 관리자 저장소를 읽으려면 이 핸들러를 앞에 세워야 한다 — 관리자 앱의
   * 검사도 같은 한 줄로 시작한다.
   */
  beforeEach(() => {
    server.use(...adminClaimHandlers)
  })

  it('answers the admin store through `/claims/:id`, the route the console reads', async () => {
    const { claim } = await client.request({
      path: `/claims/${mockAdminClaimIdOf(2)}`,
      schema: claimResponseSchema,
    })

    // 이의가 함께 실려 온다 — 상세가 「검토 대기」를 그리는 근거가 그 값이다.
    expect({ id: claim.id, pending: claim.appeal?.reviewedAt }).toEqual({
      id: mockAdminClaimIdOf(2),
      pending: null,
    })
  })

  it('answers 404 for a claim this store never held', async () => {
    const status = await statusOfFailure(() =>
      client.request({
        path: '/claims/019597a0-0001-7000-8000-0000000000ff',
        schema: claimResponseSchema,
      }),
    )

    expect(status).toBe(404)
  })
})

describe('강제 처리는 새 클레임을 만든다', () => {
  const rejected = mockAdminClaimIdOf(2)

  async function force(): Promise<ClaimResponse> {
    return client.request({
      path: '/admin/claims',
      method: 'POST',
      body: {
        sellerOrderId: '019597a0-0004-7000-8000-000000000202',
        items: [{ orderItemId: '019597a0-0005-7000-8000-0000000002aa', quantity: 1 }],
        reason: '배송 기록이 판매자 설명과 다릅니다.',
        fault: 'SELLER',
        overturnsClaimId: rejected,
      },
      schema: claimResponseSchema,
    })
  }

  it('answers the intervention, not the rejection it overturns', async () => {
    const { claim } = await force()

    expect({ id: claim.id === rejected, overturns: claim.overturnsClaimId }).toEqual({
      id: false,
      overturns: rejected,
    })
  })

  it('closes the appeal in the same request', async () => {
    await force()

    const appealed = await list('?appealed=true')

    // 인용은 강제 처리 그 자체다 — 따로 부르는 인용 라우트가 없다.
    expect(appealed.claims.map((claim) => claim.id)).toEqual([mockAdminClaimIdOf(3)])
  })

  it('refuses to overturn a claim nobody has concluded', async () => {
    const status = await statusOfFailure(() =>
      client.request({
        path: '/admin/claims',
        method: 'POST',
        body: {
          sellerOrderId: '019597a0-0004-7000-8000-000000001212',
          items: [{ orderItemId: '019597a0-0005-7000-8000-0000000012aa', quantity: 1 }],
          reason: '개입합니다.',
          fault: 'SELLER',
          overturnsClaimId: mockAdminClaimIdOf(12),
        },
        schema: claimResponseSchema,
      }),
    )

    expect(status).toBe(409)
  })
})

describe('반품 거절을 뒤집을 때의 사진', () => {
  /**
   * **뒤집기도 신청이다.**
   *
   * 실 서버에서 관리자의 개입은 원본이 있든 없든 `ClaimService.createWith` 하나를
   * 지나고, 거기서 `returnPhotoDecision` 이 돈다. 이 갈래가 그 판정을 건너뛰던 동안
   * 「사진 없이 하자로 뒤집는」 화면이 프론트 검사를 전부 통과했고, 실 서버에서만
   * 400 `RETURN_PHOTO_REQUIRED` 를 받았다.
   */
  beforeEach(() => {
    server.use(...adminClaimHandlers)
  })

  const rejectedReturn = mockAdminClaimIdOf(3)

  async function original(): Promise<Claim> {
    const { claim } = await client.request({
      path: `/claims/${rejectedReturn}`,
      schema: claimResponseSchema,
    })

    return claim
  }

  async function overturn(details: Record<string, unknown>): Promise<ClaimResponse> {
    const claim = await original()

    return client.request({
      path: '/admin/claims',
      method: 'POST',
      body: {
        sellerOrderId: claim.sellerOrderId,
        items: claim.items.map((item) => ({
          orderItemId: item.orderItemId,
          quantity: item.quantity,
        })),
        reason: '배송 기록이 판매자 설명과 다릅니다.',
        fault: null,
        return: details,
        overturnsClaimId: claim.id,
      },
      schema: claimResponseSchema,
    })
  }

  it('refuses a defect overturn with no photo, with the code the API uses', async () => {
    expect(await refusalOf(() => overturn({ returnReason: 'DEFECTIVE', photoKeys: [] }))).toEqual({
      status: 400,
      code: 'RETURN_PHOTO_REQUIRED',
    })
  })

  /** 뒤집을 것이 없는 주장에 증거를 받지 않는다. 화면은 그래서 칸 자체를 감춘다. */
  it('refuses photos on a 단순 변심 overturn', async () => {
    expect(
      await refusalOf(() => overturn({ returnReason: 'CHANGE_OF_MIND', photoKeys: [ADMIN_PHOTO] })),
    ).toEqual({ status: 400, code: 'RETURN_PHOTO_NOT_ALLOWED' })
  })

  /**
   * **남의 열쇠는 붙일 수 없다** (`isOwnPhotoKey`).
   *
   * 관리자 개입에서 사진의 주인은 **신청을 내는 사람**이라, 구매자가 문의에 첨부한
   * 이미지를 그대로 실을 수 없다 — 운영자가 받은 사진을 자기 계정으로 다시 올려야 한다.
   */
  it('refuses a key that belongs to somebody else', async () => {
    const someoneElse =
      'returns/019597a0-0003-7000-8000-000000000303/019597a0-0009-7000-8000-000000000002.png'

    expect(
      await refusalOf(() => overturn({ returnReason: 'DEFECTIVE', photoKeys: [someoneElse] })),
    ).toEqual({ status: 400, code: 'RETURN_PHOTO_FOREIGN' })
  })

  it('stands the intervention once the photo is attached', async () => {
    const { claim } = await overturn({ returnReason: 'DEFECTIVE', photoKeys: [ADMIN_PHOTO] })

    expect({ status: claim.status, overturns: claim.overturnsClaimId }).toEqual({
      status: 'RETURN_APPROVED',
      overturns: rejectedReturn,
    })
  })
})

describe('이의', () => {
  it('files one on a rejection and refuses a second', async () => {
    const claimId = mockAdminClaimIdOf(4)
    const { claim } = await client.request({
      path: `/claims/${claimId}/appeal`,
      method: 'POST',
      body: { reason: '설명이 사실과 달라요.' },
      schema: claimResponseSchema,
    })

    expect({ status: claim.status, reviewedAt: claim.appeal?.reviewedAt }).toEqual({
      status: 'RETURN_REJECTED',
      reviewedAt: null,
    })

    const again = await statusOfFailure(() =>
      client.request({
        path: `/claims/${claimId}/appeal`,
        method: 'POST',
        body: { reason: '한 번 더.' },
        schema: claimResponseSchema,
      }),
    )

    expect(again).toBe(409)
  })

  it('refuses an appeal on a claim that is still moving', async () => {
    const status = await statusOfFailure(() =>
      client.request({
        path: `/claims/${mockAdminClaimIdOf(9)}/appeal`,
        method: 'POST',
        body: { reason: '아직 답이 없어요.' },
        schema: claimResponseSchema,
      }),
    )

    expect(status).toBe(409)
  })

  it('dismisses with a reason and leaves the claim rejected', async () => {
    const claimId = mockAdminClaimIdOf(3)
    const { claim } = await client.request({
      path: `/admin/claims/${claimId}/appeal/dismiss`,
      method: 'POST',
      body: { reason: '발송 기록이 확인되어 거절을 유지합니다.' },
      schema: claimResponseSchema,
    })

    expect({
      status: claim.status,
      outcome: claim.appeal?.outcome,
      note: claim.appeal?.reviewNote,
    }).toEqual({
      status: 'RETURN_REJECTED',
      outcome: 'DISMISSED',
      note: '발송 기록이 확인되어 거절을 유지합니다.',
    })
  })
})

/**
 * 확정 후 하자 반품 — **원본이 없는 개입** (F4).
 *
 * 위의 강제 처리와 같은 라우트를 지나고 갈리는 것은 `overturnsClaimId` 하나다. 대역이
 * 재현해야 하는 성질도 그 하나에 걸려 있다: 구매확정한 몫에서만 열리는가, 사진 없이
 * 보내면 실 서버와 같은 코드로 거절하는가, 남은 수량을 넘으면 잔여를 함께 답하는가.
 */
describe('확정 후 하자 반품', () => {
  const photo = ADMIN_PHOTO

  /**
   * **관리자 저장소를 앞에 세운다.**
   *
   * `/seller-orders/:id/claimable` 은 관리자 전용 라우트가 아니라 구매자와 같은 문이고
   * (`claim.read` 가 `any` 라서), 기본 목록에서는 구매자 대역이 먼저 등록되어 있다 —
   * `/claims/:id` 가 같은 이유로 같은 처리를 받는다.
   */
  beforeEach(() => {
    server.use(...adminClaimHandlers)
  })

  function claimable(sellerOrderId: string): Promise<ClaimableResponse> {
    return client.request({
      path: `/seller-orders/${sellerOrderId}/claimable`,
      schema: claimableResponseSchema,
    })
  }

  function file(body: Record<string, unknown>): Promise<ClaimResponse> {
    return client.request({
      path: '/admin/claims',
      method: 'POST',
      body: {
        sellerOrderId: MOCK_ADMIN_CLAIMABLE_IDS.confirmed,
        reason: '확정 뒤에 하자가 확인되었습니다.',
        return: { returnReason: 'DEFECTIVE', photoKeys: [photo] },
        overturnsClaimId: null,
        ...body,
      },
      schema: claimResponseSchema,
    })
  }

  async function firstItemOf(sellerOrderId: string): Promise<string> {
    const { items } = await claimable(sellerOrderId)
    const [first] = items

    if (first === undefined) throw new Error('항목이 없습니다.')

    return first.orderItemId
  }

  /**
   * **구매자의 판정이 온다.** 확정된 몫에 `refusal: 'confirmed'` 가 실리는 것이
   * 실 서버의 답이고(`ClaimService.claimable` 이 `claimEligibility` 로 판정한다),
   * 관리자 화면은 그 거절을 진입 조건으로 읽는다.
   */
  it('answers a confirmed share as the buyer would see it — refused, with items', async () => {
    const answer = await claimable(MOCK_ADMIN_CLAIMABLE_IDS.confirmed)

    expect({ type: answer.type, refusal: answer.refusal, items: answer.items.length }).toEqual({
      type: null,
      refusal: 'confirmed',
      items: 2,
    })
  })

  it('answers 404 for a share nobody has', async () => {
    const status = await statusOfFailure(() => claimable('019597a0-0008-7000-8000-00000000ffff'))

    expect(status).toBe(404)
  })

  it('opens an approved return on a confirmed order, with no original', async () => {
    const orderItemId = await firstItemOf(MOCK_ADMIN_CLAIMABLE_IDS.confirmed)
    const { claim } = await file({ items: [{ orderItemId, quantity: 2 }] })

    expect({
      id: claim.id,
      type: claim.type,
      status: claim.status,
      fault: claim.fault,
      overturns: claim.overturnsClaimId,
      quantity: claim.items[0]?.quantity,
    }).toEqual({
      id: MOCK_ADMIN_DEFECT_RETURN_ID,
      type: 'RETURN',
      status: 'RETURN_APPROVED',
      fault: 'SELLER',
      overturns: null,
      quantity: 2,
    })
  })

  /** 개입은 목록에도 나타난다 — 원본이 없어도 뱃지는 「관리자 개입」이다. */
  it('shows up in the queue as an intervention', async () => {
    const orderItemId = await firstItemOf(MOCK_ADMIN_CLAIMABLE_IDS.confirmed)

    await file({ items: [{ orderItemId, quantity: 1 }] })

    const { claims } = await list()
    const created = claims.find((claim) => claim.id === MOCK_ADMIN_DEFECT_RETURN_ID)

    expect({ intervention: created?.intervention, status: created?.status }).toEqual({
      intervention: true,
      status: 'RETURN_APPROVED',
    })
  })

  it('refuses a share that is not confirmed yet', async () => {
    const orderItemId = await firstItemOf(MOCK_ADMIN_CLAIMABLE_IDS.delivered)
    const status = await statusOfFailure(() =>
      file({
        sellerOrderId: MOCK_ADMIN_CLAIMABLE_IDS.delivered,
        items: [{ orderItemId, quantity: 1 }],
      }),
    )

    expect(status).toBe(409)
  })

  /**
   * 사진이 **필수**인 것은 실 서버의 규칙이다 (`returnPhotoDecision`). 여기서 받아
   * 주면 화면은 사진 없는 신청을 보내고도 모든 프론트 검사를 통과한 뒤 실 서버에서만
   * 400 을 받는다.
   */
  it('refuses a defect return with no photo, with the code the API uses', async () => {
    const orderItemId = await firstItemOf(MOCK_ADMIN_CLAIMABLE_IDS.confirmed)

    try {
      await file({
        items: [{ orderItemId, quantity: 1 }],
        return: { returnReason: 'DEFECTIVE', photoKeys: [] },
      })
    } catch (error) {
      if (!isApiClientError(error)) throw error

      expect({ status: error.status, code: error.body?.error.code }).toEqual({
        status: 400,
        code: 'RETURN_PHOTO_REQUIRED',
      })

      return
    }

    throw new Error('요청이 거절되지 않았습니다.')
  })

  it('refuses more than the share has left', async () => {
    const orderItemId = await firstItemOf(MOCK_ADMIN_CLAIMABLE_IDS.exhausted)
    const status = await statusOfFailure(() =>
      file({
        sellerOrderId: MOCK_ADMIN_CLAIMABLE_IDS.exhausted,
        items: [{ orderItemId, quantity: 1 }],
      }),
    )

    expect(status).toBe(409)
  })
})
