/**
 * `/claims/[id]` — 한 건을 열고, 뒤집고, 이의를 기각하는 화면.
 *
 * **이 파일이 지키는 것은 「처리할 수 없다」를 화면이 어떻게 말하는가**이다. 이
 * 저장소는 비활성 버튼과 툴팁을 버렸으므로(TASK-0063 4.1), 못 누르는 자리마다 **문장이
 * 있는지**를 검사한다 — 상태가 아직 결론이 아니어서, 결론이 이미 끝나서, 이 역할에
 * 권한이 없어서, 그리고 데모 관리자가 실계정 건을 만졌을 때.
 *
 * 개입은 원본을 되살리지 않고 **새 클레임을 세운다.** 그래서 성공한 강제 처리의 결과는
 * 「버튼이 사라졌다」가 아니라 **원본이 개입을 가리키고 이의가 인용으로 닫히는 것**이고,
 * 그것을 대역이 실제로 그렇게 답하기 때문에 여기서 확인할 수 있다.
 */

import {
  adminClaimHandlers,
  adminClaimRowsSnapshot,
  httpFailureOn,
  mockPaths,
  networkFailureOn,
  sessionBuyer,
  sessionDemoAdmin,
} from '@shopping/api-mocks'
import type { AdminClaimListItem, ClaimStatus } from '@shopping/shared'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { UserEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { ClaimDetailWorkspace } from '@/components/claims/claim-detail-workspace'
import { messagesFor } from '@/messages'

import type { MockSession } from './support/auth'
import { renderWithAuth } from './support/auth'
import { testServer } from './setup'

const { claims: copy, errors } = messagesFor()
const detail = copy.detail
/**
 * 사진 칸의 문구는 **확정 후 하자 반품 탭과 같은 한 벌**이다 (`ReturnPhotoMessages`).
 * 서버가 두 화면에 같은 것을 요구하므로 문구도 갈라지지 않는다.
 */
const photos = copy.defectReturn.form

const requests: string[] = []

testServer.server.events.on('request:start', ({ request }) => {
  requests.push(`${request.method} ${request.url}`)
})

beforeEach(() => {
  requests.length = 0
  // `/claims/:id` 는 구매자 대역도 여는 문이고 기본 목록에서는 그쪽이 먼저다.
  testServer.server.use(...adminClaimHandlers)
})

function interventions(): readonly string[] {
  return requests.filter((line) => line.startsWith('POST') && line.endsWith('/admin/claims'))
}

/** 씨앗 하나를 조건으로 고른다. 대역이 심어 둔 줄이므로 지어낸 값이 아니다. */
function claimWhere(match: (row: AdminClaimListItem) => boolean): AdminClaimListItem {
  const row = adminClaimRowsSnapshot().find(match)

  if (row === undefined) throw new Error('the mock store holds no such claim')

  return row
}

function rejected(status: ClaimStatus, appealed: boolean): AdminClaimListItem {
  return claimWhere((row) => row.status === status && row.appealPending === appealed)
}

async function open(claim: AdminClaimListItem, session?: MockSession): Promise<void> {
  renderWithAuth(
    <ClaimDetailWorkspace
      claimId={claim.id}
      errors={errors}
      messages={copy}
      notice={messagesFor().errorNotice}
    />,
    session === undefined ? {} : { session },
  )

  await screen.findByText(detail.subtitle.replace('{orderNumber}', claim.orderNumber))
}

async function startForce(user: UserEvent): Promise<HTMLElement> {
  await user.click(screen.getByRole('button', { name: detail.actions.force }))

  return screen.findByRole('dialog', { name: copy.force.title })
}

/** 하자 사진 한 장. 이름과 형식만 쓰이므로 내용은 세 바이트면 된다. */
function photoFile(name = 'defect.png'): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png' })
}

/** 사진 한 장을 붙이고 **올라갈 때까지** 기다린다. 열쇠는 그때 생긴다. */
async function attachPhoto(user: UserEvent, dialog: HTMLElement): Promise<void> {
  await user.upload(within(dialog).getByLabelText(photos.photosDropLabel), photoFile())
  await within(
    await within(dialog).findByRole('list', { name: photos.photosListLabel }),
  ).findByText(photos.photoStatus.ready)
}

/** 반품 사유를 고른다. 고르는 것은 사유이고 바뀌는 것은 귀책과 **사진 칸**이다. */
async function chooseReturnReason(
  user: UserEvent,
  dialog: HTMLElement,
  label: string,
): Promise<void> {
  await user.click(within(dialog).getByRole('combobox', { name: copy.force.returnReasonLabel }))
  await user.click(await screen.findByRole('option', { name: label }))
}

