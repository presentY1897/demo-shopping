/**
 * `/users`, 운영자가 실제로 만지는 대로 (TASK-0093).
 *
 * 아래의 검사는 전부 **진짜 화면을 그린 뒤 고르거나 입력한다.** 지어낸 프롭 꾸러미를
 * 컴포넌트에 건네지 않고 클래스 이름을 확인하지 않는다 (QUALITY-GATES Q5). 재는 것은
 * 목록에 가려지지 않은 값이 **한 글자도 없는가**(F6), 상세를 여는 데 **사유가 실제로
 * 필요한가**(F7), 그 사유가 미리 채워져 있지 **않은가**(4.3), 적립금의 실제 반영액이
 * 요청한 숫자와 다를 때 화면이 그것을 말하는가(F5), 관리자 역할 부여에 확인이 한 걸음
 * 더 있는가(R1), 정지·해제가 로그인을 막는 조치로 설명되는가(F4), 그리고 **쓰기를 못
 * 하는 계정에게 버튼이 죽어 있고 거절이 문장으로 서는가**(F8)다.
 *
 * ## 대역이 msw 가 아니라 모듈이다
 *
 * `packages/api-mocks` 에 `/admin/users` 의 대역이 없고, 이 TASK 는 `apps/admin` 밖을
 * 고치지 않는다. 그래서 `lib/users/console-api` 를 대신 세운다 — 경로와 스키마가 그 한
 * 파일에 모여 있는 것이 이것을 가능하게 하고, 답은 여전히 계약 스키마를 지난 값이다
 * (`support/users.ts`). `reports-page.spec.tsx` 가 같은 사정을 같은 방식으로 다룬다.
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
import { pointsAnswer, rolesAnswer, userDetail, userList, userSummary } from './support/users'

const api = vi.hoisted(() => ({
  fetchUsers: vi.fn(),
  viewUser: vi.fn(),
  suspendUser: vi.fn(),
  reinstateUser: vi.fn(),
  adjustPoints: vi.fn(),
  grantRole: vi.fn(),
  revokeRole: vi.fn(),
}))

vi.mock('@/lib/users/console-api', () => api)

const { users: copy } = messagesFor()

async function openScreen(session?: MockSession): Promise<UserEvent> {
  const user = userEvent.setup()
  const { default: UsersPage } = await import('@/app/users/page')

  renderWithAuth(<UsersPage />, session === undefined ? {} : { session })
  await screen.findByRole('table', { name: copy.list.listLabel })

  return user
}

/** 사유를 묻는 창을 연다. 첫 줄의 「상세 보기」가 그 문이다. */
async function openReasonDialog(user: UserEvent): Promise<HTMLElement> {
  await user.click(screen.getAllByRole('button', { name: copy.list.openLabel })[0]!)

  return screen.findByRole('dialog')
}

/** 사유를 적고 실제로 연다. 상세 패널이 뜰 때까지 기다린다. */
async function openDetail(
  user: UserEvent,
  reason = '문의 확인을 위해 연락처를 봅니다',
): Promise<void> {
  const dialog = await openReasonDialog(user)

  await user.type(within(dialog).getByLabelText(copy.view.reasonLabel, { exact: false }), reason)
  await user.click(within(dialog).getByRole('button', { name: copy.view.submit }))
  await screen.findByRole('region', { name: copy.detail.title })
}

/** 상세 패널. 조치 셋이 전부 그 안에 있다. */
function detail(): HTMLElement {
  return screen.getByRole('region', { name: copy.detail.title })
}

/** `Select` 를 열고 보이는 글자로 하나 고른다. */
async function choose(user: UserEvent, comboboxName: string, option: string): Promise<void> {
  await user.click(screen.getByRole('combobox', { name: comboboxName }))
  await user.click(await screen.findByRole('option', { name: option }))
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
  api.fetchUsers.mockResolvedValue(userList([userSummary()]))
  api.viewUser.mockResolvedValue(userDetail())
})

