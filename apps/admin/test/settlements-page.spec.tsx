/**
 * `/settlements`, 운영자가 실제로 만지는 대로 (TASK-0081).
 *
 * 아래의 검사는 전부 **진짜 화면을 그린 뒤 고르거나 입력한다.** 지어낸 프롭 꾸러미를
 * 컴포넌트에 건네지 않고 클래스 이름을 확인하지 않는다 (QUALITY-GATES Q5). 재는 것은
 * 총액이 페이지가 아니라 필터의 합이라고 말하는가, 회차 필터가 고른 날을 그 주로
 * 접어 보내는가, 일괄 승인이 **실패한 건을 이유와 함께 남기는가**(F6), 내보내기가
 * 커서를 끝까지 따라가는가(F8), 그리고 지급·승인 자격이 없는 계정에게 쓰기가
 * 막히는가(F7)다.
 *
 * ## 대역이 msw 가 아니라 모듈이다
 *
 * `packages/api-mocks` 에 `/settlements` 의 대역이 아직 없고, 이 TASK 는
 * `apps/admin` 밖을 고치지 않는다. 그래서 `lib/settlements/console-api` 를 대신
 * 세운다 — 경로와 스키마가 그 한 파일에 모여 있는 것이 이것을 가능하게 하고, 답은
 * 여전히 계약 스키마를 지난 값이다(`support/settlements.ts`).
 */

import { sessionAdminOperator, sessionDemoAdmin } from '@shopping/api-mocks'
import { ApiClientError } from '@shopping/shared'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { UserEvent } from '@testing-library/user-event'
import axe from 'axe-core'
import type { RunOptions } from 'axe-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { messagesFor } from '@/messages'

import type { MockSession } from './support/auth'
import { renderWithAuth } from './support/auth'
import {
  bulkApproval,
  PERIOD_START,
  settlement,
  settlementList,
  SELLER_ID,
} from './support/settlements'

const api = vi.hoisted(() => ({
  fetchSettlements: vi.fn(),
  fetchSettlement: vi.fn(),
  approveSettlement: vi.fn(),
  holdSettlement: vi.fn(),
  paySettlement: vi.fn(),
  approveSettlements: vi.fn(),
}))

vi.mock('@/lib/settlements/console-api', () => api)

const { settlements: copy, auth } = messagesFor()

async function openScreen(session?: MockSession): Promise<UserEvent> {
  const user = userEvent.setup()
  const { default: SettlementsPage } = await import('@/app/settlements/page')

  renderWithAuth(<SettlementsPage />, session === undefined ? {} : { session })
  await screen.findByRole('table', { name: copy.list.listLabel })

  return user
}

/** 표의 몸통 줄들. 머리글 행은 세지 않는다. */
function rows(): readonly HTMLElement[] {
  const table = screen.getByRole('table', { name: copy.list.listLabel })

  return within(table)
    .getAllByRole('row')
    .filter((row) => within(row).queryAllByRole('cell').length > 0)
}

beforeEach(() => {
  vi.clearAllMocks()
  api.fetchSettlements.mockResolvedValue(settlementList([settlement()]))
  api.approveSettlements.mockResolvedValue(bulkApproval([]))
})

describe('목록과 총액', () => {
  it('draws a period with the day it actually ends on, not the next one', async () => {
    await openScreen()

    // 계약의 `periodEnd` 는 다음 회차의 시작과 맞물린 열린 끝이다. 그대로 그리면
    // 이웃한 두 회차가 같은 날을 공유하는 것처럼 보인다.
    const table = screen.getByRole('table', { name: copy.list.listLabel })

    expect(within(table).getByText('2026. 8. 24. ~ 2026. 8. 30.')).toBeVisible()
    expect(within(table).getByText('₩1,551,000')).toBeVisible()
  })

  /**
   * **페이지의 합이 아니다.** 20건짜리 표 위에 200건의 합계가 서 있는데 그 사실을
   * 적지 않으면, 그 숫자를 보고 지급을 결정하는 사람이 화면의 스무 줄을 더해 보고
   * 틀렸다고 판단한다.
   */
  it('says the total belongs to the filter, not to the page', async () => {
    api.fetchSettlements.mockResolvedValue(
      settlementList([settlement()], {
        nextCursor: 'next',
        totals: { count: 42, payoutAmount: 65_142_000 },
      }),
    )

    await openScreen()

    const totals = screen.getByRole('region', { name: copy.list.totals.title })

    expect(within(totals).getByText('₩65,142,000')).toBeVisible()
    expect(
      within(totals).getByText(copy.list.totals.countValue.replace('{count}', '42')),
    ).toBeVisible()
    expect(within(totals).getByText(copy.list.totals.scopeNotice)).toBeVisible()
  })

  it('offers a retry when the list did not arrive', async () => {
    api.fetchSettlements.mockRejectedValue(
      new ApiClientError({ kind: 'network', message: 'network down' }),
    )

    const user = userEvent.setup()
    const { default: SettlementsPage } = await import('@/app/settlements/page')

    renderWithAuth(<SettlementsPage />)

    expect(await screen.findByText(copy.list.errorTitle)).toBeVisible()
    await user.click(screen.getByRole('button', { name: copy.list.retryLabel }))

    await waitFor(() => {
      expect(api.fetchSettlements).toHaveBeenCalledTimes(2)
    })
  })

  it('tells an empty list apart from a filter that found nothing', async () => {
    api.fetchSettlements.mockResolvedValue(settlementList([]))

    const { default: SettlementsPage } = await import('@/app/settlements/page')

    renderWithAuth(<SettlementsPage />)

    expect(await screen.findByText(copy.list.emptyTitle)).toBeVisible()
  })
})

