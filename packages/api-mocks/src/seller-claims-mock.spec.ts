/**
 * 판매자 클레임 대역이 재현한다고 말하는 것을, 대역 자신에 대고 잰다 (TASK-0070).
 *
 * 이 파일이 있는 이유는 화면의 검사가 이 대역을 **믿고** 통과하기 때문이다.
 * 「처리 대기가 먼저 온다」를 화면 검사에서 확인해 봐야, 그 확인은 대역이 정말
 * 그렇게 답할 때만 값을 한다 — 대역이 id 순으로만 답하면 화면은 정렬을 아예 하지
 * 않으면서 초록이 되고, 실 서버 앞에서만 어긋난다.
 *
 * 모든 호출이 `createApiClient` 를 지난다. 응답은 계약 스키마로 파싱된 뒤에야
 * 도착하므로, **아래의 성공 하나하나가 곧 「계약을 지났다」의 증거**다 (C1 · C2).
 */

import type {
  ClaimTransitionResponse,
  ReturnResponse,
  SellerClaimDetailResponse,
  SellerClaimListResponse,
  SellerClaimSummaryResponse,
} from '@shopping/shared'
import {
  claimHandlingStages,
  claimTransitionResponseSchema,
  createApiClient,
  isApiClientError,
  returnResponseSchema,
  sellerClaimDetailResponseSchema,
  sellerClaimListResponseSchema,
  sellerClaimSummaryResponseSchema,
} from '@shopping/shared'
import { beforeEach, describe, expect, it } from 'vitest'

import { sellerClaimDetail, sellerClaimPage, sellerClaimSummary } from './fixtures/seller-claims'
import {
  MOCK_SELLER_CLAIM_IDS,
  MOCK_SELLER_CLAIM_STAGES,
  resetSellerClaimStore,
  sellerClaimSnapshot,
} from './handlers'
import { setupTestServer } from './node'

setupTestServer()

const client = createApiClient({ appId: 'seller', baseUrl: 'http://api.test.invalid' })

const list = (search = ''): Promise<SellerClaimListResponse> =>
  client.request({ path: `/seller-claims${search}`, schema: sellerClaimListResponseSchema })

const summary = (): Promise<SellerClaimSummaryResponse> =>
  client.request({ path: '/seller-claims/summary', schema: sellerClaimSummaryResponseSchema })

const detailOf = (id: string): Promise<SellerClaimDetailResponse> =>
  client.request({ path: `/seller-claims/${id}`, schema: sellerClaimDetailResponseSchema })

const transition = (id: string, to: string, reason?: string): Promise<ClaimTransitionResponse> =>
  client.request({
    path: `/claims/${id}/transitions`,
    method: 'POST',
    body: reason === undefined ? { to } : { to, reason },
    schema: claimTransitionResponseSchema,
  })

const pickUp = (id: string): Promise<ReturnResponse> =>
  client.request({
    path: `/returns/${id}/pickup`,
    method: 'POST',
    body: {},
    schema: returnResponseSchema,
  })

const inspect = (id: string, passed: boolean, note?: string): Promise<ReturnResponse> =>
  client.request({
    path: `/returns/${id}/inspection`,
    method: 'POST',
    body: note === undefined ? { passed } : { passed, note },
    schema: returnResponseSchema,
  })

/** 거절을 값으로. 성공하면 `null` 이라 「거절되지 않았다」도 같은 자리에서 잰다. */
async function refusalOf(call: Promise<unknown>) {
  return call.then(
    () => null,
    (error: unknown) =>
      isApiClientError(error)
        ? { code: error.code, details: error.details, status: error.status }
        : null,
  )
}

/** 자리로 클레임 id. 검사마다 uuid 를 베껴 적지 않으려고 있다. */
function claimId(index: number): string {
  const id = MOCK_SELLER_CLAIM_IDS[index]

  if (id === undefined) throw new Error(`${String(index)} 번 클레임이 없다`)

  return id
}

