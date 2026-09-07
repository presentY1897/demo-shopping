/**
 * `/demo`, 운영자가 실제로 만지는 대로 (TASK-0096).
 *
 * 아래의 검사는 전부 **진짜 화면을 그린 뒤 고르거나 입력한다.** 지어낸 프롭 꾸러미를
 * 컴포넌트에 건네지 않고 클래스 이름을 확인하지 않는다 (QUALITY-GATES Q5). 재는 것은
 * 만료가 임박한 계정이 사용 중인 계정과 다르게 그려지는가(F1), 강제 만료가 **지우는
 * 것이 아니라고** 화면이 말하는가(F2 · 4.1), 정리 실패에 **이유가 함께 서는가**(F4),
 * 재시도가 청소기를 한 번 부르는 버튼 하나인가(F5), 정책이 **이후 발급분에만**
 * 적용된다고 말하는가(F6 · R1), 그리고 일별·역할별이 한 답에서 그려지는가(F7)다.
 *
 * ## 대역이 msw 가 아니라 모듈이다
 *
 * `packages/api-mocks` 에 `/admin/demo` 의 대역이 없고, 이 TASK 는 `apps/admin` 밖을
 * 고치지 않는다. 그래서 `lib/demo/console-api` 를 대신 세운다 — 답은 여전히 계약
 * 스키마를 지난 값이다 (`support/demo-console.ts`).
 */

import { sessionAdminOperator, sessionDemoAdmin } from '@shopping/api-mocks'
import { ApiClientError } from '@shopping/shared'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { UserEvent } from '@testing-library/user-event'
import axe from 'axe-core'
import type { RunOptions } from 'axe-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DemoConsoleWorkspace } from '@/components/demo/demo-console-workspace'
import { messagesFor } from '@/messages'

import type { MockSession } from './support/auth'
import { renderWithAuth } from './support/auth'
import {
  DEMO_NOW,
  demoAccount,
  demoAccountList,
  demoPolicy,
  demoStats,
} from './support/demo-console'

const api = vi.hoisted(() => ({
  fetchDemoPolicy: vi.fn(),
  updateDemoPolicy: vi.fn(),
  fetchDemoAccounts: vi.fn(),
  expireDemoAccount: vi.fn(),
  sweepDemoAccounts: vi.fn(),
  fetchDemoStats: vi.fn(),
}))

vi.mock('@/lib/demo/console-api', () => api)

const { demoConsole: copy, users, errors } = messagesFor()

async function openScreen(session?: MockSession): Promise<UserEvent> {
  const user = userEvent.setup()

  renderWithAuth(
    <DemoConsoleWorkspace
      errors={errors}
      messages={copy}
      now={DEMO_NOW}
      roleNames={users.roleNames}
    />,
    session === undefined ? {} : { session },
  )
  await screen.findByRole('table', { name: copy.accounts.listLabel })

  return user
}

function accountsTable(): HTMLElement {
  return screen.getByRole('table', { name: copy.accounts.listLabel })
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
  api.fetchDemoPolicy.mockResolvedValue(demoPolicy())
  api.fetchDemoAccounts.mockResolvedValue(demoAccountList([demoAccount()]))
  api.fetchDemoStats.mockResolvedValue(demoStats())
})

