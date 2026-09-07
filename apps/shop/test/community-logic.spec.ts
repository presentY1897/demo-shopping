/**
 * M13 이 화면을 그리기 전에 내리는 판단들 (TASK-0086~0091).
 *
 * 일곱 모듈이 여기 모여 있는 이유는 하나다 — **전부 틀려도 조용하다.** 담을 때
 * 가격과 지금 가격을 거꾸로 빼면 인하가 인상으로 그려지고, 로컬 이력의 순서를
 * 잘못 세우면 로그인 직후의 「최근 본 상품」이 실제 순서를 잃으며, 밀도별 노출이
 * 어긋나면 미니멀 상품 페이지에 문의 목록이 붙는다. 폴링이 멈추지 않아도 화면은
 * 멀쩡하고, 신고 폼의 검증이 빠져도 서버가 대신 거절해 준다. 어느 것도 빨간 검사를
 * 만들지 않는다.
 *
 * 그래서 이 일곱은 `vitest.config.mjs` 의 문턱 목록에 있고, 이 파일이 그 문턱을
 * 채운다 — 리뷰의 `review-logic.spec.ts` 와 같은 자리, 같은 이유다.
 */

import type { Notification, NotificationType, RecentlyViewedItem } from '@shopping/shared'
import {
  QUESTION_CONTENT_MAX,
  QUESTION_LIST_DEFAULT_LIMIT,
  RECENTLY_VIEWED_MERGE_MAX,
  REPORT_DETAIL_MAX,
} from '@shopping/shared'
import { DENSITY_LEVELS } from '@shopping/ui'
import { describe, expect, it } from 'vitest'

import { mergeRequest, parseLocalHistory, recordLocalView } from '@/lib/collections/local-history'
import { priceChange } from '@/lib/collections/price-change'
import { isShopNotification, shopNotifications } from '@/lib/notifications/notification-scope'
import { NOTIFICATION_POLL_MS, pollDecision } from '@/lib/notifications/polling'
import { QUESTION_PAGE_SIZE, questionExposure } from '@/lib/questions/qna-exposure'
import { questionDraftIssues } from '@/lib/questions/question-draft'
import { reportDraftIssues, reportRequest } from '@/lib/reports/report-draft'

describe('가격 변동 — 담을 때와 지금 (TASK-0086 F5)', () => {
  it('says how much it dropped, in won rather than in percent', () => {
    // 백분율은 반올림을 한 번 해야 하고, 어느 쪽으로 해도 틀린다 — 올리면 실제보다
    // 큰 인하를 주장하고, 내리면 0.6% 인하가 「0%」가 된다.
    expect(priceChange(99_000, 89_000)).toEqual({ kind: 'dropped', amount: 10_000 })
    expect(priceChange(89_000, 99_000)).toEqual({ kind: 'raised', amount: 10_000 })
  })

  it('says nothing when the price is the same', () => {
    // 모든 줄에 「변동 없음」을 적으면 정말 변한 줄이 묻힌다.
    expect(priceChange(89_000, 89_000)).toEqual({ kind: 'same' })
  })

  it('separates 품절 from 「담을 때도 없었다」', () => {
    // 둘 다 비교할 수 없지만 사람이 할 일이 다르다 — 앞은 재입고 알림을 걸고,
    // 뒤는 애초에 비교할 지난 값이 없다.
    expect(priceChange(49_000, null)).toEqual({ kind: 'gone' })
    expect(priceChange(null, 49_000)).toEqual({ kind: 'unknown' })
    expect(priceChange(null, null)).toEqual({ kind: 'gone' })
  })
})

