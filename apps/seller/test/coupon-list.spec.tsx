/**
 * `/coupons` — 판매자 쿠폰 목록 (TASK-0074 6장).
 *
 * API 는 `@shopping/api-mocks` 이고 그 목은 **상태를 갖는다.** 그래서 여기서 단언하는
 * 것은 화면이 「무엇을 그렸나」가 아니라 **「무엇을 했나」**다 — 중단을 누르면 그 줄이
 * 정말 「발행 중단」으로 옮겨 가는가, 상태를 고르면 서버에 실제로 다른 질의가 나가는가,
 * 커서를 끝까지 넘기며 한 줄도 겹치거나 빠지지 않는가. 얼어붙은 응답으로는 그중
 * 무엇도 실패할 수 없다.
 */

import {
  httpFailureOn,
  MOCK_COUPON_SELLER_ID,
  mockPaths,
  sellerCouponHandlers,
  sellerCouponPage,
  sessionSellerOwner,
} from '@shopping/api-mocks'
import { screen, waitFor, within } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import CouponsPage from '@/app/coupons/page'
import { couponLiabilityTotals } from '@/lib/coupons/coupon-console'
import { count, money } from '@/lib/orders/format'
import { messagesFor } from '@/messages'

import { renderWithAuth } from './support/auth'
import { testServer } from './setup'
import { stubViewport, VIEWPORTS } from './support/viewport'

const copy = messagesFor().couponList
const vocabulary = messagesFor().coupons

/** 픽스처의 줄 이름들. 대역이 답하는 것과 같은 곳에서 읽는다. */
const ACTIVE_COUPON = '가을 첫 구매 5,000원'
const SCHEDULED_COUPON = '추석 스토어 3,000원'
const SUSPENDED_COUPON = '주말 한정 2,000원'
const ENDED_COUPON = '여름 마감 15%'

beforeEach(() => {
  /*
   * **판매자 저장소를 앞에 세운다.**
   *
   * `/coupons` 는 관리자 콘솔(TASK-0073)도 쓰는 라우트라 두 목이 같은 경로에 답할 수
   * 있고, 기본 목록에서는 먼저 등록된 쪽이 이긴다. 한 화면의 검사가 두 저장소를 섞어
   * 보게 두면 실패가 「어느 목이 답했나」에 달리게 된다.
   */
  testServer.server.use(...sellerCouponHandlers)
  // 콘솔은 데스크톱 퍼스트다. 표가 기본이고, 카드는 아래 모바일 절이 따로 잰다.
  stubViewport(VIEWPORTS.desktop)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function openList(): Promise<HTMLElement> {
  renderWithAuth(<CouponsPage />)

  return screen.findByRole('table', { name: copy.table.caption })
}

function table(): HTMLElement {
  return screen.getByRole('table', { name: copy.table.caption })
}

/** 표의 데이터 줄. 머리글은 뺀다. */
function rows(): readonly HTMLElement[] {
  const [, ...body] = within(table()).getAllByRole('row')

  return body
}

/** 이름으로 한 줄을 찾는다. 중단 버튼이 그 줄 안에 있어야 한다. */
function rowNamed(name: string): HTMLElement {
  const row = rows().find((candidate) => within(candidate).queryByText(name) !== null)

  if (row === undefined) throw new Error(`「${name}」 줄이 없습니다.`)

  return row
}

/** 상태 셀렉트를 한 값으로 옮긴다. */
async function chooseLifecycle(user: UserEvent, label: string): Promise<void> {
  await user.click(screen.getByRole('combobox', { name: copy.filters.lifecycleLabel }))
  await user.click(await screen.findByRole('option', { name: label }))
}

/** 그 줄의 중단·재개 버튼을 누른다. */
async function pressIssuing(user: UserEvent, name: string, label: string): Promise<void> {
  await user.click(within(rowNamed(name)).getByRole('button', { name: label }))
}

/**
 * 나가는 목록 질의를 들여다본다.
 *
 * 화면이 무엇을 **그렸나**가 아니라 무엇을 **물었나**를 재는 유일한 방법이다. 목이
 * 걸러 주기 때문에 줄만 보고는 「화면이 필터를 보냈다」와 「화면이 받아서 걸렀다」를
 * 구분할 수 없고, 뒤엣것은 실 서버 앞에서 두 번째 페이지부터 틀린다.
 */
function recordCouponQueries(): readonly URL[] {
  const seen: URL[] = []
  const answer = globalThis.fetch

  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(hrefOf(input))

    if (url.pathname.endsWith('/coupons')) seen.push(url)

    return answer(input, init)
  })

  return seen
}

