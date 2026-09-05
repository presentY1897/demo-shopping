import { ServiceUnavailableException } from '@nestjs/common'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { TossConfig } from '../config/toss-config.js'
import type { TossClient } from './toss.client.js'
import {
  createTossClient,
  FetchTossClient,
  TOSS_UNREACHABLE,
  TossError,
  UnconfiguredTossClient,
} from './toss.client.js'

/**
 * 토스로 나가는 세 번의 HTTPS 호출과, 저쪽이 우리가 쓸 수 없는 답을 했을 때.
 *
 * `google-oauth.client.spec.ts` 가 선례이고 이유도 같다 — 이 파일은 포트의 **구현**
 * 이라서, 여기서만 전역 `fetch` 를 대역으로 바꾸고 나간 요청을 직접 들여다본다.
 * 이 위의 모든 것(`TossProvider`·`PaymentService`)은 `TOSS_CLIENT` 를 통째로 갈아
 * 끼우므로 저장소의 다른 어느 곳도 아래 URL 을 알 필요가 없다 (R2).
 *
 * 재는 것은 「토스가 잘 도는가」가 아니라 **「우리가 저쪽에 무엇을 보내고, 돌아온
 * 것을 어떻게 믿는가」**다 (4.2).
 */

/**
 * 존재하지 않는 상점의 키. 값 자체는 아무 데도 닿지 않는다 — 이 파일에서 `fetch`
 * 가 대역이다.
 *
 * 접두어를 실제 모양(`test_ck_`·`test_sk_`)으로 지키는 것은 `test/support/app-config.ts`
 * 와 같은 이유다: 번들 누출 검사(TASK-0055 4.4)가 찾는 것이 그 접두어라서, 픽스처가
 * 그 모양이어야 검사가 무엇을 막는지 읽힌다.
 */
const CONFIG: TossConfig = {
  clientKey: 'test_ck_0000000000000000000000000000',
  secretKey: 'test_sk_0000000000000000000000000000',
}

const PAYMENT_KEY = 'tviva20260905000001'
/** 토스가 「주문번호」라 부르는 자리. 우리 `Payment.id` 다 (4.3). */
const ORDER_ID = 'pay_01JQ0000000000000000000000'

/** 승인·취소·조회가 모두 이 모양을 돌려준다. 우리가 읽는 것은 세 필드뿐이다. */
const PAYMENT_BODY = { paymentKey: PAYMENT_KEY, status: 'DONE', totalAmount: 30_000 }

/** 이 스펙이 들여다보는 부분만. */
interface FetchInit {
  readonly signal?: unknown
  readonly method?: string
  readonly headers?: Readonly<Record<string, string>>
  readonly body?: unknown
}

interface Answer {
  readonly ok?: boolean
  readonly status?: number
  readonly body?: unknown
  /** JSON 이 아예 아닌 답 — 게이트웨이 오류 페이지는 HTML 이다. */
  readonly unparseable?: boolean
}

function stubFetch(answer: Answer = {}): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((_url: string, _init?: FetchInit) =>
    Promise.resolve({
      ok: answer.ok ?? true,
      status: answer.status ?? 200,
      json: () =>
        answer.unparseable === true
          ? Promise.reject(new SyntaxError('Unexpected token < in JSON'))
          : Promise.resolve(answer.body ?? PAYMENT_BODY),
    }),
  )

  vi.stubGlobal('fetch', fetchMock)

  return fetchMock
}

function requestOf(fetchMock: ReturnType<typeof vi.fn>): { url: string; init: FetchInit } {
  const call = fetchMock.mock.calls[0] as [string, FetchInit | undefined] | undefined
  if (call === undefined) throw new Error('nothing was requested')

  return { url: call[0], init: call[1] ?? {} }
}

function bodyOf(init: FetchInit): Record<string, unknown> {
  if (typeof init.body !== 'string') throw new Error('the body was not a JSON string')

  return JSON.parse(init.body) as Record<string, unknown>
}

/**
 * `Basic` 자격증명을 다시 평문으로.
 *
 * 실패 메시지에 헤더를 싣지 않는다 — 그 값이 곧 시크릿 키이고, 실패한 검사의 출력은
 * CI 로그에 남는다.
 */
