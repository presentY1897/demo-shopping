/**
 * 데모 관리 화면의 순수 판단 (TASK-0096).
 *
 * 여기 있는 것들은 전부 **틀려도 조용하다** — 화면은 멀쩡한 표를 그리고, 달라지는
 * 것은 「어느 계정이 곧 사라지는가」와 「정리가 실패했는가」뿐이다. 그래서
 * `vitest.config.mjs` 가 두 파일을 분기 100% 로 잡고, 이 파일이 그 문턱을 채운다.
 *
 * 입력 → 출력만 잰다. 렌더도 대역도 없다 (QUALITY-GATES 순수 로직).
 */

import { demoPolicySchema } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import {
  DEMO_STATS_DEFAULT_DAYS,
  DEMO_STATS_MAX_DAYS,
  POLICY_FIELDS,
  cleanupFailureOf,
  dayCount,
  defaultDemoStatsPeriod,
  expiryStatus,
  kstDay,
  parseInteger,
  periodProblem,
  policyProblems,
  roleCounts,
  shiftDay,
} from '@/lib/demo/demo-console'
import { demoCount, demoDateTime, demoDay, demoMoney } from '@/lib/demo/format'
import { policyFormSchema } from '@/lib/demo/policy-form'

import { DEMO_NOW, demoAccount } from './support/demo-console'

describe('기간', () => {
  /** 자정 직후 서울에서 「어제」가 되지 않게 한다. */
  it('reads the KST calendar day, not the UTC one', () => {
    expect(kstDay(new Date('2026-09-06T16:00:00.000Z'))).toBe('2026-09-07')
    expect(kstDay(new Date('2026-09-06T14:00:00.000Z'))).toBe('2026-09-06')
  })

  it('walks a day forwards and backwards across a month boundary', () => {
    expect(shiftDay('2026-09-01', -1)).toBe('2026-08-31')
    expect(shiftDay('2026-08-31', 1)).toBe('2026-09-01')
  })

  it('opens on the last two weeks, ending today', () => {
    const period = defaultDemoStatsPeriod(DEMO_NOW)

    expect(period.to).toBe('2026-09-07')
    expect(dayCount(period)).toBe(DEMO_STATS_DEFAULT_DAYS)
  })

  /** 서버는 거꾸로 고른 기간을 하루로 접어 200 으로 답한다 — 화면이 먼저 말한다. */
  it('names a reversed period rather than sending it', () => {
    expect(periodProblem({ from: '2026-09-07', to: '2026-09-01' })).toBe('reversed')
  })

  /**
   * 날짜 칸을 지우는 순간 브라우저가 주는 것은 빈 문자열이다. 그대로 보내면 서버가
   * `from=` 을 400 으로 답하고, 화면이 할 수 있는 말은 어느 칸인지도 못 짚는 한 줄뿐이다.
   * 빈 문자열은 어떤 날짜보다도 작아 「거꾸로 골랐다」로 잘못 읽히기도 한다.
   */
  it('names an empty box as an unfinished period, not as a reversed one', () => {
    expect(periodProblem({ from: '', to: '2026-09-07' })).toBe('incomplete')
    expect(periodProblem({ from: '2026-09-01', to: '' })).toBe('incomplete')
  })

  it('names a period longer than the server would answer', () => {
    const to = '2026-09-07'

    expect(periodProblem({ from: shiftDay(to, -(DEMO_STATS_MAX_DAYS - 1)), to })).toBeNull()
    expect(periodProblem({ from: shiftDay(to, -DEMO_STATS_MAX_DAYS), to })).toBe('tooLong')
  })
})

describe('만료', () => {
  const now = DEMO_NOW.getTime()

  /** 계약이 `expiresAt` 을 nullable 로 싣는다. 빈칸이면 「못 읽었다」와 섞인다. */
  it('has a word for an account with no expiry at all', () => {
    expect(expiryStatus(null, now)).toBe('none')
  })

  it('separates an account that is already past its time', () => {
    expect(expiryStatus('2026-09-07T02:00:00.000Z', now)).toBe('expired')
  })

  /** 여섯 시간 남은 계정은 사실이고, 이십 분 남은 계정은 곧 정리 대상이다. */
  it('separates the last hour from the rest of the life', () => {
    expect(expiryStatus('2026-09-07T03:20:00.000Z', now)).toBe('endingSoon')
    expect(expiryStatus('2026-09-07T09:00:00.000Z', now)).toBe('live')
  })
})

describe('정리 실패', () => {
  it('is nothing at all for an account that was never swept badly', () => {
    expect(cleanupFailureOf(demoAccount())).toBeNull()
  })

  /**
   * 시각과 이유는 **짝**이다(`User_demo_cleanup_failure_check`). 계약은 둘을 따로
   * nullable 로 싣지만, 한쪽만 보고 그리면 **이유 없는 실패**가 표에 선다.
   */
  it('is nothing when only one half of the pair arrived', () => {
    expect(
      cleanupFailureOf(
        demoAccount({ cleanupError: '주문이 남아 있습니다', cleanupFailedAt: null }),
      ),
    ).toBeNull()
    expect(
      cleanupFailureOf(
        demoAccount({ cleanupError: null, cleanupFailedAt: '2026-09-07T02:00:00.000Z' }),
      ),
    ).toBeNull()
  })

  it('carries both halves when the account really failed', () => {
    expect(
      cleanupFailureOf(
        demoAccount({
          cleanupError: '주문이 남아 있습니다',
          cleanupFailedAt: '2026-09-07T02:00:00.000Z',
        }),
      ),
    ).toEqual({ at: '2026-09-07T02:00:00.000Z', reason: '주문이 남아 있습니다' })
  })
})