describe('필터', () => {
  /**
   * 계약의 `periodStart` 는 구간이 아니라 **한 순간**이고 회차는 월요일 자정에
   * 시작한다. 고른 수요일을 그대로 보내면 아무것도 안 걸리고, 화면은 「이 회차에는
   * 정산서가 없습니다」라고 말한다 — 없는 것은 회차가 아니라 그 순간이었는데도.
   */
  it('folds a chosen Wednesday into the period that contains it', async () => {
    const user = await openScreen()

    await user.type(screen.getByLabelText(copy.list.filters.dayLabel), '2026-08-26')

    await waitFor(() => {
      expect(api.fetchSettlements).toHaveBeenLastCalledWith(
        { periodStart: PERIOD_START },
        expect.anything(),
      )
    })

    // 어느 회차로 접혔는지를 화면이 말한다. 적지 않으면 수요일을 고른 사람은 자기가
    // 그 주 전체를 보고 있다는 사실을 알 수 없다.
    expect(
      screen.getByText(
        copy.list.filters.resolved.replace('{period}', '2026. 8. 24. ~ 2026. 8. 30.'),
      ),
    ).toBeVisible()
  })

  it('sends a chosen status as the list the contract reads', async () => {
    const user = await openScreen()

    await user.click(screen.getByRole('combobox', { name: copy.list.filters.statusLabel }))
    await user.click(await screen.findByRole('option', { name: copy.statusLabels.HOLD }))

    await waitFor(() => {
      expect(api.fetchSettlements).toHaveBeenLastCalledWith({ status: ['HOLD'] }, expect.anything())
    })
  })

  /**
   * 판매자 셀렉트가 없는 사정은 `settlement-filters.tsx` 에 있다 — 좁히는 길은
   * 목록의 행이고, 고른 것은 지울 수 있는 칩으로 남는다.
   */
  it('narrows to one store from the row, and says so in a chip that can be cleared', async () => {
    const user = await openScreen()

    await user.click(screen.getByRole('button', { name: '루미에르' }))

    await waitFor(() => {
      expect(api.fetchSettlements).toHaveBeenLastCalledWith(
        { sellerId: SELLER_ID },
        expect.anything(),
      )
    })

    expect(
      screen.getByText(copy.list.narrow.activeSeller.replace('{name}', '루미에르')),
    ).toBeVisible()

    await user.click(screen.getByRole('button', { name: copy.list.narrow.clear }))

    await waitFor(() => {
      expect(api.fetchSettlements).toHaveBeenLastCalledWith({}, expect.anything())
    })
  })

  it('says the empty list is the filter’s doing once something is narrowed', async () => {
    const user = await openScreen()

    api.fetchSettlements.mockResolvedValue(settlementList([]))

    await user.click(screen.getByRole('combobox', { name: copy.list.filters.statusLabel }))
    await user.click(await screen.findByRole('option', { name: copy.statusLabels.PAID }))

    expect(await screen.findByText(copy.list.filteredEmptyTitle)).toBeVisible()
  })
})