function credentialsOf(init: FetchInit): string {
  const header = init.headers?.authorization ?? ''
  const [scheme, encoded] = header.split(' ')

  if (scheme !== 'Basic' || encoded === undefined) throw new Error('not a Basic credential')

  return Buffer.from(encoded, 'base64').toString('utf8')
}

/** 던져진 것을 들여다볼 수 있게 꺼낸다. */
async function rejection(promise: Promise<unknown>): Promise<TossError> {
  try {
    await promise
    throw new Error('expected the call to reject')
  } catch (error) {
    if (error instanceof TossError) return error
    throw error
  }
}

const client = new FetchTossClient(CONFIG)

/**
 * 답을 정해 놓고 한 번 부른다.
 *
 * 오류 해석은 세 호출이 공유하는 한 자리(`call`)에 있으므로, 어느 것으로 불러도
 * 같은 것을 잰다 — 셋을 각각 반복하면 같은 갈래를 세 번 세는 검사가 된다.
 */
function callWith(answer: Answer): Promise<unknown> {
  stubFetch(answer)

  return client.get(PAYMENT_KEY)
}

/** 세 호출을 한 번에 훑을 때 쓴다. 인증과 비밀 유지는 셋 다 같아야 하는 성질이다. */
const CALLS: [string, () => Promise<unknown>][] = [
  ['confirm', () => client.confirm({ paymentKey: PAYMENT_KEY, orderId: ORDER_ID, amount: 30_000 })],
  ['cancel', () => client.cancel(PAYMENT_KEY, '고객 요청')],
  ['get', () => client.get(PAYMENT_KEY)],
]

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('자격증명', () => {
  it.each(CALLS)('presents the secret key as a Basic user name from %s', async (_name, call) => {
    const fetchMock = stubFetch()

    await call()

    expect(credentialsOf(requestOf(fetchMock).init)).toBe(`${CONFIG.secretKey}:`)
  })

  it('ends the credential with a colon, because the password is empty', async () => {
    // **이 콜론 하나가 이 검사의 이유다.** 토스는 시크릿 키를 사용자 이름 자리에
    // 넣고 비밀번호를 비워 두라고 한다. 콜론을 빠뜨리면 401 이 오는데, 401 은
    // 「키가 틀렸다」로 읽혀서 키를 다시 발급받고 환경변수를 뒤지는 데 한참을
    // 쓰게 된다 — 정작 틀린 것은 인코딩 한 글자다.
    const fetchMock = stubFetch()

    await client.get(PAYMENT_KEY)

    const decoded = credentialsOf(requestOf(fetchMock).init)

    expect(decoded.endsWith(':')).toBe(true)
    // 콜론 뒤에 아무것도 없다. 비밀번호 자리에 무엇이든 들어가면 그것도 401 이다.
    expect(decoded.split(':')[1]).toBe('')
  })

  it.each(CALLS)('never puts the secret key in the URL from %s (R1)', async (_name, call) => {
    // R1. URL 은 프록시 로그·APM·에러 리포터에 그대로 남는 유일한 부분이다.
    // 시크릿이 거기 한 번 실리면 회수할 방법이 없고, 그것으로 남이 우리 결제를
    // 확정하거나 취소할 수 있다.
    const fetchMock = stubFetch()

    await call()

    const { url } = requestOf(fetchMock)

    expect(url).not.toContain(CONFIG.secretKey)
    // 쿼리스트링 자체가 없다. 있는 순간 「무엇이 실렸는지」를 사람이 매번 봐야 한다.
    expect(new URL(url).search).toBe('')
  })

  it.each(CALLS)('carries a deadline on %s', async (_name, call) => {
    // 마감이 없으면 느린 날 결제 요청이 커넥션을 붙잡은 채 쌓이고, 사람은 스피너만
    // 본다. `google-oauth.client.ts` 가 같은 이유로 같은 모양이다.
    const fetchMock = stubFetch()

    await call()

    expect(requestOf(fetchMock).init.signal).toBeInstanceOf(AbortSignal)
  })
})