describe('한 건을 읽는다', () => {
  it('shows who moved it, why, and when — the row a dispute is settled from', async () => {
    const target = rejected('CANCEL_REJECTED', true)
    await open(target)

    const history = screen.getByRole('table', { name: detail.history.caption })

    expect(within(history).getByText(detail.history.created)).toBeVisible()
    expect(within(history).getByText(copy.vocabulary.actorLabels.BUYER)).toBeVisible()
    expect(within(history).getByText(detail.history.noReason)).toBeVisible()
  })

  it('shows the appeal that is waiting, with what the buyer wrote', async () => {
    const target = rejected('RETURN_REJECTED', true)
    await open(target)

    expect(screen.getByText(copy.appeal.pendingTitle)).toBeVisible()
    expect(screen.getByText('판매자 설명과 배송 기록이 맞지 않아요. 다시 봐 주세요.')).toBeVisible()
  })

  it('says so plainly when there is no appeal and no intervention', async () => {
    await open(rejected('RETURN_REJECTED', false))

    expect(screen.getByText(copy.appeal.none)).toBeVisible()
    expect(screen.getByText(detail.intervention.none)).toBeVisible()
  })

  it('offers the list rather than a retry for a claim that does not exist', async () => {
    renderWithAuth(
      <ClaimDetailWorkspace
        claimId="019597a0-0001-7000-8000-0000000000ff"
        errors={errors}
        messages={copy}
        notice={messagesFor().errorNotice}
      />,
    )

    // 404 는 오류가 아니라 빈 상태다. 「다시 시도」를 내밀면 몇 번을 눌러도 같은 답이 온다.
    expect(await screen.findByText(detail.notFoundTitle)).toBeVisible()
    expect(screen.queryByRole('button', { name: detail.retryLabel })).not.toBeInTheDocument()
  })

  it('shows the failure and a retry when the API cannot be reached', async () => {
    testServer.server.use(networkFailureOn('get', mockPaths.claim))
    renderWithAuth(
      <ClaimDetailWorkspace
        claimId={rejected('CANCEL_REJECTED', true).id}
        errors={errors}
        messages={copy}
        notice={messagesFor().errorNotice}
      />,
    )

    expect(await screen.findByText(detail.errorTitle)).toBeVisible()
    expect(screen.getByRole('button', { name: detail.retryLabel })).toBeVisible()
  })
})