describe('로컬 이력 — 비로그인 최근 본 상품 (TASK-0087 F6)', () => {
  const item = (index: number, viewedAt: string): RecentlyViewedItem => ({
    productId: `019596d0-1f1c-7c2e-9a0e-1100000000${String(index).padStart(2, '0')}`,
    productName: `상품 ${String(index)}`,
    brandName: '루미크',
    thumbnailUrl: null,
    price: 10_000,
    viewedAt,
  })

  describe('읽기', () => {
    it('is an empty list when nothing has been stored', () => {
      expect(parseLocalHistory(null)).toEqual([])
    })

    it('is an empty list rather than a crash when the value is not JSON', () => {
      // 이력을 못 읽는 것은 사람이 할 일이 있는 실패가 아니다 — 스트립 하나가 안
      // 보일 뿐이고, 그 자리에 오류 문장을 그리면 아무도 고칠 수 없다.
      expect(parseLocalHistory('{not json')).toEqual([])
    })

    it('refuses a shape the contract would not have produced', () => {
      // 브라우저에 남아 있는 것이 우리가 지난번에 적은 값이라는 보장이 없다.
      expect(parseLocalHistory('{"items":[]}')).toEqual([])
      expect(parseLocalHistory('[{"productId":"not-a-uuid"}]')).toEqual([])
    })

    it('sorts what it read, newest first', () => {
      const stored = JSON.stringify([
        item(1, '2026-09-01T00:00:00.000Z'),
        item(2, '2026-09-05T00:00:00.000Z'),
      ])

      expect(parseLocalHistory(stored).map((entry) => entry.productName)).toEqual([
        '상품 2',
        '상품 1',
      ])
    })

    it('cuts a stored list down to what a merge could carry', () => {
      const many = Array.from({ length: RECENTLY_VIEWED_MERGE_MAX + 5 }, (_unused, index) =>
        item(index, `2026-09-0${String((index % 5) + 1)}T00:00:00.000Z`),
      )

      expect(parseLocalHistory(JSON.stringify(many))).toHaveLength(RECENTLY_VIEWED_MERGE_MAX)
    })
  })

  describe('기록', () => {
    it('puts a new view at the front', () => {
      const history = [item(1, '2026-09-01T00:00:00.000Z')]

      expect(
        recordLocalView(history, item(2, '2026-09-05T00:00:00.000Z')).map((e) => e.productName),
      ).toEqual(['상품 2', '상품 1'])
    })

    it('keeps one row per product, and the later view wins', () => {
      // 서버의 병합이 같은 규칙이라, 로그인 전후로 목록이 같은 방식으로 움직인다.
      const history = [item(1, '2026-09-01T00:00:00.000Z')]
      const again = recordLocalView(history, item(1, '2026-09-05T00:00:00.000Z'))

      expect(again).toHaveLength(1)
      expect(again[0]?.viewedAt).toBe('2026-09-05T00:00:00.000Z')
    })

    it('does not let an older view push a newer one back', () => {
      const history = [item(1, '2026-09-05T00:00:00.000Z')]
      const older = recordLocalView(history, item(1, '2026-09-01T00:00:00.000Z'))

      expect(older[0]?.viewedAt).toBe('2026-09-05T00:00:00.000Z')
    })

    it('drops the oldest once the cap is reached', () => {
      const history = [item(1, '2026-09-01T00:00:00.000Z'), item(2, '2026-09-02T00:00:00.000Z')]
      const capped = recordLocalView(history, item(3, '2026-09-03T00:00:00.000Z'), 2)

      expect(capped.map((entry) => entry.productName)).toEqual(['상품 3', '상품 2'])
    })
  })

  describe('병합 요청', () => {
    it('is null when there is nothing to send', () => {
      // 계약이 한 개 이상을 요구한다. 빈 배열을 보내면 400 이 돌아오고, 그 400 은
      // 아무 일도 없었다는 사실을 실패처럼 보이게 한다.
      expect(mergeRequest([])).toBeNull()
    })

    it('sends ids and times only — the server reads the rest itself', () => {
      const request = mergeRequest([item(1, '2026-09-01T00:00:00.000Z')])

      expect(request).toEqual({
        items: [
          {
            productId: '019596d0-1f1c-7c2e-9a0e-110000000001',
            viewedAt: '2026-09-01T00:00:00.000Z',
          },
        ],
      })
    })

    it('never sends more than the contract accepts', () => {
      const many = Array.from({ length: RECENTLY_VIEWED_MERGE_MAX + 3 }, (_unused, index) =>
        item(index, '2026-09-01T00:00:00.000Z'),
      )

      expect(mergeRequest(many)?.items).toHaveLength(RECENTLY_VIEWED_MERGE_MAX)
    })
  })
})

