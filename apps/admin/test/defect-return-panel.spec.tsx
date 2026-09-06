/**
 * 「확정 후 하자 반품」 탭이 실제로 도는가 (TASK-0071 F4).
 *
 * ## 이 파일이 재는 것
 *
 * 이 화면은 **서버는 있는데 시작할 자리가 없던** 경로를 연다. 그래서 검사가 확인해야
 * 하는 것은 「폼이 그려지는가」가 아니라 **화면이 서버와 같은 말을 하는가**다 —
 * 확정된 몫에서만 열리는가, 고른 항목과 수량이 그대로 나가는가, 사유가 판매자 귀책
 * 둘로 막히는가, 사진 없는 신청이 보내지지 않는가.
 *
 * ## 대역을 앞에 세운다
 *
 * `GET /seller-orders/:id/claimable` 은 **관리자 전용 라우트가 아니라** 구매자와 같은
 * 문이다(`claim.read` 가 `any` 라서). 기본 핸들러 목록에서는 구매자 쪽 저장소가 먼저
 * 등록되어 있으므로, 이 화면의 검사는 `server.use(...adminClaimHandlers)` 로 관리자
 * 저장소를 앞에 세운다 — 상세(`/claims/:id`)가 같은 이유로 같은 방식이다.
 */

import {
  adminClaimHandlers,
  httpFailureOn,
  MOCK_ADMIN_CLAIMABLE_IDS,
  MOCK_ADMIN_DEFECT_RETURN_ID,
  mockPaths,
  networkFailureOn,
  sessionAdminSuper,
} from '@shopping/api-mocks'
import { UPLOAD_MAX_BYTES } from '@shopping/shared'
import { screen, within } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import ClaimsPage from '@/app/claims/page'
import { messagesFor } from '@/messages'

import { renderWithAuth } from './support/auth'
import { testServer } from './setup'

const { claims: copy } = messagesFor()
const defect = copy.defectReturn
const { form, lookup } = defect

beforeEach(() => {
  testServer.server.use(...adminClaimHandlers)
})

/** 하자 사진 한 장. 이름과 형식만 쓰이므로 내용은 세 바이트면 된다. */
function photoFile(name = 'defect.png'): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png' })
}

/** 탭을 열고 조회 폼이 도착할 때까지 기다린다. */
async function openTab(): Promise<UserEvent> {
  const user = userEvent.setup()

  renderWithAuth(<ClaimsPage />, { session: sessionAdminSuper })
  await screen.findByRole('table', { name: copy.list.listLabel })
  await user.click(screen.getByRole('tab', { name: defect.title }))
  await screen.findByLabelText(lookup.label, { exact: false })

  return user
}

/** 식별자를 적어 넣고 찾는다. */
async function find(user: UserEvent, value: string): Promise<void> {
  await user.clear(screen.getByLabelText(lookup.label, { exact: false }))
  await user.type(screen.getByLabelText(lookup.label, { exact: false }), value)
  await user.click(screen.getByRole('button', { name: lookup.submit }))
}

describe('대상을 찾는 자리', () => {
  /**
   * **주문번호로 찾을 수 없다는 사실이 화면에 상주한다.**
   *
   * 사람이 손에 들고 오는 값이 주문번호인데 그것으로 판매자 몫을 찾는 라우트가 없다.
   * 오류로만 말하면 그 문장은 한 번 실패한 사람에게만 도착한다.
   */
  it('주문번호로는 찾을 수 없다는 것을 누르기 전에 말한다', async () => {
    await openTab()

    expect(screen.getByText(lookup.unavailableNotice)).toBeVisible()
  })

  it('주문번호를 넣으면 「형식이 틀렸다」가 아니라 그 사실을 말한다', async () => {
    const user = await openTab()

    await find(user, '20260901-000000C1')

    expect(await screen.findByText(lookup.errors.order_number)).toBeVisible()
  })

  it('빈 칸과 알 수 없는 값은 서로 다른 문장으로 끝난다', async () => {
    const user = await openTab()

    await user.click(screen.getByRole('button', { name: lookup.submit }))
    expect(await screen.findByText(lookup.errors.empty)).toBeVisible()

    await find(user, '주문 좀 찾아줘')
    expect(await screen.findByText(lookup.errors.unrecognised)).toBeVisible()
  })

  it('없는 몫은 오류가 아니라 빈 상태다 — 다시 눌러도 같은 404 다', async () => {
    const user = await openTab()

    await find(user, '019597a0-0008-7000-8000-00000000ffff')

    expect(await screen.findByText(lookup.notFoundTitle)).toBeVisible()
    expect(screen.queryByRole('button', { name: lookup.retryLabel })).not.toBeInTheDocument()
  })

  it('닿지 못한 요청은 다시 시도할 수 있는 오류다', async () => {
    testServer.server.use(networkFailureOn('get', mockPaths.claimable))

    const user = await openTab()

    await find(user, MOCK_ADMIN_CLAIMABLE_IDS.confirmed)

    expect(await screen.findByText(lookup.errorTitle)).toBeVisible()
    expect(screen.getByRole('button', { name: lookup.retryLabel })).toBeVisible()
  })
})