describe('처리할 수 없을 때 화면이 하는 말', () => {
  /**
   * 비활성 버튼이 아니라 문장이다. 탭으로 닿지 못하는 버튼은 왜 못 누르는지 알 수
   * 없고, `aria-disabled` 버튼은 닿아도 눌리지 않으면서 사유를 툴팁에 감춘다.
   */
  it('explains that a claim nobody has concluded has nothing to overturn', async () => {
    await open(claimWhere((row) => row.status === 'CANCEL_REQUESTED'))

    expect(screen.getByText(detail.blocked.state.not_concluded)).toBeVisible()
    expect(screen.queryByRole('button', { name: detail.actions.force })).not.toBeInTheDocument()
  })

  it('explains that a refunded claim is the buyer’s own outcome', async () => {
    await open(claimWhere((row) => row.status === 'REFUNDED'))

    expect(screen.getByText(detail.blocked.state.settled)).toBeVisible()
    expect(screen.queryByRole('button', { name: detail.actions.force })).not.toBeInTheDocument()
  })

  /**
   * 콘솔 가드가 먼저 막는 계정이지만, **컴포넌트 자신의 답**도 문장이어야 한다 —
   * 권한 하나가 늘거나 줄 때 이 자리가 회색 버튼으로 되돌아가지 않게 하는 검사다.
   */
  it('names the missing capability instead of greying a button out', async () => {
    await open(rejected('CANCEL_REJECTED', true), sessionBuyer)

    expect(screen.getByText(new RegExp(detail.blocked.permission))).toBeVisible()
    expect(screen.queryByRole('button', { name: detail.actions.force })).not.toBeInTheDocument()
  })

  it('tells a demo administrator what its writes reach before anything is pressed', async () => {
    await open(rejected('CANCEL_REJECTED', true), sessionDemoAdmin)

    expect(screen.getByText(copy.scope.demoNotice)).toBeVisible()
    // 조회는 좁혀지지 않는다. 버튼은 살아 있고, 거절은 서버가 한다.
    expect(screen.getByRole('button', { name: detail.actions.force })).toBeEnabled()
  })

  /**
   * F5 — 데모 관리자가 실계정 건을 만졌을 때. 어느 줄이 실계정의 것인지는 응답에
   * 없으므로 미리 잠글 수 없고, **서버의 403 을 이 건에 대한 문장으로 바꾸는 것**이
   * 이 화면의 답이다.
   */
  it('turns the server’s refusal into a sentence about this claim, and takes the button away', async () => {
    const user = userEvent.setup()
    await open(rejected('CANCEL_REJECTED', true), sessionDemoAdmin)

    testServer.server.use(
      httpFailureOn(
        'post',
        mockPaths.adminClaims,
        403,
        'FORBIDDEN',
        '이 작업을 수행할 권한이 없습니다.',
        ['claim.handle 퍼미션으로 접근할 수 없는 리소스입니다.'],
      ),
    )

    const dialog = await startForce(user)
    await user.type(
      within(dialog).getByLabelText(copy.force.reasonLabel, { exact: false }),
      '배송 기록이 판매자 설명과 다릅니다.',
    )
    await user.click(within(dialog).getByRole('button', { name: copy.force.confirm }))

    expect(await screen.findByText(detail.blocked.refusedTitle)).toBeVisible()
    expect(screen.getByText(copy.scope.outOfScope)).toBeVisible()
    expect(screen.queryByRole('button', { name: detail.actions.force })).not.toBeInTheDocument()
  })

  it('falls back to the catalogue’s own sentence for a refusal that is not about the demo scope', async () => {
    const user = userEvent.setup()
    await open(rejected('CANCEL_REJECTED', true))

    testServer.server.use(
      httpFailureOn(
        'post',
        mockPaths.adminClaims,
        403,
        'FORBIDDEN',
        '이 작업을 수행할 권한이 없습니다.',
      ),
    )

    const dialog = await startForce(user)
    await user.type(
      within(dialog).getByLabelText(copy.force.reasonLabel, { exact: false }),
      '개입합니다.',
    )
    await user.click(within(dialog).getByRole('button', { name: copy.force.confirm }))

    expect(await screen.findByText(errors.FORBIDDEN)).toBeVisible()
  })
})

