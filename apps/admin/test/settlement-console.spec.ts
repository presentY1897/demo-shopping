/**
 * 정산 화면이 그리기 **전에** 하는 판단들 (TASK-0081).
 *
 * 이 파일이 재는 것은 화면이 아니라 그 뒤의 산수와 표다. 따로 재는 이유는 틀렸을 때
 * 조용하기 때문이다: 회차를 한 주 어긋나게 계산하는 화면은 「이 조건에 정산서가
 * 없습니다」를 멀쩡히 그리고, 지급완료에 승인 버튼을 내는 화면도 렌더링은 정상이며,
 * 따옴표를 놓친 CSV 는 **열리고, 읽히고, 틀린다.**
 *
 * `vitest.config.mjs` 가 네 모듈을 분기 100% 로 묶어 두는 이유가 같다.
 */

import { settlementStatuses } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import { CSV_BOM, csvCell, csvRow, exportFileName, settlementsToCsv } from '@/lib/settlements/csv'
import {
  settlementDateTime,
  settlementDay,
  settlementMoney,
  settlementPeriod,
} from '@/lib/settlements/format'
import { holdFormSchema } from '@/lib/settlements/hold-form'
import {
  calculationLines,
  EMPTY_SETTLEMENT_FILTERS,
  inclusiveEnd,
  isNarrowed,
  orderHref,
  periodEndOf,
  periodStartOf,
  queryOf,
  settlementHref,
} from '@/lib/settlements/settlement-console'
import {
  actionsFor,
  canBulkApprove,
  isLocked,
  permissionFor,
  settlementTransitions,
  statusVariant,
} from '@/lib/settlements/transitions'
import { settlementSearch } from '@/lib/settlements/console-api'
import { messagesFor } from '@/messages'

import { PERIOD_END, PERIOD_START, settlement } from './support/settlements'

const { settlements: copy } = messagesFor()

describe('상태가 내미는 버튼 (F3 · F4 · F5)', () => {
  /**
   * `apps/api/src/settlement/settlement-transitions.ts` 의 표와 **같아야 한다.**
   * 어긋나면 최악이 살아 있어 보이는 버튼과 그 답으로 오는 409 이고, 그때 화면은
   * 아무것도 잘못한 것처럼 보이지 않는다.
   */
  it('mirrors the transition table the API enforces', () => {
    expect(settlementTransitions).toEqual({
      PENDING: ['APPROVED', 'HOLD'],
      HOLD: ['APPROVED'],
      APPROVED: ['PAID'],
      PAID: [],
    })
  })

  it.each([
    ['PENDING', ['approve', 'hold']],
    ['HOLD', ['approve']],
    ['APPROVED', ['pay']],
    ['PAID', []],
  ] as const)('offers %s exactly %j', (status, expected) => {
    expect(actionsFor(status)).toEqual(expected)
  })

  /** 「지급완료된 정산서는 수정할 수 없다」는 조건문이 아니라 **빈 배열**이다. */
  it('locks a settlement that has nowhere left to go', () => {
    expect(isLocked('PAID')).toBe(true)
    expect(settlementStatuses.filter((status) => isLocked(status))).toEqual(['PAID'])
  })

  it('asks for a permission per action, and splits paying off from approving', () => {
    expect(permissionFor('approve')).toBe('settlement.approve')
    expect(permissionFor('hold')).toBe('settlement.approve')
    expect(permissionFor('pay')).toBe('settlement.pay')
  })

  /** 일괄 승인이 고를 수 있는 줄 — 승인으로 가는 화살표가 있는 상태뿐이다. */
  it('lets a bulk approval touch only what can still be approved (F6)', () => {
    expect(settlementStatuses.filter((status) => canBulkApprove(status))).toEqual([
      'PENDING',
      'HOLD',
    ])
  })

  /** 기다리는 줄이 끝난 줄과 같아 보이면 그 목록은 아무도 훑지 못한다. */
  it('paints every status, and paints the two that wait for a person differently', () => {
    expect(settlementStatuses.map((status) => statusVariant(status))).toEqual([
      'warning',
      'danger',
      'primary',
      'success',
    ])
  })
})

