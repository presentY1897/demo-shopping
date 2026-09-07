/**
 * `/reports`, 운영자가 실제로 만지는 대로 (TASK-0091).
 *
 * 아래의 검사는 전부 **진짜 화면을 그린 뒤 고르거나 입력한다.** 지어낸 프롭 꾸러미를
 * 컴포넌트에 건네지 않고 클래스 이름을 확인하지 않는다 (QUALITY-GATES Q5). 재는 것은
 * 대기 건수가 필터가 아니라 「할 일」이라고 말하는가, 발췌와 신고 횟수가 표에 서서
 * 대상 화면에 가지 않고 판단하게 하는가, **반려가 복구라고 화면이 말하는가**(F5),
 * 상품에 삭제를 내밀지 않는가(4.4), 삭제에 한 걸음이 더 있는가, 그리고 데모 관리자의
 * 403 이 다시 눌러 볼 만한 오류가 아니라 **문장**으로 서는가(F7)다.
 *
 * ## 대역이 msw 가 아니라 모듈이다
 *
 * `packages/api-mocks` 에 `/reports` 의 대역이 아직 없고, 이 TASK 는 `apps/admin`
 * 밖을 고치지 않는다. 그래서 `lib/reports/console-api` 를 대신 세운다 — 경로와
 * 스키마가 그 한 파일에 모여 있는 것이 이것을 가능하게 하고, 답은 여전히 계약
 * 스키마를 지난 값이다(`support/reports.ts`).
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
import { handled, report, reportList } from './support/reports'

const api = vi.hoisted(() => ({
  fetchReports: vi.fn(),
  handleReport: vi.fn(),
}))

vi.mock('@/lib/reports/console-api', () => api)

const { reports: copy, errors: errorCopy } = messagesFor()

async function openScreen(session?: MockSession): Promise<UserEvent> {
  const user = userEvent.setup()
  const { default: ReportsPage } = await import('@/app/reports/page')

  renderWithAuth(<ReportsPage />, session === undefined ? {} : { session })
  await screen.findByRole('table', { name: copy.list.listLabel })

  return user
}

/** 처리 대화상자를 연다. 첫 줄의 「처리하기」가 그 문이다. */
async function openDialog(user: UserEvent): Promise<HTMLElement> {
  await user.click(screen.getAllByRole('button', { name: copy.list.handleLabel })[0]!)

  return screen.findByRole('dialog')
}

/**
 * 선택지 하나.
 *
 * `Radio` 의 접근 가능한 이름에는 **효과 문장이 함께 들어간다** — 라벨과 설명이 한
 * `<label>` 안에 있기 때문이고, 그것이 이 화면에서 옳다: 「반려」라는 낱말만 읽히는
 * 것이 정확히 이 TASK 가 피하려는 것이다. 그래서 이름의 **앞**을 잡는다.
 */
function radio(dialog: HTMLElement, label: string): HTMLElement {
  return within(dialog).getByRole('radio', { name: new RegExp(`^${label}`) })
}

/** 사유 칸. 라벨에는 필수 표시가 붙어 있다. */
function note(dialog: HTMLElement): HTMLElement {
  return within(dialog).getByLabelText(copy.handle.noteLabel, { exact: false })
}

