/**
 * `/claims/[id]` — 클레임 하나와 그 처리 (TASK-0070 6장).
 *
 * **여기서 재는 것의 절반이 「어느 문으로 갔나」다.** 전이 라우트로 수거·검수를 밀어도
 * 상태는 옮겨지고 화면은 초록으로 보인다 — 회수 운송장이 나지 않고 검수 결과가 적히지
 * 않을 뿐이다. 목이 상태를 갖고 있으므로 그 어긋남을 실제로 관찰할 수 있고, 요청 자체를
 * 세어 두면 어긋남이 **경로의 이름**으로 드러난다.
 */

import type { ClaimStatus } from '@shopping/shared'
import {
  failNextSellerClaim,
  httpFailureOn,
  mockPaths,
  neverAnswersOn,
  sellerClaimDetail,
  sellerClaimHandlers,
  sellerClaimPage,
  sellerClaimSnapshot,
  slowResponse,
} from '@shopping/api-mocks'
import { render, screen, waitFor, within } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ClaimDetailWorkspace } from '@/components/claims/claim-detail-workspace'
import { money } from '@/lib/orders/format'
import { messagesFor } from '@/messages'

import { testServer } from './setup'

const copy = messagesFor().claimDetail
const vocabulary = messagesFor().claims

/** 나간 요청의 `METHOD /경로`. 「어느 문으로 갔나」를 이름으로 재는 자리다. */
const sent: string[] = []

beforeEach(() => {
  testServer.server.use(...sellerClaimHandlers)
  sent.length = 0
  testServer.server.events.on('request:start', ({ request }) => {
    sent.push(`${request.method} ${new URL(request.url).pathname}`)
  })
})

afterEach(() => {
  testServer.server.events.removeAllListeners('request:start')
})

/** 픽스처에서 이 상태의 클레임 하나. 검사가 상태를 지어내지 않게. */
function idOf(status: ClaimStatus): string {
  const row = sellerClaimPage.claims.find((claim) => claim.status === status)

  if (row === undefined) throw new Error(`${status} 인 픽스처가 없습니다.`)

  return row.id
}

function orderNumberOf(id: string): string {
  return sellerClaimPage.claims.find((claim) => claim.id === id)?.orderNumber ?? ''
}

async function open(status: ClaimStatus): Promise<string> {
  const id = idOf(status)

  render(<ClaimDetailWorkspace claimId={id} />)
  await screen.findByText(copy.subtitle.replace('{orderNumber}', orderNumberOf(id)))

  return id
}

/** 대화상자 안의 버튼. 같은 글자의 버튼이 화면에도 있다. */
function inDialog(name: string): HTMLElement {
  return within(screen.getByRole('dialog')).getByRole('button', { name })
}

/** 버튼 하나를 눌러 확인까지. 사유를 주면 그 칸에 적는다. */
async function press(user: UserEvent, label: string, reason?: string): Promise<void> {
  await user.click(screen.getByRole('button', { name: label }))
  if (reason !== undefined) await user.type(screen.getByRole('textbox'), reason)
  await user.click(inDialog(copy.actions.confirm))
}

function statusOf(id: string): ClaimStatus | undefined {
  return sellerClaimSnapshot().find((claim) => claim.id === id)?.status
}

describe('U1 · P5 — 네 상태', () => {
  it('announces the wait before the API has answered', () => {
    render(<ClaimDetailWorkspace claimId={idOf('RETURN_REQUESTED')} />)

    expect(screen.getByRole('status')).toHaveTextContent(copy.loadingLabel)
  })

  it('offers a retry when the read fails', async () => {
    render(<ClaimDetailWorkspace claimId="01930000-0000-7000-8000-00000000dead" />)

    expect(await screen.findByText(copy.errorTitle)).toBeVisible()
    expect(screen.getByRole('button', { name: copy.retry })).toBeVisible()
  })
})