describe('승인', () => {
  it('posts the confirmation to the documented endpoint', async () => {
    const fetchMock = stubFetch()

    await client.confirm({ paymentKey: PAYMENT_KEY, orderId: ORDER_ID, amount: 30_000 })

    const { url, init } = requestOf(fetchMock)

    expect(url).toBe('https://api.tosspayments.com/v1/payments/confirm')
    expect(init.method).toBe('POST')
    expect(init.headers?.['content-type']).toBe('application/json')
  })

  it('sends the three fields Toss confirms on, and nothing else', async () => {
    // 토스는 이 셋이 자기가 아는 값과 다르면 거절한다. 그래서 금액 대조가 두 겹이
    // 되고(`PaymentService.confirmToss` 가 이미 DB 와 맞춰 봤다), 여기에 우리가
    // 계산한 다른 숫자를 넣으면 그 두 번째 겹이 사라진다.
    const fetchMock = stubFetch()

    await client.confirm({ paymentKey: PAYMENT_KEY, orderId: ORDER_ID, amount: 30_000 })

    expect(bodyOf(requestOf(fetchMock).init)).toEqual({
      paymentKey: PAYMENT_KEY,
      orderId: ORDER_ID,
      amount: 30_000,
    })
  })

  it('returns the payment as the three fields we read', async () => {
    stubFetch({
      body: { ...PAYMENT_BODY, method: '카드', approvedAt: '2026-09-05T12:00:00+09:00' },
    })

    await expect(
      client.confirm({ paymentKey: PAYMENT_KEY, orderId: ORDER_ID, amount: 30_000 }),
    ).resolves.toEqual({ paymentKey: PAYMENT_KEY, status: 'DONE', totalAmount: 30_000 })
  })
})

describe('취소', () => {
  it('posts to the cancel endpoint of that one payment', async () => {
    const fetchMock = stubFetch({ body: { ...PAYMENT_BODY, status: 'CANCELED' } })

    await client.cancel(PAYMENT_KEY, '고객 요청')

    const { url, init } = requestOf(fetchMock)

    expect(url).toBe(`https://api.tosspayments.com/v1/payments/${PAYMENT_KEY}/cancel`)
    expect(init.method).toBe('POST')
  })

  it('omits the amount entirely for a full cancellation', async () => {
    // **여기가 부분 취소를 만드는 자리다.** 토스는 취소와 부분취소를 같은 API 로
    // 받고 이 필드 하나로 구분한다. `cancelAmount: undefined` 를 실어 보내는
    // 구현이면 JSON 에서 키가 사라져 우연히 맞지만, `0` 이나 `null` 이 실리는
    // 순간 전액 취소가 「0원 취소」가 된다 — 그리고 그 결제는 취소되지 않은 채
    // 우리 장부에서만 취소된다.
    const fetchMock = stubFetch({ body: { ...PAYMENT_BODY, status: 'CANCELED' } })

    await client.cancel(PAYMENT_KEY, '고객 요청')

    const body = bodyOf(requestOf(fetchMock).init)

    expect(body).toEqual({ cancelReason: '고객 요청' })
    expect('cancelAmount' in body).toBe(false)
  })

  it('sends the amount for a partial cancellation', async () => {
    const fetchMock = stubFetch({ body: { ...PAYMENT_BODY, status: 'PARTIAL_CANCELED' } })

    await client.cancel(PAYMENT_KEY, '일부 반품', 5_000)

    expect(bodyOf(requestOf(fetchMock).init)).toEqual({
      cancelReason: '일부 반품',
      cancelAmount: 5_000,
    })
  })

  it('escapes the payment key that goes into the path', async () => {
    // 결제키가 경로의 한 칸이라, 안에 슬래시가 있으면 인코딩 없이는 **다른
    // 엔드포인트**를 부르게 된다. 그때 오는 것은 404 이고, 404 는 「그런 결제가
    // 없다」로 읽힌다.
    const fetchMock = stubFetch({ body: { ...PAYMENT_BODY, paymentKey: 'tviva/2026' } })

    await client.cancel('tviva/2026', '고객 요청')

    expect(requestOf(fetchMock).url).toBe(
      'https://api.tosspayments.com/v1/payments/tviva%2F2026/cancel',
    )
  })
})

