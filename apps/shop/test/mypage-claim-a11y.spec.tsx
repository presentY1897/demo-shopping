/**
 * axe over the claim request screen, in every state it can be in (P2).
 *
 * TASK-0066 이 이 화면에 요구하는 것은 **밀도 3단계 × 360px** 이다. 두 축을 함께
 * 도는 이유가 이 화면에 실제로 있다: 밀도는 컨트롤의 높이와 간격을 바꾸고
 * (`touch-target`), 360px 에서는 체크박스·수량 선택·긴 상품명이 한 줄에 못 들어가
 * 접힌다. 접힌 자리에서 이름이 잘리는지는 두 축이 만나는 칸에서만 드러난다.
 *
 * `mypage-a11y.spec.tsx` 와 **같은 규칙 집합**을 쓴다. 저쪽 파일이 왜 Lighthouse 가
 * 아니라 axe 인지, 왜 네 규칙이 꺼져 있는지를 길게 적어 두었다 — 다른 바를 새로
 * 발명하는 것은 보고서에 적을 값이 없다.
 *
 * 상태를 넷 다 도는 것도 그래서다. 신청서, 신청할 수 없다는 안내, 접수된 결과,
 * 그리고 못 읽었을 때 — 접근성이 깨지는 자리는 보통 **정상 화면이 아니다.**
 */

import {
  MOCK_CLAIM_ORDER_ID,
  MOCK_CLAIM_SELLER_ORDER_IDS,
  MOCK_ORDER_NOW,
  mockPaths,
  networkFailureOn,
  resetClaimStore,
  resetOrderStore,
  sessionBuyer,
  shopperPaidClaimable,
} from '@shopping/api-mocks'
import { DENSITY_LEVELS, DENSITY_STORAGE_KEY } from '@shopping/ui'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import type { RunOptions } from 'axe-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ClaimRequestScreen } from '@/components/mypage/claim-request-screen'
import { messagesFor } from '@/messages'

import { testServer } from './setup'
import { renderAccountScreen, resetDensity } from './support/mypage'
import { stubViewport, VIEWPORTS } from './support/viewport'

vi.mock('next/navigation', () => ({ usePathname: () => '/mypage/orders/x/claim' }))

const messages = messagesFor()
const copy = messages.mypage.claim

const OPTIONS: RunOptions = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] },
  rules: {
    // jsdom paints nothing, so axe cannot decide contrast.
    'color-contrast': { enabled: false },
    // The document shell — lang, title, the `main` landmark — belongs to
    // `app/layout.tsx`, which is not rendered here.
    'html-has-lang': { enabled: false },
    'document-title': { enabled: false },
    region: { enabled: false },
    'landmark-one-main': { enabled: false },
  },
}

async function expectNoViolations(): Promise<void> {
  const results = await axe.run(document.body, OPTIONS)

  expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([])
}

function open(sellerOrderId: string | null = MOCK_CLAIM_SELLER_ORDER_IDS.paid): void {
  renderAccountScreen(
    <ClaimRequestScreen
      messages={messages.mypage}
      orderId={MOCK_CLAIM_ORDER_ID}
      sellerOrderId={sellerOrderId}
    />,
    { session: sessionBuyer },
  )
}