describe('환불 예정액 (R2)', () => {
  /**
   * **승인 버튼을 누르기 전에 얼마가 나가는지.**
   *
   * 배송비 몫을 부호째 그리는 것이 요점이다 — 「반품비 차감」과 「원 배송비 환불」을
   * 하나로 접으면 0원이 되어 아무 일도 없었던 것처럼 보인다.
   */
  it('shows the three numbers the server answered with', async () => {
    await open('RETURN_REQUESTED')

    const { quote } = sellerClaimDetail.claim
    const block = within(screen.getByRole('region', { name: copy.quote.pendingTitle }))

    expect(block.getByText(money(quote.itemsAmount))).toBeVisible()
    expect(block.getByText(money(quote.shippingAmount))).toBeVisible()
    expect(block.getByText(money(quote.total))).toBeVisible()
    expect(quote.shippingAmount).not.toBe(0)
  })

  /**
   * **끝난 클레임에 「환불 예정액」이라고 적지 않는다.**
   *
   * 같은 금액이 아직 안 나갔으면 예정액이고 나갔으면 나간 액수다. 화면이 그것을 상태로
   * 되짚으면 판정이 하나 늘고, 그 판정이 틀리는 자리가 정확히 여기다.
   */
  it('names the money 환불된 금액 once it has actually gone out', async () => {
    await open('REFUNDED')

    expect(screen.getByRole('heading', { name: copy.quote.refundedTitle })).toBeVisible()
    expect(screen.queryByRole('heading', { name: copy.quote.pendingTitle })).toBeNull()
  })

  it('reads each line’s amount out of the quote, not out of the claim item', async () => {
    await open('RETURN_REQUESTED')

    const items = within(screen.getByRole('table', { name: copy.items.caption }))
    const [line] = sellerClaimDetail.claim.quote.lines

    if (line === undefined) throw new Error('견적 줄이 없습니다.')

    // `ClaimItem.refundAmount` 는 아직 계산되지 않아 언제나 0 이다. 그대로 그리면
    // 화면은 **틀린 금액을 자신 있게** 적는다.
    expect(items.getByText(money(line.amount))).toBeVisible()
    expect(line.amount).toBeGreaterThan(0)
  })
})

describe('걸음은 서버가 정한다', () => {
  it('draws exactly the steps the server answered with', async () => {
    await open('RETURN_REQUESTED')

    const actions = within(screen.getByRole('region', { name: copy.actions.legend }))

    expect(
      actions.getByRole('button', { name: vocabulary.actionLabels.RETURN_APPROVED }),
    ).toBeVisible()
    expect(
      actions.getByRole('button', { name: vocabulary.actionLabels.RETURN_REJECTED }),
    ).toBeVisible()
    expect(actions.queryByRole('button', { name: vocabulary.inspectionLabels.passed })).toBeNull()
  })

  /**
   * **검수의 두 답에는 상태로 지을 수 없는 이름이 있다.**
   *
   * `RETURN_REJECTED` 는 신청 거절에서도 나오고 검수 불합격에서도 나온다. 상태 하나에
   * 문장 하나인 표로는 그 둘을 가를 수 없고, 가르는 것은 `route` 다.
   */
  it('names the inspection steps by what they are, not by where they land', async () => {
    await open('INSPECTING')

    const actions = within(screen.getByRole('region', { name: copy.actions.legend }))

    expect(actions.getByRole('button', { name: vocabulary.inspectionLabels.passed })).toBeVisible()
    expect(actions.getByRole('button', { name: vocabulary.inspectionLabels.failed })).toBeVisible()
  })

  it('says nothing is left rather than drawing an empty toolbar', async () => {
    await open('REFUNDED')

    expect(screen.getByText(copy.actions.empty)).toBeVisible()
  })
})

describe('세 문 (4장)', () => {
  it('sends 승인 through the transition door', async () => {
    const id = await open('RETURN_REQUESTED')
    const user = userEvent.setup()

    await press(user, vocabulary.actionLabels.RETURN_APPROVED)

    await waitFor(() => {
      expect(statusOf(id)).toBe('RETURN_APPROVED')
    })
    expect(sent).toContain(`POST /api/v1/claims/${id}/transitions`)
  })

  /**
   * **수거는 전이가 아니다.**
   *
   * 전이 라우트로 `PICKING_UP` 을 찍으면 상태만 옮겨지고 회수 운송장은 나지 않는다 —
   * 구매자는 어디에 물건을 맡겨야 하는지 모른 채 「회수 중」 화면을 본다.
   */
  it('sends 수거 through the pickup door, and a waybill comes out', async () => {
    const id = await open('RETURN_APPROVED')
    const user = userEvent.setup()

    await press(user, vocabulary.actionLabels.PICKING_UP)

    expect(await screen.findByText(/^DEMO-GA-/u)).toBeVisible()
    expect(sent).toContain(`POST /api/v1/returns/${id}/pickup`)
    expect(sent).not.toContain(`POST /api/v1/claims/${id}/transitions`)
  })

  it('sends 검수 합격 through the inspection door', async () => {
    const id = await open('INSPECTING')
    const user = userEvent.setup()

    await press(user, vocabulary.inspectionLabels.passed)

    await waitFor(() => {
      expect(statusOf(id)).toBe('RETURN_COMPLETED')
    })
    expect(sent).toContain(`POST /api/v1/returns/${id}/inspection`)
    expect(sent).not.toContain(`POST /api/v1/claims/${id}/transitions`)
  })

  /**
   * **불합격은 같은 문이고, 반대 방향 운송장이 난다.**
   *
   * 물건은 판매자에게 있고 그것은 구매자의 것이다. 전이 라우트로 밀면 반송장이 나지
   * 않아 그 물건은 영영 판매자의 창고에 남는다.
   */
  it('sends 검수 불합격 through the same door, and a send-back waybill comes out', async () => {
    const id = await open('INSPECTING')
    const user = userEvent.setup()

    await press(user, vocabulary.inspectionLabels.failed, '포장이 훼손됐습니다')

    await waitFor(() => {
      expect(statusOf(id)).toBe('RETURN_REJECTED')
    })
    expect(await screen.findByText(/^DEMO-HD-/u)).toBeVisible()
    expect(sent).toContain(`POST /api/v1/returns/${id}/inspection`)
  })
})

