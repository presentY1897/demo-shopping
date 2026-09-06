/**
 * `/mypage/orders/[id]/claim` — 취소·반품 신청 (TASK-0066).
 *
 * **이 파일이 확인하는 것 셋으로 줄이면**:
 *
 * ① **잔여 수량이 서버 값이다.** 화면이 「주문 수량 − 신청한 수량」을 계산하면 다른
 *    탭에서 방금 신청한 것이 반영되지 않는다. 그래서 한 번 신청한 뒤 다시 열어
 *    **줄어든 값이 오는지**를 잰다 — 화면이 계산하는 구현은 여기서만 갈린다.
 * ② **거절 여섯이 저마다 다른 문장을 갖는다.** 「취소할 수 없습니다」로 끝나면
 *    기다리면 되는 사람과 고객센터를 찾아야 하는 사람이 구분되지 않고, 둘 다 할 수
 *    있는 일이 없어진다.
 * ③ **자동 승인과 승인 대기가 갈린다.** 둘 다 「접수됐습니다」로 끝내면 자동
 *    승인된 사람은 오지 않을 연락을 기다린다.
 * ④ **하자 반품은 사진 없이 나가지 않는다** (TASK-0067 F2). 사진은 신청서를 만들기
 *    전에 버킷으로 직접 올라가고, 신청서에 실리는 것은 그 **열쇠**다. 열쇠의
 *    접두어가 곧 소유자이므로 화면이 그것을 지어내면 서버가 남의 사진으로 읽는다 —
 *    그래서 열쇠는 언제나 presign 이 돌려준 값 그대로여야 한다.
 */

import {
  httpFailureOn,
  MOCK_CLAIM_ORDER_ID,
  MOCK_CLAIM_RETURN_WINDOW_ENDS_AT,
  MOCK_CLAIM_SELLER_ORDER_IDS,
  MOCK_ORDER_NOW,
  mockPaths,
  networkFailureOn,
  resetClaimStore,
  resetOrderStore,
  sessionBuyer,
  shopperPaidClaimable,
} from '@shopping/api-mocks'
import { returnReasons, UPLOAD_MAX_BYTES } from '@shopping/shared'
import { DENSITY_LEVELS, DENSITY_STORAGE_KEY } from '@shopping/ui'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { UserEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ClaimRequestScreen } from '@/components/mypage/claim-request-screen'
import { messagesFor } from '@/messages'

import { testServer } from './setup'
import { renderAccountScreen, resetDensity } from './support/mypage'
import { stubViewport, VIEWPORTS } from './support/viewport'

vi.mock('next/navigation', () => ({ usePathname: () => '/mypage/orders/x/claim' }))

const messages = messagesFor()
const copy = messages.mypage.claim

/**
 * 결제완료 몫의 세 줄. 수량이 1 · 2 · 3 이라 부분 취소를 잴 수 있다.
 *
 * 자리로 가리키는 이유는 픽스처가 배열이기 때문이다 — 구조 분해하면 세 값이 전부
 * `| undefined` 가 되고, 그 `undefined` 를 세 번 걸러내는 코드가 검사보다 길어진다.
 */
const SINGLE = 0
const DOUBLE = 1
const TRIPLE = 2

/** 화면에 그려지는 이름. 상품명과 옵션을 붙인 것이 한 줄의 이름이다. */
function nameOf(index: number): string {
  const item = shopperPaidClaimable.items[index]

  if (item === undefined) throw new Error('픽스처의 줄을 찾지 못했다')

  return `${item.snapshot.productName} ${item.snapshot.optionLabel}`.trim()
}

function open(sellerOrderId: string | null = MOCK_CLAIM_SELLER_ORDER_IDS.paid): UserEvent {
  const user = userEvent.setup()

  renderAccountScreen(
    <ClaimRequestScreen
      messages={messages.mypage}
      orderId={MOCK_CLAIM_ORDER_ID}
      sellerOrderId={sellerOrderId}
    />,
    { session: sessionBuyer },
  )

  return user
}

