/**
 * 회원 화면의 순수 판단 (TASK-0093).
 *
 * 여기 있는 것들은 전부 **틀려도 조용하다** — 화면은 멀쩡히 그려지고 달라지는 것은
 * 「어떤 회원을 찾아 주는가」와 「얼마가 실제로 움직였다고 말하는가」뿐이다. 그래서
 * `vitest.config.mjs` 가 두 파일을 분기 100% 로 잡고, 이 파일이 그 문턱을 채운다.
 *
 * 입력 → 출력만 잰다. 렌더도 대역도 없다 (QUALITY-GATES 순수 로직).
 */

import type { ApiFailure } from '@shopping/shared'
import { ADMIN_REASON_MAX, adminUserListQueryParamsSchema } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import { userCount, userDateTime, userMoney, userSignedMoney } from '@/lib/users/format'
import { pointsFormSchema, reasonFormSchema } from '@/lib/users/forms'
import {
  EMPTY_USER_FILTERS,
  USER_SEARCH_MAX,
  grantableRoles,
  isAdminRole,
  isNarrowed,
  parseAmount,
  pointsOutcome,
  queryOf,
  refusalOf,
} from '@/lib/users/user-console'

import { pointsAnswer } from './support/users'

/** 서버가 답한 실패 하나. `createApiClient` 가 만드는 모양 그대로. */
function httpFailure(status: number): ApiFailure {
  return {
    kind: 'http',
    status,
    code: 'FORBIDDEN',
    message: '서버 문장',
    details: [],
    requestId: 'req-1',
  }
}

describe('필터', () => {
  it('is not narrowed by an empty filter, nor by whitespace somebody typed and erased', () => {
    expect(isNarrowed(EMPTY_USER_FILTERS)).toBe(false)
    expect(isNarrowed({ ...EMPTY_USER_FILTERS, q: '   ' })).toBe(false)
  })

  it('counts each axis on its own', () => {
    expect(isNarrowed({ ...EMPTY_USER_FILTERS, q: 'hong' })).toBe(true)
    expect(isNarrowed({ ...EMPTY_USER_FILTERS, role: 'SELLER_OWNER' })).toBe(true)
    expect(isNarrowed({ ...EMPTY_USER_FILTERS, isDemo: false })).toBe(true)
    expect(isNarrowed({ ...EMPTY_USER_FILTERS, suspended: false })).toBe(true)
  })

  /**
   * 값이 없는 축은 **열쇠 자체가 없다.** `undefined` 를 실어 보내면
   * `URLSearchParams` 가 `role=undefined` 를 만들고 서버는 400 으로 답한다.
   */
  it('leaves an unset axis out of the query rather than sending undefined', () => {
    expect(queryOf(EMPTY_USER_FILTERS)).toEqual({})
    expect(Object.keys(queryOf(EMPTY_USER_FILTERS))).toEqual([])
  })

  it('carries every axis that was set, and trims the search', () => {
    expect(queryOf({ q: '  hong  ', role: 'ADMIN_SUPER', isDemo: true, suspended: false })).toEqual(
      { q: 'hong', role: 'ADMIN_SUPER', isDemo: true, suspended: false },
    )
  })

  /**
   * 「거짓」은 **고르지 않음이 아니다.** `isDemo: false` 가 열쇠로 실려야 「실계정만」이
   * 되고, 빠지면 그 필터는 전체를 보여 준다.
   */
  it('sends a false as a value, not as an absence', () => {
    expect(queryOf({ ...EMPTY_USER_FILTERS, isDemo: false })).toEqual({ isDemo: false })
  })

  /** 화면이 옮겨 적은 상한이 계약과 같은가. 다르면 121자를 친 사람이 400 을 받는다. */
  it('mirrors the contract’s search limit', () => {
    expect(
      adminUserListQueryParamsSchema.safeParse({ q: 'x'.repeat(USER_SEARCH_MAX) }).success,
    ).toBe(true)
    expect(
      adminUserListQueryParamsSchema.safeParse({ q: 'x'.repeat(USER_SEARCH_MAX + 1) }).success,
    ).toBe(false)
  })
})

describe('역할', () => {
  /** `startsWith('ADMIN')` 으로 적으면 이 줄이 빠진다 — 그것도 콘솔에 들어오는 역할이다. */
  it('counts DEMO_ADMIN among the roles that need a confirmation', () => {
    expect(isAdminRole('DEMO_ADMIN')).toBe(true)
    expect(isAdminRole('ADMIN_OPERATOR')).toBe(true)
    expect(isAdminRole('ADMIN_SUPER')).toBe(true)
  })

  it('leaves the two everyday roles alone', () => {
    expect(isAdminRole('BUYER')).toBe(false)
    expect(isAdminRole('SELLER_OWNER')).toBe(false)
  })

  it('does not offer a role the account already holds', () => {
    expect(grantableRoles(['BUYER'])).not.toContain('BUYER')
    expect(grantableRoles(['BUYER'])).toContain('SELLER_OWNER')
  })

  it('offers nothing to an account that holds everything', () => {
    expect(
      grantableRoles(['BUYER', 'SELLER_OWNER', 'ADMIN_OPERATOR', 'ADMIN_SUPER', 'DEMO_ADMIN']),
    ).toEqual([])
  })
})

