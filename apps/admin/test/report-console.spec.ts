/**
 * 신고 화면이 그리기 **전에** 하는 판단들 (TASK-0091).
 *
 * 이 파일이 재는 것은 화면이 아니라 그 뒤의 표들이다. 따로 재는 이유는 틀렸을 때
 * 조용하기 때문이다: 상태 묶음이 어긋난 화면은 「이 조건에 신고가 없습니다」를 멀쩡히
 * 그리고, 상품에 삭제 버튼을 내는 화면도 렌더링은 정상이며, **반려의 효과가 뒤집혀도**
 * 화면은 「반려하면 다시 보입니다」를 그대로 그리면서 아무것도 복구하지 않는다.
 *
 * `vitest.config.mjs` 가 두 모듈을 분기 100% 로 묶어 두는 이유가 같다.
 */

import type { ApiFailure } from '@shopping/shared'
import { reportReasons, reportStatuses, reportTargetTypes } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import { reportSearch } from '@/lib/reports/console-api'
import { reportDateTime } from '@/lib/reports/format'
import { handleFormSchema } from '@/lib/reports/handle-form'
import {
  canHandle,
  effectOf,
  isDestructive,
  outcomesFor,
  removable,
  REPORT_EFFECT,
  reportOutcomes,
  statusVariant,
} from '@/lib/reports/outcomes'
import {
  EMPTY_REPORT_FILTERS,
  isNarrowed,
  queryOf,
  refusalOf,
  reportScopes,
  statusesOf,
} from '@/lib/reports/report-console'
import { messagesFor } from '@/messages'

const { reports: copy } = messagesFor()

/** 서버가 실제로 답하는 모양의 실패. */
function httpFailure(status: number, code: string): ApiFailure {
  return { kind: 'http', status, code, message: '서버 문장', details: [], requestId: null }
}

describe('대상이 내미는 처리 (F4 · 4.4)', () => {
  /**
   * `apps/api/src/reports/report-rules.ts` 의 `REPORT_EFFECT` 와 **같아야 한다.**
   *
   * 가장 중요한 줄은 `REJECTED: 'reveal'` 이다. 그것이 뒤집히면 화면은 반려를
   * 「아무 일도 안 함」으로 설명하게 되고, 자동 임시 숨김에 걸린 멀쩡한 글은 신고 세
   * 번에 영영 가려진 채 남는다 (TASK-0091 4.2).
   */
  it('mirrors the effect table the API enforces', () => {
    expect(REPORT_EFFECT).toEqual({ HIDDEN: 'hide', REMOVED: 'remove', REJECTED: 'reveal' })
  })

  it('offers deletion for everything that can be deleted', () => {
    expect(outcomesFor('REVIEW')).toEqual(['HIDDEN', 'REMOVED', 'REJECTED'])
    expect(outcomesFor('QUESTION')).toEqual(['HIDDEN', 'REMOVED', 'REJECTED'])
    expect(outcomesFor('ANSWER')).toEqual(['HIDDEN', 'REMOVED', 'REJECTED'])
  })

  /**
   * 상품은 주문·정산·리뷰가 가리키는 행이다. 버튼을 내면 서버는 409
   * (`REPORT_NOT_REMOVABLE`) 로 답하고, 그 왕복에서 사람이 배우는 것은 없다.
   */
  it('never offers deletion for a product', () => {
    expect(removable('PRODUCT')).toBe(false)
    expect(outcomesFor('PRODUCT')).toEqual(['HIDDEN', 'REJECTED'])
  })

  it('keeps the order of the choices the same whichever target it is', () => {
    for (const target of reportTargetTypes) {
      const offered = outcomesFor(target)

      expect(offered).toEqual(reportOutcomes.filter((outcome) => offered.includes(outcome)))
    }
  })

  it('calls exactly one outcome irreversible', () => {
    expect(reportOutcomes.filter(isDestructive)).toEqual(['REMOVED'])
    expect(effectOf('REJECTED')).toBe('reveal')
  })

  it('lets only a pending report be handled', () => {
    expect(reportStatuses.filter(canHandle)).toEqual(['PENDING'])
  })

  it('paints the four statuses four different ways', () => {
    const painted = reportStatuses.map(statusVariant)

    expect(new Set(painted).size).toBe(reportStatuses.length)
    expect(statusVariant('PENDING')).toBe('warning')
    expect(statusVariant('REMOVED')).toBe('danger')
  })

  it('names every status, target and reason the contract can send', () => {
    for (const status of reportStatuses) expect(copy.statusLabels[status]).not.toBe('')
    for (const target of reportTargetTypes) expect(copy.targetTypeLabels[target]).not.toBe('')
    for (const reason of reportReasons) expect(copy.reasonLabels[reason]).not.toBe('')
  })
})