/**
 * 한 페이지를 좁힌다.
 *
 * 픽스처 여섯 줄은 기본 한 페이지(20)에 통째로 들어가므로 화면이 「다음」을 누를 일이
 * 없다. **페이지 크기는 화면의 것이 아니라 서버의 것**이라 화면에 그 손잡이를 뚫지
 * 않고, 검사가 여기서 질의만 고친다.
 */
function narrowPagesTo(size: number): void {
  const answer = globalThis.fetch

  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(hrefOf(input))

    if (!url.pathname.endsWith('/coupons')) return answer(input, init)

    url.searchParams.set('limit', String(size))

    return answer(url, init)
  })
}

function hrefOf(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
}

describe('U1 · P5 — 네 상태', () => {
  it('announces the wait before anything has answered', () => {
    renderWithAuth(<CouponsPage />)

    expect(screen.getByRole('status')).toHaveTextContent(copy.loadingLabel)
  })

  it('draws the first page once it arrives', async () => {
    await openList()

    expect(rows()).toHaveLength(sellerCouponPage.coupons.length)
  })

  it('offers a retry rather than an empty table when the load fails (U6)', async () => {
    testServer.server.use(
      httpFailureOn('get', mockPaths.coupons, 500, 'INTERNAL_ERROR', '서버 오류'),
    )
    renderWithAuth(<CouponsPage />)

    expect(await screen.findByText(copy.errorTitle)).toBeVisible()
    expect(screen.getByRole('button', { name: copy.retry })).toBeVisible()
  })

  it('tells an empty filter from an empty store', async () => {
    await openList()

    const user = userEvent.setup()

    // 픽스처는 다섯 상태를 전부 채우고 있으므로, 비는 조합을 **만들어야** 한다:
    // 하나뿐인 발행 예정 쿠폰을 중단하면 그 상태에 남는 줄이 없어진다.
    await pressIssuing(user, SCHEDULED_COUPON, copy.issuing.suspendLabel)
    await waitFor(() => {
      expect(
        within(rowNamed(SCHEDULED_COUPON)).getByText(vocabulary.lifecycleLabels.SUSPENDED),
      ).toBeVisible()
    })

    await chooseLifecycle(user, vocabulary.lifecycleLabels.SCHEDULED)

    expect(await screen.findByText(copy.filteredEmpty.title)).toBeVisible()
    // 가게가 빈 것이 아니라 **조건이** 빈 것이다. 두 문장을 하나로 접으면 판매자는
    // 자기 쿠폰이 사라진 줄 안다.
    expect(screen.queryByText(copy.empty.title)).toBeNull()
  })
})

