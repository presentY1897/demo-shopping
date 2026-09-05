import type { OrderStatus } from '@shopping/shared'
import { orderStatuses } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import {
  actionFor,
  actionRouteOf,
  isShippable,
  needsReason,
  SELLER_ORDER_ACTION_ROUTES,
  SELLER_ORDER_TABS,
  statusesOf,
  tabCountOf,
} from '@/lib/orders/order-console'
import { csvCell, exportFileName, ordersToCsv } from '@/lib/orders/order-export'
import { dayEnd, dayStart, queryOf } from '@/lib/orders/use-seller-orders'

/**
 * 주문 화면의 순수 판단 (TASK-0060).
 *
 * 렌더하지 않고 잰다. 여기 있는 것들은 전부 **틀려도 화면이 멀쩡해 보이는** 종류라,
 * 상호작용 검사가 아니라 입력 → 출력으로 재는 편이 촘촘하다.
 */

const ZERO_COUNTS = Object.fromEntries(orderStatuses.map((status) => [status, 0])) as Record<
  OrderStatus,
  number
>

describe('상태 탭', () => {
  it('has 전체 mean 「상태를 보내지 않는다」, not 「아무 상태도 아니다」', () => {
    // 빈 배열을 보내면 서버는 「그중 아무것도」로 읽어 언제나 0건이 된다.
    expect(statusesOf('all')).toBeNull()
  })

  it('maps 취소·반품 to two statuses — the reason the parameter is a list', () => {
    expect(statusesOf('closed')).toEqual(['CANCELED', 'RETURNED'])
  })

  it('names only statuses the contract knows', () => {
    for (const tab of SELLER_ORDER_TABS) {
      for (const status of statusesOf(tab) ?? []) expect(orderStatuses).toContain(status)
    }
  })

  it('counts 전체 as every status, 결제 대기 included', () => {
    const counts = { ...ZERO_COUNTS, PAYMENT_PENDING: 3, PAID: 2 }

    // 결제 대기도 판매자의 주문이다. 탭이 그것을 감추면 숫자와 목록이 어긋난다.
    expect(tabCountOf('all', counts)).toBe(5)
  })

  it('counts a two-status tab as the sum of both', () => {
    expect(tabCountOf('closed', { ...ZERO_COUNTS, CANCELED: 2, RETURNED: 3 })).toBe(5)
  })
})

describe('액션이 두드리는 문 (4.3)', () => {
  it('sends 발송 to the shipment route — the transition door demands a waybill', () => {
    expect(actionRouteOf('SHIPPED')).toBe('shipment')
  })

  /**
   * **이 한 줄이 TASK-0061 4.4 의 답이다.**
   *
   * 전이 라우트로 배송완료를 찍으면 주문만 움직이고 `Shipment.status` 는 그대로
   * 남는다 — 구매자의 추적 화면이 「이동 중」인 채로 주문은 배송완료가 된다. 여기가
   * `'transition'` 으로 되돌아가는 순간 그 결함이 되살아나고, 서버 쪽 검사는 전부
   * 초록이다(그쪽 라우트는 멀쩡하므로).
   */
  it('sends 배송완료 to the delivery route, never to the transition route', () => {
    expect(actionRouteOf('DELIVERED')).toBe('delivery')
    expect(actionRouteOf('DELIVERED')).not.toBe('transition')
  })

  it('sends everything else through the state machine’s own door', () => {
    for (const status of orderStatuses) {
      if (status === 'SHIPPED' || status === 'DELIVERED') continue

      expect(actionRouteOf(status)).toBe('transition')
    }
  })

  it('names only routes that exist', () => {
    for (const status of orderStatuses) {
      expect(SELLER_ORDER_ACTION_ROUTES).toContain(actionRouteOf(status))
    }
  })

  it('asks for a reason on 취소·반품 and on nothing else', () => {
    // 사유는 클레임 절차의 결론에 남는 한 줄이다. 정상 진행에 붙이면 판매자는
    // 발송할 때마다 빈 칸을 본다.
    expect(needsReason('CANCELED')).toBe(true)
    expect(needsReason('RETURNED')).toBe(true)
    expect(needsReason('PREPARING')).toBe(false)
    expect(needsReason('DELIVERED')).toBe(false)
  })

  it('reads the button out of the server’s answer, not out of the status', () => {
    const actions = [
      { to: 'SHIPPED' as const, enabled: false, blockedBy: 'tracking' as const },
      { to: 'CANCELED' as const, enabled: true, blockedBy: null },
    ]

    expect(actionFor(actions, 'SHIPPED')?.blockedBy).toBe('tracking')
    expect(actionFor(actions, 'DELIVERED')).toBeNull()
  })

  it('offers 일괄 발송 only for shares that are actually preparing', () => {
    expect(isShippable('PREPARING')).toBe(true)
    expect(isShippable('PAID')).toBe(false)
    expect(isShippable('SHIPPED')).toBe(false)
  })
})