describe('강제 처리', () => {
  it('says what will happen before it happens', async () => {
    const user = userEvent.setup()
    await open(rejected('CANCEL_REJECTED', true))

    const dialog = await startForce(user)

    // 한 문단이 아니라 네 문장이다 — 돈과 재고는 같은 사실이 아니고, 한 문단이면
    // 아무도 읽지 않는다 (구매확정 다이얼로그와 같은 톤).
    expect(within(dialog).getByText(copy.force.consequences.newClaim)).toBeVisible()
    expect(within(dialog).getByText(copy.force.consequences.money)).toBeVisible()
    expect(within(dialog).getByText(copy.force.consequences.appeal)).toBeVisible()
    expect(within(dialog).getByText(copy.force.consequences.irreversible)).toBeVisible()
    // 금액을 지어내지 않는다. 관리자용 견적 계약이 아직 없다는 사실을 문장으로 적는다.
    expect(within(dialog).getByText(copy.force.amountNotice)).toBeVisible()
  })

  it('shows what the chosen fault will be recorded as', async () => {
    const user = userEvent.setup()
    await open(rejected('RETURN_REJECTED', true))

    const dialog = await startForce(user)

    // 고르는 것은 사유인데 바뀌는 것은 귀책이다. 그 결과를 누르기 전에 말한다.
    expect(
      within(dialog).getByText(
        copy.force.faultPreview.replace('{fault}', copy.vocabulary.faultLabels.SELLER),
      ),
    ).toBeVisible()
    expect(
      within(dialog).getByLabelText(copy.force.returnReasonLabel, { exact: false }),
    ).toBeVisible()
  })

  it('refuses to send an intervention with no reason, and says so under the field', async () => {
    const user = userEvent.setup()
    await open(rejected('CANCEL_REJECTED', true))

    const dialog = await startForce(user)
    await user.click(within(dialog).getByRole('button', { name: copy.force.confirm }))

    expect(await within(dialog).findByText(copy.force.errors.reasonRequired)).toBeVisible()
    expect(interventions()).toHaveLength(0)
    // 오류는 그 칸의 설명이지 폼 위에 떠 있는 한 줄이 아니다 (U2).
    expect(
      within(dialog).getByLabelText(copy.force.reasonLabel, { exact: false }),
    ).toHaveAccessibleDescription(expect.stringContaining(copy.force.errors.reasonRequired))
  })

  /**
   * 성공의 증거는 「버튼이 사라졌다」가 아니다. 원본은 거절된 채 남고 개입이 옆에 서며,
   * 둘이 서로를 가리킨다 (F6). 이의는 같은 처리에서 인용으로 닫힌다.
   */
  it('stands a new claim beside the rejection and closes the appeal as upheld', async () => {
    const user = userEvent.setup()
    await open(rejected('CANCEL_REJECTED', true))

    const dialog = await startForce(user)
    await user.type(
      within(dialog).getByLabelText(copy.force.reasonLabel, { exact: false }),
      '배송 기록이 판매자 설명과 다릅니다.',
    )
    await user.click(within(dialog).getByRole('button', { name: copy.force.confirm }))

    expect(await screen.findByText(detail.toast.forced)).toBeVisible()
    expect(interventions()).toHaveLength(1)

    expect(
      await screen.findByRole('link', {
        name: detail.intervention.openIntervention.replace('{index}', '1'),
      }),
    ).toBeVisible()
    expect(screen.getByText(copy.appeal.outcomes.UPHELD)).toBeVisible()
    // 인용에는 사유가 없다. 빈칸 대신 근거가 어디 있는지를 적는다.
    expect(screen.getByText(copy.appeal.noNote)).toBeVisible()
  })

  it('sends one request however many times the confirm button is pressed', async () => {
    const user = userEvent.setup()
    await open(rejected('CANCEL_REJECTED', true))

    const dialog = await startForce(user)
    await user.type(
      within(dialog).getByLabelText(copy.force.reasonLabel, { exact: false }),
      '중복 클릭을 확인합니다.',
    )
    await user.tripleClick(within(dialog).getByRole('button', { name: copy.force.confirm }))

    expect(await screen.findByText(detail.toast.forced)).toBeVisible()
    expect(interventions()).toHaveLength(1)
  })

  it('keeps the dialog open and shows the failure when the API cannot be reached', async () => {
    const user = userEvent.setup()
    await open(rejected('CANCEL_REJECTED', true))

    testServer.server.use(networkFailureOn('post', mockPaths.adminClaims))

    const dialog = await startForce(user)
    await user.type(
      within(dialog).getByLabelText(copy.force.reasonLabel, { exact: false }),
      '개입합니다.',
    )
    await user.click(within(dialog).getByRole('button', { name: copy.force.confirm }))

    expect(await within(dialog).findByText(copy.failures.network)).toBeVisible()
  })
})