/** 목록이 오기를 기다린다. 온 뒤에야 고를 것이 있다. */
async function ready(): Promise<HTMLElement> {
  return screen.findByRole('list', { name: copy.itemsLabel })
}

/** 이름으로 한 줄을. 셋이 같은 모양이라 이름으로 가른다. */
function rowOf(name: string): HTMLElement {
  const label = screen.getByText(name)
  const row = label.closest('li')

  if (row === null) throw new Error(`${name} 줄을 찾지 못했다`)

  return row
}

/** 한 항목을 고르고, 사유를 적고, 보낸다 — 정상 흐름 한 벌. */
async function fillAndSend(user: UserEvent, name: string): Promise<void> {
  await user.click(within(rowOf(name)).getByRole('checkbox'))
  await user.type(screen.getByLabelText(copy.reasonLabel), '색상이 화면과 달라요.')
  await user.click(screen.getByRole('button', { name: copy.submit }))
}

beforeEach(() => {
  resetDensity()
  stubViewport(VIEWPORTS.desktop)
  resetOrderStore()
  resetClaimStore()
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(new Date(MOCK_ORDER_NOW))
})

afterEach(() => {
  vi.useRealTimers()
  localStorage.clear()
  vi.unstubAllGlobals()
  resetOrderStore()
  resetClaimStore()
})

describe('잔여 수량은 서버가 답한다 (F1 · F3)', () => {
  it('주문 수량이 아니라 신청 가능 수량을 그린다', async () => {
    open()
    await ready()

    expect(
      within(rowOf(nameOf(TRIPLE))).getByText(copy.remainingLabel.replace('{count}', '3')),
    ).toBeVisible()
  })

  /**
   * **화면이 빼서 계산하는 구현은 여기서만 갈린다.**
   *
   * 두 번째로 여는 화면은 첫 신청을 모른다 — 컴포넌트가 새로 마운트되고 상태도
   * 비어 있다. 그래도 잔여가 2 로 오는 것은 **서버가 그렇게 답했기** 때문이고,
   * 이것이 다른 탭에서 신청한 것이 반영되는 유일한 방법이다.
   */
  it('신청하고 나면 줄어든 값이 온다 — 다른 창에서 신청한 것도 이렇게 보인다', async () => {
    const user = open()

    await ready()
    await fillAndSend(user, nameOf(TRIPLE))
    await screen.findByText(copy.outcome.title)

    screen.getByRole('link', { name: copy.outcome.backToOrder })

    // 화면을 새로 연다. 첫 신청의 흔적은 컴포넌트에 남아 있지 않다.
    open()
    await ready()

    expect(
      within(rowOf(nameOf(TRIPLE))).getByText(copy.remainingLabel.replace('{count}', '2')),
    ).toBeVisible()
  })

  /** 잔여가 0인 줄은 감추지 않는다. 감추면 「내가 신청한 그 상품」이 사라진다. */
  it('다 신청한 줄은 남기되 고를 수 없게 한다', async () => {
    const user = open()

    await ready()
    await fillAndSend(user, nameOf(SINGLE))
    await screen.findByText(copy.outcome.title)

    open()
    await ready()

    const row = rowOf(nameOf(SINGLE))

    expect(within(row).getByText(copy.alreadyClaimed)).toBeVisible()
    expect(within(row).queryByRole('checkbox')).not.toBeInTheDocument()
  })
})

