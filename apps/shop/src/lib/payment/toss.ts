'use client'

/**
 * 토스 결제창, 그리고 그것이 **없어도 되게** 만드는 자리 (TASK-0055 4.1 · 4.8).
 *
 * **키가 없으면 토스는 존재하지 않는다.** 서버가 자격증명이 없으면 프로바이더를
 * 등록하지 않는 것과 같은 판단이고(D-031), 화면 쪽에서 그 판단을 내리는 곳이
 * {@link tossClientKey} 하나다 — 여기서 `null` 이 나오면 결제수단 목록에 토스가
 * 아예 나오지 않고 가상 카드만으로 전체 흐름이 완결된다. 지금 이 저장소에 키가
 * 없으므로 **그것이 기본 상태**다.
 *
 * **의존성이 아니라 스크립트다** (4.8). npm 패키지를 넣으면 lockfile 이 바뀌어
 * 모든 워크트리가 재설치해야 하고, 대역의 경계가 라이브러리 안으로 들어가 검사가
 * 「우리가 무엇을 불렀는가」 대신 「라이브러리가 무엇을 불렀는가」를 흉내 내게 된다.
 * `lib/profile/postcode.ts` 가 같은 이유로 같은 모양이고, 서버의
 * `google-oauth.client.ts` 는 같은 이유로 라이브러리 없이 `fetch` 세 번이다.
 *
 * **모듈 전체가 갈아 끼울 수 있는 함수 하나다.** 검사는 {@link openTossCheckout}
 * 을 대신할 것을 넘기거나(`vi.mock`), 진짜 함수에 가짜 {@link TossSdkLoader} 를
 * 넘긴다 — 어느 쪽도 `js.tosspayments.com` 에 닿지 않는다. 목 서버는 처리되지 않은
 * 요청을 거부하고 프로세스는 바깥으로 나가는 소켓을 센다.
 *
 * 승인·취소를 부르는 열쇠는 **여기 없고, 이름조차 없다.** 그쪽은 `apps/api` 의
 * 것이고, 이 앱이 그 이름을 알고 있는 것 자체가 사고다 (4.4 ·
 * `test/secret-key-containment.spec.ts`).
 */

/** v2 표준 결제창. 버전이 경로에 박혀 있어 저쪽이 v3 를 내도 이 앱은 움직이지 않는다. */
export const TOSS_SCRIPT_URL = 'https://js.tosspayments.com/v2/standard'

/**
 * 스크립트가 붙는 데 주는 시간.
 *
 * 네트워크를 추측한 값이 아니라 **천장**이다. `<script>` 는 연결이 거부되면
 * `error` 를 내지만 요청이 매달려 있으면 **아무것도 내지 않는다** — 사내 프록시나
 * 도메인 차단 정책이 정확히 그 모양이고, 이것이 없으면 「결제창을 여는 중」이
 * 영원히 돈다. `postcode.ts` 가 같은 이유로 같은 값을 쓴다.
 */
export const TOSS_LOAD_TIMEOUT_MS = 5_000

/**
 * 테스트 환경 안내가 가리키는 곳 (F7 · 4.7).
 *
 * **카드번호가 아니라 링크인 이유**가 이 문서에 적혀 있다 — 토스페이먼츠는 테스트용
 * 국내 카드번호를 따로 주지 않고, 대신 실제 카드 정보를 넣어도 가상으로만 승인된다.
 * 그러니 우리가 화면에 적을 수 있는 「테스트 카드번호」라는 것은 **존재하지 않는
 * 값**이고, 지어내면 그것을 세 번 시도한 사람은 우리 결제가 고장 났다고 결론 내린다.
 */
export const TOSS_TEST_GUIDE_URL = 'https://docs.tosspayments.com/guides/v2/get-started/environment'

/**
 * 결제창이 돌아오는 두 경로.
 *
 * `checkout/[id]` 와 겹치지 않는다 — 정적 세그먼트가 동적 세그먼트를 이기므로
 * `/checkout/toss/success` 는 언제나 이 화면이고, `/checkout/toss` 는 「toss 라는
 * id 의 주문서」로 읽혀 만료 화면이 된다. 열 이유가 없는 주소라 그대로 둔다.
 */