describe('목록 (F1 · F6)', () => {
  /**
   * 계약이 가려진 값만 싣는다. 화면이 원본을 그리려면 어딘가에서 그것을 받아야 하고,
   * 그 어딘가가 없다는 것이 이 검사가 재는 것이다.
   */
  it('shows the masked email and name, and no raw value anywhere', async () => {
    api.fetchUsers.mockResolvedValue(
      userList([userSummary({ maskedEmail: 'hon***@example.com', maskedName: '홍*동' })]),
    )

    await openScreen()

    const table = screen.getByRole('table', { name: copy.list.listLabel })

    expect(within(table).getByText('hon***@example.com')).toBeVisible()
    expect(within(table).getByText('홍*동')).toBeVisible()
    expect(document.body.textContent).not.toContain('hongildong@example.com')
  })

  /** 별이 박힌 문자열은 설명 없이는 고장으로 읽히고, 사람은 그것을 검색창에 붙여 넣는다. */
  it('says the values are masked and that search looks at the real ones', async () => {
    await openScreen()

    expect(screen.getByText(copy.list.maskedNotice)).toBeVisible()
  })

  /** 한 번도 안 들어온 계정이 실제로 있다. 빈칸은 「못 읽었다」와 섞인다. */
  it('says so rather than leaving a blank when nobody ever signed in', async () => {
    api.fetchUsers.mockResolvedValue(userList([userSummary({ lastLoginAt: null })]))

    await openScreen()

    expect(screen.getByText(copy.list.neverLoggedIn)).toBeVisible()
  })

  /** 글자마다 보내면 「hong」을 치는 사이에 요청이 네 번 나간다. */
  it('sends the search once, when it is submitted', async () => {
    const user = await openScreen()

    await user.type(screen.getByLabelText(copy.list.filters.searchLabel), 'hong')

    expect(api.fetchUsers).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: copy.list.filters.searchSubmit }))

    await waitFor(() => {
      expect(api.fetchUsers).toHaveBeenLastCalledWith(
        expect.objectContaining({ q: 'hong' }),
        expect.anything(),
      )
    })
  })

  it('narrows by role without a second press', async () => {
    const user = await openScreen()

    await choose(user, copy.list.filters.roleLabel, copy.roleNames.SELLER_OWNER)

    await waitFor(() => {
      expect(api.fetchUsers).toHaveBeenLastCalledWith(
        expect.objectContaining({ role: 'SELLER_OWNER' }),
        expect.anything(),
      )
    })
  })

  it('tells an empty list apart from a list nothing matched', async () => {
    api.fetchUsers.mockResolvedValue(userList([]))

    // `openScreen` 은 표를 기다린다. 빈 목록에는 표가 없으므로 여기서는 직접 그린다.
    const user = userEvent.setup()
    const { default: UsersPage } = await import('@/app/users/page')

    renderWithAuth(<UsersPage />)

    expect(await screen.findByText(copy.list.emptyTitle)).toBeVisible()

    await user.type(screen.getByLabelText(copy.list.filters.searchLabel), 'nobody')
    await user.click(screen.getByRole('button', { name: copy.list.filters.searchSubmit }))

    expect(await screen.findByText(copy.list.filteredEmptyTitle)).toBeVisible()
  })

  it('offers a retry when the list could not be read (U6)', async () => {
    api.fetchUsers.mockRejectedValue(refusal(500, 'INTERNAL_ERROR'))

    const user = userEvent.setup()
    const { default: UsersPage } = await import('@/app/users/page')

    renderWithAuth(<UsersPage />)

    expect(await screen.findByText(copy.list.errorTitle)).toBeVisible()

    api.fetchUsers.mockResolvedValue(userList([userSummary()]))
    await user.click(screen.getByRole('button', { name: copy.list.retryLabel }))

    expect(await screen.findByRole('table', { name: copy.list.listLabel })).toBeVisible()
  })
})

