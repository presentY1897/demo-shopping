import { Logger, ServiceUnavailableException } from '@nestjs/common'

import type { TossConfig } from '../config/toss-config.js'
import type { TossStatus } from './toss-rules.js'

/**
 * 토스와 대화하는 **유일한** 자리 (TASK-0055 R2 · QUALITY-GATES 6장).
 *
 * `GOOGLE_OAUTH` 가 선례다. 토스는 검사에서 대역으로 바뀌는 의존성이다 — 저쪽의
 * 응답은 우리가 정할 수 없고 저쪽의 실패는 우리가 만들 수 없다. 포트 뒤에 두면
 * 스펙이 전역 `fetch` 를 뒤지는 대신 프로바이더 하나를 갈아 끼운다.
 *
 * **라이브러리를 쓰지 않는 이유**도 같다. 필요한 것은 문서화된 HTTPS 호출 세 개이고,
 * 라이브러리를 넣으면 대역의 경계가 그 안으로 들어가 버린다 — 스펙이 「우리가 무엇을
 * 불렀는가」가 아니라 「라이브러리가 무엇을 불렀는가」를 흉내 내게 된다.
 */
export const TOSS_CLIENT = Symbol('TOSS_CLIENT')

const BASE_URL = 'https://api.tosspayments.com/v1'

/**
 * 토스가 답할 때까지 기다리는 한도.
 *
 * 승인은 카드사까지 다녀오므로 조회보다 느리다. 그래도 상한이 있는 이유는, 없으면
 * 느린 날 결제 요청이 커넥션을 붙잡은 채 쌓이고 사람은 스피너만 보기 때문이다 —
 * `google-oauth.client.ts` 가 같은 이유로 같은 모양을 하고 있다.
 */
const REQUEST_TIMEOUT_MS = 15_000

/** 토스가 돌려주는 결제. 우리가 읽는 것만 좁혀 적는다. */
export interface TossPayment {
  readonly paymentKey: string
  readonly status: TossStatus
  /** 승인된 총액. 우리가 보낸 금액과 같아야 한다. */
  readonly totalAmount: number
}

export interface TossConfirmRequest {
  readonly paymentKey: string
  /**
   * 토스가 「주문번호」라고 부르는 값. **우리 `Payment.id` 다** (4.3).
   *
   * `Order.id` 를 주면 한 주문에 결제를 두 번 시도할 수 없다 — 첫 시도가 거절돼
   * 다른 카드로 다시 하는 것이 정확히 그 경우다.
   */
  readonly orderId: string
  readonly amount: number
}

export interface TossClient {
  /** 승인. 결제창 성공은 승인이 아니고, 이 호출이 최종 확정이다. */
  confirm(request: TossConfirmRequest): Promise<TossPayment>
  /** 취소·부분취소. 토스는 둘을 같은 API 로 받고 금액으로 구분한다. */
  cancel(paymentKey: string, reason: string, amount?: number): Promise<TossPayment>
  /** 대사용 조회. */
  get(paymentKey: string): Promise<TossPayment>
  /**
   * **우리 결제 id 로** 되찾는다 (TASK-0056 · D-220).
   *
   * 승인이 끊긴 건에는 `paymentKey` 가 없다 — 그 값은 저쪽의 답에 실려 오는데 그
   * 답을 못 받은 것이 이 상황이다. 그래서 대사가 물어볼 수 있는 유일한 열쇠가
   * **우리가 보낸 `orderId`**, 즉 우리 `Payment.id` 다 (TASK-0055 4.3).
   *
   * 그 결제가 저쪽에 아예 없으면 `null` 이다 — 요청이 도착조차 안 했다는 뜻이고,
   * 그때 우리 결제는 실패로 끝난다.
   */
  getByOrderId(orderId: string): Promise<TossPayment | null>
}

/**
 * 토스가 우리가 쓸 수 없는 답을 했을 때.
 *
 * `code` 를 들고 있는 이유는 **거절과 장애가 다르기 때문**이다 — 한도 초과는
 * 사람에게 보여 줄 정상적인 대답이고, 연결 실패는 운영자가 볼 것이다. 그 구분을
 * 부르는 쪽이 하도록 코드를 남긴다.
 */
export class TossError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'TossError'
  }
}

/** 연결 자체가 안 됐을 때 붙는 코드. 토스가 쓰는 코드와 겹치지 않는 이름이다. */
export const TOSS_UNREACHABLE = 'TOSS_UNREACHABLE'

/** 토스, HTTPS 로. */
export class FetchTossClient implements TossClient {
  private readonly log = new Logger(FetchTossClient.name)

  constructor(private readonly config: TossConfig) {}

  confirm(request: TossConfirmRequest): Promise<TossPayment> {
    return this.call('/payments/confirm', {
      paymentKey: request.paymentKey,
      orderId: request.orderId,
      amount: request.amount,
    })
  }