describe('자동 승인과 승인 대기가 갈린다 (F1 · F4)', () => {
  it('결제완료 주문은 그 자리에서 처리됐다고 말한다', async () => {
    const user = open()

    await ready()
    await fillAndSend(user, nameOf(SINGLE))

    expect(await screen.findByText(copy.outcome.approvedTitle)).toBeVisible()
    expect(screen.getByText(copy.outcome.approvedBody)).toBeVisible()
    expect(screen.queryByText(copy.outcome.waitingTitle)).not.toBeInTheDocument()
  })

  it('상품준비중 주문은 판매자를 기다린다고 말한다', async () => {
    const user = open(MOCK_CLAIM_SELLER_ORDER_IDS.preparing)

    await ready()

    const first = within(await ready())
      .getAllByRole('checkbox')
      .at(0)

    if (first === undefined) throw new Error('고를 줄이 없다')
    await user.click(first)
    await user.type(screen.getByLabelText(copy.reasonLabel), '주문을 잘못 넣었어요.')
    await user.click(screen.getByRole('button', { name: copy.submit }))

    expect(await screen.findByText(copy.outcome.waitingTitle)).toBeVisible()
    expect(screen.queryByText(copy.outcome.approvedTitle)).not.toBeInTheDocument()
  })

  /** 환불은 이 TASK 가 하지 않는다. 하지 않은 일을 한 것처럼 말하지 않는다. */
  it('환불이 아직 끝나지 않았다는 것을 함께 말한다', async () => {
    const user = open()

    await ready()
    await fillAndSend(user, nameOf(SINGLE))

    expect(await screen.findByText(copy.outcome.refundPending)).toBeVisible()
  })
})

/**
 * 반품 신청서의 두 칸 — 사유 셋과 사진 (TASK-0067 F2).
 *
 * **취소 화면에는 없는 칸이다.** 계약이 귀책과 반품 부속을 둘 중 하나로 좁혀 두었고
 * (`createClaimRequestSchema`), 어느 쪽을 그릴지는 서버가 답한 경로가 정한다.
 */