describe('일괄 승인 (F6)', () => {
  const pending = settlement({ status: 'PENDING' })
  const held = settlement({
    status: 'HOLD',
    holdReason: '반품 분쟁 확인 중',
    brandName: '아틀리에',
  })
  const paid = settlement({ status: 'PAID', brandName: '메종', paidAt: '2026-09-01T00:00:00.000Z' })

  beforeEach(() => {
    api.fetchSettlements.mockResolvedValue(settlementList([pending, held, paid]))
  })

  /**
   * 이미 지급된 줄을 고를 수 있게 두면 사람은 그것을 고르고, 서버는 거절하고, 화면은
   * 「승인하지 못했습니다」를 그린다 — 아무도 그것을 시도한 적이 없어야 했다.
   */
  it('lets nobody select a settlement that has nowhere left to go', async () => {
    await openScreen()

    const [, , paidRow] = rows()
    const box = within(paidRow!).getByRole('checkbox')

    expect(box).toBeDisabled()
    expect(box).toHaveAccessibleName(expect.stringContaining(copy.list.notSelectable))
  })

  it('selects every approvable row on the page from the header, and only those', async () => {
    const user = await openScreen()

    await user.click(screen.getByRole('checkbox', { name: copy.list.selectPage }))

    expect(screen.getByText(copy.bulk.selected.replace('{count}', '2'))).toBeVisible()
  })

  /**
   * **실패한 것을 조용히 빼지 않는다.** 「3건 골랐는데 2건이 승인됐다」를 화면이
   * 말하지 못하면 남은 1건은 아무도 다시 보지 않고, 그 1건이야말로 사람이 봐야 하는
   * 것이다.
   */
  it('shows every id that was refused, with the reason and a way to open it', async () => {
    api.approveSettlements.mockResolvedValue(
      bulkApproval([pending.id], [{ id: held.id, reason: 'wrong_status' }]),
    )

    const user = await openScreen()

    await user.click(screen.getByRole('checkbox', { name: copy.list.selectPage }))
    await user.click(screen.getByRole('button', { name: copy.bulk.approve }))

    const dialog = await screen.findByRole('dialog')

    // 확인 문구에 건수와 합계가 함께 선다.
    expect(
      within(dialog).getByText(
        copy.bulk.confirm.description.replace('{count}', '2').replace('{amount}', '₩3,102,000'),
      ),
    ).toBeVisible()

    await user.click(within(dialog).getByRole('button', { name: copy.bulk.confirm.confirm }))

    await waitFor(() => {
      expect(api.approveSettlements).toHaveBeenCalledWith([pending.id, held.id])
    })

    const outcome = await screen.findByRole('region', { name: copy.bulk.result.title })

    expect(
      within(outcome).getByText(copy.bulk.result.approved.replace('{count}', '1')),
    ).toBeVisible()
    expect(within(outcome).getByText(copy.bulk.result.failedTitle)).toBeVisible()
    expect(within(outcome).getByText(copy.bulk.result.reasons.wrong_status)).toBeVisible()
    expect(within(outcome).getByRole('link', { name: '아틀리에' })).toHaveAttribute(
      'href',
      `/settlements/${held.id}`,
    )
  })

  /**
   * 고른 줄을 **정산서 그대로** 들고 있는 이유가 이것이다. id 만 들면 확인 문구의
   * 합계가 「지금 화면에 있는 줄」만 더한 값이 되고, 두 페이지에서 고른 사람에게
   * 그것은 확인이 아니라 틀린 숫자다.
   */
  it('keeps counting rows that were chosen on an earlier page', async () => {
    const later = settlement({ brandName: '메종', payoutAmount: 1_000_000 })

    api.fetchSettlements.mockImplementation((query: { readonly cursor?: string }) =>
      Promise.resolve(
        query.cursor === undefined
          ? settlementList([pending], { nextCursor: 'page-2' })
          : settlementList([later], { nextCursor: null }),
      ),
    )

    const user = await openScreen()

    await user.click(screen.getByRole('checkbox', { name: copy.list.selectPage }))
    await user.click(screen.getByRole('button', { name: copy.list.pagination.next }))

    await screen.findByRole('button', { name: '메종' })

    await user.click(screen.getByRole('checkbox', { name: copy.list.selectPage }))
    await user.click(screen.getByRole('button', { name: copy.bulk.approve }))

    const dialog = await screen.findByRole('dialog')

    expect(
      within(dialog).getByText(
        copy.bulk.confirm.description.replace('{count}', '2').replace('{amount}', '₩2,551,000'),
      ),
    ).toBeVisible()
  })

  it('sends nothing when the answer to the confirmation is no', async () => {
    const user = await openScreen()

    await user.click(screen.getByRole('checkbox', { name: copy.list.selectPage }))
    await user.click(screen.getByRole('button', { name: copy.bulk.approve }))

    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: copy.bulk.confirm.cancel }))

    expect(api.approveSettlements).not.toHaveBeenCalled()
  })
})

