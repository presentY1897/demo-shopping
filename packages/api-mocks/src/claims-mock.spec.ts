/**
 * 클레임 대역이 재현한다고 말하는 것을, 대역 자신에 대고 잰다 (TASK-0066).
 *
 * 이 파일이 있는 이유는 화면의 검사가 이 대역을 **믿고** 통과하기 때문이다.
 * 「세 개 중 하나를 걸면 잔여가 둘이 된다」를 화면 검사에서 확인해 봐야, 그 확인은
 * 대역이 정말 그렇게 답할 때만 값을 한다 — 대역이 잔여를 그대로 두면 화면은 틀린
 * 일을 하면서 초록이 되고, 실 서버 앞에서만 무너진다.
 *
 * 모든 호출이 `createApiClient` 를 지난다. 응답은 계약 스키마로 파싱된 뒤에야
 * 도착하므로, **아래의 성공 하나하나가 곧 「계약을 지났다」의 증거**다 (C1 · C2).
 */

import type {
  ClaimableResponse,
  ClaimItemInput,
  ClaimResponse,
  ReturnReason,
} from '@shopping/shared'
import {
  claimableResponseSchema,
  claimResponseSchema,
  createApiClient,
  isApiClientError,
  RETURN_PHOTO_MAX_COUNT,
} from '@shopping/shared'
import { beforeEach, describe, expect, it } from 'vitest'

import { shopperPaidClaimable, shopperWindowClosedClaimable } from './fixtures/claims'
import { sessionBuyer } from './fixtures/session'
import {
  failNextClaim,
  MOCK_CLAIM_ID,
  MOCK_CLAIM_RETURN_WINDOW_ENDS_AT,
  MOCK_CLAIM_SELLER_ORDER_IDS,
  MOCK_ORDER_NOW,
  resetClaimStore,
} from './handlers'
import { setupTestServer } from './node'

setupTestServer()

const client = createApiClient({ appId: 'shop', baseUrl: 'http://api.test.invalid' })

const claimable = (sellerOrderId: string): Promise<ClaimableResponse> =>
  client.request({
    path: `/seller-orders/${sellerOrderId}/claimable`,
    schema: claimableResponseSchema,
  })

const create = (sellerOrderId: string, items: readonly ClaimItemInput[]): Promise<ClaimResponse> =>
  client.request({
    path: '/claims',
    method: 'POST',
    body: { sellerOrderId, items, reason: '사이즈를 잘못 골랐어요.', fault: 'CUSTOMER' },
    schema: claimResponseSchema,
  })

/** 반품 사진 한 장의 열쇠. 접두어가 곧 소유자다 (`returnPhotoKeyPattern`). */
const PHOTO_KEY = `returns/${sessionBuyer.user.id}/0192f0c2-0000-7000-8000-00000000abcd.png`

/**
 * 같은 라우트에 **반품의 부속**을 실어 보낸다 (TASK-0067).
 *
 * 취소와 반품이 한 계약이고, 다른 것은 「귀책을 싣느냐 사유를 싣느냐」뿐이다
 * (`createClaimRequestSchema`).
 */