describe('반품은 사유 셋을 묻고, 하자에는 사진을 받는다 (F2)', () => {
  /** 하자 사진 한 장. 이름과 형식만 쓰이므로 내용은 세 바이트면 된다. */
  function photoFile(name = 'defect.png'): File {
    return new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png' })
  }

  async function openReturn(): Promise<UserEvent> {
    const user = open(MOCK_CLAIM_SELLER_ORDER_IDS.delivered)

    await ready()

    return user
  }

  /**
   * 사유 라디오 하나.
   *
   * **접근 가능한 이름이 「라벨 + 설명」이다.** `Radio` 가 둘을 한 `<label>` 에
   * 담기 때문이고, 그것은 고른 뒤에 놀라지 않도록 「배송비를 누가 무는가」를 함께
   * 읽히게 하려는 결정이다. 그래서 앞부분으로 찾는다.
   */
  function reasonRadio(label: string): HTMLElement {
    return screen.getByRole('radio', { name: new RegExp(label) })
  }

  /** 첫 줄을 고른다. 어느 줄인지는 이 검사의 관심이 아니다. */
  async function pickFirstItem(user: UserEvent): Promise<void> {
    const [first] = within(await ready()).getAllByRole('checkbox')

    if (first === undefined) throw new Error('고를 줄이 없다')
    await user.click(first)
  }

  it('취소에는 귀책을 묻고 반품 사유는 묻지 않는다', async () => {
    open()
    await ready()

    expect(screen.getByText(copy.faultLegend)).toBeVisible()
    expect(screen.queryByText(copy.returnReasonLegend)).not.toBeInTheDocument()
  })

  it('반품에는 사유 셋을 묻고 귀책은 묻지 않는다', async () => {
    await openReturn()

    expect(screen.getByText(copy.returnReasonLegend)).toBeVisible()
    for (const value of returnReasons) {
      expect(reasonRadio(copy.returnReasons[value].label)).toBeVisible()
    }
    // 귀책은 사유에서 파생된다. 물어보면 「오배송인데 구매자 귀책」이 만들어진다.
    expect(screen.queryByText(copy.faultLegend)).not.toBeInTheDocument()
  })

  /**
   * **변심에는 칸 자체가 없다.** 뒤집을 것이 없는 주장에 증거를 받을 이유가 없고,
   * 받아 두면 아무도 보지 않는 이미지만 쌓인다.
   */
  it('사진 칸은 하자·오배송에만 나타난다', async () => {
    const user = await openReturn()

    expect(screen.queryByLabelText(copy.photos.dropLabel)).not.toBeInTheDocument()

    await user.click(reasonRadio(copy.returnReasons.DEFECTIVE.label))

    expect(screen.getByLabelText(copy.photos.dropLabel)).toBeInTheDocument()

    await user.click(reasonRadio(copy.returnReasons.CHANGE_OF_MIND.label))

    expect(screen.queryByLabelText(copy.photos.dropLabel)).not.toBeInTheDocument()
  })

  /**
   * **누르기 전에 말한다** (U2).
   *
   * 서버도 같은 것을 거절하지만(`RETURN_PHOTO_REQUIRED`), 그 거절은 사진을 고르는
   * 일을 하나도 하지 않은 채 보낸 뒤에 온다.
   */
  it('사진 없는 하자 반품은 보내지 않고 무엇이 빠졌는지 말한다', async () => {
    const user = await openReturn()

    await user.click(reasonRadio(copy.returnReasons.DEFECTIVE.label))
    await pickFirstItem(user)
    await user.type(screen.getByLabelText(copy.reasonLabel), '솔기가 뜯어져 있어요.')
    await user.click(screen.getByRole('button', { name: copy.submit }))

    expect(await screen.findByText(copy.issues.photo_required)).toBeVisible()
    // 보내지 않았으므로 결과 화면으로 넘어가지 않는다.
    expect(screen.queryByText(copy.outcome.title)).not.toBeInTheDocument()
  })

  /**
   * **열쇠는 presign 이 돌려준 값 그대로다.**
   *
   * 대역이 세션의 사용자 id 로 `returns/{userId}/…` 를 만들고, 실 서버도 그렇게
   * 만든다 — 소유는 그 접두어 하나로 판정되므로(`isOwnPhotoKey`), 화면이 열쇠를
   * 조립하는 구현은 여기서 갈린다.
   */
  it('고른 사진이 버킷까지 올라가고, 그 열쇠로 신청이 접수된다', async () => {
    const user = await openReturn()

    await user.click(reasonRadio(copy.returnReasons.DEFECTIVE.label))
    await user.upload(screen.getByLabelText(copy.photos.dropLabel), photoFile())

    const attached = within(await screen.findByRole('list', { name: copy.photos.listLabel }))

    expect(await attached.findByText(copy.photos.statuses.ready)).toBeVisible()

    await pickFirstItem(user)
    await user.type(screen.getByLabelText(copy.reasonLabel), '솔기가 뜯어져 있어요.')
    await user.click(screen.getByRole('button', { name: copy.submit }))

    expect(await screen.findByText(copy.outcome.title)).toBeVisible()
    // 반품은 판매자의 판단을 기다린다 — 물건이 돌아와야 하므로 자동 승인이 없다.
    expect(screen.getByText(copy.outcome.waitingTitle)).toBeVisible()
  })

  /**
   * 상한을 넘는 파일은 **왕복 없이** 그 자리에서 거절되고, 어느 장인지 남는다.
   *
   * 조용히 사라지면 사람은 다섯 장을 골랐는데 넷만 붙은 이유도, 어느 것이 빠졌는지도
   * 알 수 없다. presign 을 먼저 부르면 400 하나가 돌아오는데 그 400 은 **어느
   * 파일인지** 말해 주지 않는다.
   */
  it('상한을 넘는 사진은 그 줄에 이유를 달고 남는다', async () => {
    const user = await openReturn()

    await user.click(reasonRadio(copy.returnReasons.WRONG_ITEM.label))
    await user.upload(
      screen.getByLabelText(copy.photos.dropLabel),
      new File([new Uint8Array(UPLOAD_MAX_BYTES + 1)], 'huge.png', { type: 'image/png' }),
    )

    const attached = within(await screen.findByRole('list', { name: copy.photos.listLabel }))

    expect(attached.getByText('huge.png')).toBeVisible()
    expect(attached.getByText(copy.photos.failures.too_large)).toBeVisible()
  })

  /**
   * 서버가 사진을 거절하면 **그 코드의 문장**이 보인다 (U6 · TASK-0117).
   *
   * 화면이 먼저 막는 거절이라 실제로는 다른 창에서 뭔가 바뀐 뒤에만 오지만, 코드를
   * 모르는 화면은 서버 문장을 그대로 흘려 **`{max}` 를 그대로 그린다** — 다섯 코드를
   * 카탈로그에 들인 이유가 그것이다.
   */
  it('서버가 거절한 사진은 그 코드의 문장으로 말한다', async () => {
    testServer.server.use(
      httpFailureOn('post', mockPaths.claims, 400, 'RETURN_PHOTO_TOO_MANY', '서버의 문장', [
        {
          field: 'return.photoKeys',
          message: '서버의 문장',
          code: 'RETURN_PHOTO_TOO_MANY',
          params: { max: 5 },
        },
      ]),
    )

    const user = await openReturn()

    await user.click(reasonRadio(copy.returnReasons.DEFECTIVE.label))
    await user.upload(screen.getByLabelText(copy.photos.dropLabel), photoFile())
    await within(await screen.findByRole('list', { name: copy.photos.listLabel })).findByText(
      copy.photos.statuses.ready,
    )
    await pickFirstItem(user)
    await user.type(screen.getByLabelText(copy.reasonLabel), '솔기가 뜯어져 있어요.')
    await user.click(screen.getByRole('button', { name: copy.submit }))

    expect(
      await screen.findByText(messages.mypage.errors.RETURN_PHOTO_TOO_MANY.replace('{max}', '5')),
    ).toBeVisible()
    expect(screen.queryByText('서버의 문장')).not.toBeInTheDocument()
  })

  /** 붙인 것을 뺄 수 있어야 한다. 버튼 이름이 파일마다 다른 것이 P4 다. */
  it('붙인 사진을 뺄 수 있다', async () => {
    const user = await openReturn()

    await user.click(reasonRadio(copy.returnReasons.DEFECTIVE.label))
    await user.upload(screen.getByLabelText(copy.photos.dropLabel), photoFile('seam.png'))

    const removeLabel = copy.photos.removeNamed.replace('{name}', 'seam.png')

    await user.click(await screen.findByRole('button', { name: removeLabel }))

    expect(screen.queryByRole('list', { name: copy.photos.listLabel })).not.toBeInTheDocument()
  })
})