describe('조정 금액', () => {
  it('reads a signed integer', () => {
    expect(parseAmount('1000')).toBe(1000)
    expect(parseAmount(' -1000 ')).toBe(-1000)
  })

  /** `Number('')` 는 0이다. 빈 칸을 먼저 걸러야 「0원 조정」이 되지 않는다. */
  it('is null for an empty box rather than zero', () => {
    expect(parseAmount('')).toBeNull()
    expect(parseAmount('   ')).toBeNull()
  })

  it('refuses what is not an integer number of won', () => {
    expect(parseAmount('천원')).toBeNull()
    expect(parseAmount('1.5')).toBeNull()
  })

  /** 0은 여기서 막지 않는다 — 계약이 거절하고, 그 거절에는 그 나름의 문장이 있다. */
  it('lets a zero through so the contract can refuse it in its own words', () => {
    expect(parseAmount('0')).toBe(0)
  })
})

describe('실제로 움직인 몫', () => {
  it('says exact when the whole amount moved', () => {
    expect(pointsOutcome(1000, pointsAnswer(13_000, 1000))).toBe('exact')
  })

  /** 5만원을 빼려 했고 1만원만 빠졌다. 요청한 숫자를 그리면 그것이 거짓말이다. */
  it('says clipped when the balance stopped a deduction short', () => {
    expect(pointsOutcome(-50_000, pointsAnswer(0, -10_000))).toBe('clipped')
  })

  /** 잔액이 0인 계정의 차감은 **아무 줄도 남기지 않는다.** */
  it('says none when nothing moved at all', () => {
    expect(pointsOutcome(-50_000, pointsAnswer(0, 0))).toBe('none')
  })
})

describe('거절', () => {
  it('reads a 403 as a refusal this screen has its own sentence for', () => {
    expect(refusalOf(httpFailure(403))).toBe('forbidden')
  })

  /** 이미 정지된 회원을 또 정지하면 404 다. 다음 행동은 다시 읽는 것이다. */
  it('reads a 404 as somebody having got there first', () => {
    expect(refusalOf(httpFailure(404))).toBe('stale')
  })

  it('leaves an ordinary failure to the catalog', () => {
    expect(refusalOf(httpFailure(500))).toBeNull()
    expect(refusalOf({ kind: 'transport', reason: 'network' })).toBeNull()
  })
})

describe('폼', () => {
  const reasonCopy = { reasonRequired: '사유를 적어 주세요.', reasonTooLong: '{max}자까지요.' }

  it('accepts a reason and hands back the trimmed value', () => {
    const parsed = reasonFormSchema(reasonCopy).safeParse({ reason: '  문의 확인  ' })

    expect(parsed.success && parsed.data.reason).toBe('문의 확인')
  })

  /** 공백만 적은 것과 비운 것은 사람에게 같은 실수다. */
  it('refuses whitespace with the same sentence as an empty box', () => {
    const parsed = reasonFormSchema(reasonCopy).safeParse({ reason: '   ' })

    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues[0]?.message).toBe(reasonCopy.reasonRequired)
  })

  it('interpolates the contract’s limit into the too-long sentence', () => {
    const parsed = reasonFormSchema(reasonCopy).safeParse({
      reason: 'x'.repeat(ADMIN_REASON_MAX + 1),
    })

    expect(parsed.error?.issues[0]?.message).toBe(`${String(ADMIN_REASON_MAX)}자까지요.`)
  })

  it('reads nothing at all as an empty reason rather than throwing', () => {
    expect(reasonFormSchema(reasonCopy).safeParse(undefined).success).toBe(false)
  })

  const pointsCopy = {
    ...reasonCopy,
    amountRequired: '금액을 적어 주세요.',
    amountZero: '0원은 조정이 아닙니다.',
  }

  it('carries a signed amount and its reason through to the request', () => {
    const parsed = pointsFormSchema(pointsCopy).safeParse({ amount: '-1000', reason: '보상 회수' })

    expect(parsed.success && parsed.data).toEqual({ amount: -1000, reason: '보상 회수' })
  })

  /** 「비었다」와 「0이다」는 사람이 고쳐야 할 것이 다르다. */
  it('tells an empty amount apart from a zero', () => {
    const empty = pointsFormSchema(pointsCopy).safeParse({ amount: '', reason: '사유' })
    const zero = pointsFormSchema(pointsCopy).safeParse({ amount: '0', reason: '사유' })

    expect(empty.error?.issues[0]?.message).toBe(pointsCopy.amountRequired)
    expect(zero.error?.issues[0]?.message).toBe(pointsCopy.amountZero)
  })

  it('places one sentence per box when both are wrong', () => {
    const parsed = pointsFormSchema(pointsCopy).safeParse({ amount: '', reason: '' })

    expect(parsed.error?.issues.map((issue) => issue.path[0])).toEqual(['amount', 'reason'])
  })
})

describe('형식', () => {
  /** 시간대를 넘기지 않으면 같은 순간이 서버와 브라우저에서 다른 날로 그려진다. */
  it('draws an instant in Seoul time', () => {
    expect(userDateTime('2026-09-06T15:30:00.000Z')).toContain('2026')
  })

  it('draws money from the currency rather than by appending 원', () => {
    expect(userMoney(348_000)).toBe('₩348,000')
  })

  it('groups a plain count', () => {
    expect(userCount(12_345)).toBe('12,345')
  })

  /** 부호가 금액의 절반이다 — 「50,000원 조정」은 어느 쪽인지 말하지 않는다. */
  it('always draws the sign of an adjustment', () => {
    expect(userSignedMoney(1000)).toBe('+₩1,000')
    expect(userSignedMoney(-1000)).toBe('-₩1,000')
  })
})