describe('확정된 주문에서만 시작한다', () => {
  /**
   * 다른 상태에는 **이미 정상 경로가 있다**는 사실을 문장으로 말한다.
   *
   * 여기에 반품 폼을 그려 놓고 서버가 거절하게 두면, 운영자는 정상 경로가 있다는
   * 사실 자체를 모른 채 실패를 반복한다.
   */
  it.each([
    ['delivered', MOCK_ADMIN_CLAIMABLE_IDS.delivered, defect.blocked.state.claim_path_open],
    ['shipped', MOCK_ADMIN_CLAIMABLE_IDS.shipped, defect.blocked.state.in_transit],
    ['canceled', MOCK_ADMIN_CLAIMABLE_IDS.canceled, defect.blocked.state.not_claimable],
    ['exhausted', MOCK_ADMIN_CLAIMABLE_IDS.exhausted, defect.blocked.state.nothing_left],
  ])('%s 인 몫에는 폼 대신 왜 여기가 아닌지를 적는다', async (_name, id, sentence) => {
    const user = await openTab()

    await find(user, id)

    expect(await screen.findByText(sentence)).toBeVisible()
    expect(screen.queryByRole('button', { name: form.submit })).not.toBeInTheDocument()
  })

  it('구매확정한 몫에서는 항목과 남은 수량이 열린다', async () => {
    const user = await openTab()

    await find(user, MOCK_ADMIN_CLAIMABLE_IDS.confirmed)

    expect(await screen.findByText(form.found)).toBeVisible()
    expect(screen.getByRole('checkbox', { name: /울 블렌드 코트/u })).toBeVisible()
    expect(screen.getByText(form.remaining.replace('{count}', '2'))).toBeVisible()
  })
})

describe('사유는 하자·오배송뿐이다', () => {
  it('고를 수 있는 사유가 둘이고 단순 변심은 없다', async () => {
    const user = await openTab()

    await find(user, MOCK_ADMIN_CLAIMABLE_IDS.confirmed)
    await screen.findByText(form.found)
    await user.click(screen.getByRole('combobox', { name: form.reasonLabel }))

    const options = await screen.findAllByRole('option')

    expect(options.map((option) => option.textContent)).toEqual([
      copy.vocabulary.returnReasonLabels.DEFECTIVE,
      copy.vocabulary.returnReasonLabels.WRONG_ITEM,
    ])
  })

  /** 목록에 없는 것만으로는 왜 없는지 알 수 없다. 문장이 그 자리를 맡는다. */
  it('왜 단순 변심이 없는지를 문장으로도 말한다', async () => {
    const user = await openTab()

    await find(user, MOCK_ADMIN_CLAIMABLE_IDS.confirmed)

    expect(await screen.findByText(form.reasonHint)).toBeVisible()
  })

  it('고른 사유가 어떤 귀책으로 기록되는지 미리 말한다', async () => {
    const user = await openTab()

    await find(user, MOCK_ADMIN_CLAIMABLE_IDS.confirmed)
    await screen.findByText(form.found)

    expect(
      screen.getByText(form.faultPreview.replace('{fault}', copy.vocabulary.faultLabels.SELLER)),
    ).toBeVisible()
  })
})

