/**
 * 상품 문의 (TASK-0088 F1 · F2 · F6 · F7).
 *
 * **API 대역은 `test/support/community.ts` 다** — `@shopping/api-mocks` 에 문의
 * 라우트의 핸들러가 아직 없다. 대역의 답은 계약 스키마를 지나고, 화면이 보낸 본문도
 * `createQuestionRequestSchema` 로 읽힌다.
 *
 * **이 파일이 확인하는 것 넷으로 줄이면**:
 *
 * ① **맥시멀에서만 목록이 펼쳐진 채로 시작한다** (F6). 접힌 단계는 **아무것도 묻지 않는다**.
 * ② **공개/비공개가 서버로 나간다** (F1). 무엇을 그렸나가 아니라 **무엇을 보냈나**를 잰다.
 * ③ **남의 비공개 문의 자리를 만들지 않는다** (F2). 줄 자체가 오지 않으므로 셀 수도 없다.
 * ④ **로그인하지 않은 사람은 401 을 만나지 않는다.** 그 자리는 폼이 아니라 로그인 링크다.
 */

import { sessionBuyer } from '@shopping/api-mocks'
import { DENSITY_STORAGE_KEY } from '@shopping/ui'
import { DensityProvider } from '@shopping/ui/density'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MyQuestionsScreen } from '@/components/questions/my-questions-screen'
import { ProductQuestions } from '@/components/questions/product-questions'
import { messagesFor } from '@/messages'

import { renderWithAuth } from './support/auth'
import type { CommunityApiStub } from './support/community'
import { MOCK_DETAIL_PRODUCT_ID, resetCommunityStores, stubCommunityApi } from './support/community'
import { renderAccountScreen, resetDensity } from './support/mypage'

vi.mock('next/navigation', async () => {
  const { nextNavigationMock } = await import('./support/navigation')

  return nextNavigationMock()
})

const messages = messagesFor()
const copy = messages.productDetail.questions
const mine = messages.mypage.questions

let stub: CommunityApiStub

function open({
  density = 3,
  signedIn = true,
}: { density?: number; signedIn?: boolean } = {}): ReturnType<typeof userEvent.setup> {
  localStorage.setItem(DENSITY_STORAGE_KEY, String(density))
  document.documentElement.setAttribute('data-density', String(density))

  const user = userEvent.setup()

  renderWithAuth(
    <DensityProvider>
      <ProductQuestions
        copy={copy}
        productId={MOCK_DETAIL_PRODUCT_ID}
        refusals={messages.refusals}
        report={messages.report}
      />
    </DensityProvider>,
    { session: signedIn ? sessionBuyer : null },
  )

  return user
}