describe('조회', () => {
  it('reads the payment with a GET that carries no body', async () => {
    const fetchMock = stubFetch()

    await client.get(PAYMENT_KEY)

    const { url, init } = requestOf(fetchMock)

    expect(url).toBe(`https://api.tosspayments.com/v1/payments/${PAYMENT_KEY}`)
    expect(init.method).toBe('GET')
    expect(init.body).toBeUndefined()
    // 본문이 없으면 그 헤더도 없어야 한다. 있으면 「본문이 있다」고 말하는 GET 이 된다.
    expect(init.headers?.['content-type']).toBeUndefined()
  })

  it('escapes the payment key that goes into the path', async () => {
    const fetchMock = stubFetch({ body: { ...PAYMENT_BODY, paymentKey: 'tviva/2026' } })

    await client.get('tviva/2026')

    expect(requestOf(fetchMock).url).toBe('https://api.tosspayments.com/v1/payments/tviva%2F2026')
  })

  it('returns the status Toss reports, untranslated', async () => {
    // 우리 상태로 옮기는 것은 `toss-rules.ts` 의 일이다. 여기서 미리 옮기면 대사가
    // 「저쪽이 실제로 뭐라고 했는가」를 볼 수 없다.
    stubFetch({ body: { ...PAYMENT_BODY, status: 'PARTIAL_CANCELED' } })

    await expect(client.get(PAYMENT_KEY)).resolves.toMatchObject({ status: 'PARTIAL_CANCELED' })
  })
})

describe('토스가 거절했을 때', () => {
  it("carries Toss's own code and sentence", async () => {
    // 「카드 한도를 초과했습니다」 같은 것은 저쪽이 우리보다 정확히 안다. 다시 쓰면
    // 번역이 두 곳에서 조금씩 갈리고, 사용자에게는 그 차이가 그냥 혼란이다.
    stubFetch({
      ok: false,
      status: 400,
      body: {
        code: 'EXCEED_MAX_CARD_INSTALLMENT_PLAN',
        message: '설정 가능한 할부 개월 수를 초과했습니다.',
      },
    })

    const error = await rejection(
      client.confirm({ paymentKey: PAYMENT_KEY, orderId: ORDER_ID, amount: 30_000 }),
    )

    expect(error).toBeInstanceOf(TossError)
    expect(error.name).toBe('TossError')
    expect(error.code).toBe('EXCEED_MAX_CARD_INSTALLMENT_PLAN')
    expect(error.message).toBe('설정 가능한 할부 개월 수를 초과했습니다.')
  })

  it('falls back to the status when the body names no code', async () => {
    // 게이트웨이가 만든 4xx·5xx 에는 토스의 코드가 없다. 코드 없이 던지면 부르는
    // 쪽에서 거절과 장애를 가를 수 없다.
    const error = await rejection(
      callWith({ ok: false, status: 400, body: { message: '잘못된 요청' } }),
    )

    expect(error.code).toBe('HTTP_400')
    expect(error.message).toBe('잘못된 요청')
  })

  it('falls back for a body that is not JSON at all', async () => {
    const error = await rejection(callWith({ ok: false, status: 502, unparseable: true }))

    expect(error.code).toBe('HTTP_502')
    // 문장은 여전히 사람이 읽을 수 있어야 한다. 이 message 는 `TossProvider` 가
    // 그대로 사용자에게 보여 준다.
    expect(error.message).toMatch(/[가-힣]/)
  })

  it('falls back for an empty body', async () => {
    const error = await rejection(callWith({ ok: false, status: 500, body: {} }))

    expect(error.code).toBe('HTTP_500')
    expect(error.message).toMatch(/[가-힣]/)
  })
})

/**
 * **닿지 못한 것은 거절이 아니다.**
 *
 * 거절은 답이다 — 저쪽이 「안 된다」고 말했으므로 그 결제는 승인되지 않았다는 것을
 * 우리가 안다. 연결이 끊긴 것은 답이 아니다: 요청이 도착했는지, 승인이 끝난 뒤
 * 응답만 잃어버린 것인지 **우리는 모른다.** 승인됐는데 우리 장부가 비어 있는 상태가
 * 정확히 여기서 생긴다.
 *
 * 그래서 코드가 따로 있다. 부르는 쪽은 이 코드를 보고 「실패했다」로 적는 대신
 * 「모른다」로 두고, 그 불일치를 웹훅(TASK-0056)과 대사(`getStatus`)가 찾는다.
 */