describe('밀도별 문의 노출 — 표가 유일한 출처다 (TASK-0088 F6)', () => {
  it('opens the list at the maximal step only', () => {
    // 4장의 문장 그대로다. 미니멀 상품 페이지에 문의 목록이 붙으면 정보 밀도가
    // 올라가 밀도 구분 자체가 흐려진다.
    expect(questionExposure(1)).toEqual({ open: false, count: 5 })
    expect(questionExposure(2)).toEqual({ open: false, count: QUESTION_LIST_DEFAULT_LIMIT })
    expect(questionExposure(3)).toEqual({ open: true, count: QUESTION_LIST_DEFAULT_LIMIT })
  })

  it('answers for every density the toggle can produce', () => {
    for (const level of DENSITY_LEVELS) {
      expect(questionExposure(level).count).toBeGreaterThan(0)
    }
  })

  it('fetches the most any step shows, so changing density asks nothing again', () => {
    expect(QUESTION_PAGE_SIZE).toBe(questionExposure(3).count)
  })
})

describe('문의를 보내기 전에 걸리는 것들 (TASK-0088 F1)', () => {
  it('lets a written question through', () => {
    expect(questionDraftIssues('어깨 너비가 몇 cm 인가요?')).toEqual([])
  })

  it('refuses an empty body, and whitespace is empty', () => {
    // 계약이 `z.string().trim()` 으로 받으므로 화면도 다듬은 뒤에 센다.
    expect(questionDraftIssues('')).toEqual(['content_required'])
    expect(questionDraftIssues('   \n ')).toEqual(['content_required'])
  })

  it('refuses a body over the contract cap', () => {
    expect(questionDraftIssues('ㄱ'.repeat(QUESTION_CONTENT_MAX))).toEqual([])
    expect(questionDraftIssues('ㄱ'.repeat(QUESTION_CONTENT_MAX + 1))).toEqual(['content_too_long'])
  })
})

describe('폴링 — 언제 다시 묻는가 (TASK-0090 R1 · F8)', () => {
  it('polls every thirty seconds for a signed-in visible tab', () => {
    expect(pollDecision({ hidden: false, signedIn: true })).toEqual({
      kind: 'poll',
      intervalMs: NOTIFICATION_POLL_MS,
    })
    expect(NOTIFICATION_POLL_MS).toBe(30_000)
  })

  it('stops in a background tab, because nobody is looking at the badge (R1)', () => {
    expect(pollDecision({ hidden: true, signedIn: true })).toEqual({
      kind: 'idle',
      reason: 'hidden',
    })
  })

  it('stops for a signed-out visitor, and says so before it says 「숨었다」', () => {
    // 익명이면서 숨은 탭에게 「숨어서 멈췄다」고 답하면, 탭이 다시 보이는 순간
    // 폴링이 살아나 401 을 받는다.
    expect(pollDecision({ hidden: false, signedIn: false })).toEqual({
      kind: 'idle',
      reason: 'signedOut',
    })
    expect(pollDecision({ hidden: true, signedIn: false })).toEqual({
      kind: 'idle',
      reason: 'signedOut',
    })
  })
})

