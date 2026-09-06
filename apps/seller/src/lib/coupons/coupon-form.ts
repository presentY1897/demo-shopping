import type { CreateCouponRequest } from '@shopping/shared'
import { COUPON_PERCENT_MAX_VALUE, createCouponRequestSchema } from '@shopping/shared'
import { z } from 'zod'

/**
 * 발행 폼의 입력들과, 그것이 만드는 요청 하나 (TASK-0074 5장).
 *
 * **규칙은 `@shopping/shared` 의 것이고 문구만 이 앱의 것이다.**
 * `createCouponRequestSchema` 는 `apps/api` 가 같은 요청을 검증하는 바로 그 객체라
 * (게이트 C1), 길이와 상한은 한 번만 적힌다. 그것이 뱉는 말은 zod 의 기본 영어라
 * 판매자에게 보여 줄 것이 못 되고, 그것을 고치는 것은 계약의 일이 아니다 — 문구는
 * 그리는 앱의 것이다 (`lib/sellers/store-form.ts` 가 같은 이유로 같은 모양이다).
 *
 * ## 계약이 답하지 않는 세 가지
 *
 * 아래 셋은 **여기에만 있는 규칙**이고, 그래서 화면의 친절이지 진실의 출처가
 * 아니다 — 서버가 같은 것을 거절하면 그 답을 그대로 그린다.
 *
 * | 규칙 | 왜 계약에 없나 |
 * | --- | --- |
 * | 정률의 할인율은 100 이하 | `discountValue` 의 상한이 정액 기준(1천만)이고, 「정률은 100 이하」는 주석으로만 적혀 있다 |
 * | 종료가 시작보다 뒤 | `createCouponRequestSchema` 에 두 값을 함께 보는 refine 이 없다 |
 * | 상품 지정이면 상품이 하나는 있어야 | `scopeIds` 의 하한이 없다 (`.max(50)` 뿐) |
 *
 * 셋 다 **막지 않으면 서버가 400·403 으로 되돌려 보내는** 것들이라, 화면에서 먼저
 * 잡는 편이 판매자가 무엇을 고쳐야 하는지 알기 쉽다. 다만 그 판정을 화면만 하는
 * 것은 아니다: 화면만 막으면 API 를 직접 부르는 길이 남는다.
 */

/**
 * 이 폼이 서버 메시지를 붙일 수 있는 입력들.
 *
 * `serverFieldErrors` 가 이 목록에 없는 이름을 만나면 폼 위쪽의 오류 상자로 보낸다 —
 * 없는 컨트롤 밑에 문장을 다는 것보다 낫기 때문이다. `COUPON_SCOPE_FORBIDDEN` 이
 * 가리키는 `scopeType` · `scopeIds` 가 **둘 다 여기 있어야** 그 403 이 제 칸에
 * 붙는다 (F1).
 */
export const SELLER_COUPON_FORM_FIELDS = [
  'name',
  'discountType',
  'discountValue',
  'maxDiscountAmount',
  'minOrderAmount',
  'scopeType',
  'scopeIds',
  'validFrom',
  'validUntil',
  'issueLimit',
  'withCode',
] as const

export type SellerCouponFormField = (typeof SELLER_COUPON_FORM_FIELDS)[number]

/**
 * 컨트롤이 들고 있는 값.
 *
 * 숫자 칸도 문자열이다 — `<input type="number">` 가 돌려주는 것이 문자열이고,
 * 비어 있는 칸을 `0` 으로 읽으면 「무제한」과 「0장」이 구분되지 않는다.
 *
 * **`interface` 로 적을 수 없다.** `useForm` 의 `FormValues` 는
 * `Readonly<Record<string, unknown>>` 이고, 인터페이스에는 암묵적 인덱스 시그니처가
 * 생기지 않아 그 자리에 넘길 수 없다 (`store-form.ts` 가 같은 문장을 적어 두었다).
 * 그래서 문자열 칸들을 `Record` 로 세우고 모양이 다른 둘만 덧붙인다 — 매핑 타입에는
 * 그 시그니처가 생기고, 저쪽은 그 성질을 물려받는다.
 */
export type SellerCouponTextField = Exclude<SellerCouponFormField, 'scopeIds' | 'withCode'>

export type SellerCouponFormValues = Readonly<Record<SellerCouponTextField, string>> & {
  /** 지정한 상품들. 체크박스 묶음 하나가 이 배열 하나를 대신한다. */
  readonly scopeIds: readonly string[]
  /** 코드를 붙일 것인가. **코드 문자열은 서버가 만든다** — 고르는 칸이 아니다. */
  readonly withCode: boolean
}