describe('필터가 만드는 질의', () => {
  it('asks for nothing when nothing is narrowed', () => {
    expect(queryOf(EMPTY_REPORT_FILTERS)).toEqual({})
    expect(isNarrowed(EMPTY_REPORT_FILTERS)).toBe(false)
  })

  /**
   * 계약의 `status` 는 **목록**이다. 「처리됨」 하나가 셋을 뜻하는 것이 이 축의 요점이고,
   * 그것이 없으면 끝난 것을 훑는 사람은 세 번 골라 봐야 한다.
   */
  it('folds 처리됨 into the three statuses the contract knows', () => {
    expect(statusesOf('HANDLED')).toEqual(['HIDDEN', 'REMOVED', 'REJECTED'])
    expect(queryOf({ scope: 'HANDLED', targetType: null })).toEqual({
      status: ['HIDDEN', 'REMOVED', 'REJECTED'],
    })
  })

  it('sends a single status as a one-item list', () => {
    expect(queryOf({ scope: 'PENDING', targetType: null })).toEqual({ status: ['PENDING'] })
  })

  it('carries the target type on its own axis', () => {
    expect(queryOf({ scope: null, targetType: 'PRODUCT' })).toEqual({ targetType: 'PRODUCT' })
    expect(isNarrowed({ scope: null, targetType: 'PRODUCT' })).toBe(true)
    expect(isNarrowed({ scope: 'PENDING', targetType: null })).toBe(true)
  })

  it('names every scope the filter can offer', () => {
    for (const scope of reportScopes) expect(copy.list.scopeLabels[scope]).not.toBe('')
  })

  /**
   * 값이 없는 축은 **키 자체가 없어야** 한다. `undefined` 를 실으면
   * `URLSearchParams` 가 `status=undefined` 를 만들고 서버는 400 으로 답한다.
   */
  it('joins the status list with one comma and leaves empty axes out', () => {
    expect(reportSearch(queryOf({ scope: 'HANDLED', targetType: 'REVIEW' }))).toBe(
      '?status=HIDDEN%2CREMOVED%2CREJECTED&targetType=REVIEW',
    )
    expect(reportSearch({})).toBe('')
    expect(reportSearch({ limit: 20, cursor: 'next' })).toBe('?limit=20&cursor=next')
  })
})

describe('거절을 읽는 법 (F7)', () => {
  /**
   * 데모 관리자는 목록을 전부 읽지만 실계정의 글에는 403 을 받는다 (D-058). 카탈로그의
   * `FORBIDDEN` 은 「권한이 없어요」 한 줄이라 **왜 어떤 줄은 되고 어떤 줄은 안 되는지**를
   * 말하지 못한다.
   */
  it('tells a demo administrator’s refusal apart from an ordinary failure', () => {
    expect(refusalOf(httpFailure(403, 'FORBIDDEN'))).toBe('forbidden')
    expect(copy.handle.refusals.forbidden).toContain('데모 관리자')
  })

  it('reads a lost race as “read the list again”', () => {
    expect(refusalOf(httpFailure(409, 'REPORT_ALREADY_HANDLED'))).toBe('stale')
  })

  /** 나머지는 카탈로그가 코드로 문장을 고른다. 여기서 되풀이하지 않는다. */
  it('leaves every other failure to the catalog', () => {
    expect(refusalOf(httpFailure(409, 'REPORT_NOT_REMOVABLE'))).toBeNull()
    expect(refusalOf(httpFailure(500, 'INTERNAL_ERROR'))).toBeNull()
    expect(refusalOf({ kind: 'transport', reason: 'network' })).toBeNull()
  })
})

describe('처리 폼', () => {
  const schema = handleFormSchema(copy.handle.errors)

  it('accepts a chosen outcome with a reason', () => {
    expect(schema.parse({ outcome: 'HIDDEN', note: '  욕설이 확인되어 가립니다.  ' })).toEqual({
      outcome: 'HIDDEN',
      note: '욕설이 확인되어 가립니다.',
    })
  })

  it('asks for an outcome before anything else', () => {
    const result = schema.safeParse({ outcome: '', note: '사유' })

    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['outcome'])
    expect(result.error?.issues[0]?.message).toBe(copy.handle.errors.outcomeRequired)
  })

  /**
   * 공백만 적은 것도 빈 사유다. 계약이 `trim().min(1)` 이라 서버도 거절하지만, 그
   * 왕복에서 사람이 배우는 것은 없다 — 그리고 이 문장은 **신고자에게 그대로 간다.**
   */
  it('refuses a reason that is only whitespace', () => {
    const result = schema.safeParse({ outcome: 'REJECTED', note: '   ' })

    expect(result.error?.issues[0]?.path).toEqual(['note'])
    expect(result.error?.issues[0]?.message).toBe(copy.handle.errors.noteRequired)
  })

  it('says how long a reason may be, with the number the contract holds', () => {
    const result = schema.safeParse({ outcome: 'REJECTED', note: 'ㄱ'.repeat(501) })

    expect(result.error?.issues[0]?.message).toBe(
      copy.handle.errors.noteTooLong.replace('{max}', '500'),
    )
  })

  it('treats a value that is not even an object as an empty form', () => {
    const result = schema.safeParse(null)

    expect(result.error?.issues[0]?.path).toEqual(['outcome'])
  })

  it('treats a non-string note as an empty one', () => {
    const result = schema.safeParse({ outcome: 'HIDDEN', note: 42 })

    expect(result.error?.issues[0]?.message).toBe(copy.handle.errors.noteRequired)
  })
})

describe('시각', () => {
  /**
   * 시간대를 넘기지 않으면 서버 렌더는 컨테이너의 시간대로, 브라우저는 방문자의
   * 시간대로 같은 순간을 **다른 날**로 그린다.
   */
  it('draws an instant in the console’s time zone', () => {
    expect(reportDateTime('2026-09-05T15:30:00.000Z')).toBe('2026. 9. 6. AM 12:30')
  })
})