/** 서버가 답한 실패 하나. `createApiClient` 가 만드는 모양 그대로. */
function refusal(status: number, code: string): ApiClientError {
  return new ApiClientError({
    kind: 'http',
    message: 'for the log',
    status,
    body: { error: { code, message: '서버 문장', details: [], requestId: 'req-1' } },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  api.fetchReports.mockResolvedValue(reportList([report()]))
})

describe('목록', () => {
  /**
   * 계약이 발췌와 신고 횟수를 싣는 것은 관리자가 **대상 화면으로 가지 않고** 판단할
   * 수 있게 하기 위해서다. 표에서 빼면 한 건마다 새 탭을 열어야 하고, 그러면 대기
   * 줄은 훑을 수 없는 것이 된다.
   */
  it('carries what a judgement needs — the excerpt and how often this target was reported', async () => {
    api.fetchReports.mockResolvedValue(
      reportList([
        report({ targetReportCount: 5, targetExcerpt: '이런 걸 파는 가게가 다 있네요' }),
      ]),
    )

    await openScreen()

    const table = screen.getByRole('table', { name: copy.list.listLabel })

    expect(within(table).getByText('이런 걸 파는 가게가 다 있네요')).toBeVisible()
    expect(within(table).getByText(copy.list.reportCount.replace('{count}', '5'))).toBeVisible()
  })

  /** `targetHidden` 은 신고의 상태가 아니라 **대상**의 상태다 (4.3). */
  it('says the target is already hidden, beside the report’s own status', async () => {
    api.fetchReports.mockResolvedValue(reportList([report({ targetHidden: true })]))

    await openScreen()

    const table = screen.getByRole('table', { name: copy.list.listLabel })

    expect(within(table).getByText(copy.list.targetHidden)).toBeVisible()
    expect(within(table).getByText(copy.statusLabels.PENDING)).toBeVisible()
  })

  /**
   * **페이지의 합이 아니다.** 「반려」만 보고 있는 화면 위에 12가 서 있는데 그 사실을
   * 적지 않으면, 읽는 사람은 화면의 줄을 세어 보고 숫자가 틀렸다고 판단한다.
   */
  it('says the pending count belongs to the whole queue, not to the filter', async () => {
    api.fetchReports.mockResolvedValue(reportList([report()], { pendingCount: 12 }))

    await openScreen()

    const panel = screen.getByRole('region', { name: copy.list.pending.title })

    expect(
      within(panel).getByText(copy.list.pending.countValue.replace('{count}', '12')),
    ).toBeVisible()
    expect(within(panel).getByText(copy.list.pending.scopeNotice)).toBeVisible()
  })

  it('offers a one-press way to the queue the count is about', async () => {
    api.fetchReports.mockResolvedValue(reportList([report()], { pendingCount: 12 }))

    const user = await openScreen()

    await user.click(screen.getByRole('button', { name: copy.list.pending.only }))

    await waitFor(() => {
      expect(api.fetchReports).toHaveBeenLastCalledWith({ status: ['PENDING'] }, expect.anything())
    })

    // 이미 대기만 보고 있으면 같은 곳으로 가는 버튼을 다시 내지 않는다.
    expect(screen.queryByRole('button', { name: copy.list.pending.only })).toBeNull()
  })

  it('shows what was decided, and why, on a report nobody can handle again', async () => {
    api.fetchReports.mockResolvedValue(
      reportList([
        report({
          status: 'REJECTED',
          handledAt: '2026-09-06T02:00:00.000Z',
          handledNote: '리뷰의 범위를 벗어나지 않았습니다.',
        }),
      ]),
    )

    await openScreen()

    expect(
      screen.getByText(
        copy.list.handledNote.replace('{note}', '리뷰의 범위를 벗어나지 않았습니다.'),
      ),
    ).toBeVisible()
    expect(screen.queryByRole('button', { name: copy.list.handleLabel })).toBeNull()
  })

  it('offers a retry when the list did not arrive', async () => {
    api.fetchReports.mockRejectedValue(
      new ApiClientError({ kind: 'network', message: 'network down' }),
    )

    const user = userEvent.setup()
    const { default: ReportsPage } = await import('@/app/reports/page')

    renderWithAuth(<ReportsPage />)

    expect(await screen.findByText(copy.list.errorTitle)).toBeVisible()
    await user.click(screen.getByRole('button', { name: copy.list.retryLabel }))

    await waitFor(() => {
      expect(api.fetchReports).toHaveBeenCalledTimes(2)
    })
  })

  it('tells an empty queue apart from a filter that found nothing', async () => {
    api.fetchReports.mockResolvedValue(reportList([]))

    const user = await (async () => {
      const events = userEvent.setup()
      const { default: ReportsPage } = await import('@/app/reports/page')

      renderWithAuth(<ReportsPage />)
      await screen.findByText(copy.list.emptyTitle)

      return events
    })()

    await user.click(screen.getByRole('combobox', { name: copy.list.filters.targetLabel }))
    await user.click(await screen.findByRole('option', { name: copy.targetTypeLabels.PRODUCT }))

    expect(await screen.findByText(copy.list.filteredEmptyTitle)).toBeVisible()
  })
})

describe('필터', () => {
  /**
   * 계약의 `status` 는 목록이다. 「처리됨」 하나가 숨김·삭제·반려 셋을 뜻하고, 그
   * 셋이 쉼표 하나로 나간다.
   */
  it('sends 처리됨 as the three statuses the contract reads', async () => {
    const user = await openScreen()

    await user.click(screen.getByRole('combobox', { name: copy.list.filters.scopeLabel }))
    await user.click(await screen.findByRole('option', { name: copy.list.scopeLabels.HANDLED }))

    await waitFor(() => {
      expect(api.fetchReports).toHaveBeenLastCalledWith(
        { status: ['HIDDEN', 'REMOVED', 'REJECTED'] },
        expect.anything(),
      )
    })
  })

  it('narrows by target type on its own axis', async () => {
    const user = await openScreen()

    await user.click(screen.getByRole('combobox', { name: copy.list.filters.targetLabel }))
    await user.click(await screen.findByRole('option', { name: copy.targetTypeLabels.REVIEW }))

    await waitFor(() => {
      expect(api.fetchReports).toHaveBeenLastCalledWith({ targetType: 'REVIEW' }, expect.anything())
    })

    await user.click(screen.getByRole('button', { name: copy.list.filters.reset }))

    await waitFor(() => {
      expect(api.fetchReports).toHaveBeenLastCalledWith({}, expect.anything())
    })
  })
})

describe('처리 (F4 · F5 · F6)', () => {
  it('refuses to send a decision with no reason on it', async () => {
    const user = await openScreen()
    const dialog = await openDialog(user)

    await user.click(radio(dialog, copy.handle.outcomeLabels.HIDDEN))
    await user.click(within(dialog).getByRole('button', { name: copy.handle.submit }))

    expect(await within(dialog).findByText(copy.handle.errors.noteRequired)).toBeVisible()
    expect(api.handleReport).not.toHaveBeenCalled()
  })

  it('refuses to send a reason with no decision on it', async () => {
    const user = await openScreen()
    const dialog = await openDialog(user)

    await user.type(note(dialog), '가립니다.')
    await user.click(within(dialog).getByRole('button', { name: copy.handle.submit }))

    expect(await within(dialog).findByText(copy.handle.errors.outcomeRequired)).toBeVisible()
    expect(api.handleReport).not.toHaveBeenCalled()
  })

  /**
   * **반려가 이 화면에서 가장 위험한 낱말이다.** 「아무 일도 안 함」으로 읽히면 자동
   * 임시 숨김에 걸린 멀쩡한 글은 아무도 복구하지 않는다. 그래서 선택지 옆에 「다시
   * 보이게 됩니다」가 서 있어야 한다 (F5).
   */
  it('says out loud that rejecting a report puts the target back', async () => {
    api.fetchReports.mockResolvedValue(reportList([report({ targetHidden: true })]))
    api.handleReport.mockResolvedValue(
      handled(report({ status: 'REJECTED', handledNote: '문제 없습니다.' })),
    )

    const user = await openScreen()
    const dialog = await openDialog(user)

    expect(within(dialog).getByText(copy.handle.outcomeEffects.reveal)).toBeVisible()
    expect(within(dialog).getByText(copy.handle.hiddenNotice)).toBeVisible()

    await user.click(radio(dialog, copy.handle.outcomeLabels.REJECTED))
    await user.type(note(dialog), '문제 없습니다.')
    await user.click(within(dialog).getByRole('button', { name: copy.handle.submit }))

    await waitFor(() => {
      expect(api.handleReport).toHaveBeenCalledWith(expect.any(String), {
        outcome: 'REJECTED',
        note: '문제 없습니다.',
      })
    })

    expect(await screen.findByText(copy.toast.handled.REJECTED)).toBeVisible()
  })

  /** 서버는 같은 대상의 다른 대기 신고도 함께 닫는다 (4.7). 그것을 미리 말한다. */
  it('warns that the other pending reports on the same target close with it', async () => {
    api.fetchReports.mockResolvedValue(reportList([report({ targetReportCount: 4 })]))

    const user = await openScreen()
    const dialog = await openDialog(user)

    expect(within(dialog).getByText(copy.handle.siblingNotice)).toBeVisible()
  })

  /**
   * 상품은 주문·정산·리뷰가 가리키는 행이라 지울 수 없다 (4.4). 버튼을 내면 서버는
   * 409 로 답하고, 그 왕복에서 사람이 배우는 것은 없다.
   */
  it('never offers deletion on a product, and says why', async () => {
    api.fetchReports.mockResolvedValue(reportList([report({ targetType: 'PRODUCT' })]))

    const user = await openScreen()
    const dialog = await openDialog(user)

    expect(radio(dialog, copy.handle.outcomeLabels.HIDDEN)).toBeVisible()
    expect(
      within(dialog).queryByRole('radio', {
        name: new RegExp(`^${copy.handle.outcomeLabels.REMOVED}`),
      }),
    ).toBeNull()
    expect(within(dialog).getByText(copy.handle.productNotice)).toBeVisible()
  })

  /**
   * 삭제에는 돌아오는 화살표가 없다 (R1). 확인은 **같은 창 안**에서 일어나고, 뒤로
   * 돌아오면 적어 둔 사유가 그대로 남아 있어야 한다.
   */
  it('asks once more before deleting, and keeps the reason when the answer is no', async () => {
    api.handleReport.mockResolvedValue(handled(report({ status: 'REMOVED' })))

    const user = await openScreen()
    const dialog = await openDialog(user)

    await user.click(radio(dialog, copy.handle.outcomeLabels.REMOVED))
    await user.type(note(dialog), '광고 글입니다.')
    await user.click(within(dialog).getByRole('button', { name: copy.handle.submit }))

    expect(await within(dialog).findByText(copy.handle.confirm.title)).toBeVisible()
    expect(api.handleReport).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: copy.handle.confirm.back }))

    expect(note(dialog)).toHaveValue('광고 글입니다.')

    await user.click(within(dialog).getByRole('button', { name: copy.handle.submit }))
    await user.click(
      await within(dialog).findByRole('button', { name: copy.handle.confirm.confirm }),
    )

    await waitFor(() => {
      expect(api.handleReport).toHaveBeenCalledWith(expect.any(String), {
        outcome: 'REMOVED',
        note: '광고 글입니다.',
      })
    })
  })

  /**
   * 답으로 오는 것은 그 신고 한 건이지만 바뀌는 것은 더 많다 — 같은 대상의 다른 대기
   * 신고도 닫히고 대기 건수도 줄었다. 그것을 아는 유일한 방법이 다시 읽는 것이다.
   */
  it('reads the list again once a decision lands', async () => {
    api.handleReport.mockResolvedValue(handled(report({ status: 'HIDDEN' })))

    const user = await openScreen()
    const dialog = await openDialog(user)

    await user.click(radio(dialog, copy.handle.outcomeLabels.HIDDEN))
    await user.type(note(dialog), '욕설입니다.')
    await user.click(within(dialog).getByRole('button', { name: copy.handle.submit }))

    await waitFor(() => {
      expect(api.fetchReports).toHaveBeenCalledTimes(2)
    })
  })
})