/**
 * 폼이 시작하는 자리.
 *
 * 기간은 비워 둔다. 「오늘부터 한 달」 같은 기본값을 넣으면 그것을 **읽지 않고**
 * 발행하는 사람이 생기고, 이 화면이 하려는 일은 정확히 그 반대다 — 숫자를 보게
 * 하는 것이다.
 */
export const EMPTY_COUPON_FORM: SellerCouponFormValues = {
  name: '',
  discountType: 'FIXED',
  discountValue: '',
  maxDiscountAmount: '',
  minOrderAmount: '',
  scopeType: 'SELLER',
  scopeIds: [],
  validFrom: '',
  validUntil: '',
  issueLimit: '',
  withCode: false,
}

/** 한 입력이 틀릴 수 있는 방식마다 한 문장. 한국어는 카탈로그에 산다. */
export interface CouponFieldErrorMessages {
  readonly nameRequired: string
  readonly nameTooLong: string
  readonly discountValueRequired: string
  readonly discountValueRange: string
  /** 정률인데 100을 넘겼다. 「전액보다 더 깎는 쿠폰」은 금액이 아니다. */
  readonly percentRange: string
  readonly maxDiscountAmountRange: string
  readonly minOrderAmountRange: string
  readonly issueLimitRange: string
  readonly validFromRequired: string
  readonly validUntilRequired: string
  /** 종료가 시작보다 앞이거나 같다. 하루도 열리지 않는 쿠폰이다. */
  readonly periodOrder: string
  /** 상품 지정인데 아무 상품도 고르지 않았다. */
  readonly scopeRequired: string
}

export interface CouponSchemaOptions {
  readonly messages: CouponFieldErrorMessages
}

function text(values: Record<string, unknown>, key: string): string {
  const value = values[key]

  return typeof value === 'string' ? value : ''
}

function isBlank(value: string): boolean {
  return value.trim() === ''
}

/**
 * 숫자 칸 하나. 비어 있으면 `undefined`, 숫자가 아니면 `NaN`.
 *
 * `NaN` 을 그대로 계약에 넘기는 것이 중요하다. `0` 이나 `undefined` 로 접으면
 * 「abc 를 입력했다」가 「입력하지 않았다」와 같은 문장을 받는다.
 */
function numeric(values: Record<string, unknown>, key: string): number | undefined {
  const raw = text(values, key)

  return isBlank(raw) ? undefined : Number(raw)
}

/**
 * `<input type="datetime-local">` 이 준 「그 지역의 벽시계」를 순간으로.
 *
 * 그 컨트롤은 시간대가 없는 문자열(`2026-09-10T09:00`)을 준다. 브라우저의 시간대로
 * 읽는 것이 판매자가 의도한 것이고 — 화면에 「9시」라고 쳤으면 자기 시계의 9시다 —
 * 서버가 받는 것은 그 순간의 UTC ISO 다. 여기서 접미사만 붙여 보내면 한국에서 친
 * 9시가 서버에서 오후 6시가 된다.
 *
 * 읽히지 않으면 빈 문자열이다. 계약의 `z.iso.datetime()` 이 그것을 거절하고, 그
 * 거절이 **그 칸에** 붙는다.
 */
export function toInstant(local: string): string {
  if (isBlank(local)) return ''

  const at = new Date(local)

  return Number.isNaN(at.getTime()) ? '' : at.toISOString()
}

/** 폼의 값을 계약의 요청으로. 판단은 아직 하나도 하지 않는다. */
function toRequest(values: Record<string, unknown>, sellerId: string): Record<string, unknown> {
  const scopeType = text(values, 'scopeType')
  const discountType = text(values, 'discountType')
  const scopeIds = values.scopeIds

  return {
    // **부담 주체는 고르는 값이 아니라 파생되는 값이다.** `sellerId` 가 실려 있는
    // 것이 곧 「판매자 쿠폰」이고, 그래서 이 폼에 발행자를 고르는 칸이 없다.
    sellerId,
    name: text(values, 'name'),
    discountType,
    discountValue: numeric(values, 'discountValue'),
    // 상한은 정률에만 뜻이 있다. 정액에 실어 보내면 계약이 「정액에서는 언제나
    // null」이라고 못박아 둔 것을 화면이 어기는 셈이 된다.
    maxDiscountAmount:
      discountType === 'PERCENT' ? (numeric(values, 'maxDiscountAmount') ?? null) : null,
    minOrderAmount: numeric(values, 'minOrderAmount') ?? 0,
    scopeType,
    // 스토어 전체 쿠폰에 상품 목록을 함께 보내지 않는다. 남아 있으면 범위를
    // 「스토어」로 바꾼 뒤에도 예전에 고른 상품이 요청에 실려 나간다.
    scopeIds: scopeType === 'PRODUCT' && Array.isArray(scopeIds) ? scopeIds : [],
    validFrom: toInstant(text(values, 'validFrom')),
    validUntil: toInstant(text(values, 'validUntil')),
    issueLimit: numeric(values, 'issueLimit') ?? null,
    withCode: values.withCode === true,
  }
}

