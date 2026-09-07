/**
 * 신고 버튼 (TASK-0091 F1 · F2 — 구매자 화면 몫).
 *
 * 관리자 처리 화면은 `apps/admin` 의 것이고, 여기서 재는 것은 **접수까지**다.
 *
 * **API 대역은 `test/support/community.ts` 다** — `@shopping/api-mocks` 에
 * `POST /reports` 의 핸들러가 아직 없다. 화면이 보낸 본문은 `createReportRequestSchema`
 * 로 읽히므로, 계약에 없는 필드를 싣거나 「기타」에 설명을 빠뜨리면 검사가 실패한다.
 *
 * **이 파일이 확인하는 것 넷으로 줄이면**:
 *
 * ① **사유를 미리 골라 두지 않는다.** 읽지 않고 보낸 신고는 관리자가 세는 숫자를 망친다.
 * ② **「기타」에만 설명 칸이 나타나고, 그때는 필수다** (계약의 `refine`).
 * ③ **접수한 뒤에는 폼이 사라진다** (F2). 두 번째 클릭이 400 을 받아 오게 두지 않는다.
 * ④ **거절 둘이 서로 다른 문장이다.** 자기 글을 신고하려던 사람과 이미 신고한 사람은
 *    다음에 할 일이 다르다.
 */

import { sessionBuyer } from '@shopping/api-mocks'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ReportDialog } from '@/components/reports/report-dialog'
import { messagesFor } from '@/messages'

import { renderWithAuth } from './support/auth'
import type { CommunityApiStub } from './support/community'
import { resetCommunityStores, stubCommunityApi } from './support/community'

vi.mock('next/navigation', async () => {
  const { nextNavigationMock } = await import('./support/navigation')

  return nextNavigationMock()
})

const REVIEW_ID = '019596d0-1f1c-7c2e-9a0e-630000000001'

const messages = messagesFor()
const copy = messages.report

let stub: CommunityApiStub

function open(signedIn = true): ReturnType<typeof userEvent.setup> {
  const user = userEvent.setup()

  renderWithAuth(
    <ReportDialog
      copy={copy}
      refusals={messages.refusals}
      targetId={REVIEW_ID}
      targetType="REVIEW"
    />,
    { session: signedIn ? sessionBuyer : null },
  )

  return user
}

async function openDialog(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  await user.click(await screen.findByRole('button', { name: copy.triggerLabel }))

  return screen.findByRole('dialog', { name: copy.title })
}

beforeEach(() => {
  localStorage.clear()
  resetCommunityStores()
  stub = stubCommunityApi()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('F1 접수', () => {
  it('opens with nothing chosen, and says so rather than sending', async () => {
    const user = open()
    const dialog = await openDialog(user)

    for (const reason of Object.values(copy.reasons)) {
      expect(within(dialog).getByRole('radio', { name: reason })).not.toBeChecked()
    }

    await user.click(within(dialog).getByRole('button', { name: copy.submitLabel }))

    expect(within(dialog).getByText(copy.issues.reason_required)).toBeVisible()
    expect(stub.writes).toEqual([])
  })

  it('sends the chosen reason with no detail field at all', async () => {
    const user = open()
    const dialog = await openDialog(user)

    await user.click(within(dialog).getByRole('radio', { name: copy.reasons.SPAM }))

    // 늘 보이는 빈 칸은 사람에게 「적어야 하나」를 매번 묻는다.
    expect(within(dialog).queryByLabelText(copy.detailLabel)).toBeNull()

    await user.click(within(dialog).getByRole('button', { name: copy.submitLabel }))

    await waitFor(() => {
      expect(stub.writes).toEqual([{ targetType: 'REVIEW', targetId: REVIEW_ID, reason: 'SPAM' }])
    })
  })

  it('reveals a required detail field for 「기타」', async () => {
    const user = open()
    const dialog = await openDialog(user)

    await user.click(within(dialog).getByRole('radio', { name: copy.reasons.OTHER }))

    const detail = within(dialog).getByLabelText(copy.detailLabel)

    await user.click(within(dialog).getByRole('button', { name: copy.submitLabel }))

    // 계약의 `refine` 과 같은 규칙이다. 분류되지 않는 신고에 근거까지 없으면
    // 관리자가 판단할 것이 하나도 없다.
    expect(within(dialog).getByText(copy.issues.detail_required)).toBeVisible()
    expect(stub.writes).toEqual([])

    await user.type(detail, '  같은 광고가 반복됩니다.  ')
    await user.click(within(dialog).getByRole('button', { name: copy.submitLabel }))

    await waitFor(() => {
      expect(stub.writes).toEqual([
        {
          targetType: 'REVIEW',
          targetId: REVIEW_ID,
          reason: 'OTHER',
          detail: '같은 광고가 반복됩니다.',
        },
      ])
    })
  })
})

describe('F2 접수 뒤', () => {
  it('replaces the form with an acknowledgement rather than a second button', async () => {
    const user = open()
    const dialog = await openDialog(user)

    await user.click(within(dialog).getByRole('radio', { name: copy.reasons.ABUSE }))
    await user.click(within(dialog).getByRole('button', { name: copy.submitLabel }))

    expect(await within(dialog).findByText(copy.doneTitle)).toBeVisible()
    expect(within(dialog).queryByRole('button', { name: copy.submitLabel })).toBeNull()
  })
})

describe('거절', () => {
  it.each([
    ['REPORT_OWN_CONTENT', messages.refusals.errors.REPORT_OWN_CONTENT],
    ['REPORT_ALREADY_FILED', messages.refusals.errors.REPORT_ALREADY_FILED],
  ])('says what to do next for %s', async (code, sentence) => {
    const user = open()
    const dialog = await openDialog(user)

    stub.state.refuseNextWrite = { status: 400, code, message: '서버 문장' }

    await user.click(within(dialog).getByRole('radio', { name: copy.reasons.ABUSE }))
    await user.click(within(dialog).getByRole('button', { name: copy.submitLabel }))

    // 서버 문장은 발행하는 쪽에게 하는 말이다. 사람이 다음에 할 일은 화면이 안다.
    expect(await within(dialog).findByText(sentence)).toBeVisible()
  })
})

describe('로그인', () => {
  it('offers sign-in in place of the trigger, because a report needs a reporter', async () => {
    open(false)

    // 중복 신고를 막는 것도, 남용을 확인하는 것도 사람을 알아야 할 수 있는 일이다.
    expect(await screen.findByRole('link', { name: copy.signInLabel })).toBeVisible()
    expect(screen.queryByRole('button', { name: copy.triggerLabel })).toBeNull()
  })
})