describe('계정 목록 (F1)', () => {
  it('says how long each account has, and separates the last hour from the rest', async () => {
    api.fetchDemoAccounts.mockResolvedValue(
      demoAccountList([
        demoAccount({ expiresAt: '2026-09-07T09:00:00.000Z' }),
        demoAccount({ expiresAt: '2026-09-07T03:20:00.000Z' }),
      ]),
    )

    await openScreen()

    const table = accountsTable()

    expect(within(table).getByText(copy.accounts.expiryLabels.live)).toBeVisible()
    expect(within(table).getByText(copy.accounts.expiryLabels.endingSoon)).toBeVisible()
  })

  /** 계약이 `expiresAt` 을 nullable 로 싣는다. 빈칸은 「못 읽었다」와 섞인다. */
  it('has a word for an account with no expiry at all', async () => {
    api.fetchDemoAccounts.mockResolvedValue(demoAccountList([demoAccount({ expiresAt: null })]))

    await openScreen()

    expect(within(accountsTable()).getByText(copy.accounts.expiryLabels.none)).toBeVisible()
  })

  it('offers a retry when the list could not be read (U6)', async () => {
    api.fetchDemoAccounts.mockRejectedValue(refusal(500, 'INTERNAL_ERROR'))

    const user = userEvent.setup()

    renderWithAuth(
      <DemoConsoleWorkspace
        errors={errors}
        messages={copy}
        now={DEMO_NOW}
        roleNames={users.roleNames}
      />,
    )

    expect(await screen.findByText(copy.accounts.errorTitle)).toBeVisible()

    api.fetchDemoAccounts.mockResolvedValue(demoAccountList([demoAccount()]))
    await user.click(screen.getByRole('button', { name: copy.accounts.retryLabel }))

    expect(await screen.findByRole('table', { name: copy.accounts.listLabel })).toBeVisible()
  })

  /** 한 섹션이 실패해도 나머지는 그려진다 — 「데모가 죽었나」로 읽히지 않게. */
  it('keeps the other sections when one door fails', async () => {
    api.fetchDemoPolicy.mockRejectedValue(refusal(500, 'INTERNAL_ERROR'))

    await openScreen()

    expect(screen.getByText(copy.policy.errorTitle)).toBeVisible()
    expect(accountsTable()).toBeVisible()
  })
})

describe('강제 만료 (F2)', () => {
  /** 지우지 않는다. 말하지 않으면 목록에 그대로 남은 계정을 보고 실패로 읽는다. */
  it('says it moves the expiry rather than deleting the account', async () => {
    await openScreen()

    expect(screen.getByText(copy.accounts.expireNotice)).toBeVisible()
  })

  it('asks once, then calls the door', async () => {
    api.expireDemoAccount.mockResolvedValue(undefined)

    const user = await openScreen()

    await user.click(
      within(accountsTable()).getByRole('button', { name: copy.accounts.expireLabel }),
    )

    const confirm = await screen.findByRole('dialog')

    expect(within(confirm).getByText(copy.accounts.confirm.title)).toBeVisible()
    expect(api.expireDemoAccount).not.toHaveBeenCalled()

    await user.click(within(confirm).getByRole('button', { name: copy.accounts.confirm.confirm }))

    await waitFor(() => {
      expect(api.expireDemoAccount).toHaveBeenCalledWith(expect.any(String))
    })
  })

  /** 만료 시각이 바뀌었으니 목록을 다시 읽는다. 통계의 활성 수도 함께 달라진다. */
  it('reads the list and the statistics again afterwards', async () => {
    api.expireDemoAccount.mockResolvedValue(undefined)

    const user = await openScreen()

    await user.click(
      within(accountsTable()).getByRole('button', { name: copy.accounts.expireLabel }),
    )
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: copy.accounts.confirm.confirm,
      }),
    )

    await waitFor(() => {
      expect(api.fetchDemoAccounts).toHaveBeenCalledTimes(2)
    })
    expect(api.fetchDemoStats).toHaveBeenCalledTimes(2)
  })
})