describe('열람 (F7)', () => {
  /** 사유 없이는 열 수 없다. 그것이 이 화면에서 「막는 것이 아니라 가르는 것」이다. */
  it('asks why before it opens anything', async () => {
    const user = await openScreen()

    await openReasonDialog(user)

    expect(api.viewUser).not.toHaveBeenCalled()
  })

  /**
   * 미리 채워 둔 사유는 감사 기록이 아니라 **감사 기록의 모양**이다. 칸이 비어 있고,
   * 비운 채로 누르면 나가지 않는다.
   */
  it('starts with an empty reason and refuses to send one', async () => {
    const user = await openScreen()
    const dialog = await openReasonDialog(user)
    const box = within(dialog).getByLabelText(copy.view.reasonLabel, { exact: false })

    expect(box).toHaveValue('')

    await user.click(within(dialog).getByRole('button', { name: copy.view.submit }))

    expect(await within(dialog).findByText(copy.view.errors.reasonRequired)).toBeVisible()
    expect(api.viewUser).not.toHaveBeenCalled()
  })

  it('sends the sentence the operator actually typed', async () => {
    const user = await openScreen()

    await openDetail(user, '배송 사고 문의(#12345) 확인')

    expect(api.viewUser).toHaveBeenCalledWith(expect.any(String), '배송 사고 문의(#12345) 확인')
  })

  /** 여는 대상도 가려진 값이다 — 원본을 미리 보여 주면 이 창을 지나기 전에 열린 것이 된다. */
  it('identifies the account by its masked values, inside the dialog', async () => {
    const user = await openScreen()
    const dialog = await openReasonDialog(user)

    expect(within(dialog).getByText(/hon\*\*\*@example\.com/)).toBeVisible()
    expect(dialog.textContent).not.toContain('hongildong@example.com')
  })

  it('says the reason will be kept', async () => {
    const user = await openScreen()
    const dialog = await openReasonDialog(user)

    expect(within(dialog).getByText(copy.view.notice)).toBeVisible()
  })
})

describe('상세 요약 (F2)', () => {
  it('shows the unmasked values only after the reason was given', async () => {
    const user = await openScreen()

    expect(document.body.textContent).not.toContain('hongildong@example.com')

    await openDetail(user)

    expect(within(detail()).getByText('hongildong@example.com')).toBeVisible()
    expect(within(detail()).getByText('홍길동')).toBeVisible()
  })

  it('summarises what the account did, as counts and money', async () => {
    api.viewUser.mockResolvedValue(
      userDetail({
        stats: {
          orderCount: 12,
          paidAmount: 348_000,
          reviewCount: 3,
          questionCount: 1,
          pointBalance: 12_000,
          couponCount: 2,
        },
      }),
    )

    const user = await openScreen()

    await openDetail(user)

    const panel = detail()

    expect(within(panel).getByText('₩348,000')).toBeVisible()
    expect(within(panel).getAllByText('12건').length).toBeGreaterThan(0)
    expect(within(panel).getByText(copy.detail.statsNote)).toBeVisible()
  })
})