/**
 * 커서를 끝까지 따라가며 모든 줄을 모은다.
 *
 * **한 페이지에 다 들어가지 않게** 좁은 `limit` 으로 부른다. 기본 한 페이지(20)로
 * 부르면 열 줄이 한 번에 오고, 그때 커서는 아무 일도 하지 않으면서 검사가 통과한다.
 */
async function walk(limit: number, filter = ''): Promise<readonly string[]> {
  const seen: string[] = []
  let cursor: string | null = null

  // 열 줄을 `limit` 으로 나눈 것보다 넉넉히 돈다. 무한 반복은 커서가 제자리를
  // 가리킬 때 생기고, 그것을 검사가 매달리는 대신 실패로 잡아야 한다.
  for (let page = 0; page < 20; page += 1) {
    const query: string = cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`
    const answer: SellerClaimListResponse = await list(`?limit=${String(limit)}${filter}${query}`)

    seen.push(...answer.claims.map((claim) => claim.id))
    cursor = answer.nextCursor
    if (cursor === null) return seen
  }

  throw new Error('커서가 끝나지 않는다')
}

/** 이 목록의 단계 순위들. 비내림차순이면 「대기 먼저」가 지켜진 것이다. */
const ranksOf = (claims: SellerClaimListResponse['claims']): readonly number[] =>
  claims.map((claim) => claimHandlingStages.indexOf(claim.stage))

beforeEach(() => {
  resetSellerClaimStore()
})

describe('판매자 클레임 픽스처', () => {
  it('단계 셋을 전부 채운다', () => {
    const stages = new Set(sellerClaimPage.claims.map((claim) => claim.stage))

    expect([...stages].sort()).toEqual([...claimHandlingStages].sort())
  })

  it('취소와 반품이 섞여 있다', () => {
    const types = new Set(sellerClaimPage.claims.map((claim) => claim.type))

    expect([...types].sort()).toEqual(['CANCEL', 'RETURN'])
  })

  it('id 순서와 단계가 어긋나 있다', () => {
    // 나란히 두면 「단계 순위, id」 정렬이 「id」 정렬과 같은 답을 내고, 그때 정렬을
    // 아예 구현하지 않은 목도 아래의 검사를 통과한다.
    const byId = [...sellerClaimPage.claims].sort((left, right) => left.id.localeCompare(right.id))

    expect(byId.at(0)?.stage).toBe('CLOSED')
    expect(byId.at(-1)?.stage).toBe('WAITING')
  })

  it('대기 건에 지연된 것과 아직 기한 안인 것이 둘 다 있다', () => {
    const waiting = sellerClaimPage.claims.filter((claim) => claim.stage === 'WAITING')

    expect(waiting.some((claim) => claim.overdue)).toBe(true)
    expect(waiting.some((claim) => !claim.overdue)).toBe(true)
  })

  it('단계는 상태에서 나온다', () => {
    for (const claim of sellerClaimPage.claims) {
      expect(claim.stage).toBe(MOCK_SELLER_CLAIM_STAGES[claim.status])
    }
  })
})

describe('목록의 순서', () => {
  it('처리 대기가 먼저 온다', async () => {
    const page = await list()
    const ranks = ranksOf(page.claims)

    // 앞에서부터 대기가 끊긴 뒤에 다시 나오면 안 된다 — 순위가 비내림차순이어야 한다.
    expect([...ranks].sort((left, right) => left - right)).toEqual(ranks)
    expect(page.claims.at(0)?.stage).toBe('WAITING')
  })

  it('대기 안에서는 오래된 것이 먼저 온다', async () => {
    const waiting = (await list('?stage=WAITING')).claims
    const requestedAt = waiting.map((claim) => claim.requestedAt)

    expect(waiting.length).toBeGreaterThan(1)
    // 사전순이 곧 시간순이다 — 밀리초까지 적힌 `Z` 시각이라 그렇다.
    expect([...requestedAt].sort()).toEqual(requestedAt)
  })

  it('지연된 건이 대기 탭 맨 위에 모인다', async () => {
    const waiting = (await list('?stage=WAITING')).claims
    const overdue = waiting.map((claim) => claim.overdue)
    const firstOnTime = overdue.indexOf(false)

    expect(waiting.at(0)?.overdue).toBe(true)
    // 기한 안인 건이 처음 나온 뒤로는 지연이 다시 나오지 않는다. 기한이 신청 시각의
    // 단조 증가 함수이므로, 「오래된 것이 먼저」가 곧 「기한 임박 순」이다.
    expect(overdue.slice(firstOnTime).includes(true)).toBe(false)
  })
})

describe('커서', () => {
  it('끝까지 넘겨도 중복 0 · 누락 0', async () => {
    const seen = await walk(3)
    const all = sellerClaimPage.claims.map((claim) => claim.id)

    expect(seen).toHaveLength(all.length)
    expect(new Set(seen).size).toBe(all.length)
    expect([...seen].sort()).toEqual([...all].sort())
  })

  it('넘긴 순서가 첫 페이지의 순서와 이어진다', async () => {
    expect(await walk(3)).toEqual(sellerClaimPage.claims.map((claim) => claim.id))
  })

  it('필터를 걸고 넘겨도 그 안에서 전수를 돈다', async () => {
    const returns = sellerClaimPage.claims.filter((claim) => claim.type === 'RETURN')

    expect(await walk(2, '&type=RETURN')).toEqual(returns.map((claim) => claim.id))
  })

  it('서버와 같은 인코딩이다 — base64url("<단계순위>.<uuid>")', async () => {
    const page = await list('?limit=3')
    const last = page.claims.at(-1)

    expect(page.nextCursor).not.toBeNull()
    expect(Buffer.from(page.nextCursor ?? '', 'base64url').toString('utf8')).toBe(
      `${String(claimHandlingStages.indexOf(last?.stage ?? 'WAITING'))}.${last?.id ?? ''}`,
    )
  })

  it('마지막 페이지에는 커서가 없다', async () => {
    expect((await list('?limit=50')).nextCursor).toBeNull()
  })

  it('모양이 아닌 커서는 400 이다', async () => {
    // 조용히 첫 페이지로 되돌리면 화면이 「1페이지를 무한히 반복」하고, 그 증상은
    // 아무 오류도 내지 않는다.
    const refusal = await refusalOf(list('?cursor=bm90LWEtY3Vyc29y'))

    expect(refusal).toMatchObject({ status: 400, code: 'INVALID' })
    expect(refusal?.details[0]).toMatchObject({ field: 'cursor' })
  })
})

describe('필터', () => {
  it('단계로 좁힌다', async () => {
    const closed = await list('?stage=CLOSED')

    expect(closed.claims.length).toBeGreaterThan(0)
    expect(closed.claims.every((claim) => claim.stage === 'CLOSED')).toBe(true)
  })

  it('유형으로 좁힌다', async () => {
    const cancels = await list('?type=CANCEL')

    expect(cancels.claims.length).toBeGreaterThan(0)
    expect(cancels.claims.every((claim) => claim.type === 'CANCEL')).toBe(true)
  })

  it('상태로 좁힌다 — 쉼표 하나가 문법이다', async () => {
    const answer = await list('?status=CANCEL_REQUESTED,RETURN_REQUESTED')

    expect(answer.claims.map((claim) => claim.status).sort()).toEqual([
      'CANCEL_REQUESTED',
      'RETURN_REQUESTED',
    ])
  })

  it('탭과 상태를 함께 걸면 둘 다 적용된다', async () => {
    const answer = await list('?stage=CLOSED&status=CANCEL_REQUESTED')

    expect(answer.claims).toEqual([])
  })
})

describe('뱃지', () => {
  it('처음에는 픽스처와 같은 숫자를 답한다', async () => {
    expect((await summary()).summary).toEqual(sellerClaimSummary.summary)
  })

  it('0건인 상태도 0을 갖는다', async () => {
    const { counts } = (await summary()).summary

    // 안 채우면 화면이 「아직 못 읽었다」와 「0건이다」를 구분할 수 없다.
    expect(counts.RETURN_APPROVED).toBeGreaterThan(0)
    expect(Object.values(counts).every((count) => count >= 0)).toBe(true)
  })
})

describe('상세', () => {
  it('픽스처와 같은 답을 준다', async () => {
    expect(await detailOf(sellerClaimDetail.claim.claim.id)).toEqual(sellerClaimDetail)
  })

  it('버튼과 문을 서버가 정한다', async () => {
    const { claim } = await detailOf(claimId(5))

    // 수거는 전이 라우트가 아니라 자기 문으로 간다 — 그쪽으로 밀면 상태만 옮겨지고
    // 회수 운송장이 나지 않는다.
    expect(claim.actions).toEqual([{ to: 'PICKING_UP', route: 'pickup', requiresReason: false }])
  })

  it('거절에만 사유가 필수라고 답한다', async () => {
    const { claim } = await detailOf(claimId(1))

    expect(claim.actions).toEqual([
      { to: 'CANCEL_APPROVED', route: 'transition', requiresReason: false },
      { to: 'CANCEL_REJECTED', route: 'transition', requiresReason: true },
    ])
  })

  it('종착에는 밟을 걸음이 없다', async () => {
    expect((await detailOf(claimId(0))).claim.actions).toEqual([])
  })

  it('취소에는 반품 부속이 없다', async () => {
    expect((await detailOf(claimId(1))).claim.return).toBeNull()
  })

  it('없는 클레임은 404 다', async () => {
    expect(await refusalOf(detailOf('01937c00-0000-7000-8000-00000000cc99'))).toMatchObject({
      status: 404,
    })
  })
})

describe('승인과 거절', () => {
  it('승인하면 그 줄이 옮겨지고 대기가 줄어든다', async () => {
    const before = (await summary()).summary.waiting
    const answer = await transition(claimId(1), 'CANCEL_APPROVED')

    expect(answer.changed).toBe(true)
    expect(answer.claim.status).toBe('CANCEL_APPROVED')
    // 저장소가 실제로 바뀌었는가 — 답만 바꾸고 줄을 그대로 두면 다음 목록이 옛말을
    // 한다.
    expect(sellerClaimSnapshot().find((item) => item.id === claimId(1))).toMatchObject({
      status: 'CANCEL_APPROVED',
      stage: 'IN_PROGRESS',
    })
    expect((await summary()).summary.waiting).toBe(before - 1)
  })

  it('거절 사유 없이 거절하면 400 이다', async () => {
    const refusal = await refusalOf(transition(claimId(1), 'CANCEL_REJECTED'))

    expect(refusal).toMatchObject({ status: 400, code: 'CLAIM_REASON_REQUIRED' })
    expect(refusal?.details[0]).toMatchObject({ field: 'reason' })
    // **거절된 요청은 아무것도 바꾸지 않는다.**
    expect(sellerClaimSnapshot().find((item) => item.id === claimId(1))?.status).toBe(
      'CANCEL_REQUESTED',
    )
  })

  it('사유를 적으면 거절되고 이력에 그 문장이 남는다', async () => {
    const answer = await transition(
      claimId(3),
      'RETURN_REJECTED',
      '사용감이 있어 받아드리기 어려워요.',
    )

    expect(answer.claim.status).toBe('RETURN_REJECTED')
    expect(answer.claim.history.at(-1)).toMatchObject({
      toStatus: 'RETURN_REJECTED',
      reason: '사용감이 있어 받아드리기 어려워요.',
      actor: 'SELLER',
    })
  })

  it('이미 그 상태면 아무 일도 하지 않고 성공한다', async () => {
    await transition(claimId(1), 'CANCEL_APPROVED')

    const again = await transition(claimId(1), 'CANCEL_APPROVED')

    // 재시도한 화면에 오류를 보이는 것은, 그 사람이 원한 결과가 이미 이뤄져 있는데
    // 실패했다고 말하는 것이다.
    expect(again.changed).toBe(false)
  })

  it('정의되지 않은 걸음은 409 다', async () => {
    expect(await refusalOf(transition(claimId(1), 'REFUNDED'))).toMatchObject({
      status: 409,
      code: 'CLAIM_TRANSITION_UNDEFINED',
    })
  })
})

describe('수거와 검수', () => {
  it('수거를 시작하면 회수 운송장이 함께 난다', async () => {
    const answer = await pickUp(claimId(5))

    expect(answer.claim.status).toBe('PICKING_UP')
    expect(answer.return.shipments.at(0)).toMatchObject({ direction: 'PICKUP' })
    expect((await detailOf(claimId(5))).claim.return?.pickupTrackingNumber).toBe(
      answer.return.shipments.at(0)?.trackingNumber,
    )
  })

  it('취소 신청에 수거를 부르면 라우트가 틀렸다고 답한다', async () => {
    const refusal = await refusalOf(pickUp(claimId(1)))

    expect(refusal).toMatchObject({ status: 400, code: 'CLAIM_TRANSITION_UNDEFINED' })
    expect(refusal?.details[0]).toMatchObject({ field: 'claimId' })
  })

  it('아직 승인되지 않은 반품에 수거를 부르면 409 다', async () => {
    expect(await refusalOf(pickUp(claimId(3)))).toMatchObject({
      status: 409,
      code: 'CLAIM_TRANSITION_UNDEFINED',
    })
  })

  it('검수에 합격하면 반품완료로 옮겨진다', async () => {
    const answer = await inspect(claimId(9), true)

    expect(answer.claim.status).toBe('RETURN_COMPLETED')
    expect(answer.return.inspection).toMatchObject({ passed: true })
    expect(sellerClaimSnapshot().find((item) => item.id === claimId(9))?.stage).toBe('IN_PROGRESS')
  })

  it('불합격에 사유가 없으면 400 이다', async () => {
    const refusal = await refusalOf(inspect(claimId(9), false))

    // 붙는 자리가 `reason` 이 아니라 `note` 다 — 이 요청에 `reason` 이라는 칸이 없어
    // 그 이름으로 답하면 화면은 오류를 어느 입력에도 놓지 못한다.
    expect(refusal).toMatchObject({ status: 400, code: 'CLAIM_REASON_REQUIRED' })
    expect(refusal?.details[0]).toMatchObject({ field: 'note' })
    expect(sellerClaimSnapshot().find((item) => item.id === claimId(9))?.status).toBe('INSPECTING')
  })

  it('불합격은 반송이다', async () => {
    const answer = await inspect(claimId(9), false, '사용한 흔적이 있어요.')

    expect(answer.claim.status).toBe('RETURN_REJECTED')
    expect(answer.return.shipments.some((shipment) => shipment.direction === 'SEND_BACK')).toBe(
      true,
    )
    // 검수 결과와 전이 사유가 한 사실이다 — 분쟁에서 읽히는 것은 이력이다.
    expect(answer.claim.history.at(-1)?.reason).toBe('사용한 흔적이 있어요.')
  })
})

describe('저장소는 스펙마다 처음으로 돌아온다', () => {
  it('앞 검사가 옮긴 줄이 넘어오지 않는다', async () => {
    // 넘어오면 「대기 5건」이 앞 스펙의 「4건」이 되고, 파일 안의 순서가 통과 여부를
    // 정한다.
    expect((await summary()).summary).toEqual(sellerClaimSummary.summary)
  })
})