describe('경로는 서버가 정한다 (F3)', () => {
  it('배송완료 주문에서는 반품 신청이 된다', async () => {
    open(MOCK_CLAIM_SELLER_ORDER_IDS.delivered)

    expect(
      await screen.findByRole('heading', { level: 1, name: copy.types.RETURN.title }),
    ).toBeVisible()
  })

  /**
   * **기간의 날짜는 서버가 준 값이다.**
   *
   * 화면이 「배송완료 + 7일」을 계산하면 시간을 압축한 데모에서 틀린 날짜를 자신
   * 있게 적는다. 그 어긋남은 이 단언에서만 드러난다 — 목이 답하는 값이
   * `MOCK_ORDER_NOW` 로부터 이레가 **아니기** 때문이다.
   */
  it('반품 기간의 끝을 서버가 준 날짜로 그린다', async () => {
    open(MOCK_CLAIM_SELLER_ORDER_IDS.delivered)
    await ready()

    const day = new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul',
      dateStyle: 'medium',
    }).format(new Date(MOCK_CLAIM_RETURN_WINDOW_ENDS_AT))

    expect(screen.getByText(new RegExp(day.replaceAll('.', '\\.')))).toBeVisible()
  })

  it('결제완료 주문에는 기간 문장이 없다 — 취소는 기다릴 것이 없다', async () => {
    open()
    await ready()

    expect(screen.getByRole('heading', { level: 1, name: copy.types.CANCEL.title })).toBeVisible()
    // 반품에만 기간이 있다. 취소 화면에 「언제까지」가 뜨면 사람은 없는 마감을
    // 지키려 한다.
    expect(screen.queryByText(/까지 신청할 수 있습니다/)).not.toBeInTheDocument()
  })
})