describe('정리 실패와 재시도 (F4 · F5)', () => {
  /** 시각과 이유는 짝이다. 이유 없는 실패는 화면이 말할 것이 없다 (4.3). */
  it('shows the failure with the reason beside it', async () => {
    api.fetchDemoAccounts.mockResolvedValue(
      demoAccountList([
        demoAccount({
          cleanupError: '남아 있는 주문이 있습니다',
          cleanupFailedAt: '2026-09-07T02:00:00.000Z',
        }),
      ]),
    )

    await openScreen()

    expect(within(accountsTable()).getByText('남아 있는 주문이 있습니다')).toBeVisible()
  })

  it('says a failure is a field that clears itself, not a list that piles up', async () => {
    await openScreen()

    expect(screen.getByText(copy.accounts.cleanupNotice)).toBeVisible()
  })

  it('narrows to the accounts that failed', async () => {
    const user = await openScreen()

    await user.click(screen.getByLabelText(copy.accounts.failedOnlyLabel))

    await waitFor(() => {
      expect(api.fetchDemoAccounts).toHaveBeenLastCalledWith(
        expect.objectContaining({ failedOnly: true }),
        expect.anything(),
      )
    })
  })

  /** 재시도는 청소기를 한 번 부르는 것뿐이다 — 화면이 정리 순서를 다시 만들지 않는다. */
  it('retries by running the sweep once', async () => {
    api.sweepDemoAccounts.mockResolvedValue({ swept: 2, failed: 1 })

    const user = await openScreen()

    await user.click(screen.getByRole('button', { name: copy.accounts.sweepLabel }))

    await waitFor(() => {
      expect(api.sweepDemoAccounts).toHaveBeenCalledTimes(1)
    })

    expect(
      await screen.findByText(copy.toast.swept.replace('{swept}', '2').replace('{failed}', '1')),
    ).toBeVisible()
  })

  /** 0을 둘 그리는 대신 한 문장으로 말한다. */
  it('says nothing was there rather than drawing two zeroes', async () => {
    api.sweepDemoAccounts.mockResolvedValue({ swept: 0, failed: 0 })

    const user = await openScreen()

    await user.click(screen.getByRole('button', { name: copy.accounts.sweepLabel }))

    expect(await screen.findByText(copy.toast.sweptNothing)).toBeVisible()
  })

  it('shows the refusal when the sweep could not run (U6)', async () => {
    api.sweepDemoAccounts.mockRejectedValue(refusal(500, 'INTERNAL_ERROR'))

    const user = await openScreen()

    await user.click(screen.getByRole('button', { name: copy.accounts.sweepLabel }))

    expect(await screen.findByText(errors.INTERNAL_ERROR)).toBeVisible()
  })
})

describe('정책 (F6)', () => {
  /** R1. 말하지 않으면 「안 먹혔다」로 읽힌다. */
  it('says the change applies to later issues only', async () => {
    await openScreen()

    expect(screen.getByText(copy.policy.notice)).toBeVisible()
  })

  it('seeds the boxes with what is stored', async () => {
    api.fetchDemoPolicy.mockResolvedValue(demoPolicy({ ttlHours: 24 }))

    await openScreen()

    expect(
      await screen.findByLabelText(copy.policy.fields.ttlHours.label, { exact: false }),
    ).toHaveValue('24')
  })

  it('saves a lifetime of one hour', async () => {
    api.updateDemoPolicy.mockResolvedValue(demoPolicy({ ttlHours: 1 }))

    const user = await openScreen()
    const box = await screen.findByLabelText(copy.policy.fields.ttlHours.label, { exact: false })

    await user.clear(box)
    await user.type(box, '1')
    await user.click(screen.getByRole('button', { name: copy.policy.submitLabel }))

    await waitFor(() => {
      expect(api.updateDemoPolicy).toHaveBeenCalledWith(expect.objectContaining({ ttlHours: 1 }))
    })

    expect(await screen.findByText(copy.toast.policySaved)).toBeVisible()
  })

  /**
   * 수명이 0이면 발급되는 즉시 만료된 계정이 나오고, 그 증상은 「데모가 안 된다」로만
   * 보인다 (4.4). 범위 문장의 두 수는 계약에서 읽어 온 것이다.
   */
  it('refuses a lifetime the contract would refuse, in that box, with the real bounds', async () => {
    const user = await openScreen()
    const box = await screen.findByLabelText(copy.policy.fields.ttlHours.label, { exact: false })

    await user.clear(box)
    await user.type(box, '0')
    await user.click(screen.getByRole('button', { name: copy.policy.submitLabel }))

    expect(
      await screen.findByText(
        copy.policy.errors.ttlHours.range.replace('{min}', '1').replace('{max}', '720'),
      ),
    ).toBeVisible()
    expect(api.updateDemoPolicy).not.toHaveBeenCalled()
  })

  it('shows the stored policy in the units a person reads', async () => {
    api.fetchDemoPolicy.mockResolvedValue(demoPolicy({ virtualCardLimit: 5_000_000 }))

    await openScreen()

    expect(
      screen.getByText(
        new RegExp(copy.policy.current.virtualCardLimit.replace('{amount}', '₩5,000,000')),
      ),
    ).toBeVisible()
  })
})