beforeEach(() => {
  localStorage.clear()
  resetDensity()
  resetCommunityStores()
  stub = stubCommunityApi()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('F6 밀도 분기 — 맥시멀에서만 목록', () => {
  it('shows the list from the start at the maximal step', async () => {
    open({ density: 3 })

    const list = await screen.findByRole('list', { name: copy.listLabel })

    expect(within(list).getAllByRole('listitem')).toHaveLength(3)
  })

  it.each([1, 2])('asks for nothing at density %s and offers a link instead', async (density) => {
    const user = open({ density })

    // 보이지도 않을 목록을 위해 요청을 하나 더 보내면, 콜드 스타트가 90초인 배포에서
    // 그것이 화면이 늦게 뜨는 이유가 된다.
    expect(screen.queryByRole('list', { name: copy.listLabel })).toBeNull()
    expect(stub.requests.filter((one) => one.url.pathname.endsWith('/questions'))).toEqual([])

    await user.click(screen.getByRole('button', { name: copy.expandLabel }))

    expect(await screen.findByRole('list', { name: copy.listLabel })).toBeVisible()
  })
})

describe('F1 문의 작성', () => {
  it('sends the public/private choice the person made', async () => {
    const user = open()

    await screen.findByRole('list', { name: copy.listLabel })
    await user.click(screen.getByRole('button', { name: copy.askLabel }))
    await user.type(screen.getByLabelText(copy.form.contentLabel), '세탁기에 돌려도 되나요?')
    await user.click(screen.getByRole('radio', { name: copy.form.privateLabel }))
    await user.click(screen.getByRole('button', { name: copy.form.submitLabel }))

    // 무엇을 그렸나가 아니라 **무엇을 보냈나**를 잰다.
    await waitFor(() => {
      expect(stub.writes).toEqual([{ content: '세탁기에 돌려도 되나요?', isPublic: false }])
    })
  })

  it('defaults to public, because a question is part of the product’s information', async () => {
    const user = open()

    await screen.findByRole('list', { name: copy.listLabel })
    await user.click(screen.getByRole('button', { name: copy.askLabel }))

    // 계약의 기본값이 공개다. 비공개는 고르는 것이지 기본이 아니다.
    expect(screen.getByRole('radio', { name: copy.form.publicLabel })).toBeChecked()
  })

  it('says where to fix an empty body before spending a round trip', async () => {
    const user = open()

    await screen.findByRole('list', { name: copy.listLabel })
    await user.click(screen.getByRole('button', { name: copy.askLabel }))
    await user.click(screen.getByRole('button', { name: copy.form.submitLabel }))

    expect(screen.getByText(copy.form.issues.content_required)).toBeVisible()
    expect(stub.writes).toEqual([])
  })

  it('puts what was just written at the front rather than reading the list again', async () => {
    const user = open()

    await screen.findByRole('list', { name: copy.listLabel })
    await user.click(screen.getByRole('button', { name: copy.askLabel }))
    await user.type(screen.getByLabelText(copy.form.contentLabel), '재입고 일정이 있나요?')
    await user.click(screen.getByRole('button', { name: copy.form.submitLabel }))

    // 다시 읽으면 비공개로 남긴 문의가 다음 장으로 밀려 방금 쓴 것이 사라진다.
    const list = await screen.findByRole('list', { name: copy.listLabel })

    await waitFor(() => {
      expect(within(list).getAllByRole('listitem')).toHaveLength(4)
    })
    expect(screen.getByText(copy.form.submittedNotice)).toBeVisible()
  })

  it('offers sign-in rather than a form to a visitor', () => {
    open({ signedIn: false })

    expect(screen.getByRole('link', { name: copy.signInLabel })).toBeVisible()
    expect(screen.queryByRole('button', { name: copy.askLabel })).toBeNull()
  })
})

describe('F2 비공개', () => {
  it('marks a private question of one’s own and says nothing about anybody else’s', async () => {
    open()

    const list = await screen.findByRole('list', { name: copy.listLabel })
    const rows = within(list).getAllByRole('listitem')
    const privateRow = rows.find((row) => within(row).queryByText(copy.privateBadge) !== null)

    if (privateRow === undefined) throw new Error('비공개 문의 줄을 찾지 못했습니다.')
    expect(within(privateRow).getByText(copy.mineBadge)).toBeVisible()

    // 남의 비공개 문의는 줄 자체가 오지 않는다. 「비공개 문의입니다」 자리를 만들려면
    // 몇 개가 감춰졌는지 세어야 하고, 그 수 자체가 알아서는 안 될 것이다.
    expect(screen.getByText(copy.privacyNotice)).toBeVisible()
  })

  it('offers no report button on a question of one’s own', async () => {
    open()

    const list = await screen.findByRole('list', { name: copy.listLabel })
    const rows = within(list).getAllByRole('listitem')
    const mineRow = rows.find((row) => within(row).queryByText(copy.mineBadge) !== null)

    if (mineRow === undefined) throw new Error('내 문의 줄을 찾지 못했습니다.')

    // 서버가 `REPORT_OWN_CONTENT` 로 거절한다 — 보여 주면 누를 수 있는 것처럼 보이는
    // 막다른 길이다.
    expect(within(mineRow).queryByRole('button', { name: messages.report.triggerLabel })).toBeNull()
  })
})

describe('F7 마이페이지의 내 문의', () => {
  it('shows what was left, private ones included', async () => {
    renderAccountScreen(<MyQuestionsScreen messages={messages.mypage} />, {
      session: sessionBuyer,
    })

    const list = await screen.findByRole('list', { name: mine.listLabel })

    // 여기가 없으면 비공개 문의는 남기는 순간 사라지는 글이 된다.
    expect(within(list).getByText(mine.privateBadge)).toBeVisible()
    expect(within(list).getByText(mine.pendingBadge)).toBeVisible()
  })
})