/**
 * 거절 여섯 (F5).
 *
 * 넷은 **누르기 전에** 온다 (`GET …/claimable`). 남은 둘은 보낸 뒤의 오류 코드로
 * 오고, 자리가 다를 뿐 같은 문장이다 — 그것이 `claim-refusal.ts` 가 있는 이유다.
 */
describe('신청할 수 없는 이유를 저마다 다른 문장으로 말한다 (F5)', () => {
  it.each([
    ['배송중', MOCK_CLAIM_SELLER_ORDER_IDS.shipped, copy.refusals.in_transit],
    ['구매확정', MOCK_CLAIM_SELLER_ORDER_IDS.confirmed, copy.refusals.confirmed],
    ['취소됨', MOCK_CLAIM_SELLER_ORDER_IDS.canceled, copy.refusals.not_claimable],
    ['기간 지남', MOCK_CLAIM_SELLER_ORDER_IDS.windowClosed, copy.refusals.window_closed],
  ])('%s', async (_name, sellerOrderId, sentence) => {
    open(sellerOrderId)

    expect(await screen.findByText(sentence)).toBeVisible()
    // 신청할 수 없는 주문에는 보내는 버튼이 없다. 있으면 누른 사람이 같은 말을
    // 두 번 듣는다.
    expect(screen.queryByRole('button', { name: copy.submit })).not.toBeInTheDocument()
  })

  it('네 문장이 서로 다르다', () => {
    const four = [
      copy.refusals.in_transit,
      copy.refusals.confirmed,
      copy.refusals.not_claimable,
      copy.refusals.window_closed,
    ]

    expect(new Set(four).size).toBe(four.length)
  })

  /**
   * **수량이 모자란 거절만 숫자를 싣는다** (U6).
   *
   * 이 갈래에 오는 사람은 대개 다른 창에서 방금 하나를 신청한 사람이고, 「신청할
   * 수 없습니다」로 끝나면 몇 개로 고쳐야 하는지 알 방법이 없다.
   */
  it('남은 수량을 넘겨 보내면 지금 몇 개까지인지 말한다', async () => {
    const user = open()

    await ready()
    testServer.server.use(
      httpFailureOn(
        'post',
        mockPaths.claims,
        409,
        'CLAIM_EXCEEDS_REMAINING',
        '신청할 수 있는 수량을 넘었어요.',
        [
          {
            field: 'items',
            message: '신청할 수 있는 수량을 넘었어요.',
            code: 'CLAIM_EXCEEDS_REMAINING',
            params: { remaining: 1 },
          },
        ],
      ),
    )
    await fillAndSend(user, nameOf(DOUBLE))

    expect(
      await screen.findByText(copy.refusals.exceeds_remaining.replace('{remaining}', '1')),
    ).toBeVisible()
  })

  /** 그 밖의 실패는 공용 자리로 간다 — 거절의 문장을 붙이면 거짓말이 된다. */
  it('서버가 넘어졌을 때는 거절로 말하지 않는다 (U6)', async () => {
    const user = open()

    await ready()
    testServer.server.use(networkFailureOn('post', mockPaths.claims))
    await fillAndSend(user, nameOf(SINGLE))

    expect(await screen.findByText(copy.submitErrorTitle)).toBeVisible()
    expect(screen.queryByText(copy.refusals.not_claimable)).not.toBeInTheDocument()
  })
})