describe('회차 — 고른 날을 그 주로 접는다', () => {
  /**
   * 계약의 `periodStart` 는 **한 순간**이고 서버는 그것을 정확히 일치시킨다. 회차는
   * 언제나 월요일 자정 KST 에 시작하므로, 수요일을 그대로 보내면 아무것도 걸리지
   * 않고 화면은 「이 회차에는 정산서가 없습니다」라고 말한다.
   */
  it.each([
    ['2026-08-24', PERIOD_START],
    ['2026-08-26', PERIOD_START],
    ['2026-08-30', PERIOD_START],
    ['2026-08-31', PERIOD_END],
  ])('reads %s as the period that starts %s', (day, expected) => {
    expect(periodStartOf(day)).toBe(expected)
  })

  it('closes a period exactly where the next one opens', () => {
    expect(periodEndOf(PERIOD_START)).toBe(PERIOD_END)
  })

  /**
   * 열린 끝을 그대로 그리면 8월 24일 회차의 끝이 8월 31일이 되고 다음 회차의 시작도
   * 8월 31일이 된다 — 하루가 두 회차에 걸쳐 있는 것처럼 읽힌다.
   */
  it('draws the last day of a period, not the first day of the next', () => {
    expect(settlementDay(PERIOD_START)).toBe('2026. 8. 24.')
    // 서버가 보낸 열린 끝은 한국 시간으로 8월 31일이다. 그 하루를 되돌려야 회차가
    // 「8월 24일 ~ 8월 30일」이 된다.
    expect(settlementDay(PERIOD_END)).toBe('2026. 8. 31.')
    expect(settlementDay(inclusiveEnd(PERIOD_END))).toBe('2026. 8. 30.')
    expect(settlementPeriod(PERIOD_START, PERIOD_END, '{start} ~ {end}')).toBe(
      '2026. 8. 24. ~ 2026. 8. 30.',
    )
  })
})

describe('필터를 계약의 질의로', () => {
  it('asks for nothing while nothing is chosen', () => {
    expect(queryOf(EMPTY_SETTLEMENT_FILTERS)).toEqual({})
    expect(isNarrowed(EMPTY_SETTLEMENT_FILTERS)).toBe(false)
  })

  it('folds the chosen day into the period, and sends the status as a list', () => {
    expect(
      queryOf({ day: '2026-08-26', sellerId: null, sellerName: null, status: 'PENDING' }),
    ).toEqual({ periodStart: PERIOD_START, status: ['PENDING'] })
  })

  it('narrows to one store without carrying the name the screen shows', () => {
    const filters = {
      day: null,
      sellerId: '019596e0-0011-7000-8000-000000000001',
      sellerName: '루미에르',
      status: null,
    }

    expect(queryOf(filters)).toEqual({ sellerId: filters.sellerId })
    expect(isNarrowed(filters)).toBe(true)
  })

  it.each([
    [{ day: '2026-08-26' }, true],
    [{ status: 'HOLD' as const }, true],
    [{ sellerName: '루미에르' }, false],
  ])('knows whether %j narrows the list', (partial, expected) => {
    expect(isNarrowed({ ...EMPTY_SETTLEMENT_FILTERS, ...partial })).toBe(expected)
  })

  /** 상태는 **쉼표 하나**로 나간다. 반복 키는 프레임워크마다 다르게 파싱된다. */
  it('writes the query string the contract reads back', () => {
    expect(settlementSearch({})).toBe('')
    expect(
      settlementSearch({
        status: ['PENDING', 'HOLD'],
        sellerId: 'seller-1',
        periodStart: PERIOD_START,
        limit: 100,
        cursor: 'c1',
      }),
    ).toBe(
      `?status=PENDING%2CHOLD&sellerId=seller-1&periodStart=${encodeURIComponent(PERIOD_START)}&limit=100&cursor=c1`,
    )
  })
})