describe('알림의 소유 앱 — 상점이 그리는 것만 (TASK-0090 F7)', () => {
  const one = (type: NotificationType): Notification => ({
    id: '019596d0-1f1c-7c2e-9a0e-720000000001',
    type,
    title: '제목',
    body: '본문',
    link: null,
    readAt: null,
    createdAt: '2026-09-05T00:00:00.000Z',
  })

  it('keeps the shop’s own types', () => {
    expect(isShopNotification('ORDER_STATUS')).toBe(true)
    expect(isShopNotification('RESTOCK')).toBe(true)
  })

  it('drops the two consoles’ types', () => {
    // 한 계정이 두 역할을 가질 수 있다 — 판매자도 물건을 산다. 상점이 「정산이
    // 지급되었습니다」를 그리면 그 링크는 상점에 없는 화면을 가리킨다.
    expect(isShopNotification('SELLER_SETTLEMENT')).toBe(false)
    expect(isShopNotification('ADMIN_SELLER_APPLICATION')).toBe(false)
  })

  it('filters a page the same way', () => {
    const page = [one('ORDER_STATUS'), one('SELLER_ORDER'), one('ADMIN_SELLER_APPLICATION')]

    expect(shopNotifications(page).map((notification) => notification.type)).toEqual([
      'ORDER_STATUS',
    ])
  })
})

describe('신고를 보내기 전에 걸리는 것들 (TASK-0091 F1)', () => {
  it('refuses a report with no reason chosen', () => {
    // 첫 사유가 미리 골라져 있으면 사람이 읽지 않고 보낼 수 있고, 그렇게 들어온
    // 「욕설」 신고는 관리자가 세는 숫자를 망친다.
    expect(reportDraftIssues({ detail: '', reason: null })).toEqual(['reason_required'])
  })

  it('lets a listed reason through with no detail at all', () => {
    expect(reportDraftIssues({ detail: '', reason: 'ABUSE' })).toEqual([])
  })

  it('requires a detail for 「기타」, and whitespace is empty', () => {
    // 계약의 `refine` 과 같은 규칙이다. 분류되지 않는 신고에 근거까지 없으면
    // 관리자가 판단할 것이 하나도 없다.
    expect(reportDraftIssues({ detail: '', reason: 'OTHER' })).toEqual(['detail_required'])
    expect(reportDraftIssues({ detail: '  ', reason: 'OTHER' })).toEqual(['detail_required'])
    expect(reportDraftIssues({ detail: '광고 링크가 반복됩니다.', reason: 'OTHER' })).toEqual([])
  })

  it('refuses a detail over the contract cap', () => {
    expect(reportDraftIssues({ detail: 'ㄱ'.repeat(REPORT_DETAIL_MAX), reason: 'SPAM' })).toEqual(
      [],
    )
    expect(
      reportDraftIssues({ detail: 'ㄱ'.repeat(REPORT_DETAIL_MAX + 1), reason: 'SPAM' }),
    ).toEqual(['detail_too_long'])
  })

  it('reports them in the order they are fixed in', () => {
    // 화면은 첫 하나만 보인다. 순서가 곧 「어디부터 고치라」는 답이다.
    expect(reportDraftIssues({ detail: 'ㄱ'.repeat(REPORT_DETAIL_MAX + 1), reason: null })).toEqual(
      ['reason_required', 'detail_too_long'],
    )
  })

  describe('보낼 본문', () => {
    it('carries the trimmed detail when there is one', () => {
      expect(
        reportRequest('REVIEW', '019596d0-1f1c-7c2e-9a0e-630000000001', {
          detail: '  광고입니다.  ',
          reason: 'SPAM',
        }),
      ).toEqual({
        targetType: 'REVIEW',
        targetId: '019596d0-1f1c-7c2e-9a0e-630000000001',
        reason: 'SPAM',
        detail: '광고입니다.',
      })
    })

    it('leaves the field out entirely when nothing was written', () => {
      // `detail: ''` 는 「빈 설명을 남겼다」이고 `undefined` 는 「설명이 없다」다.
      // 관리자 목록에서 앞쪽은 「설명을 지운 신고」처럼 읽힌다.
      expect(
        reportRequest('QUESTION', '019596d0-1f1c-7c2e-9a0e-710000000001', {
          detail: '   ',
          reason: 'ABUSE',
        }),
      ).toEqual({
        targetType: 'QUESTION',
        targetId: '019596d0-1f1c-7c2e-9a0e-710000000001',
        reason: 'ABUSE',
      })
    })
  })
})