describe('보내기 전에 걸리는 것들 (U2 · U3)', () => {
  it('아무것도 고르지 않으면 그 사실을 말한다', async () => {
    const user = open()

    await ready()
    await user.click(screen.getByRole('button', { name: copy.submit }))

    expect(await screen.findByText(copy.issues.no_items)).toBeVisible()
  })

  it('사유가 비면 그 칸에 오류가 붙는다', async () => {
    const user = open()

    await ready()
    await user.click(within(rowOf(nameOf(SINGLE))).getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: copy.submit }))

    const reason = screen.getByLabelText(copy.reasonLabel)

    expect(await screen.findByText(copy.issues.reason_required)).toBeVisible()
    expect(reason).toHaveAttribute('aria-invalid', 'true')
    // 오류가 그 칸에 **묶여** 있다. 화면 어딘가에 떠 있는 것과 다르다.
    expect(reason.getAttribute('aria-describedby')).toContain(
      screen.getByText(copy.issues.reason_required).id,
    )
  })

  /** 눌러 보기 전에는 지적하지 않는다. */
  it('열자마자 오류를 보이지 않는다', async () => {
    open()
    await ready()

    expect(screen.queryByText(copy.issues.no_items)).not.toBeInTheDocument()
    expect(screen.queryByText(copy.issues.reason_required)).not.toBeInTheDocument()
  })

  it('보내는 동안 버튼이 다시 눌리지 않는다 (U3)', async () => {
    const user = open()

    await ready()
    await user.click(within(rowOf(nameOf(SINGLE))).getByRole('checkbox'))
    await user.type(screen.getByLabelText(copy.reasonLabel), '취소할게요.')

    const button = screen.getByRole('button', { name: copy.submit })

    await user.click(button)
    await screen.findByText(copy.outcome.title)

    // 결과 화면으로 바뀌었으므로 두 번째 클릭이 갈 곳 자체가 없다.
    expect(screen.queryByRole('button', { name: copy.submit })).not.toBeInTheDocument()
  })
})

describe('네 상태 (U1)', () => {
  it('불러오는 동안 기다리는 중이라고 말한다', async () => {
    open()

    // 기다림은 **지금** 화면에 있다. `findBy` 로 기다리면 그 사이에 목록이 도착해
    // 사라지고, 그때 이 단언은 「없다」로 실패한다 — 재는 것이 없는 검사가 된다.
    expect(screen.getByRole('status', { name: copy.loadingLabel })).toBeInTheDocument()
    await ready()
  })

  it('못 읽으면 다시 시도할 수 있다', async () => {
    testServer.server.use(networkFailureOn('get', mockPaths.claimable))
    open()

    expect(await screen.findByText(copy.loadErrorTitle)).toBeVisible()
    expect(screen.getByRole('button', { name: messages.mypage.retryLabel })).toBeVisible()
  })

  it('어느 배송인지 모르면 돌아갈 곳을 준다', () => {
    open(null)

    expect(screen.getByRole('heading', { level: 1, name: copy.missingBundleTitle })).toBeVisible()
    expect(screen.getByRole('link', { name: copy.backToOrder })).toHaveAttribute(
      'href',
      `/mypage/orders/${MOCK_CLAIM_ORDER_ID}`,
    )
  })
})

describe('키보드만으로 신청한다 (U5)', () => {
  it('탭과 스페이스로 고르고, 사유를 치고, 보낼 수 있다', async () => {
    const user = open()

    await ready()

    const checkbox = within(rowOf(nameOf(SINGLE))).getByRole('checkbox')

    checkbox.focus()
    await user.keyboard(' ')
    expect(checkbox).toBeChecked()

    screen.getByLabelText(copy.reasonLabel).focus()
    await user.keyboard('사이즈를 잘못 골랐어요.')

    screen.getByRole('button', { name: copy.submit }).focus()
    await user.keyboard('{Enter}')

    expect(await screen.findByText(copy.outcome.title)).toBeVisible()
  })
})

describe('밀도 3단계에서 모두 그려진다 (U4 · P6)', () => {
  it.each(DENSITY_LEVELS)('밀도 %s', async (level) => {
    localStorage.setItem(DENSITY_STORAGE_KEY, String(level))
    document.documentElement.setAttribute('data-density', String(level))
    stubViewport(VIEWPORTS.mobile)

    open()

    expect(within(await ready()).getAllByRole('listitem')).toHaveLength(
      shopperPaidClaimable.items.length,
    )
  })
})