const createReturn = (
  sellerOrderId: string,
  items: readonly ClaimItemInput[],
  returnReason: ReturnReason = 'CHANGE_OF_MIND',
  photoKeys: readonly string[] = [],
): Promise<ClaimResponse> =>
  client.request({
    path: '/claims',
    method: 'POST',
    body: {
      sellerOrderId,
      items,
      reason: '받아 보니 색이 달라요.',
      return: { returnReason, photoKeys },
    },
    schema: claimResponseSchema,
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

/** 이 몫에서 이 수량의 줄을 찾는다. 항목 id 를 검사마다 베껴 적지 않으려고 있다. */
async function lineWithQuantity(sellerOrderId: string, quantity: number): Promise<string> {
  const { items } = await claimable(sellerOrderId)
  const found = items.find((item) => item.quantity === quantity)

  if (found === undefined) throw new Error(`${sellerOrderId} 에 ${quantity}개짜리 줄이 없다`)

  return found.orderItemId
}

beforeEach(() => {
  resetClaimStore()
})

describe('클레임 픽스처', () => {
  it('결제완료 몫의 세 줄이 수량 1 · 2 · 3 이다', () => {
    // 전부 1이면 「세 줄 중 하나」와 「그 줄의 두 개 중 하나」가 화면에서 같은
    // 조작이 되고, 부분 취소를 잴 자리가 없어진다 (D-027).
    expect(shopperPaidClaimable.items.map((item) => item.quantity)).toEqual([1, 2, 3])
  })

  it('두 기간이 「지금」의 양쪽에 있다', () => {
    const closed = shopperWindowClosedClaimable.returnWindowEndsAt

    // 기간이 지났어도 값은 실린다 — 화면이 「언제까지였는지」를 말해야 한다.
    expect(closed).not.toBeNull()
    // 사전순이 곧 시간순이다. 양쪽 다 밀리초까지 적힌 `Z` 시각이라 그렇다.
    expect(closed !== null && closed < MOCK_ORDER_NOW).toBe(true)
    expect(MOCK_ORDER_NOW < MOCK_CLAIM_RETURN_WINDOW_ENDS_AT).toBe(true)
  })
})

describe('「무엇을 신청할 수 있나」는 주문 상태가 정한다', () => {
  it.each([
    [MOCK_CLAIM_SELLER_ORDER_IDS.paid, 'CANCEL', null],
    [MOCK_CLAIM_SELLER_ORDER_IDS.preparing, 'CANCEL', null],
    [MOCK_CLAIM_SELLER_ORDER_IDS.delivered, 'RETURN', null],
    [MOCK_CLAIM_SELLER_ORDER_IDS.shipped, null, 'in_transit'],
    [MOCK_CLAIM_SELLER_ORDER_IDS.confirmed, null, 'confirmed'],
    [MOCK_CLAIM_SELLER_ORDER_IDS.canceled, null, 'not_claimable'],
    [MOCK_CLAIM_SELLER_ORDER_IDS.windowClosed, null, 'window_closed'],
  ])('%s 는 %s · %s 로 답한다', async (sellerOrderId, type, refusal) => {
    const answer = await claimable(sellerOrderId)

    expect(answer.type).toBe(type)
    expect(answer.refusal).toBe(refusal)
  })

  it('반품 기간의 끝은 반품 경로에서만 실린다', async () => {
    // 화면이 D+7 을 더해 만든 값이 아니라 **서버가 준 값**을 그리는지는 이 리터럴과
    // 비교해야만 드러난다.
    await expect(claimable(MOCK_CLAIM_SELLER_ORDER_IDS.delivered)).resolves.toMatchObject({
      returnWindowEndsAt: MOCK_CLAIM_RETURN_WINDOW_ENDS_AT,
    })
    await expect(claimable(MOCK_CLAIM_SELLER_ORDER_IDS.paid)).resolves.toMatchObject({
      returnWindowEndsAt: null,
    })
  })

  it('모르는 묶음에는 404 로 답한다', async () => {
    const refusal = await refusalOf(claimable('019596d0-1f1c-7c2e-9a0e-6d0000009999'))

    expect(refusal?.status).toBe(404)
  })
})

describe('신청하면 잔여가 줄어든다', () => {
  it('다시 물으면 줄어든 값이 온다', async () => {
    const orderItemId = await lineWithQuantity(MOCK_CLAIM_SELLER_ORDER_IDS.paid, 3)

    await create(MOCK_CLAIM_SELLER_ORDER_IDS.paid, [{ orderItemId, quantity: 1 }])

    const { items } = await claimable(MOCK_CLAIM_SELLER_ORDER_IDS.paid)
    const line = items.find((item) => item.orderItemId === orderItemId)

    // 화면이 빼서 계산하지 않게 하려고 서버가 주는 값이다 (F8).
    expect(line).toMatchObject({ quantity: 3, claimedQuantity: 1, remainingQuantity: 2 })
  })

  it('같은 몫의 다른 줄은 그대로다', async () => {
    const three = await lineWithQuantity(MOCK_CLAIM_SELLER_ORDER_IDS.paid, 3)
    const two = await lineWithQuantity(MOCK_CLAIM_SELLER_ORDER_IDS.paid, 2)

    await create(MOCK_CLAIM_SELLER_ORDER_IDS.paid, [{ orderItemId: three, quantity: 3 }])

    const { items } = await claimable(MOCK_CLAIM_SELLER_ORDER_IDS.paid)

    expect(items.find((item) => item.orderItemId === two)?.remainingQuantity).toBe(2)
  })

  it('리셋하면 잡아 둔 수량까지 함께 놓는다', async () => {
    const orderItemId = await lineWithQuantity(MOCK_CLAIM_SELLER_ORDER_IDS.paid, 2)

    await create(MOCK_CLAIM_SELLER_ORDER_IDS.paid, [{ orderItemId, quantity: 2 }])
    resetClaimStore()

    const { items } = await claimable(MOCK_CLAIM_SELLER_ORDER_IDS.paid)

    expect(items.find((item) => item.orderItemId === orderItemId)?.remainingQuantity).toBe(2)
  })
})

describe('수량이 맞지 않는 신청', () => {
  it('남은 것보다 많으면 지금의 잔여를 달고 거절된다', async () => {
    const orderItemId = await lineWithQuantity(MOCK_CLAIM_SELLER_ORDER_IDS.paid, 3)

    await create(MOCK_CLAIM_SELLER_ORDER_IDS.paid, [{ orderItemId, quantity: 2 }])

    const refusal = await refusalOf(
      create(MOCK_CLAIM_SELLER_ORDER_IDS.paid, [{ orderItemId, quantity: 2 }]),
    )

    expect(refusal?.status).toBe(409)
    expect(refusal?.code).toBe('CLAIM_EXCEEDS_REMAINING')
    // 「신청할 수 없습니다」로 끝나는 화면은 이 사람에게 아무것도 알려 주지 않는다.
    expect(refusal?.details[0]).toMatchObject({ field: 'items', params: { remaining: 1 } })
  })

  it('0개는 400 이다', async () => {
    const orderItemId = await lineWithQuantity(MOCK_CLAIM_SELLER_ORDER_IDS.paid, 1)
    const refusal = await refusalOf(
      create(MOCK_CLAIM_SELLER_ORDER_IDS.paid, [{ orderItemId, quantity: 0 }]),
    )

    expect(refusal?.status).toBe(400)
    expect(refusal?.code).toBe('CLAIM_INVALID_QUANTITY')
    expect(refusal?.details[0]).toMatchObject({ field: 'items' })
  })

  it('이 주문에 없는 항목은 상태 판단보다 먼저 걸린다', async () => {
    const refusal = await refusalOf(
      create(MOCK_CLAIM_SELLER_ORDER_IDS.shipped, [
        { orderItemId: '019596d0-1f1c-7c2e-9a0e-6b0000009999', quantity: 1 },
      ]),
    )

    expect(refusal?.status).toBe(400)
    expect(refusal?.code).toBe('CLAIM_ITEM_MISSING')
  })
})

describe('거절의 순서는 사람에게 할 말의 순서다', () => {
  it('배송 중인 주문에 0개를 신청하면 「배송 중」이라고 답한다', async () => {
    // 「수량이 올바르지 않다」를 받은 사람은 수량을 고쳐 다시 시도하고, 또 거절당한다.
    const orderItemId = await lineWithQuantity(MOCK_CLAIM_SELLER_ORDER_IDS.shipped, 1)
    const refusal = await refusalOf(
      create(MOCK_CLAIM_SELLER_ORDER_IDS.shipped, [{ orderItemId, quantity: 0 }]),
    )

    expect(refusal?.code).toBe('CLAIM_IN_TRANSIT')
  })

  it.each([
    [MOCK_CLAIM_SELLER_ORDER_IDS.confirmed, 'CLAIM_ORDER_CONFIRMED'],
    [MOCK_CLAIM_SELLER_ORDER_IDS.canceled, 'CLAIM_NOT_CLAIMABLE'],
    [MOCK_CLAIM_SELLER_ORDER_IDS.windowClosed, 'CLAIM_WINDOW_CLOSED'],
  ])('%s 는 %s 로 거절한다', async (sellerOrderId, code) => {
    const orderItemId = await lineWithQuantity(sellerOrderId, 1)
    const refusal = await refusalOf(create(sellerOrderId, [{ orderItemId, quantity: 1 }]))

    expect(refusal?.status).toBe(409)
    expect(refusal?.code).toBe(code)
  })
})

describe('신청이 태어나는 자리는 몫의 상태가 정한다', () => {
  it('결제완료는 자동으로 승인된 채 태어난다', async () => {
    const orderItemId = await lineWithQuantity(MOCK_CLAIM_SELLER_ORDER_IDS.paid, 1)
    const { claim } = await create(MOCK_CLAIM_SELLER_ORDER_IDS.paid, [{ orderItemId, quantity: 1 }])

    expect(claim.id).toBe(MOCK_CLAIM_ID)
    expect(claim.type).toBe('CANCEL')
    // 판매자가 아직 아무것도 하지 않았다 — 승인을 기다릴 이유가 없다 (TASK-0066 4장).
    expect(claim.status).toBe('CANCEL_APPROVED')
    expect(
      claim.history.map((entry) => [entry.toStatus, entry.actor, entry.actorId === null]),
    ).toEqual([
      ['CANCEL_REQUESTED', 'BUYER', false],
      // 사람이 없는 전이라 `actorId` 가 비고, 그 사실이 `actor` 에 남는다.
      ['CANCEL_APPROVED', 'SYSTEM', true],
    ])
  })

  it('상품준비중은 판매자 승인을 기다린다', async () => {
    const orderItemId = await lineWithQuantity(MOCK_CLAIM_SELLER_ORDER_IDS.preparing, 1)
    const { claim } = await create(MOCK_CLAIM_SELLER_ORDER_IDS.preparing, [
      { orderItemId, quantity: 1 },
    ])

    expect(claim.type).toBe('CANCEL')
    expect(claim.status).toBe('CANCEL_REQUESTED')
    expect(claim.history).toHaveLength(1)
  })

  it('배송완료는 반품으로 태어난다', async () => {
    const orderItemId = await lineWithQuantity(MOCK_CLAIM_SELLER_ORDER_IDS.delivered, 2)
    const { claim } = await createReturn(MOCK_CLAIM_SELLER_ORDER_IDS.delivered, [
      { orderItemId, quantity: 1 },
    ])

    expect(claim.type).toBe('RETURN')
    expect(claim.status).toBe('RETURN_REQUESTED')
  })

  /**
   * **귀책은 사유에서 접힌다** (`returnFaultOf`).
   *
   * 요청에 그 값이 없으므로 대역이 접지 않으면 답에 실을 것이 없고, 임의로 고르면
   * 화면은 실 서버가 절대 주지 않는 조합 — 「오배송인데 구매자 귀책」 — 을 그린다.
   */
  it.each([
    ['CHANGE_OF_MIND', 'CUSTOMER'],
    ['DEFECTIVE', 'SELLER'],
    ['WRONG_ITEM', 'SELLER'],
  ] as const)('%s 반품의 귀책은 %s 다', async (returnReason, fault) => {
    const orderItemId = await lineWithQuantity(MOCK_CLAIM_SELLER_ORDER_IDS.delivered, 2)
    const { claim } = await createReturn(
      MOCK_CLAIM_SELLER_ORDER_IDS.delivered,
      [{ orderItemId, quantity: 1 }],
      returnReason,
      returnReason === 'CHANGE_OF_MIND' ? [] : [PHOTO_KEY],
    )

    expect(claim.fault).toBe(fault)
  })

  it('환불액은 언제나 0 이다', async () => {
    const orderItemId = await lineWithQuantity(MOCK_CLAIM_SELLER_ORDER_IDS.paid, 2)
    const { claim } = await create(MOCK_CLAIM_SELLER_ORDER_IDS.paid, [{ orderItemId, quantity: 2 }])

    // 「0원을 돌려준다」가 아니라 「아직 계산하지 않았다」다 (TASK-0068).
    expect(claim.items.map((item) => item.refundAmount)).toEqual([0])
    expect(claim.items[0]).toMatchObject({ orderItemId, quantity: 2 })
  })
})

/**
 * 계약이 합쳐진 뒤 이 라우트가 **만들 수 없게 된 것들** (TASK-0067).
 *
 * 대역이 여기서 받아 주면 화면은 프론트 검사를 전부 통과한 뒤 **실 서버에서만**
 * 거절당한다 — 모킹의 대가를 계약 게이트로 갚는다는 것이 이 뜻이다.
 */
describe('경로와 부속이 맞아야 한다', () => {
  it('반품 경로에 귀책만 보내면 거절한다', async () => {
    const orderItemId = await lineWithQuantity(MOCK_CLAIM_SELLER_ORDER_IDS.delivered, 2)

    await expect(
      refusalOf(create(MOCK_CLAIM_SELLER_ORDER_IDS.delivered, [{ orderItemId, quantity: 1 }])),
    ).resolves.toMatchObject({ status: 409, code: 'CLAIM_NOT_CLAIMABLE' })
  })

  it('취소 경로에 반품 사유를 보내면 거절한다', async () => {
    const orderItemId = await lineWithQuantity(MOCK_CLAIM_SELLER_ORDER_IDS.paid, 1)

    await expect(
      refusalOf(createReturn(MOCK_CLAIM_SELLER_ORDER_IDS.paid, [{ orderItemId, quantity: 1 }])),
    ).resolves.toMatchObject({ status: 409, code: 'CLAIM_NOT_CLAIMABLE' })
  })

  /** 근거 없이 판매자에게 돈을 물릴 수 없다. 화면이 먼저 막지만 문은 여기 있다. */
  it('하자 반품에 사진이 없으면 그 코드로 거절한다', async () => {
    const orderItemId = await lineWithQuantity(MOCK_CLAIM_SELLER_ORDER_IDS.delivered, 2)

    await expect(
      refusalOf(
        createReturn(
          MOCK_CLAIM_SELLER_ORDER_IDS.delivered,
          [{ orderItemId, quantity: 1 }],
          'DEFECTIVE',
        ),
      ),
    ).resolves.toMatchObject({ status: 400, code: 'RETURN_PHOTO_REQUIRED' })
  })

  /**
   * 상한은 **계약이 아니라 규칙**이 갖는다.
   *
   * 계약에 같은 숫자를 두면 여섯 번째 장이 이름 없는 필드 오류가 되고, 그 답은 사유를
   * 고쳐야 하는 사람과 한 장을 빼면 되는 사람을 구분하지 못한다 — 화면이 「N장까지」로
   * 바꿔 말할 수 있으려면 `params.max` 가 실려 와야 한다.
   */
  it('상한을 넘긴 사진은 몇 장까지인지 함께 답한다', async () => {
    const orderItemId = await lineWithQuantity(MOCK_CLAIM_SELLER_ORDER_IDS.delivered, 2)
    const keys = Array.from(
      { length: RETURN_PHOTO_MAX_COUNT + 1 },
      (_, index) =>
        `returns/${sessionBuyer.user.id}/0192f0c2-0000-7000-8000-00000000ab0${index}.png`,
    )

    await expect(
      refusalOf(
        createReturn(
          MOCK_CLAIM_SELLER_ORDER_IDS.delivered,
          [{ orderItemId, quantity: 1 }],
          'DEFECTIVE',
          keys,
        ),
      ),
    ).resolves.toMatchObject({
      status: 400,
      code: 'RETURN_PHOTO_TOO_MANY',
      details: [expect.objectContaining({ params: { max: RETURN_PHOTO_MAX_COUNT } })],
    })
  })

  /** 뒤집을 것이 없는 주장에 증거를 받으면 아무도 보지 않는 이미지만 쌓인다. */
  it('단순 변심에 사진을 붙이면 그 코드로 거절한다', async () => {
    const orderItemId = await lineWithQuantity(MOCK_CLAIM_SELLER_ORDER_IDS.delivered, 2)

    await expect(
      refusalOf(
        createReturn(
          MOCK_CLAIM_SELLER_ORDER_IDS.delivered,
          [{ orderItemId, quantity: 1 }],
          'CHANGE_OF_MIND',
          [PHOTO_KEY],
        ),
      ),
    ).resolves.toMatchObject({ status: 400, code: 'RETURN_PHOTO_NOT_ALLOWED' })
  })
})

describe('신청한 뒤 다시 읽기', () => {
  it('신청서를 그대로 답한다', async () => {
    const orderItemId = await lineWithQuantity(MOCK_CLAIM_SELLER_ORDER_IDS.paid, 1)
    const { claim } = await create(MOCK_CLAIM_SELLER_ORDER_IDS.paid, [{ orderItemId, quantity: 1 }])

    await expect(
      client.request({ path: `/claims/${claim.id}`, schema: claimResponseSchema }),
    ).resolves.toEqual({ claim })
  })

  it('모르는 클레임에는 404 로 답한다', async () => {
    const refusal = await refusalOf(
      client.request({
        path: `/claims/019596d0-1f1c-7c2e-9a0e-7a0000009999`,
        schema: claimResponseSchema,
      }),
    )

    expect(refusal?.status).toBe(404)
  })
})

describe('실패를 강제하는 손잡이', () => {
  it('다음 신청 하나만 실패시킨다', async () => {
    const orderItemId = await lineWithQuantity(MOCK_CLAIM_SELLER_ORDER_IDS.paid, 1)

    failNextClaim()

    const refusal = await refusalOf(
      create(MOCK_CLAIM_SELLER_ORDER_IDS.paid, [{ orderItemId, quantity: 1 }]),
    )

    expect(refusal?.status).toBe(409)
    await expect(
      create(MOCK_CLAIM_SELLER_ORDER_IDS.paid, [{ orderItemId, quantity: 1 }]),
    ).resolves.toBeDefined()
  })
})