describe('F6 — 소유권', () => {
  it('renders a store-ownership refusal as a sentence, not a broken screen', async () => {
    testServer.server.use(
      httpFailureOn('get', mockPaths.coupons, 403, 'FORBIDDEN', '다른 스토어의 쿠폰입니다.'),
    )
    renderWithAuth(<CouponsPage />)

    expect(await screen.findByText(copy.errorTitle)).toBeVisible()
    // 카탈로그의 문장이지 서버가 보낸 한국어가 아니다 (TASK-0117).
    expect(screen.getByText(messagesFor().errors.FORBIDDEN)).toBeVisible()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('points an account with no store at 입점 신청 instead of asking the API', async () => {
    const queries = recordCouponQueries()

    renderWithAuth(<CouponsPage />, { session: sessionWithoutStore() })

    expect(await screen.findByText(copy.noStore.title)).toBeVisible()
    expect(screen.getByRole('link', { name: copy.noStore.applyLabel })).toHaveAttribute(
      'href',
      '/apply',
    )
    // 불렀다면 서버는 그것을 플랫폼 쿠폰 목록으로 읽고 403 을 준다 — 아직 신청하지
    // 않았을 뿐인 사람이 「권한이 없어요」를 보게 되는 자리다.
    expect(queries).toHaveLength(0)
  })
})

describe('F5 — 부담 누계', () => {
  it('shows what each coupon has discounted so far', async () => {
    await openList()

    expect(within(rowNamed(ACTIVE_COUPON)).getByText(money(58_000))).toBeVisible()
  })

  it('adds the rows on screen up, and says the total is this page only', async () => {
    await openList()

    const totals = couponLiabilityTotals(sellerCouponPage.coupons)
    const summary = screen.getByRole('region', { name: copy.liability.title })

    expect(within(summary).getByText(money(totals.discountTotal))).toBeVisible()
    expect(
      within(summary).getByText(copy.liability.used.replace('{count}', count(totals.usedCount))),
    ).toBeVisible()
    expect(within(summary).getByText(copy.liability.note)).toBeVisible()
  })
})

describe('정산 연결 자리 (M12)', () => {
  it('links to the settlement screen and says the discount comes out there', async () => {
    await openList()

    expect(screen.getByText(copy.settlement.body)).toBeVisible()
    expect(screen.getByRole('link', { name: copy.settlement.linkLabel })).toHaveAttribute(
      'href',
      '/settlements',
    )
  })
})

describe('상태 필터', () => {
  it('asks the server for the chosen lifecycle rather than filtering here', async () => {
    await openList()

    const queries = recordCouponQueries()
    const user = userEvent.setup()

    await chooseLifecycle(user, vocabulary.lifecycleLabels.SUSPENDED)

    await waitFor(() => {
      expect(queries.at(-1)?.searchParams.get('lifecycle')).toBe('SUSPENDED')
    })
    // 이 목록이 누구 것인지를 정하는 값. 빠지면 서버는 플랫폼 목록으로 읽는다.
    expect(queries.at(-1)?.searchParams.get('sellerId')).toBe(MOCK_COUPON_SELLER_ID)
  })

  it('narrows the list to that lifecycle', async () => {
    await openList()

    const user = userEvent.setup()

    await chooseLifecycle(user, vocabulary.lifecycleLabels.SUSPENDED)

    await waitFor(() => {
      expect(rows()).toHaveLength(1)
    })
    expect(within(table()).getByText(SUSPENDED_COUPON)).toBeVisible()
  })

  it('goes back to the first page when the filter changes', async () => {
    narrowPagesTo(2)
    await openList()

    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: copy.pagination.next }))
    await waitFor(() => {
      expect(screen.getByText(copy.pagination.page.replace('{page}', '2'))).toBeVisible()
    })

    await chooseLifecycle(user, vocabulary.lifecycleLabels.ACTIVE)

    // 커서는 그 필터 안에서만 자리를 뜻한다. 넘겨받은 커서를 그대로 쓰면 이제
    // 존재하지 않는 목록을 이어 달라고 하는 셈이다.
    await waitFor(() => {
      expect(screen.getByText(copy.pagination.page.replace('{page}', '1'))).toBeVisible()
    })
  })
})

describe('발행 중단과 재개', () => {
  it('moves the row to 발행 중단 and offers the way back', async () => {
    await openList()

    const user = userEvent.setup()

    await pressIssuing(user, ACTIVE_COUPON, copy.issuing.suspendLabel)

    await waitFor(() => {
      expect(
        within(rowNamed(ACTIVE_COUPON)).getByText(vocabulary.lifecycleLabels.SUSPENDED),
      ).toBeVisible()
    })
    expect(
      screen.getByText(copy.issuing.suspendedNotice.replace('{name}', ACTIVE_COUPON)),
    ).toBeVisible()

    await pressIssuing(user, ACTIVE_COUPON, copy.issuing.resumeLabel)

    await waitFor(() => {
      expect(
        within(rowNamed(ACTIVE_COUPON)).getByText(vocabulary.lifecycleLabels.ACTIVE),
      ).toBeVisible()
    })
    expect(
      screen.getByText(copy.issuing.resumedNotice.replace('{name}', ACTIVE_COUPON)),
    ).toBeVisible()
  })

  it('says that what already went out is unaffected', async () => {
    await openList()

    expect(screen.getByText(copy.issuing.hint)).toBeVisible()
  })

  it('offers nothing to press on a coupon whose period is over', async () => {
    await openList()

    const row = rowNamed(ENDED_COUPON)

    expect(within(row).queryByRole('button')).toBeNull()
    expect(within(row).getByText(copy.issuing.ended)).toBeVisible()
  })

  it('shows a refusal rather than pretending the row moved (U6)', async () => {
    await openList()

    testServer.server.use(
      httpFailureOn('patch', mockPaths.coupon, 500, 'INTERNAL_ERROR', '서버 오류'),
    )

    const user = userEvent.setup()

    await pressIssuing(user, ACTIVE_COUPON, copy.issuing.suspendLabel)

    expect(await screen.findByRole('alert')).toHaveTextContent(copy.toast.failureTitle)
    expect(
      within(rowNamed(ACTIVE_COUPON)).getByText(vocabulary.lifecycleLabels.ACTIVE),
    ).toBeVisible()
  })
})