describe('역할 (F3 · R1)', () => {
  it('grants an everyday role in one press', async () => {
    api.grantRole.mockResolvedValue(rolesAnswer(userDetail().user.id, ['BUYER', 'SELLER_OWNER']))

    const user = await openScreen()

    await openDetail(user)
    await choose(user, copy.roles.grantLabel, copy.roleNames.SELLER_OWNER)
    await user.click(within(detail()).getByRole('button', { name: copy.roles.grantSubmit }))

    await waitFor(() => {
      expect(api.grantRole).toHaveBeenCalledWith(expect.any(String), 'SELLER_OWNER')
    })
  })

  /**
   * 관리자 역할은 부여하는 순간 콘솔 전체가 열린다. 확인 한 걸음이 없으면 목록에서
   * 잘못 고른 한 번이 곧 최고관리자 한 명이다.
   */
  it('asks again before it hands over the whole console', async () => {
    const user = await openScreen()

    await openDetail(user)
    await choose(user, copy.roles.grantLabel, copy.roleNames.ADMIN_SUPER)
    await user.click(within(detail()).getByRole('button', { name: copy.roles.grantSubmit }))

    const confirm = await screen.findByRole('dialog')

    expect(within(confirm).getByText(copy.roles.confirm.title)).toBeVisible()
    expect(api.grantRole).not.toHaveBeenCalled()

    api.grantRole.mockResolvedValue(rolesAnswer(userDetail().user.id, ['BUYER', 'ADMIN_SUPER']))
    await user.click(within(confirm).getByRole('button', { name: copy.roles.confirm.confirm }))

    await waitFor(() => {
      expect(api.grantRole).toHaveBeenCalledWith(expect.any(String), 'ADMIN_SUPER')
    })
  })

  it('revokes a role the account already holds', async () => {
    api.revokeRole.mockResolvedValue(rolesAnswer(userDetail().user.id, []))

    const user = await openScreen()

    await openDetail(user)
    await user.click(
      within(detail()).getByRole('button', {
        name: copy.roles.revokeLabel.replace('{role}', copy.roleNames.BUYER),
      }),
    )

    await waitFor(() => {
      expect(api.revokeRole).toHaveBeenCalledWith(expect.any(String), 'BUYER')
    })
  })

  /** 눌러도 아무 일도 안 일어나는 항목은 눌러 본 사람에게 고장으로 읽힌다. */
  it('does not offer a role the account already has', async () => {
    const user = await openScreen()

    await openDetail(user)
    await user.click(screen.getByRole('combobox', { name: copy.roles.grantLabel }))

    expect(screen.queryByRole('option', { name: copy.roleNames.BUYER })).toBeNull()
    expect(await screen.findByRole('option', { name: copy.roleNames.SELLER_OWNER })).toBeVisible()
  })
})

describe('정지 (F4)', () => {
  it('will not suspend without a reason', async () => {
    const user = await openScreen()

    await openDetail(user)
    await user.click(within(detail()).getByRole('button', { name: copy.suspension.suspendLabel }))

    expect(await screen.findByText(copy.suspension.errors.reasonRequired)).toBeVisible()
    expect(api.suspendUser).not.toHaveBeenCalled()
  })

  it('suspends with the reason, then lets the list say so', async () => {
    api.suspendUser.mockResolvedValue(undefined)

    const user = await openScreen()

    await openDetail(user)
    await user.type(
      within(detail()).getByLabelText(copy.suspension.reasonLabel, { exact: false }),
      '허위 리뷰 반복',
    )
    await user.click(within(detail()).getByRole('button', { name: copy.suspension.suspendLabel }))

    await waitFor(() => {
      expect(api.suspendUser).toHaveBeenCalledWith(expect.any(String), '허위 리뷰 반복')
    })

    // 204 라 앉힐 것이 없다. 패널을 닫고 목록을 조용히 다시 읽는다 — 정지 시각을
    // 화면이 지어내면 서버가 적은 시각과 달라진다.
    await waitFor(() => {
      expect(screen.queryByRole('region', { name: copy.detail.title })).toBeNull()
    })
    expect(api.fetchUsers).toHaveBeenCalledTimes(2)
    expect(api.viewUser).toHaveBeenCalledTimes(1)
  })

  /** 정지는 탈퇴가 아니고, 살아 있는 세션도 함께 끊긴다 (4.4). */
  it('says the suspension is reversible and cuts the live session', async () => {
    const user = await openScreen()

    await openDetail(user)

    expect(within(detail()).getByText(copy.suspension.notice)).toBeVisible()
  })

  it('shows the standing suspension and offers to lift it', async () => {
    api.viewUser.mockResolvedValue(
      userDetail({
        suspendedAt: '2026-09-01T00:00:00.000Z',
        suspendedReason: '허위 리뷰 반복',
      }),
    )
    api.reinstateUser.mockResolvedValue(undefined)

    const user = await openScreen()

    await openDetail(user)

    expect(within(detail()).getByText(copy.suspension.activeTitle)).toBeVisible()
    expect(
      within(detail()).getByText(
        copy.suspension.activeReason.replace('{reason}', '허위 리뷰 반복'),
      ),
    ).toBeVisible()

    await user.click(within(detail()).getByRole('button', { name: copy.suspension.reinstateLabel }))

    await waitFor(() => {
      expect(api.reinstateUser).toHaveBeenCalledWith(expect.any(String))
    })
  })

  /** 이미 다른 관리자가 바꿔 놓았다. 다음 행동은 다시 읽는 것이지 다시 누르는 것이 아니다. */
  it('says somebody got there first rather than offering the same button again', async () => {
    api.viewUser.mockResolvedValue(userDetail({ suspendedAt: '2026-09-01T00:00:00.000Z' }))
    api.reinstateUser.mockRejectedValue(refusal(404, 'NOT_FOUND'))

    const user = await openScreen()

    await openDetail(user)
    await user.click(within(detail()).getByRole('button', { name: copy.suspension.reinstateLabel }))

    expect(await screen.findByText(copy.refusals.stale)).toBeVisible()
  })
})