describe('토스에 닿지 못했을 때', () => {
  it('marks a timeout as unreachable rather than as a refusal', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new DOMException('The operation timed out.', 'TimeoutError'))),
    )

    const error = await rejection(client.get(PAYMENT_KEY))

    expect(error.code).toBe(TOSS_UNREACHABLE)
    // 어느 쪽으로 끝났는지 운영자가 알 수 있게 이름은 남긴다.
    expect(error.message).toBe('TimeoutError')
  })

  it('marks a transport failure the same way', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('fetch failed'))),
    )

    const error = await rejection(
      client.confirm({ paymentKey: PAYMENT_KEY, orderId: ORDER_ID, amount: 30_000 }),
    )

    expect(error.code).toBe(TOSS_UNREACHABLE)
    expect(error.message).toBe('TypeError')
  })

  it('still names it unreachable when what was thrown is not an Error', async () => {
    // `fetch` 를 감싼 무엇이든 Error 가 아닌 것을 던질 수 있다. 그때 이름을 읽으려
    // 들면 여기서 두 번째 예외가 나고, 그 예외는 500 이 되어 원인을 덮는다.
    const notAnError = 'socket hang up' as unknown as Error

    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(notAnError)),
    )

    const error = await rejection(client.cancel(PAYMENT_KEY, '고객 요청'))

    expect(error.code).toBe(TOSS_UNREACHABLE)
    expect(error.message).toBe('network')
  })
})

/**
 * 모양이 다른 200.
 *
 * 조용히 `undefined` 를 들고 가면 **그 값이 결제 상태가 된다** — 「승인은 됐는데 우리
 * 장부가 비었다」로 끝나고, 그것은 대사할 때가 되어서야 보인다.
 */
describe('읽을 수 없는 응답', () => {
  const MALFORMED: [string, unknown][] = [
    ['the payment key is missing', { status: 'DONE', totalAmount: 30_000 }],
    ['the status is missing', { paymentKey: PAYMENT_KEY, totalAmount: 30_000 }],
    ['the amount is a string', { ...PAYMENT_BODY, totalAmount: '30000' }],
    ['the amount is missing', { paymentKey: PAYMENT_KEY, status: 'DONE' }],
    ['the body is not JSON at all', null],
  ]

  it.each(MALFORMED)('refuses a 200 where %s', async (_case, body) => {
    stubFetch(body === null ? { unparseable: true } : { body })

    const error = await rejection(client.get(PAYMENT_KEY))

    expect(error.code).toBe('TOSS_MALFORMED_RESPONSE')
  })

  it('says nothing about the body it could not read', async () => {
    // 이 문장은 사용자에게 그대로 간다. 응답 조각을 실으면 결제사 내부 값이 화면에
    // 나오고, 같은 문장이 로그에도 남는다.
    stubFetch({ body: { paymentKey: PAYMENT_KEY, status: 'DONE', totalAmount: '30000' } })

    const error = await rejection(client.get(PAYMENT_KEY))

    expect(error.message).toMatch(/[가-힣]/)
    expect(error.message).not.toContain('30000')
  })
})

describe('토스 키가 없는 API', () => {
  const unconfigured: TossClient = new UnconfiguredTossClient()

  const REFUSALS: [string, () => unknown][] = [
    [
      'confirm',
      () => unconfigured.confirm({ paymentKey: PAYMENT_KEY, orderId: ORDER_ID, amount: 30_000 }),
    ],
    ['cancel', () => unconfigured.cancel(PAYMENT_KEY, '고객 요청')],
    ['get', () => unconfigured.get(PAYMENT_KEY)],
  ]

  it.each(REFUSALS)('answers 503 from %s and reaches nobody', (_name, call) => {
    // CI 에도 토스 키가 없다 (4.1). 「설정되지 않음」은 부팅 실패가 아니라 **돌고
    // 있는 API 에 토스만 없는 상태**여야 하고, 여기까지 오는 길은 실제로는 없다 —
    // 키가 없으면 `TossProvider` 가 레지스트리에 붙지 않기 때문이다.
    const fetchMock = stubFetch()

    expect(call).toThrow(ServiceUnavailableException)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('says so in a sentence a person can read', () => {
    // 이 거절도 브라우저까지 간다. 환경변수 이름을 알려 줄 자리가 아니다.
    const thrown = (): unknown => unconfigured.get(PAYMENT_KEY)

    expect(thrown).toThrow(/[가-힣]/)
    expect(thrown).not.toThrow(/TOSS_/)
  })
})

describe('구현을 고른다', () => {
  it('takes the unconfigured client when there are no credentials', () => {
    expect(createTossClient(null)).toBeInstanceOf(UnconfiguredTossClient)
  })

  it('takes the fetch client when there are', () => {
    expect(createTossClient(CONFIG)).toBeInstanceOf(FetchTossClient)
  })
})