describe('역할별 통계', () => {
  it('is empty when nothing was issued', () => {
    expect(roleCounts({})).toEqual([])
  })

  /** 객체는 순서를 약속하지 않는다. 두 번의 조회가 다른 순서로 그리면 읽을 수 없다. */
  it('puts the known roles in the contract’s order, whatever order they arrived in', () => {
    expect(roleCounts({ SELLER_OWNER: 2, BUYER: 5 }).map((row) => row.role)).toEqual([
      'BUYER',
      'SELLER_OWNER',
    ])
  })

  /** 모르는 열쇠를 숨기면 역할별 합이 조용히 전체와 어긋난다. */
  it('keeps a role this console has never heard of, at the end and marked', () => {
    const rows = roleCounts({ BUYER: 5, MODERATOR: 1 })

    expect(rows.map((row) => row.role)).toEqual(['BUYER', 'MODERATOR'])
    expect(rows.map((row) => row.named)).toEqual([true, false])
  })

  it('carries the counts through unchanged', () => {
    expect(roleCounts({ BUYER: 5 })[0]?.issued).toBe(5)
  })
})

describe('정책', () => {
  /** 계약에 칸이 하나 늘면 화면의 목록도 함께 늘어야 한다. */
  it('names exactly the fields the contract has', () => {
    expect([...POLICY_FIELDS].sort()).toEqual(Object.keys(demoPolicySchema.shape).sort())
  })

  it('reads an integer and refuses what is not one', () => {
    expect(parseInteger(' 24 ')).toBe(24)
    expect(parseInteger('')).toBeNull()
    expect(parseInteger('1.5')).toBeNull()
  })

  it('finds nothing wrong with a policy the contract accepts', () => {
    expect(
      policyProblems({ ttlHours: '24', seedOrders: '3', virtualCardLimit: '5000000' }),
    ).toEqual({})
  })

  it('marks an empty box as needing a value', () => {
    expect(policyProblems({ ttlHours: '', seedOrders: '3', virtualCardLimit: '5000000' })).toEqual({
      ttlHours: 'required',
    })
  })

  /**
   * 수명이 0이면 발급되는 즉시 만료된 계정이 나오고, 그 증상은 「데모가 안 된다」로만
   * 보인다 (4.4). 위도 막는다 — 30일짜리 데모는 데모가 아니라 계정이다.
   */
  it('marks a value the contract would refuse as out of range', () => {
    expect(policyProblems({ ttlHours: '0', seedOrders: '3', virtualCardLimit: '5000000' })).toEqual(
      {
        ttlHours: 'range',
      },
    )
    expect(
      policyProblems({ ttlHours: '721', seedOrders: '3', virtualCardLimit: '5000000' }),
    ).toEqual({ ttlHours: 'range' })
  })

  it('marks every wrong box at once', () => {
    expect(policyProblems({ ttlHours: '', seedOrders: '999', virtualCardLimit: 'x' })).toEqual({
      ttlHours: 'required',
      seedOrders: 'range',
      virtualCardLimit: 'required',
    })
  })
})

describe('정책 폼', () => {
  const copy = {
    ttlHours: { required: '수명을 적어 주세요.', range: '{min}~{max}시간까지요.' },
    seedOrders: { required: '주문 수를 적어 주세요.', range: '{min}~{max}건까지요.' },
    virtualCardLimit: { required: '한도를 적어 주세요.', range: '{min}~{max}원까지요.' },
  }

  it('hands back the contract’s own object when everything fits', () => {
    const parsed = policyFormSchema(copy).safeParse({
      ttlHours: '1',
      seedOrders: '0',
      virtualCardLimit: '1000',
    })

    expect(parsed.success && parsed.data).toEqual({
      ttlHours: 1,
      seedOrders: 0,
      virtualCardLimit: 1000,
    })
  })

  /**
   * 범위를 손으로 적지 않는다 — 문장의 두 수는 `demoPolicySchema` 에서 읽어 온 것이다.
   * 이 검사가 깨지면 화면이 「1~720 사이로」라고 안내한 뒤 서버가 거절하는 상태다.
   */
  it('fills the sentence from the contract’s own bounds', () => {
    const parsed = policyFormSchema(copy).safeParse({
      ttlHours: '721',
      seedOrders: '3',
      virtualCardLimit: '5000000',
    })

    expect(parsed.error?.issues[0]?.message).toBe('1~720시간까지요.')
  })

  it('places one sentence per box', () => {
    const parsed = policyFormSchema(copy).safeParse({
      ttlHours: '',
      seedOrders: '',
      virtualCardLimit: '',
    })

    expect(parsed.error?.issues.map((issue) => issue.path[0])).toEqual([...POLICY_FIELDS])
  })

  it('reads nothing at all as three empty boxes rather than throwing', () => {
    expect(policyFormSchema(copy).safeParse(undefined).success).toBe(false)
  })
})

describe('형식', () => {
  it('draws an instant in Seoul time', () => {
    expect(demoDateTime('2026-09-06T15:30:00.000Z')).toContain('2026')
  })

  it('draws a KST calendar day with no clock on it', () => {
    expect(demoDay('2026-09-07')).toContain('2026')
  })

  it('groups a plain count', () => {
    expect(demoCount(12_345)).toBe('12,345')
  })

  it('draws the card limit from the currency rather than by appending 원', () => {
    expect(demoMoney(5_000_000)).toBe('₩5,000,000')
  })
})