describe('거절 (F7)', () => {
  /**
   * 데모 관리자는 `content.moderate` 를 `demo` 로 좁혀 갖는다 (D-058). **목록은 전부
   * 읽히고**, 어느 줄이 막히는지는 화면이 미리 알 수 없다 — 스코프는 대상의 주인을
   * 상대로 판정되고 목록은 주인을 실어 오지 않는다. 그래서 버튼을 미리 죽이지 않고
   * 거절을 문장으로 받는다.
   */
  it('shows a demo administrator the queue, and answers the refusal with a sentence', async () => {
    api.handleReport.mockRejectedValue(refusal(403, 'FORBIDDEN'))

    const user = await openScreen(sessionDemoAdmin)

    // 미리 죽이지 않는다 — 어느 줄이 되는지 알 수 없기 때문이다.
    const dialog = await openDialog(user)

    await user.click(radio(dialog, copy.handle.outcomeLabels.HIDDEN))
    await user.type(note(dialog), '욕설입니다.')
    await user.click(within(dialog).getByRole('button', { name: copy.handle.submit }))

    expect(await within(dialog).findByText(copy.handle.refusals.forbidden)).toBeVisible()
    // 카탈로그의 「이 작업을 할 수 있는 권한이 없어요」 한 줄로는 왜 어떤 줄은 되고
    // 어떤 줄은 안 되는지를 말할 수 없다.
    expect(within(dialog).queryByText(errorCopy.FORBIDDEN)).toBeNull()
  })

  /** 다음 행동은 다시 누르는 것이 아니라 **목록을 다시 읽는 것**이다. */
  it('answers a lost race with the refresh that actually helps', async () => {
    api.handleReport.mockRejectedValue(refusal(409, 'REPORT_ALREADY_HANDLED'))

    const user = await openScreen()
    const dialog = await openDialog(user)

    await user.click(radio(dialog, copy.handle.outcomeLabels.HIDDEN))
    await user.type(note(dialog), '욕설입니다.')
    await user.click(within(dialog).getByRole('button', { name: copy.handle.submit }))

    await user.click(await within(dialog).findByRole('button', { name: copy.handle.refreshLabel }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    expect(api.fetchReports).toHaveBeenCalledTimes(2)
  })

  /** 그 밖의 거절은 카탈로그가 코드로 문장을 고른다. 화면이 다시 짓지 않는다. */
  it('leaves every other refusal to the error catalog', async () => {
    api.handleReport.mockRejectedValue(refusal(409, 'REPORT_NOT_REMOVABLE'))

    const user = await openScreen()
    const dialog = await openDialog(user)

    await user.click(radio(dialog, copy.handle.outcomeLabels.HIDDEN))
    await user.type(note(dialog), '욕설입니다.')
    await user.click(within(dialog).getByRole('button', { name: copy.handle.submit }))

    expect(await within(dialog).findByText(errorCopy.REPORT_NOT_REMOVABLE)).toBeVisible()
  })

  /**
   * 목록도 처리도 `content.moderate` 하나다. 그 퍼미션이 아예 없는 계정에게는 「다시
   * 시도」가 붙은 오류가 아니라 **아무리 눌러도 되지 않는다**는 문장이 서야 한다.
   */
  it('says no differently to an account that cannot moderate at all', async () => {
    const { default: ReportsPage } = await import('@/app/reports/page')

    renderWithAuth(<ReportsPage />, { session: null })

    expect(await screen.findByText(copy.forbiddenTitle)).toBeVisible()
    expect(api.fetchReports).not.toHaveBeenCalled()
  })

  it('lets an ordinary operator moderate', async () => {
    await openScreen(sessionAdminOperator)

    expect(screen.getAllByRole('button', { name: copy.list.handleLabel })[0]).toBeEnabled()
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
  it('has no violations with the queue and the handling dialog open', async () => {
    api.fetchReports.mockResolvedValue(
      reportList([
        report({ targetHidden: true, targetReportCount: 3 }),
        report({ status: 'HIDDEN' }),
      ]),
    )

    const user = await openScreen()

    await openDialog(user)

    const results = await axe.run(document.body, A11Y)

    expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([])
  })
})
