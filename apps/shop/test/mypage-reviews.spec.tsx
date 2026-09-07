/**
 * `/mypage/reviews` — 리뷰 쓸 수 있는 주문과 작성 (TASK-0083 F6 · F7).
 *
 * **API 대역이 이 저장소의 msw 가 아니다.** `packages/api-mocks` 에 리뷰 라우트의
 * 핸들러가 아직 없고 그것을 더하는 일은 이 갈래의 소유가 아니라서, `globalThis.fetch`
 * 를 감싸 리뷰 경로만 가로챈다 — 그 대역은 **요청도 답도 계약 스키마로** 다루므로,
 * 화면이 계약에 없는 필드를 싣거나 필수 필드를 빠뜨리면 여기서 터진다
 * (`test/support/reviews.ts` 의 머리말이 그 이음매를 적고 있다).
 *
 * **이 파일이 확인하는 것 넷으로 줄이면**:
 *
 * ① **기한은 서버의 값이다.** 화면은 `writableUntil` 을 「며칠 남았나」로만 옮기고,
 *    지난 줄에는 쓰기를 권하지 않는다.
 * ② **거절 일곱이 저마다 다른 문장을 갖는다.** 기다리면 되는 사람과 고쳐야 하는
 *    사람과 할 수 있는 일이 없는 사람에게 같은 문장을 보이면, 서버가 코드를 일곱으로
 *    나눈 일이 화면에서 다시 하나로 뭉개진다.
 * ③ **보내는 것은 계약의 모양이다.** 별점·본문·사진 열쇠, 그리고 가리키는 것은
 *    상품이 아니라 **주문 항목**이다.
 * ④ **쓴 뒤에 줄이 남는다.** 계약에 「내가 쓴 리뷰」 목록이 없으므로, 고치고 지우는
 *    일이 일어날 수 있는 자리는 여기뿐이고 화면은 그 경계를 말한다.
 */

import { sessionBuyer } from '@shopping/api-mocks'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { UserEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ReviewableList } from '@/components/reviews/reviewable-list'
import { messagesFor } from '@/messages'

import { renderAccountScreen, resetDensity } from './support/mypage'
import type { ReviewApiStub } from './support/reviews'
import { MOCK_NOW, stubReviewApi } from './support/reviews'
import { stubViewport, VIEWPORTS } from './support/viewport'

vi.mock('next/navigation', () => ({ usePathname: () => '/mypage/reviews' }))

const messages = messagesFor().mypage
const copy = messages.reviews

let stub: ReviewApiStub

function open(): UserEvent {
  const user = userEvent.setup()

  renderAccountScreen(<ReviewableList messages={messages} />, { session: sessionBuyer })

  return user
}

/** 목록의 **직계 자식**만 센다 — 줄 하나가 첨부 사진 목록을 품을 수 있다. */
async function rows(): Promise<readonly HTMLElement[]> {
  const list = await screen.findByRole('list', { name: copy.listLabel })

  return [...list.children].filter((node): node is HTMLElement => node instanceof HTMLElement)
}

/** 첫 줄 — 아직 12일이 남은 「울 롱코트」. */
async function writableRow(): Promise<HTMLElement> {
  const [first] = await rows()

  if (first === undefined) throw new Error('쓸 수 있는 줄을 찾지 못했습니다.')

  return first
}

/** 별점을 고르고 본문을 채운 뒤 등록을 누른다. */
async function fillAndSubmit(user: UserEvent, row: HTMLElement, content: string): Promise<void> {
  await user.click(
    within(row).getByRole('radio', { name: copy.form.ratingOption.replace('{score}', '5') }),
  )
  await user.type(within(row).getByLabelText(copy.form.contentLabel), content)
  await user.click(within(row).getByRole('button', { name: copy.form.submit }))
}

beforeEach(() => {
  resetDensity()
  stubViewport(VIEWPORTS.desktop)
  // 남은 기간이 시간의 함수라 「지금」을 픽스처의 그것에 맞춘다. 그러지 않으면 이
  // 검사는 실행하는 날에 따라 「12일 남음」을 보기도 하고 못 보기도 한다.
  vi.setSystemTime(MOCK_NOW)
  stub = stubReviewApi()
})