export const TOSS_SUCCESS_PATH = '/checkout/toss/success'
export const TOSS_FAIL_PATH = '/checkout/toss/fail'

/**
 * 돌아올 때 우리가 챙겨 가는 것 — 어느 주문서에서 떠났는가.
 *
 * 토스가 실어 보내는 것은 `paymentKey`·`orderId`·`amount` 뿐이고 그중 어느 것도
 * 주문서를 가리키지 않는다. 그런데 실패한 사람에게 줘야 할 길이 정확히 **그
 * 주문서로 돌아가는 것**이라(F3), 우리가 만든 URL 에 우리가 미리 넣어 둔다 —
 * 토스는 자기 파라미터를 덧붙일 뿐 우리 것을 지우지 않는다.
 */
export const TOSS_RETURN_CHECKOUT_PARAM = 'checkout'

/** 결제창을 여는 데 필요한 전부. */
export interface TossCheckoutRequest {
  readonly clientKey: string
  /** 결제할 금액. **서버가 연 결제의 승인액**이지 화면이 그린 숫자가 아니다. */
  readonly amount: number
  /**
   * 토스가 「주문 id」라 부르는 값에 넣을 것 — 우리 **결제 id** 다 (4.3).
   *
   * 우리 `Order.id` 를 주면 토스가 그것으로 멱등을 판단해 **한 주문에 결제를 두 번
   * 시도할 수 없다.** 첫 시도가 실패해 다시 결제하는 것이 정확히 그 경우다.
   */
  readonly paymentId: string
  readonly orderName: string
  readonly successUrl: string
  readonly failUrl: string
}

/**
 * 결제창을 연다. 성공하면 **브라우저가 이 페이지를 떠난다.**
 *
 * 그래서 이 약속이 지켜졌다는 것은 「결제가 됐다」가 아니라 「우리 화면이 곧
 * 사라진다」는 뜻이고, 거절은 창을 **열지 못한 것**뿐이다 — 창 안에서 일어나는 일은
 * 리다이렉트로 돌아온다.
 */
export type TossCheckout = (request: TossCheckoutRequest) => Promise<void>

/** 결제창 SDK 를 손에 넣는 방법. 검사는 진짜 스크립트 대신 이것을 갈아 끼운다. */
export type TossSdkLoader = () => Promise<TossPaymentsFactory>

/** v2 SDK 중 우리가 쓰는 부분만. 남의 타입을 통째로 들여오지 않는다. */
export type TossPaymentsFactory = (clientKey: string) => TossPaymentsInstance

export interface TossPaymentsInstance {
  readonly payment: (options: { readonly customerKey: string }) => TossPaymentSession
}

export interface TossPaymentSession {
  readonly requestPayment: (request: TossRequestPayment) => Promise<unknown>
}

export interface TossRequestPayment {
  readonly method: 'CARD'
  readonly amount: { readonly currency: 'KRW'; readonly value: number }
  readonly orderId: string
  readonly orderName: string
  readonly successUrl: string
  readonly failUrl: string
}

/**
 * 로그인하지 않은 결제.
 *
 * 이 값은 토스가 정한 **문자열 상수**다. 우리 계정 id 를 넣으면 그 사람의 카드가
 * 저쪽에 저장되고, 그것은 자동결제(빌링)의 이야기이지 이 TASK 의 것이 아니다.
 */
const ANONYMOUS_CUSTOMER_KEY = 'ANONYMOUS'