describe('CSV 내보내기 (F8)', () => {
  it('follows the cursor to the end of the filter rather than exporting the page', async () => {
    const first = settlement()
    const second = settlement({ brandName: '아틀리에' })

    api.fetchSettlements
      .mockResolvedValueOnce(settlementList([first], { nextCursor: null }))
      .mockResolvedValueOnce(settlementList([first], { nextCursor: 'page-2' }))
      .mockResolvedValueOnce(settlementList([second], { nextCursor: null }))

    const user = await openScreen()
    const created: string[] = []

    /*
     * jsdom 에는 다운로드가 없다. 재는 것은 「파일을 만들었는가」이고, 그 자리가
     * `createObjectURL` 이다. `URL` 을 통째로 갈아 끼우지 않는다 — 그 클래스는 API
     * 클라이언트가 주소를 만드는 데 쓴다 (`apps/seller` 의 같은 검사와 같은 방식).
     */
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: (blob: Blob) => {
        created.push(blob.type)

        return 'blob:test'
      },
    })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: () => undefined })

    await user.click(screen.getByRole('button', { name: copy.export.label }))

    expect(await screen.findByText(copy.export.done.replace('{count}', '2'))).toBeVisible()
    expect(created).toEqual(['text/csv;charset=utf-8'])
    // 한 페이지를 그리는 요청과, 커서를 따라간 두 번. 상한까지 100건씩 읽는다.
    expect(api.fetchSettlements).toHaveBeenLastCalledWith({ limit: 100, cursor: 'page-2' })
  })

  it('says there is nothing to export instead of handing over an empty file', async () => {
    const user = await openScreen()

    api.fetchSettlements.mockResolvedValue(settlementList([]))

    await user.click(screen.getByRole('button', { name: copy.export.label }))

    expect(await screen.findByText(copy.export.empty)).toBeVisible()
  })
})

it('allows demo administrators to submit an example settlement approval', async () => {
  const user = await openScreen(sessionDemoAdmin)
  await user.click(screen.getByRole('checkbox', { name: copy.list.selectPage }))
  await user.click(screen.getByRole('button', { name: copy.bulk.approve }))
  const dialog = await screen.findByRole('dialog')
  await user.click(within(dialog).getByRole('button', { name: copy.bulk.confirm.confirm }))
  await waitFor(() => expect(api.approveSettlements).toHaveBeenCalled())
})

describe('처리 자격이 없는 계정 (F7)', () => {
  /**
   * 데모 관리자는 운영자에서 파생되고(`role-permissions.ts`), 운영자에게
   * `settlement.approve` 도 `settlement.pay` 도 없다. 그래서 거절은 조건문이 아니라
   * 권한 목록의 **빈자리**가 만들고, 화면은 서버가 묻는 것과 같은 표에 물어 같은
   * 답을 받는다.
   */
  it.each([['an operator', sessionAdminOperator]])(
    'shows %s everything and blocks the one write, with a reason',
    async (_name, session) => {
      const user = await openScreen(session)

      // 목록도 총액도 내보내기도 선택도 그대로 있다. 감추면 콘솔이 실제보다 적은
      // 기능을 가진 것처럼 보이고, 무엇을 요청해야 하는지도 알 수 없다.
      expect(screen.getByRole('region', { name: copy.list.totals.title })).toBeVisible()
      expect(screen.getByRole('button', { name: copy.export.label })).toBeEnabled()

      await user.click(screen.getByRole('checkbox', { name: copy.list.selectPage }))

      const approve = screen.getByRole('button', { name: copy.bulk.approve })

      expect(approve).toHaveAttribute('aria-disabled', 'true')
      expect(approve).toHaveAccessibleDescription(auth.denials.missing_permission)
    },
  )

  /**
   * 속성 `disabled` 였다면 졌다. 키보드가 닿지 못하는 컨트롤은 자기가 왜 막혔는지도
   * 말하지 못하고, 그 설명이 가장 필요한 사람이 바로 화면을 볼 수 없는 사람이다.
   */
  it('stays reachable and inert while blocked (P4)', async () => {
    const user = await openScreen(sessionAdminOperator)

    await user.click(screen.getByRole('checkbox', { name: copy.list.selectPage }))

    const approve = screen.getByRole('button', { name: copy.bulk.approve })

    approve.focus()
    expect(approve).toHaveFocus()

    await user.keyboard('{Enter}')

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(api.approveSettlements).not.toHaveBeenCalled()
  })
})

const A11Y: RunOptions = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] },
  rules: {
    'color-contrast': { enabled: false },
    'html-has-lang': { enabled: false },
    'document-title': { enabled: false },
    region: { enabled: false },
  },
}

describe('접근성 (P2)', () => {
  it('has no violations with rows selected and the totals on screen', async () => {
    api.fetchSettlements.mockResolvedValue(
      settlementList([settlement(), settlement({ status: 'PAID', brandName: '메종' })]),
    )

    const user = await openScreen()

    await user.click(screen.getByRole('checkbox', { name: copy.list.selectPage }))

    const results = await axe.run(document.body, A11Y)

    expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([])
  })
})