describe('계산 근거 다섯 줄 (F1)', () => {
  /**
   * TASK-0081 4장이 그린 그대로. **부호를 여기서 정한다** — 계약이 싣는 수수료와
   * 쿠폰은 양수이고 반품 차감은 이미 음수라, 셋을 같은 열에 세우려면 앞의 둘을
   * 뒤집어야 한다. 그 뒤집기가 표를 그리는 자리마다 흩어지면 언젠가 한 곳이 빠지고
   * **합이 맞지 않는 표**가 그려진다.
   */
  it('turns the four deductions into one column of signed amounts', () => {
    expect(calculationLines(settlement())).toEqual([
      { key: 'sales', amount: 1_890_000, total: false },
      { key: 'commission', amount: -189_000, total: false },
      { key: 'sellerCoupon', amount: -30_000, total: false },
      { key: 'returnAdjustment', amount: -120_000, total: false },
      { key: 'payout', amount: 1_551_000, total: true },
    ])
  })

  /**
   * 마지막 줄은 **저장된 값**이지 네 줄의 합이 아니다. 화면이 합을 다시 계산하면
   * 서버와 다른 답을 낼 수 있게 되고, 그때 옳은 것은 언제나 서버 쪽이다.
   */
  it('reads the payout off the settlement rather than adding the rows up', () => {
    const lines = calculationLines(settlement({ payoutAmount: -1_000 }))

    expect(lines.at(-1)).toEqual({ key: 'payout', amount: -1_000, total: true })
  })

  it('links a settlement and an order line to somewhere a person can go (F2)', () => {
    expect(settlementHref('s-1')).toBe('/settlements/s-1')
    expect(orderHref('20260824-001', 'so-1')).toBe(
      '/orders?orderNumber=20260824-001&sellerOrderId=so-1',
    )
  })
})

describe('금액과 시각', () => {
  /** 「원」을 붙이지 않는다. 기호도 자릿수도, 음수의 부호와 그 자리도 로케일의 답이다. */
  it('formats money from the currency, negatives included', () => {
    expect(settlementMoney(1_551_000)).toBe('₩1,551,000')
    expect(settlementMoney(-120_000)).toBe('-₩120,000')
  })

  /** 시간대를 넘기지 않으면 회차의 경계가 일요일로 보인다. */
  it('reads an instant in the console time zone', () => {
    expect(settlementDay(PERIOD_START)).toBe('2026. 8. 24.')
    // 시각은 `toContain` 이다 — 오전/오후의 표기는 런타임의 ICU 자료에 달렸고,
    // 이 검사가 재려는 것은 **어느 시간대로 읽느냐**다 (`format/date.spec.ts` 와
    // 같은 이유로 같은 모양).
    const dateTime = settlementDateTime('2026-08-31T00:10:00.000Z')

    expect(dateTime).toContain('2026. 8. 31.')
    expect(dateTime).toContain('9:10')
  })
})

describe('보류 사유 (F4)', () => {
  const schema = holdFormSchema(copy.actions.hold.errors)

  it('takes a reason and trims it', () => {
    expect(schema.parse({ reason: '  반품 분쟁 확인 중  ' })).toEqual({
      reason: '반품 분쟁 확인 중',
    })
  })

  /** 공백만 적은 것도 빈 사유다. 계약이 `trim().min(1)` 이므로 둘은 같은 거절이다. */
  it.each([[''], ['   '], ['\n\t']])('refuses %j on the field itself', (reason) => {
    const result = schema.safeParse({ reason })

    expect(result.success).toBe(false)
    expect(result.error?.issues).toEqual([
      expect.objectContaining({ path: ['reason'], message: copy.actions.hold.errors.required }),
    ])
  })

  it('refuses a reason that is too long, and says the limit', () => {
    const result = schema.safeParse({ reason: 'ㄱ'.repeat(501) })

    expect(result.error?.issues).toEqual([
      expect.objectContaining({
        path: ['reason'],
        message: copy.actions.hold.errors.tooLong.replace('{max}', '500'),
      }),
    ])
  })

  /** 칸이 아예 없는 값도 빈 사유다 — 폼이 무엇을 들고 있든 답은 하나여야 한다. */
  it.each([[{}], [{ reason: 42 }], [null], ['nope']])('reads %j as an empty reason', (input) => {
    expect(schema.safeParse(input).success).toBe(false)
  })
})