describe('페이지 넘기기', () => {
  it('walks every row once with no duplicate and no gap', async () => {
    narrowPagesTo(2)
    await openList()

    const user = userEvent.setup()
    const seen: string[] = []

    for (let page = 0; page < 3; page += 1) {
      await waitFor(() => {
        expect(rows()).toHaveLength(2)
      })
      seen.push(...rows().map((row) => row.textContent ?? ''))

      if (page < 2) await user.click(screen.getByRole('button', { name: copy.pagination.next }))
    }

    expect(new Set(seen).size).toBe(seen.length)
    expect(seen).toHaveLength(sellerCouponPage.coupons.length)
  })
})

describe('P4 · U5 — 키보드만으로', () => {
  it('reaches the issue form and the suspend button by tabbing, and works them with the keyboard', async () => {
    await openList()

    const user = userEvent.setup()

    // 마우스를 한 번도 쓰지 않는다. 표 안의 버튼이 탭 순서에 없으면 이 검사는
    // 「끝까지 눌러도 아무 데도 닿지 않는다」로 끝난다.
    await pressTabUntil(
      user,
      () => document.activeElement?.textContent === messagesFor().couponForm.openLabel,
    )
    await user.keyboard('{Enter}')

    expect(await screen.findByRole('form', { name: messagesFor().couponForm.legend })).toBeVisible()
  })

  it("operates a row's suspend button from the keyboard", async () => {
    await openList()

    const user = userEvent.setup()
    const button = within(rowNamed(ACTIVE_COUPON)).getByRole('button', {
      name: copy.issuing.suspendLabel,
    })

    button.focus()
    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(
        within(rowNamed(ACTIVE_COUPON)).getByText(vocabulary.lifecycleLabels.SUSPENDED),
      ).toBeVisible()
    })
  })
})

describe('P3 — 360px', () => {
  it('draws cards rather than a sideways table', async () => {
    stubViewport(VIEWPORTS.mobile)
    renderWithAuth(<CouponsPage />)

    const list = await screen.findByRole('list', { name: copy.table.caption })

    expect(within(list).getAllByRole('listitem')).toHaveLength(sellerCouponPage.coupons.length)
    expect(screen.queryByRole('table')).toBeNull()
  })
})

/**
 * 판매자 역할은 있는데 스토어가 없는 계정.
 *
 * 입점 신청을 하지 않았거나 아직 승인을 기다리는 사람이고, 콘솔 가드는 그 사람을 막지
 * 않는다 — `/apply` 가 그 사람의 화면이기 때문이다.
 */
/**
 * 조건이 맞을 때까지 탭을 누른다.
 *
 * 몇 번 눌러야 하는지를 세어 적으면 컨트롤이 하나 늘 때마다 이 검사가 깨지고, 그
 * 깨짐은 접근성과 아무 상관이 없다. 재는 것은 **닿는가**이지 몇 번째인가가 아니다.
 */
async function pressTabUntil(user: UserEvent, done: () => boolean): Promise<void> {
  for (let step = 0; step < 40; step += 1) {
    if (done()) return
    await user.tab()
  }

  throw new Error('탭으로 닿지 못했습니다.')
}

function sessionWithoutStore(): typeof sessionSellerOwner {
  return { ...sessionSellerOwner, user: { ...sessionSellerOwner.user, sellerId: null } }
}