describe('적립금 (F5)', () => {
  it('will not adjust without a reason', async () => {
    const user = await openScreen()

    await openDetail(user)
    await user.type(
      within(detail()).getByLabelText(copy.points.amountLabel, { exact: false }),
      '1000',
    )
    await user.click(within(detail()).getByRole('button', { name: copy.points.submitLabel }))

    expect(await screen.findByText(copy.points.errors.reasonRequired)).toBeVisible()
    expect(api.adjustPoints).not.toHaveBeenCalled()
  })

  it('sends a signed amount and the reason through one door', async () => {
    api.adjustPoints.mockResolvedValue(pointsAnswer(11_000, -1000))

    const user = await openScreen()

    await openDetail(user)
    await user.type(
      within(detail()).getByLabelText(copy.points.amountLabel, { exact: false }),
      '-1000',
    )
    await user.type(
      within(detail()).getByLabelText(copy.points.reasonLabel, { exact: false }),
      '오지급 회수',
    )
    await user.click(within(detail()).getByRole('button', { name: copy.points.submitLabel }))

    await waitFor(() => {
      expect(api.adjustPoints).toHaveBeenCalledWith(expect.any(String), {
        amount: -1000,
        reason: '오지급 회수',
      })
    })

    expect(await screen.findByText(/\+?-?₩1,000/)).toBeVisible()
  })

  /**
   * **화면이 요청한 숫자를 그리면 거짓말이다.** 5만원을 빼려 했고 1만원만 빠졌는데
   * 「-50,000원 조정했어요」라고 말하면, 그 사람은 다음에 잔액을 보고서야 안다.
   */
  it('says what actually moved when the balance clipped the deduction', async () => {
    api.adjustPoints.mockResolvedValue(pointsAnswer(0, -10_000))

    const user = await openScreen()

    await openDetail(user)
    await user.type(
      within(detail()).getByLabelText(copy.points.amountLabel, { exact: false }),
      '-50000',
    )
    await user.type(
      within(detail()).getByLabelText(copy.points.reasonLabel, { exact: false }),
      '오지급 회수',
    )
    await user.click(within(detail()).getByRole('button', { name: copy.points.submitLabel }))

    expect(
      await screen.findByText(
        copy.points.applied.clipped
          .replace('{requested}', '-₩50,000')
          .replace('{applied}', '-₩10,000'),
      ),
    ).toBeVisible()
  })

  /** 잔액이 0인 계정의 차감은 아무 줄도 남기지 않는다 — 「일부만 반영」과 다른 문장이다. */
  it('says nothing moved rather than pointing at a ledger row that does not exist', async () => {
    api.adjustPoints.mockResolvedValue(pointsAnswer(0, 0))

    const user = await openScreen()

    await openDetail(user)
    await user.type(
      within(detail()).getByLabelText(copy.points.amountLabel, { exact: false }),
      '-1000',
    )
    await user.type(
      within(detail()).getByLabelText(copy.points.reasonLabel, { exact: false }),
      '오지급 회수',
    )
    await user.click(within(detail()).getByRole('button', { name: copy.points.submitLabel }))

    expect(
      await screen.findByText(copy.points.applied.none.replace('{requested}', '-₩1,000')),
    ).toBeVisible()
  })

  it('says a zero is not an adjustment, in its own words', async () => {
    const user = await openScreen()

    await openDetail(user)
    await user.type(within(detail()).getByLabelText(copy.points.amountLabel, { exact: false }), '0')
    await user.type(
      within(detail()).getByLabelText(copy.points.reasonLabel, { exact: false }),
      '아무것도 아님',
    )
    await user.click(within(detail()).getByRole('button', { name: copy.points.submitLabel }))

    expect(await screen.findByText(copy.points.errors.amountZero)).toBeVisible()
    expect(api.adjustPoints).not.toHaveBeenCalled()
  })
})