describe('기간을 질의로', () => {
  it('takes the whole local day, both ends', () => {
    const from = dayStart('2026-09-06')
    const to = dayEnd('2026-09-06')

    expect(from).not.toBeUndefined()
    expect(to).not.toBeUndefined()
    // 자정부터 그날의 마지막 밀리초까지. 판매자가 「9월 6일」이라고 할 때 뜻하는 것이
    // 자기 시계의 하루이므로 지역시로 만든다.
    expect(new Date(to ?? '').getTime() - new Date(from ?? '').getTime()).toBe(
      24 * 60 * 60 * 1000 - 1,
    )
  })

  it('sends nothing for an empty field', () => {
    expect(dayStart('')).toBeUndefined()
    expect(dayEnd('')).toBeUndefined()
  })

  it('sends nothing for a date the browser could not parse', () => {
    expect(dayStart('2026-13-45')).toBeUndefined()
  })

  it('leaves every filter out when nothing is set', () => {
    expect(queryOf({ tab: 'all', from: '', to: '', q: '' })).toEqual({})
  })

  it('trims the search — a space is not a search', () => {
    expect(queryOf({ tab: 'all', from: '', to: '', q: '   ' })).toEqual({})
    expect(queryOf({ tab: 'all', from: '', to: '', q: ' 코트 ' })).toEqual({ q: '코트' })
  })
})

describe('엑셀 내보내기', () => {
  const columns = {
    orderNumber: '주문번호',
    orderedAt: '주문일시',
    status: '상태',
    recipient: '수령인',
    headline: '상품',
    itemCount: '건수',
    totalQuantity: '수량',
    paidAmount: '결제금액',
    trackingNumber: '운송장',
  }

  const options = {
    columns,
    emptyTracking: '발송 전',
    formatDate: (value: string) => value,
    statusLabels: { PAID: '결제완료' } as Record<string, string>,
  }

  const row = {
    id: '01930000-0000-7000-8000-000000000001',
    orderNumber: '20260906-00000001',
    orderedAt: '2026-09-06T01:00:00.000Z',
    status: 'PAID' as const,
    headline: '울 코트, 특가',
    itemCount: 2,
    totalQuantity: 3,
    paidAmount: 12_000,
    maskedRecipientName: '홍*동',
    thumbnailUrl: null,
    trackingNumber: null,
  }

  it('starts with a BOM so Excel reads it as UTF-8', () => {
    // 없으면 Excel 이 시스템 코드페이지로 읽어 한글이 전부 깨진다. 증상은
    // 「내보내기가 깨진다」이지 「인코딩을 안 알려 줬다」가 아니다.
    expect(ordersToCsv([row], options).startsWith('﻿')).toBe(true)
  })

  it('quotes every cell, so a comma in a product name cannot shift a column', () => {
    const csv = ordersToCsv([row], options)

    expect(csv).toContain('"울 코트, 특가"')
    // 「필요할 때만 감싼다」는 판단이고, 그 판단이 한 번 틀리면 아래 모든 값이 한 칸씩
    // 밀린 파일이 나온다 — 그 파일은 열리고, 읽히고, 틀린다.
    expect(csvCell('a"b')).toBe('"a""b"')
  })

  it('names the status rather than the enum', () => {
    expect(ordersToCsv([row], options)).toContain('"결제완료"')
  })

  it('says 발송 전 rather than leaving the tracking cell blank', () => {
    // 빈 칸으로 두면 「없다」와 「못 읽었다」가 같아진다.
    expect(ordersToCsv([row], options)).toContain('"발송 전"')
  })

  it('exports the masked name, never the original (F6)', () => {
    // 파일로 나가는 순간 우리가 통제하지 못하는 곳에 남는다. 목록에서 가린 값을
    // 파일에서 되돌리는 것은 가린 이유를 없애는 일이다.
    const csv = ordersToCsv([row], options)

    expect(csv).toContain('"홍*동"')
    expect(csv).not.toContain('홍길동')
  })

  it('writes a header even with no rows', () => {
    expect(ordersToCsv([], options)).toContain('"주문번호"')
  })

  it('stamps the file with the day it was taken', () => {
    expect(exportFileName('orders', new Date(2026, 8, 6))).toBe('orders_20260906.csv')
  })
})