describe('반품 거절을 뒤집을 때의 사진', () => {
  /**
   * **이 갈래가 실 서버에서만 400 이었다.**
   *
   * 하자·오배송 반품은 판매자에게 돈을 물리는 일이라 서버가 사진을 필수로 요구하는데
   * (`returnPhotoDecision`), 이 대화상자에는 사진 칸이 없었고 대역도 뒤집기 갈래에서만
   * 그 판정을 지나지 않았다. 그래서 「사진 없는 하자 반품」이 프론트 검사를 전부
   * 통과한 뒤 실 서버에서 `RETURN_PHOTO_REQUIRED` 로 끝났다.
   */
  it('offers the photo box when a rejected return is overturned as a defect', async () => {
    const user = userEvent.setup()
    await open(rejected('RETURN_REJECTED', true))

    const dialog = await startForce(user)

    expect(within(dialog).getByLabelText(photos.photosDropLabel)).toBeVisible()
  })

  /** 취소에는 붙일 자리가 없다 — 계약이 `return` 을 싣지 않는다(둘 중 하나다). */
  it('never offers it where a cancellation is overturned', async () => {
    const user = userEvent.setup()
    await open(rejected('CANCEL_REJECTED', true))

    const dialog = await startForce(user)

    expect(within(dialog).queryByLabelText(photos.photosDropLabel)).not.toBeInTheDocument()
  })

  /**
   * **누르기 전에 말한다.** 서버도 같은 것을 거절하지만, 그 거절은 보낸 **뒤에** 온다.
   * 그리고 회색 버튼이 아니다 (TASK-0063 4.1) — 눌리고, 무엇이 남았는지 답한다.
   */
  it('refuses to send a defect overturn with no photo, and says what is missing', async () => {
    const user = userEvent.setup()
    await open(rejected('RETURN_REJECTED', true))

    const dialog = await startForce(user)
    await user.type(
      within(dialog).getByLabelText(copy.force.reasonLabel, { exact: false }),
      '판매자 설명과 사진이 맞지 않습니다.',
    )
    await user.click(within(dialog).getByRole('button', { name: copy.force.confirm }))

    expect(await within(dialog).findByText(photos.issues.photo_required)).toBeVisible()
    expect(interventions()).toHaveLength(0)
    expect(within(dialog).getByRole('button', { name: copy.force.confirm })).toBeEnabled()
  })

  it('sends the intervention once a photo is attached', async () => {
    const user = userEvent.setup()
    await open(rejected('RETURN_REJECTED', true))

    const dialog = await startForce(user)

    await attachPhoto(user, dialog)
    await user.type(
      within(dialog).getByLabelText(copy.force.reasonLabel, { exact: false }),
      '하자 사진을 확인했습니다.',
    )
    await user.click(within(dialog).getByRole('button', { name: copy.force.confirm }))

    expect(await screen.findByText(detail.toast.forced)).toBeVisible()
    expect(interventions()).toHaveLength(1)
  })

  /**
   * **단순 변심에는 사진이 금지다** (`RETURN_PHOTO_NOT_ALLOWED`).
   *
   * 칸을 감추는 것만으로는 모자란다 — 하자로 골라 붙였다가 사유를 바꾼 사람의 열쇠가
   * 그대로 나가면 서버가 그 신청을 거절한다. 붙였다 바꾸는 순서로 재는 이유가 그것이고,
   * 대역이 실 서버와 같은 판정을 하므로 열쇠가 남아 있으면 이 검사가 빨개진다.
   */
  it('drops the attached photos when the reason moves to 단순 변심, and sends without them', async () => {
    const user = userEvent.setup()
    await open(rejected('RETURN_REJECTED', true))

    const dialog = await startForce(user)

    await attachPhoto(user, dialog)
    await chooseReturnReason(user, dialog, copy.vocabulary.returnReasonLabels.CHANGE_OF_MIND)

    expect(within(dialog).queryByLabelText(photos.photosDropLabel)).not.toBeInTheDocument()

    await user.type(
      within(dialog).getByLabelText(copy.force.reasonLabel, { exact: false }),
      '변심 반품을 그대로 승인합니다.',
    )
    await user.click(within(dialog).getByRole('button', { name: copy.force.confirm }))

    expect(await screen.findByText(detail.toast.forced)).toBeVisible()
    expect(interventions()).toHaveLength(1)
  })
})

describe('이의 기각', () => {
  it('is offered only where an appeal is waiting', async () => {
    await open(rejected('RETURN_REJECTED', false))

    expect(
      screen.queryByRole('button', { name: detail.actions.dismissAppeal }),
    ).not.toBeInTheDocument()
  })

  it('refuses to send a dismissal with no reason', async () => {
    const user = userEvent.setup()
    await open(rejected('RETURN_REJECTED', true))

    await user.click(screen.getByRole('button', { name: detail.actions.dismissAppeal }))
    const dialog = await screen.findByRole('dialog', { name: copy.appeal.dismiss.title })
    await user.click(within(dialog).getByRole('button', { name: copy.appeal.dismiss.confirm }))

    expect(await within(dialog).findByText(copy.appeal.dismiss.errors.reasonRequired)).toBeVisible()
  })

  it('records the outcome and leaves the rejection standing', async () => {
    const user = userEvent.setup()
    const target = rejected('RETURN_REJECTED', true)
    await open(target)

    await user.click(screen.getByRole('button', { name: detail.actions.dismissAppeal }))
    const dialog = await screen.findByRole('dialog', { name: copy.appeal.dismiss.title })
    await user.type(
      within(dialog).getByLabelText(copy.appeal.dismiss.reasonLabel, { exact: false }),
      '발송 기록이 확인되어 거절을 유지합니다.',
    )
    await user.click(within(dialog).getByRole('button', { name: copy.appeal.dismiss.confirm }))

    expect(await screen.findByText(detail.toast.dismissed)).toBeVisible()
    expect(screen.getByText(copy.appeal.outcomes.DISMISSED)).toBeVisible()
    expect(screen.getByText('발송 기록이 확인되어 거절을 유지합니다.')).toBeVisible()
    // 클레임은 거절된 채 그대로다 — 이의를 닫은 것이지 결론을 바꾼 것이 아니다.
    await waitFor(() => {
      expect(
        screen.getAllByText(copy.vocabulary.statusLabels.RETURN_REJECTED).length,
      ).toBeGreaterThan(0)
    })
  })
})