  cancel(paymentKey: string, reason: string, amount?: number): Promise<TossPayment> {
    return this.call(`/payments/${encodeURIComponent(paymentKey)}/cancel`, {
      cancelReason: reason,
      // 금액을 안 보내면 **전액 취소**다. 부분 취소만 이 필드를 채운다.
      ...(amount === undefined ? {} : { cancelAmount: amount }),
    })
  }

  get(paymentKey: string): Promise<TossPayment> {
    return this.call(`/payments/${encodeURIComponent(paymentKey)}`, null)
  }

  async getByOrderId(orderId: string): Promise<TossPayment | null> {
    try {
      return await this.call(`/payments/orders/${encodeURIComponent(orderId)}`, null)
    } catch (error: unknown) {
      // 없는 주문은 404 다. **그것은 오류가 아니라 답이다** — 저쪽에 이 결제가
      // 없다는 뜻이고, 대사는 그 답으로 우리 결제를 실패로 보낸다. 던지면 대사가
      // 매번 재시도하며 영원히 풀지 못한다.
      if (error instanceof TossError && error.code === 'NOT_FOUND_PAYMENT') return null

      throw error
    }
  }

  /**
   * 한 번의 호출. 인증·마감·오류 해석이 전부 여기 있다.
   *
   * 시크릿 키는 **Basic 인증의 사용자 이름 자리**에 들어가고 비밀번호는 비어 있다
   * (토스 규약). 그래서 값 뒤에 콜론이 붙는다 — 빠뜨리면 401 이 오고, 그 401 은
   * 키가 틀렸다는 뜻으로 읽혀 한참을 잘못 찾게 된다.
   */
  private async call(path: string, body: object | null): Promise<TossPayment> {
    const credentials = Buffer.from(`${this.config.secretKey}:`).toString('base64')
    let response: Response

    try {
      response = await fetch(`${BASE_URL}${path}`, {
        method: body === null ? 'GET' : 'POST',
        headers: {
          authorization: `Basic ${credentials}`,
          ...(body === null ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === null ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    } catch (error) {
      // 저쪽에 닿지도 못했다. **승인됐는지 우리가 모르는 상태**라서 거절과 다르고,
      // 그 불일치는 웹훅(TASK-0056)과 대사가 찾는다.
      throw new TossError(TOSS_UNREACHABLE, error instanceof Error ? error.name : 'network')
    }

    const payload: unknown = await response.json().catch(() => null)

    if (!response.ok) throw errorOf(payload, response.status)

    return this.narrow(payload)
  }

  /**
   * 응답에서 우리가 읽는 세 필드만 꺼낸다.
   *
   * 모양이 다르면 던진다. 조용히 `undefined` 를 들고 가면 그 값이 결제 상태가 되고,
   * 「승인은 됐는데 우리 장부가 비었다」로 끝난다.
   */
  private narrow(payload: unknown): TossPayment {
    const body = (payload ?? {}) as Record<string, unknown>
    const { paymentKey, status, totalAmount } = body

    if (typeof paymentKey !== 'string' || typeof status !== 'string') {
      this.log.error('토스 응답에서 결제키나 상태를 읽지 못했습니다.')

      throw new TossError('TOSS_MALFORMED_RESPONSE', '결제사 응답을 읽을 수 없습니다.')
    }

    if (typeof totalAmount !== 'number') {
      this.log.error('토스 응답에서 금액을 읽지 못했습니다.')

      throw new TossError('TOSS_MALFORMED_RESPONSE', '결제사 응답을 읽을 수 없습니다.')
    }

    return { paymentKey, status: status as TossStatus, totalAmount }
  }
}

/** 토스의 오류 본문 `{ code, message }`. 없으면 상태 코드로 대신한다. */
function errorOf(payload: unknown, status: number): TossError {
  const body = (payload ?? {}) as Record<string, unknown>
  const code = typeof body.code === 'string' ? body.code : `HTTP_${String(status)}`
  const message =
    typeof body.message === 'string' ? body.message : '결제사가 요청을 처리하지 못했어요.'

  return new TossError(code, message)
}

/**
 * 키가 없을 때 묶이는 것.
 *
 * 실제로는 아무도 부르지 않는다 — 키가 없으면 `TossProvider` 가 레지스트리에
 * 등록되지 않아 여기까지 오는 길이 없다(4.1). 그래도 두는 이유는 DI 가 값을
 * 요구하기 때문이고, 그 값이 `null` 이면 **부르는 쪽마다** 널 검사를 하게 된다.
 */
export class UnconfiguredTossClient implements TossClient {
  confirm(): Promise<TossPayment> {
    return this.refuse()
  }

  getByOrderId(): Promise<TossPayment | null> {
    return this.refuse()
  }

  cancel(): Promise<TossPayment> {
    return this.refuse()
  }

  get(): Promise<TossPayment> {
    return this.refuse()
  }

  private refuse(): never {
    throw new ServiceUnavailableException('토스 결제가 아직 설정되지 않았어요.')
  }
}

export function createTossClient(config: TossConfig | null): TossClient {
  return config === null ? new UnconfiguredTossClient() : new FetchTossClient(config)
}