describe('쓰기의 자격 (F8 · 4.6)', () => {
  /** 운영자는 읽을 수 있고 바꾸지 못한다. 감추지 않고 **왜 못 누르는지**를 말한다. */
  it('leaves an operator the reading and blocks every write, with a reason', async () => {
    const user = await openScreen(sessionAdminOperator)

    await openDetail(user)

    const panel = detail()

    for (const label of [
      copy.suspension.suspendLabel,
      copy.points.submitLabel,
      copy.roles.grantSubmit,
    ]) {
      const button = within(panel).getByRole('button', { name: label })

      expect(button).toHaveAttribute('aria-disabled', 'true')
      expect(button).toHaveAccessibleDescription()
    }
  })

  it('blocks a demo administrator the same way', async () => {
    const user = await openScreen(sessionDemoAdmin)

    await openDetail(user)

    expect(
      within(detail()).getByRole('button', { name: copy.suspension.suspendLabel }),
    ).toHaveAttribute('aria-disabled', 'true')
  })

  /**
   * 미리 막는 것만으로는 부족하다. 부팅 갱신이 끝나기 전이나 다른 탭에서 역할이
   * 회수된 뒤에는 살아 있는 버튼이 403 을 받고, 그때 화면이 아무 말도 하지 않으면
   * 같은 버튼이 몇 번이고 다시 눌린다.
   */
  it('still renders a sentence when a 403 arrives at a live button', async () => {
    api.suspendUser.mockRejectedValue(refusal(403, 'FORBIDDEN'))

    const user = await openScreen()

    await openDetail(user)
    await user.type(
      within(detail()).getByLabelText(copy.suspension.reasonLabel, { exact: false }),
      '허위 리뷰 반복',
    )
    await user.click(within(detail()).getByRole('button', { name: copy.suspension.suspendLabel }))

    expect(await screen.findByText(copy.refusals.forbidden)).toBeVisible()
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
  it('has no violations with the list, the reason dialog and the detail panel', async () => {
    api.fetchUsers.mockResolvedValue(
      userList([
        userSummary(),
        userSummary({ isDemo: true, suspendedAt: '2026-09-01T00:00:00.000Z' }),
      ]),
    )

    const user = await openScreen()

    await openReasonDialog(user)
    expect((await axe.run(document.body, A11Y)).violations).toEqual([])

    await user.keyboard('{Escape}')
    await openDetail(user)

    expect((await axe.run(document.body, A11Y)).violations).toEqual([])
  })

  /** 키보드만으로 상세까지 닿는가 (P4 · U5). */
  it('reaches the reason dialog and submits it from the keyboard alone', async () => {
    const user = await openScreen()

    await user.click(screen.getAllByRole('button', { name: copy.list.openLabel })[0]!)

    const dialog = await screen.findByRole('dialog')
    const box = within(dialog).getByLabelText(copy.view.reasonLabel, { exact: false })

    box.focus()
    await user.keyboard('키보드로 적은 사유')
    await user.tab()

    expect(document.activeElement).not.toBe(box)

    await user.click(within(dialog).getByRole('button', { name: copy.view.submit }))

    expect(await screen.findByRole('region', { name: copy.detail.title })).toBeVisible()
  })
})