/**
 * 결제창 키. 없으면 `null` 이고, 그것이 「토스가 없다」는 뜻이다 (4.1).
 *
 * **불릴 때 읽는다.** `lib/api.ts` 의 `apiBaseUrl` 과 같은 이유이고 여기서는 하나가
 * 더 있다 — 모듈 최상위에서 굳히면 값이 임포트 시점에 박혀, 키가 있는 상태와 없는
 * 상태를 한 프로세스 안에서 둘 다 재는 것이 불가능해진다. Next 는 이 표현을 빌드
 * 타임에 문자열로 인라인하므로 지연 읽기라고 해서 번들이 달라지지는 않는다.
 *
 * 공백만 있는 값은 없는 것으로 친다. `.env` 에 이름만 남기고 값을 지운 상태가 흔하고,
 * 그때 빈 문자열로 `TossPayments('')` 를 부르면 창이 뜨다 만다.
 */
export function tossClientKey(): string | null {
  const key = process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY

  if (key === undefined || key.trim() === '') return null

  return key
}

/** 결제창이 돌아올 두 주소. 주문서 id 를 우리가 실어 보낸다. */
export function tossReturnUrls(
  origin: string,
  checkoutId: string,
): { readonly successUrl: string; readonly failUrl: string } {
  const query = `?${TOSS_RETURN_CHECKOUT_PARAM}=${encodeURIComponent(checkoutId)}`

  return {
    failUrl: `${origin}${TOSS_FAIL_PATH}${query}`,
    successUrl: `${origin}${TOSS_SUCCESS_PATH}${query}`,
  }
}

function tossGlobal(): TossPaymentsFactory | undefined {
  return (globalThis as { TossPayments?: TossPaymentsFactory }).TossPayments
}

/**
 * 붙는 중이거나 이미 붙은 스크립트. 두 번 누른다고 두 번 받지 않는다.
 *
 * 실패하면 지운다 — 처음 눌렀을 때 오프라인이던 사람이 그 세션 내내 토스를 쓰지
 * 못하게 되는 것은 캐시가 아니라 벌이다.
 */
let loading: Promise<TossPaymentsFactory> | null = null

const loadTossSdk: TossSdkLoader = () => {
  const ready = tossGlobal()

  if (ready !== undefined) return Promise.resolve(ready)

  loading ??= new Promise<TossPaymentsFactory>((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('toss checkout needs a document'))

      return
    }

    const script = document.createElement('script')
    const timer = setTimeout(() => {
      reject(new Error('toss checkout timed out'))
    }, TOSS_LOAD_TIMEOUT_MS)

    script.addEventListener('load', () => {
      clearTimeout(timer)

      const factory = tossGlobal()

      // 200 을 주면서 오류 페이지를 돌려주는 프록시가 여기로 온다. 붙었는데 전역이
      // 없는 것은 안 붙은 것과 결과가 같다.
      if (factory === undefined) reject(new Error('toss checkout did not register'))
      else resolve(factory)
    })
    script.addEventListener('error', () => {
      clearTimeout(timer)
      reject(new Error('toss checkout failed to load'))
    })

    script.async = true
    script.src = TOSS_SCRIPT_URL
    document.head.append(script)
  }).catch((error: unknown) => {
    loading = null
    throw error
  })

  return loading
}

/**
 * 진짜 결제창.
 *
 * `load` 가 인자인 것이 이 파일의 검사 가능성 전부다 — 기본값은 CDN 이고, 검사는
 * 전역을 흉내 내는 것을 넘겨 **우리가 무엇을 어떤 모양으로 넘겼는지**만 잰다.
 * 그것이 4.2 가 말하는 「우리 쪽 절반」이고, 나머지 절반은 사람이 키를 넣고 눌러
 * 보는 종류다.
 */
export const openTossCheckout = async (
  request: TossCheckoutRequest,
  load: TossSdkLoader = loadTossSdk,
): Promise<void> => {
  const factory = await load()

  await factory(request.clientKey)
    .payment({ customerKey: ANONYMOUS_CUSTOMER_KEY })
    .requestPayment({
      amount: { currency: 'KRW', value: request.amount },
      failUrl: request.failUrl,
      method: 'CARD',
      // 4.3 — 토스가 「주문」이라 부르는 것에 우리 **결제** id 를 준다.
      orderId: request.paymentId,
      orderName: request.orderName,
      successUrl: request.successUrl,
    })
}