afterEach(() => {
  localStorage.clear()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('F7 작성 가능 목록', () => {
  it('lists what can still be written, with what is left of the window', async () => {
    open()
    const shown = await rows()

    expect(shown).toHaveLength(2)
    // 서버가 계산해 보낸 기한을 옮긴 것뿐이다. 화면이 「배송완료 + 30일」을 세면
    // 배포 설정으로 기간을 바꾸는 날 화면만 옛 날짜를 자신 있게 말한다.
    expect(
      within(shown[0] ?? document.body).getByText(copy.window.daysLeft.replace('{days}', '12')),
    ).toBeVisible()
    expect(screen.getByText(copy.countLabel.replace('{count}', '2'))).toBeVisible()
  })

  it('refuses to start a form on a row whose window closed while the page was open', async () => {
    const user = open()
    const [, expired] = await rows()

    if (expired === undefined) throw new Error('기한이 지난 줄을 찾지 못했습니다.')
    expect(within(expired).getByText(copy.window.expired)).toBeVisible()

    const write = within(expired).getByRole('button', { name: copy.writeLabel })

    // `aria-disabled` 이지 `disabled` 가 아니다 — 탭 순서에 남아야 바로 위의 「기간이
    // 지났습니다」에 닿을 수 있다.
    expect(write).toHaveAttribute('aria-disabled', 'true')
    await user.click(write)
    expect(within(expired).queryByLabelText(copy.form.contentLabel)).toBeNull()
  })

  it('says the account has nothing to write about rather than showing an empty list', async () => {
    stub.state.reviewable = []
    open()

    expect(await screen.findByText(copy.emptyTitle)).toBeVisible()
  })

  it('names the boundary this screen has — 계약에 「내가 쓴 리뷰」 목록이 없다', async () => {
    open()
    await rows()

    expect(screen.getByText(copy.written.sessionOnlyNotice)).toBeVisible()
  })
})

describe('F6 작성 폼', () => {
  it('asks for a rating before it will send anything', async () => {
    const user = open()
    const row = await writableRow()

    await user.click(within(row).getByRole('button', { name: copy.writeLabel }))
    await user.type(within(row).getByLabelText(copy.form.contentLabel), '따뜻합니다.')
    await user.click(within(row).getByRole('button', { name: copy.form.submit }))

    expect(within(row).getByText(copy.form.issues.rating_required)).toBeVisible()
    expect(stub.writes).toEqual([])
  })

  it('points at the order item, not at the product', async () => {
    const user = open()
    const row = await writableRow()

    await user.click(within(row).getByRole('button', { name: copy.writeLabel }))
    await fillAndSubmit(user, row, '두께감이 좋고 마감이 깔끔했습니다.')

    await waitFor(() => {
      expect(stub.writes).toHaveLength(1)
    })
    // 상품 id 를 보내면 「이 사람이 그 상품을 샀는가」를 서버가 물어야 하고, 그 물음은
    // 우회 경로가 생기는 날 뚫린다 (TASK-0083 4장).
    expect(stub.writes[0]).toEqual({
      orderItemId: '019596d0-1f1c-7c2e-9a0e-610000000001',
      rating: 5,
      content: '두께감이 좋고 마감이 깔끔했습니다.',
      imageKeys: [],
    })
  })

  it('offers the same photo field the return form uses', async () => {
    const user = open()
    const row = await writableRow()

    await user.click(within(row).getByRole('button', { name: copy.writeLabel }))

    // 반품 사진과 **같은 컴포넌트**다. 두 벌이 되면 갈라지는 것은 코드가 아니라 거절의
    // 기준이고, 그 갈라짐은 한 화면에서만 드러나 오래 남는다.
    expect(within(row).getByText(copy.form.photos.hint.replace('{max}', '5'))).toBeVisible()
  })

  it('shows what was written and offers to change it', async () => {
    const user = open()
    const row = await writableRow()

    await user.click(within(row).getByRole('button', { name: copy.writeLabel }))
    await fillAndSubmit(user, row, '두께감이 좋고 마감이 깔끔했습니다.')

    expect(await within(row).findByText(copy.written.title)).toBeVisible()
    expect(within(row).getByRole('button', { name: copy.written.editLabel })).toBeVisible()
  })
})

describe('F4 · F5 고치기와 지우기', () => {
  async function write(user: UserEvent): Promise<HTMLElement> {
    const row = await writableRow()

    await user.click(within(row).getByRole('button', { name: copy.writeLabel }))
    await fillAndSubmit(user, row, '두께감이 좋고 마감이 깔끔했습니다.')
    await within(row).findByText(copy.written.title)

    return row
  }

  it('sends the whole draft again, because imageKeys is an assignment', async () => {
    const user = open()
    const row = await write(user)

    await user.click(within(row).getByRole('button', { name: copy.written.editLabel }))
    await user.click(
      within(row).getByRole('radio', { name: copy.form.ratingOption.replace('{score}', '3') }),
    )
    await user.click(within(row).getByRole('button', { name: copy.form.saveLabel }))

    await waitFor(() => {
      expect(stub.writes).toHaveLength(2)
    })
    expect(stub.writes[1]).toEqual({
      rating: 3,
      content: '두께감이 좋고 마감이 깔끔했습니다.',
      imageKeys: [],
    })
  })

  it('asks once before deleting, because the row cannot be written again', async () => {
    const user = open()
    const row = await write(user)

    await user.click(within(row).getByRole('button', { name: copy.written.deleteLabel }))

    // `Review.orderItemId` 가 unique 라 지운 뒤 같은 주문 항목에 다시 쓸 수 없다.
    expect(within(row).getByText(copy.written.deleteConfirm)).toBeVisible()

    await user.click(within(row).getByRole('button', { name: copy.written.deleteConfirmOk }))

    expect(await within(row).findByText(copy.written.deletedNotice)).toBeVisible()
  })

  it('says the edit window closed rather than repeating the server sentence', async () => {
    const user = open()
    const row = await write(user)

    stub.state.refuseNextWrite = {
      status: 409,
      code: 'REVIEW_EDIT_WINDOW_CLOSED',
      message: '리뷰를 고칠 수 있는 기간이 지났어요.',
    }

    await user.click(within(row).getByRole('button', { name: copy.written.editLabel }))
    await user.click(within(row).getByRole('button', { name: copy.form.saveLabel }))

    // 서버 문장은 「지났어요」에서 끝난다. 화면의 문장은 **지금 보이는 것이
    // 최종본이라는 사실**까지 말한다 — 그것이 이 사람이 알아야 하는 전부다.
    expect(await within(row).findByText(messages.errors.REVIEW_EDIT_WINDOW_CLOSED)).toBeVisible()
  })
})

describe('거절 일곱 — 사람이 할 일이 저마다 다르다', () => {
  const refusals = [
    'REVIEW_NOT_DELIVERED',
    'REVIEW_ALREADY_WRITTEN',
    'REVIEW_WINDOW_CLOSED',
    'REVIEW_ORDER_CANCELED',
    'REVIEW_IMAGE_FOREIGN',
  ] as const

  it.each(refusals)('renders its own sentence for %s', async (code) => {
    const user = open()
    const row = await writableRow()

    stub.state.refuseNextWrite = { status: 400, code, message: '서버가 하는 말' }

    await user.click(within(row).getByRole('button', { name: copy.writeLabel }))
    await fillAndSubmit(user, row, '두께감이 좋고 마감이 깔끔했습니다.')

    expect(await within(row).findByText(messages.errors[code])).toBeVisible()
    expect(within(row).queryByText('서버가 하는 말')).toBeNull()
  })

  it('gives the five refusals five different sentences', () => {
    const sentences = new Set(refusals.map((code) => messages.errors[code]))

    expect(sentences.size).toBe(refusals.length)
  })

  it('falls back to the server sentence while REVIEW_IMAGE_TOO_MANY carries no {max}', async () => {
    const user = open()
    const row = await writableRow()

    // 계약은 `params.max` 를 싣기로 되어 있고(`error-codes.ts`), 아직 실리지 않는다.
    // 그때 `{max}` 가 그대로 그려지지 않는 것이 `interpolate` 의 약속이다 — 값이 없는
    // 자리표시자가 있으면 카탈로그 문장을 통째로 포기하고 서버 문장으로 돌아간다.
    stub.state.refuseNextWrite = {
      status: 400,
      code: 'REVIEW_IMAGE_TOO_MANY',
      message: '사진이 너무 많아요.',
    }

    await user.click(within(row).getByRole('button', { name: copy.writeLabel }))
    await fillAndSubmit(user, row, '두께감이 좋고 마감이 깔끔했습니다.')

    expect(await within(row).findByText('사진이 너무 많아요.')).toBeVisible()
    expect(within(row).queryByText(/\{max\}/)).toBeNull()
  })
})