describe('거절 사유 (U2 · 5장)', () => {
  it('refuses to submit 반품 거절 without a reason, and says so on the field', async () => {
    const id = await open('RETURN_REQUESTED')
    const user = userEvent.setup()

    await press(user, vocabulary.actionLabels.RETURN_REJECTED)

    expect(await screen.findByText(copy.actions.reasonRequired)).toBeVisible()
    // 아무 요청도 나가지 않았다 — 상태가 그대로다.
    expect(statusOf(id)).toBe('RETURN_REQUESTED')
    expect(sent).not.toContain(`POST /api/v1/claims/${id}/transitions`)
  })

  it('puts the 검수 불합격 reason in its own field, with its own sentence', async () => {
    await open('INSPECTING')

    const user = userEvent.setup()

    await press(user, vocabulary.inspectionLabels.failed)

    // 같은 「거절 사유」이지만 실리는 칸이 `note` 다. 한 칸으로 접으면 제출 직전에
    // 어느 쪽인지 다시 판단해야 하고, 틀리면 요청은 **성공한다**.
    expect(screen.getByLabelText(copy.actions.noteLabel)).toBeVisible()
    expect(await screen.findByText(copy.actions.noteRequired)).toBeVisible()
  })

  it('asks for nothing but a confirmation on a normal step', async () => {
    await open('RETURN_REQUESTED')

    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: vocabulary.actionLabels.RETURN_APPROVED }))

    // 정상 흐름마다 빈 칸을 채우게 하면 그 칸은 곧 「.」 으로 채워지고, 그때 거절 사유도
    // 함께 무의미해진다.
    expect(screen.queryByLabelText(copy.actions.reasonLabel)).toBeNull()
  })

  /**
   * **서버의 거절도 그 칸에 그린다.**
   *
   * 화면이 먼저 막는 것은 친절이고 규칙은 서버에 있다(`CLAIM_REASON_REQUIRED`). 그런데
   * 서버의 답만 화면 위 배너로 그리면 같은 잘못에 두 가지 모양의 답이 나가고, 그 둘은
   * 서로 다른 자리를 가리킨다.
   */
  it('draws the server’s CLAIM_REASON_REQUIRED on the same field', async () => {
    await open('RETURN_REQUESTED')
    testServer.server.use(
      httpFailureOn(
        'post',
        mockPaths.claimTransitions,
        400,
        'CLAIM_REASON_REQUIRED',
        '거절 사유를 입력해 주세요.',
      ),
    )

    const user = userEvent.setup()

    await press(user, vocabulary.actionLabels.RETURN_REJECTED, '재고 소진')

    expect(await screen.findByText(copy.actions.reasonRequired)).toBeVisible()
    expect(within(screen.getByRole('dialog')).queryByText(copy.failure.title)).toBeNull()
  })
})