describe('CSV (F8)', () => {
  const options = {
    columns: copy.export.columns,
    emptyHoldReason: copy.export.emptyHoldReason,
    formatDay: (isoString: string) => isoString.slice(0, 10),
    statusLabels: copy.statusLabels,
  }

  /**
   * **감싸는 것은 언제나다.** 「필요할 때만」은 판단이고, 그 판단이 한 번 틀리면
   * 쉼표 하나가 열을 밀어 아래 모든 값이 한 칸씩 어긋난 파일이 나온다.
   */
  it.each([
    ['루미에르', '"루미에르"'],
    ['반품, 분쟁', '"반품, 분쟁"'],
    ['그는 "이상하다"고 했다', '"그는 ""이상하다""고 했다"'],
    ['두\n줄', '"두\n줄"'],
    [1_890_000, '"1890000"'],
    [-120_000, '"-120000"'],
  ])('quotes %j as %s', (value, expected) => {
    expect(csvCell(value)).toBe(expected)
  })

  it('joins a row with commas', () => {
    expect(csvRow(['a', 1])).toBe('"a","1"')
  })

  /**
   * **BOM 이 진짜로 필요하다.** 없으면 Excel 이 시스템 코드페이지로 읽어 한글이 전부
   * 깨지고, 증상은 「내보내기가 깨진다」이지 「인코딩을 안 알려 줬다」가 아니다.
   */
  it('starts with the byte order mark Excel needs, and ends every line the way RFC 4180 says', () => {
    const csv = settlementsToCsv([settlement()], options)

    expect(csv.startsWith(CSV_BOM)).toBe(true)
    expect(csv.endsWith('\r\n')).toBe(true)
    expect(csv.split('\r\n')).toHaveLength(3)
  })

  /**
   * **금액은 서식 없는 정수다.** `₩1,890,000` 을 넣으면 스프레드시트가 그것을
   * 문자열로 읽고, 그 열은 더해지지 않는다 — 파일을 받는 사람이 첫 번째로 하는 일이
   * 합계를 내는 일인데도.
   */
  it('writes amounts as plain integers a spreadsheet can add up', () => {
    const [, row] = settlementsToCsv([settlement()], options).split('\r\n')

    expect(row).toBe(
      [
        '"2026-08-23"',
        '"2026-08-30"',
        '"루미에르"',
        `"${copy.statusLabels.PENDING}"`,
        '"1890000"',
        '"189000"',
        '"30000"',
        '"-120000"',
        '"1551000"',
        '""',
      ].join(','),
    )
    expect(row).not.toContain('₩')
    expect(row).not.toContain(',0')
  })

  /** 회차의 끝은 **포함하는 날**이다. 열린 끝을 적으면 이웃한 두 회차가 겹쳐 보인다. */
  it('writes the last day of the period, not the first day of the next one', () => {
    const [, row] = settlementsToCsv([settlement()], options).split('\r\n')

    expect(row).toContain('"2026-08-30"')
    expect(row).not.toContain('"2026-08-31"')
  })

  it('carries the hold reason, and says so when there is none', () => {
    const [, held] = settlementsToCsv(
      [settlement({ status: 'HOLD', holdReason: '반품, 분쟁 확인 중' })],
      options,
    ).split('\r\n')

    expect(held).toContain('"반품, 분쟁 확인 중"')
  })

  it('is a header and nothing else when the filter chose nothing', () => {
    expect(settlementsToCsv([], options).split('\r\n')).toHaveLength(2)
  })

  /** 두 번 받으면 두 파일이어야 한다. */
  it('stamps the file name with the day it was taken', () => {
    expect(exportFileName('settlements', new Date(2026, 8, 6))).toBe('settlements_20260906.csv')
  })
})