describe('접수', () => {
  /** 항목 · 사진 · 개입 사유를 채우고 확인 대화상자를 연다. */
  async function fill(user: UserEvent): Promise<void> {
    await find(user, MOCK_ADMIN_CLAIMABLE_IDS.confirmed)
    await screen.findByText(form.found)

    await user.click(screen.getByRole('checkbox', { name: /울 블렌드 코트/u }))
    await user.upload(screen.getByLabelText(form.photosDropLabel), photoFile())
    await within(await screen.findByRole('list', { name: form.photosListLabel })).findByText(
      form.photoStatus.ready,
    )
    await user.type(
      screen.getByLabelText(form.noteLabel, { exact: false }),
      '고객이 보낸 사진에서 솔기 하자를 확인했습니다.',
    )
  }

  /**
   * **누르기 전에 말한다.** 서버도 같은 것을 거절하지만
   * (`RETURN_PHOTO_REQUIRED`), 그 거절은 사진 없이 보낸 **뒤에** 온다.
   */
  it('사진 없는 하자 반품은 보내지 않고 무엇이 빠졌는지 말한다', async () => {
    const user = await openTab()

    await find(user, MOCK_ADMIN_CLAIMABLE_IDS.confirmed)
    await screen.findByText(form.found)
    await user.click(screen.getByRole('checkbox', { name: /울 블렌드 코트/u }))
    await user.type(screen.getByLabelText(form.noteLabel, { exact: false }), '하자입니다.')
    await user.click(screen.getByRole('button', { name: form.submit }))

    expect(await screen.findByText(form.issues.photo_required)).toBeVisible()
    expect(screen.queryByRole('dialog', { name: defect.confirm.title })).not.toBeInTheDocument()
  })

  it('아무것도 고르지 않고 누르면 남은 것을 한꺼번에 말한다', async () => {
    const user = await openTab()

    await find(user, MOCK_ADMIN_CLAIMABLE_IDS.confirmed)
    await screen.findByText(form.found)
    await user.click(screen.getByRole('button', { name: form.submit }))

    expect(await screen.findByText(form.issues.no_items)).toBeVisible()
    expect(screen.getByText(form.issues.reason_required)).toBeVisible()
    expect(screen.getByText(form.issues.photo_required)).toBeVisible()
  })

  /**
   * **무엇이 일어나는지를 마지막으로 말한다.** 셋째 문장이 이 화면에만 있는 사실이다 —
   * 정산이 이미 나갔으면 그 돈을 회수해야 하고, 회수 절차는 아직 없다 (M12).
   */
  it('확인 대화상자가 확정을 되돌린다는 것과 정산 회수를 함께 말한다', async () => {
    const user = await openTab()

    await fill(user)
    await user.click(screen.getByRole('button', { name: form.submit }))

    const dialog = await screen.findByRole('dialog', { name: defect.confirm.title })

    expect(within(dialog).getByText(defect.consequences.reopens)).toBeVisible()
    expect(within(dialog).getByText(defect.consequences.settlement)).toBeVisible()
    expect(within(dialog).getByText(defect.consequences.irreversible)).toBeVisible()
  })

  it('확인하면 반품이 접수되고 그 건으로 가는 길이 남는다', async () => {
    const user = await openTab()

    await fill(user)
    await user.click(screen.getByRole('button', { name: form.submit }))

    const dialog = await screen.findByRole('dialog', { name: defect.confirm.title })

    await user.click(within(dialog).getByRole('button', { name: defect.confirm.confirm }))

    expect(await screen.findByText(defect.done.title)).toBeVisible()
    expect(screen.getByRole('link', { name: defect.done.open })).toHaveAttribute(
      'href',
      `/claims/${MOCK_ADMIN_DEFECT_RETURN_ID}`,
    )
  })

  /**
   * 서버가 거절하면 **그 코드의 문장**이 대화상자 안에 남는다 (TASK-0117).
   *
   * 대화상자를 닫아 버리면 사람은 무엇이 잘못됐는지 못 읽은 채 처음으로 돌아간다.
   */
  it('서버가 거절하면 대화상자 안에 그 이유가 남는다', async () => {
    const user = await openTab()

    await fill(user)
    testServer.server.use(
      httpFailureOn('post', mockPaths.adminClaims, 403, 'FORBIDDEN', '권한이 없습니다.'),
    )
    await user.click(screen.getByRole('button', { name: form.submit }))

    const dialog = await screen.findByRole('dialog', { name: defect.confirm.title })

    await user.click(within(dialog).getByRole('button', { name: defect.confirm.confirm }))

    expect(await within(dialog).findByText(defect.failureTitle)).toBeVisible()
    expect(screen.queryByText(defect.done.title)).not.toBeInTheDocument()
  })
})

describe('사진', () => {
  /** 상한을 넘는 파일은 **왕복 없이** 그 자리에서 거절되고, 어느 장인지 남는다. */
  it('상한을 넘는 사진은 그 줄에 이유를 달고 남는다', async () => {
    const user = await openTab()

    await find(user, MOCK_ADMIN_CLAIMABLE_IDS.confirmed)
    await screen.findByText(form.found)
    await user.upload(
      screen.getByLabelText(form.photosDropLabel),
      new File([new Uint8Array(UPLOAD_MAX_BYTES + 1)], 'huge.png', { type: 'image/png' }),
    )

    const attached = within(await screen.findByRole('list', { name: form.photosListLabel }))

    expect(attached.getByText('huge.png')).toBeVisible()
    expect(attached.getByText(form.photoFailures.too_large)).toBeVisible()
  })
})