beforeEach(() => {
  resetDensity()
  stubViewport(VIEWPORTS.mobile)
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

describe('밀도 3단계 × 360px (P2 · P6)', () => {
  it.each(DENSITY_LEVELS)('밀도 %s — 신청서', async (level) => {
    localStorage.setItem(DENSITY_STORAGE_KEY, String(level))
    document.documentElement.setAttribute('data-density', String(level))

    open()
    await screen.findByRole('list', { name: copy.itemsLabel })

    await expectNoViolations()
  })

  /**
   * 수량 선택이 나온 뒤에도 한 번.
   *
   * 고르기 전에는 목록에 없던 컨트롤이라, 고르지 않은 화면만 재면 그 컨트롤은
   * 검사를 한 번도 지나지 않는다.
   */
  it.each(DENSITY_LEVELS)('밀도 %s — 항목을 고른 뒤', async (level) => {
    localStorage.setItem(DENSITY_STORAGE_KEY, String(level))
    document.documentElement.setAttribute('data-density', String(level))

    const user = userEvent.setup()

    open()

    const list = await screen.findByRole('list', { name: copy.itemsLabel })
    const first = within(list).getAllByRole('checkbox').at(0)

    if (first === undefined) throw new Error('고를 줄이 없다')
    await user.click(first)

    await expectNoViolations()
  })
})

describe('나머지 상태들', () => {
  it('신청할 수 없다는 안내에 위반이 없다', async () => {
    open(MOCK_CLAIM_SELLER_ORDER_IDS.shipped)
    await screen.findByText(copy.refusals.in_transit)

    await expectNoViolations()
  })

  it('접수된 결과에 위반이 없다', async () => {
    const user = userEvent.setup()

    open()

    const list = await screen.findByRole('list', { name: copy.itemsLabel })
    const first = within(list).getAllByRole('checkbox').at(0)

    if (first === undefined) throw new Error('고를 줄이 없다')
    await user.click(first)
    await user.type(screen.getByLabelText(copy.reasonLabel), '색상이 달라요.')
    await user.click(screen.getByRole('button', { name: copy.submit }))
    await screen.findByText(copy.outcome.title)

    await expectNoViolations()
  })

  it('오류가 붙은 폼에 위반이 없다', async () => {
    const user = userEvent.setup()

    open()
    await screen.findByRole('list', { name: copy.itemsLabel })
    await user.click(screen.getByRole('button', { name: copy.submit }))
    await screen.findByText(copy.issues.no_items)

    await expectNoViolations()
  })

  /**
   * 사진 칸은 **고르기 전에는 없다** (TASK-0067 F2).
   *
   * 사유를 하자로 옮겨야 파일 입력과 첨부 목록이 나타나므로, 기본 화면만 재면 이
   * 화면에서 접근성이 가장 깨지기 쉬운 컨트롤이 검사를 한 번도 지나지 않는다 —
   * 파일 입력은 시각적으로 감춰 두고 패널을 그 라벨로 삼는 모양이라(`ImageDropZone`)
   * 라벨이 끊기면 이름 없는 입력이 된다.
   */
  it('사진을 붙인 반품 신청서에 위반이 없다', async () => {
    const user = userEvent.setup()

    open(MOCK_CLAIM_SELLER_ORDER_IDS.delivered)
    await screen.findByRole('list', { name: copy.itemsLabel })

    await user.click(
      screen.getByRole('radio', { name: new RegExp(copy.returnReasons.DEFECTIVE.label) }),
    )
    await user.upload(
      screen.getByLabelText(copy.photos.dropLabel),
      new File([new Uint8Array([1, 2, 3])], 'defect.png', { type: 'image/png' }),
    )
    await within(await screen.findByRole('list', { name: copy.photos.listLabel })).findByText(
      copy.photos.statuses.ready,
    )

    await expectNoViolations()
  })

  it('못 읽었을 때에도 위반이 없다', async () => {
    testServer.server.use(networkFailureOn('get', mockPaths.claimable))
    open()
    await screen.findByText(copy.loadErrorTitle)

    await expectNoViolations()
  })

  it('어느 배송인지 모를 때에도 위반이 없다', async () => {
    open(null)
    screen.getByRole('heading', { level: 1, name: copy.missingBundleTitle })

    await expectNoViolations()
  })

  /** 목록이 실제로 세 줄이라 위 검사들이 빈 화면을 잰 것이 아니다. */
  it('신청서가 빈 화면이 아니다', async () => {
    open()

    const list = await screen.findByRole('list', { name: copy.itemsLabel })

    expect(within(list).getAllByRole('listitem')).toHaveLength(shopperPaidClaimable.items.length)
  })
})