describe('통계 (F7)', () => {
  it('answers both axes from one read', async () => {
    await openScreen()

    const days = screen.getByRole('table', { name: copy.stats.daysCaption })
    const byRole = screen.getByRole('table', { name: copy.stats.byRoleCaption })

    expect(within(days).getAllByRole('row').length).toBeGreaterThan(3)
    expect(within(byRole).getByText(users.roleNames.BUYER)).toBeVisible()
    expect(api.fetchDemoStats).toHaveBeenCalledTimes(1)
  })

  /** 빈 날을 빼면 「이틀 아무도 안 눌렀다」가 「꾸준했다」로 보인다. */
  it('keeps a day nobody issued anything on', async () => {
    await openScreen()

    const days = screen.getByRole('table', { name: copy.stats.daysCaption })

    expect(
      within(days)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toContain('0')
  })

  /** 모르는 열쇠를 숨기면 역할별 합이 조용히 전체와 어긋난다. */
  it('keeps a role this console has never heard of, and says why it looks like that', async () => {
    api.fetchDemoStats.mockResolvedValue(demoStats({ byRole: { BUYER: 5, MODERATOR: 1 } }))

    await openScreen()

    expect(
      within(screen.getByRole('table', { name: copy.stats.byRoleCaption })).getByText('MODERATOR'),
    ).toBeVisible()
    expect(screen.getByText(copy.stats.unnamedRoleNotice)).toBeVisible()
  })

  it('shows how many accounts are alive and how many failed to clean up', async () => {
    api.fetchDemoStats.mockResolvedValue(demoStats({ activeAccounts: 7, failedCleanups: 1 }))

    await openScreen()

    expect(screen.getByText(copy.stats.summary.activeLabel)).toBeVisible()
    expect(screen.getByText(copy.stats.summary.countValue.replace('{count}', '7'))).toBeVisible()
  })

  /**
   * 서버는 거꾸로 고른 기간을 하루로 접어 200 으로 답한다. 그대로 보내면 화면의 날짜
   * 두 칸과 표가 서로 다른 기간을 가리킨다.
   */
  it('names a reversed period instead of asking for it', async () => {
    const user = await openScreen()

    await user.clear(screen.getByLabelText(copy.stats.filters.fromLabel))
    await user.type(screen.getByLabelText(copy.stats.filters.fromLabel), '2026-12-31')

    expect(await screen.findByText(copy.stats.filters.rangeReversed)).toBeVisible()
    expect(api.fetchDemoStats).toHaveBeenCalledTimes(1)
  })

  it('asks for the period the two boxes show', async () => {
    await openScreen()

    expect(api.fetchDemoStats).toHaveBeenCalledWith(
      { from: '2026-08-25', to: '2026-09-07' },
      expect.anything(),
    )
  })
})

describe('자격', () => {
  /** 여섯 문 전부가 `demo.manage` 하나다. 세 관리자 역할이 모두 그것을 갖는다. */
  it('lets every administrator role in, including the demo administrator', async () => {
    await openScreen(sessionDemoAdmin)

    expect(screen.getByRole('button', { name: copy.accounts.sweepLabel })).toBeEnabled()
  })

  it('lets an operator run the sweep too', async () => {
    await openScreen(sessionAdminOperator)

    expect(screen.getByRole('button', { name: copy.accounts.sweepLabel })).toBeEnabled()
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
  it('has no violations with all three sections drawn', async () => {
    api.fetchDemoAccounts.mockResolvedValue(
      demoAccountList([
        demoAccount(),
        demoAccount({
          cleanupError: '남아 있는 주문이 있습니다',
          cleanupFailedAt: '2026-09-07T02:00:00.000Z',
        }),
      ]),
    )

    await openScreen()

    expect((await axe.run(document.body, A11Y)).violations).toEqual([])
  })

  /** 강제 만료까지 키보드만으로 닿는가 (P4 · U5). */
  it('reaches the confirmation from the keyboard alone', async () => {
    const user = await openScreen()
    const expire = within(accountsTable()).getByRole('button', { name: copy.accounts.expireLabel })

    expire.focus()
    await user.keyboard('{Enter}')

    expect(await screen.findByRole('dialog')).toBeVisible()
    expect((await axe.run(document.body, A11Y)).violations).toEqual([])
  })
})