/** 계약이 거절한 한 칸의 문장, 또는 계약 자신의 말. */
function sentenceFor(
  messages: CouponFieldErrorMessages,
  field: string,
  blank: boolean,
  fallback: string,
): string {
  if (field === 'name') return blank ? messages.nameRequired : messages.nameTooLong
  if (field === 'discountValue') {
    return blank ? messages.discountValueRequired : messages.discountValueRange
  }
  if (field === 'maxDiscountAmount') return messages.maxDiscountAmountRange
  if (field === 'minOrderAmount') return messages.minOrderAmountRange
  if (field === 'issueLimit') return messages.issueLimitRange
  if (field === 'validFrom') return messages.validFromRequired
  if (field === 'validUntil') return messages.validUntilRequired
  if (field === 'scopeIds') return messages.scopeRequired

  return fallback
}

/**
 * 계약이 통과시킨 뒤에도 남는 세 가지.
 *
 * 통과한 값 위에서 판단한다 — 문자열을 다시 파싱하지 않으므로 「100.5」 같은 입력은
 * 이미 계약이 걸렀고, 여기 오는 것은 전부 정수다.
 *
 * @returns 하나라도 걸렸으면 `true`
 */
function refuseExtras(
  request: CreateCouponRequest,
  ctx: z.RefinementCtx,
  messages: CouponFieldErrorMessages,
  input: unknown,
): boolean {
  const issues: readonly { readonly path: readonly string[]; readonly message: string }[] = [
    // 「전액보다 더 깎는 쿠폰」은 금액이 아니다. 계약은 이 상한을 정액 기준으로만
    // 들고 있어(1천만) 정률 200% 를 통과시킨다.
    ...(request.discountType === 'PERCENT' && request.discountValue > COUPON_PERCENT_MAX_VALUE
      ? [{ path: ['discountValue'], message: messages.percentRange }]
      : []),
    // 하루도 열리지 않는 쿠폰. 발행은 되고 아무에게도 나가지 않는다 — 그것이
    // 조용한 실패라 여기서 막는다.
    ...(Date.parse(request.validUntil) <= Date.parse(request.validFrom)
      ? [{ path: ['validUntil'], message: messages.periodOrder }]
      : []),
    // 상품 지정인데 상품이 없다. 계약의 `scopeIds` 에는 하한이 없어 빈 배열이
    // 통과하고, 그러면 **아무 상품에도 붙지 않는 쿠폰**이 발행된다.
    ...(request.scopeType === 'PRODUCT' && request.scopeIds.length === 0
      ? [{ path: ['scopeIds'], message: messages.scopeRequired }]
      : []),
  ]

  for (const issue of issues) {
    ctx.addIssue({ code: 'custom', path: [...issue.path], message: issue.message, input })
  }

  return issues.length > 0
}

/**
 * `POST /coupons` — 판매자 쿠폰 하나.
 *
 * `z.unknown().transform` 으로 계약을 **감싸는** 이유는 `store-form.ts` 와 같다:
 * 한국어 메시지를 붙이려고 규칙을 다시 쓰면 길이·상한·형식이 두 곳에 적히고, 그
 * 사본은 규칙이 옮겨 간 뒤에도 옛 문장을 계속 보여 준다. 이렇게 하면 허용되는 것을
 * 말하는 곳은 여전히 하나이고, 계약이 준 `path` 가 문장을 **그 칸 밑에** 놓는다.
 */
export function sellerCouponFormSchema(
  sellerId: string,
  { messages }: CouponSchemaOptions,
): z.ZodType<CreateCouponRequest> {
  return z.unknown().transform((input, ctx) => {
    const values: Record<string, unknown> =
      typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}
    const parsed = createCouponRequestSchema.safeParse(toRequest(values, sellerId))

    for (const issue of parsed.success ? [] : parsed.error.issues) {
      const field = issue.path.map((segment) => String(segment)).join('.')

      ctx.addIssue({
        code: 'custom',
        path: issue.path,
        message: sentenceFor(messages, field, isBlank(text(values, field)), issue.message),
        input,
      })
    }

    if (!parsed.success) return z.NEVER
    if (refuseExtras(parsed.data, ctx, messages, input)) return z.NEVER

    return parsed.data
  })
}