describe('첨부 사진', () => {
  it('renders what the buyer attached, named and lazy', async () => {
    await open('RETURN_REQUESTED')

    const photos = sellerClaimDetail.claim.return?.photos ?? []

    expect(photos.length).toBeGreaterThan(0)

    const image = screen.getByRole('img', {
      name: copy.photos.alt.replace('{index}', '1'),
    })

    // 주소는 서버가 준 것 그대로다 — 프론트에서 열쇠로 조합하면 배포 설정이 한 벌 더
    // 생긴다.
    expect(image).toHaveAttribute('src', photos[0]?.url ?? '')
    expect(image).toHaveAttribute('loading', 'lazy')
  })

  /**
   * **URL 이 없는 것은 오류가 아니다.**
   *
   * 저장소가 설정되지 않은 배포에서는 열쇠만 있고 공개 주소가 없다 (TASK-0011 4.5).
   * 깨진 이미지 아이콘 대신 문장으로 말한다.
   */
  it('says so rather than drawing a broken image when the URL is missing', async () => {
    const detail = sellerClaimDetail.claim
    const held = detail.return

    if (held === null) throw new Error('반품 부속이 없습니다.')

    /*
     * 이 헬퍼가 지금 하는 일은 「이 경로에 이 본문으로 답한다」이고, 지연이 0 이면 그
     * 것뿐이다. 목에는 URL 없는 사진이 없다 — 있으면 그것은 목의 결함이지 이 배포의
     * 모습이 아니다.
     */
    testServer.server.use(
      slowResponse(mockPaths.sellerClaim, 0, {
        claim: {
          ...detail,
          return: { ...held, photos: held.photos.map((photo) => ({ ...photo, url: null })) },
        },
      }),
    )
    render(<ClaimDetailWorkspace claimId={idOf('RETURN_REQUESTED')} />)

    expect(await screen.findByText(copy.photos.unavailable)).toBeVisible()
    expect(screen.queryByRole('img')).toBeNull()
  })
})

describe('귀책은 읽기 전용이다', () => {
  /**
   * **판매자가 귀책을 바꾸는 서버 계약이 없다.**
   *
   * 반품의 귀책은 신청 사유에서 파생돼 신청 시점에 굳는다. 낼 수 없는 컨트롤을
   * 비활성으로 내는 것은 「언젠가 열린다」는 거짓말이라, 컨트롤을 아예 내지 않고 왜
   * 바꿀 수 없는지를 적는다.
   */
  it('shows the fault and its grounds without offering a control', async () => {
    await open('RETURN_REQUESTED')

    const block = within(screen.getByRole('region', { name: copy.sections.fault }))
    const held = sellerClaimDetail.claim.return

    if (held === null) throw new Error('반품 부속이 없습니다.')

    expect(block.getByText(vocabulary.returnReasonLabels[held.reason])).toBeVisible()
    expect(
      block.getByText(vocabulary.faultLabels[sellerClaimDetail.claim.claim.fault]),
    ).toBeVisible()
    expect(block.getByText(copy.fault.readOnlyNotice)).toBeVisible()
    expect(block.queryByRole('combobox')).toBeNull()
    expect(block.queryByRole('radio')).toBeNull()
  })
})

describe('처리 기한', () => {
  it('warns in words when the deadline has passed, and names the rule the server used', async () => {
    await open('RETURN_REQUESTED')

    const block = within(screen.getByRole('region', { name: copy.sections.deadline }))

    expect(sellerClaimDetail.claim.overdue).toBe(true)
    expect(block.getByText(copy.deadline.overdue)).toBeVisible()
    // 주말만 세고 공휴일은 보지 않는다. 감추면 연휴의 「기한 초과」가 버그로 신고된다.
    expect(block.getByText(copy.deadline.rule)).toBeVisible()
  })
})

describe('U3 · U6 — 도는 동안과 거절당했을 때', () => {
  it('does not let a second click become a second request', async () => {
    const id = await open('RETURN_REQUESTED')

    testServer.server.use(neverAnswersOn('post', mockPaths.claimTransitions))

    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: vocabulary.actionLabels.RETURN_APPROVED }))
    await user.click(inDialog(copy.actions.confirm))

    await waitFor(() => {
      expect(inDialog(copy.actions.confirm)).toBeDisabled()
    })

    await user.click(inDialog(copy.actions.confirm))

    expect(sent.filter((line) => line === `POST /api/v1/claims/${id}/transitions`)).toHaveLength(1)
  })

  it('shows the server’s refusal beside the button that was pressed', async () => {
    await open('RETURN_REQUESTED')
    failNextSellerClaim()

    const user = userEvent.setup()

    await press(user, vocabulary.actionLabels.RETURN_APPROVED)

    // 대화상자 안에서 답한다 — 화면 어딘가가 아니라 방금 누른 자리 옆에서.
    expect(await within(screen.getByRole('dialog')).findByText(copy.failure.title)).toBeVisible()
  })
})
