/**
 * `/coupons`, driven the way an administrator drives it (TASK-0073).
 *
 * 아래의 검사는 전부 **진짜 화면을 그린 뒤 누르거나 입력한다.** 지어낸 프롭 꾸러미를
 * 컴포넌트에 건네지 않고 클래스 이름을 확인하지 않는다 (QUALITY-GATES Q5). 재는 것은
 * 상태 필터가 **무엇을 요청하는가**, 중단이 목록의 상태를 실제로 옮기는가, 일괄 지급의
 * 세 숫자가 문장이 되는가, 예상 비용이 **계산할 수 없을 때 계산하지 않는가**, 그리고
 * 서버의 거절이 어느 칸에 닿는가다.
 *
 * API 는 `@shopping/api-mocks` 의 상태 있는 대역이라, 「목록이 좁혀졌다」는 화면이
 * 그린 틀이 아니라 **API 가 무엇을 요청받았는지**가 답한다.
 *
 * **`server.use(...platformCouponHandlers)` 가 모든 렌더의 첫 줄이다.** `/coupons` 는
 * 판매자 콘솔(TASK-0074)도 쓰는 문이고, 두 대역 모두 기본 목록에 실려 있지 않다 —
 * 자기 저장소를 앞에 세우는 것은 각 화면의 검사다.
 */

import {
  emptyPlatformCouponStore,
  httpFailureOn,
  MOCK_PLATFORM_COUPON_IDS,
  mockPaths,
  networkFailureOn,
  neverAnswersOn,
  platformCouponHandlers,
  platformCouponSnapshot,
  resetPlatformCouponStore,
  sessionDemoAdmin,
  sessionSellerOwner,
} from '@shopping/api-mocks'
import type { CouponListEntry } from '@shopping/shared'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { UserEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import CouponsPage from '@/app/coupons/page'
import { messagesFor } from '@/messages'

import type { MockSession } from './support/auth'
import { renderWithAuth } from './support/auth'
import { testServer } from './setup'
import { stubViewport, VIEWPORTS } from './support/viewport'

const { coupons: copy, errors } = messagesFor()

/** Every request the app made, newest last. Reset before each test. */
const requests: string[] = []

testServer.server.events.on('request:start', ({ request }) => {
  requests.push(`${request.method} ${request.url}`)
})

beforeEach(() => {
  requests.length = 0
  resetPlatformCouponStore()
  testServer.server.use(...platformCouponHandlers)
})

/** 목록이 마지막으로 요청받은 질의. 일괄 지급·중단의 경로는 세지 않는다. */
function lastListQuery(): string {
  const entry = [...requests]
    .reverse()
    .find((line) => line.startsWith('GET') && line.includes('/coupons'))

  return entry ?? ''
}

function listTable(): HTMLElement {
  return screen.getByRole('table', { name: copy.list.listLabel })
}

async function openList(session?: MockSession): Promise<HTMLElement> {
  renderWithAuth(<CouponsPage />, session === undefined ? {} : { session })

  return screen.findByRole('table', { name: copy.list.listLabel })
}

async function openForm(): Promise<UserEvent> {
  const user = userEvent.setup()

  await openList()
  await user.click(screen.getByRole('tab', { name: copy.tabs.issue }))
  await screen.findByRole('form', { name: copy.form.title })

  return user
}

function seeded(couponId: string): CouponListEntry {
  const entry = platformCouponSnapshot().find((row) => row.coupon.id === couponId)

  if (entry === undefined) throw new Error('the mock store holds no such coupon')

  return entry
}

/** 이름으로 찾은 한 줄. 이름이 행 머리이므로 그것이 행을 가리키는 방법이다. */
function rowOf(couponId: string): HTMLElement {
  const name = seeded(couponId).coupon.name
  const row = within(listTable()).getByText(name).closest('tr')

  if (row === null) throw new Error('그 이름을 가진 줄이 없습니다.')

  return row
}

/**
 * 셀렉트 하나에서 값을 고른다. 라딕스의 셀렉트는 열고 나서 고른다.
 *
 * 이름을 정규식이 아니라 술어로 맞춘다 — 이 화면의 라벨에는 「(원)」처럼 괄호가 들어
 * 있고, 그것을 `new RegExp` 에 넣으면 괄호가 그룹으로 읽혀 아무것도 찾지 못한다.
 */
async function choose(user: UserEvent, label: string, option: string): Promise<void> {
  await user.click(screen.getByRole('combobox', { name: (name) => name.startsWith(label) }))
  await user.click(await screen.findByRole('option', { name: option }))
}

/** 라벨이 붙은 입력 하나. 필수 표시(`*`)가 붙으므로 부분 일치로 찾는다. */
function fieldNamed(label: string): HTMLElement {
  return screen.getByLabelText(label, { exact: false })
}

describe('발행한 쿠폰 목록', () => {
  it('lists every platform coupon with what it has issued and what it has cost', async () => {
    const table = await openList()

    expect(within(table).getAllByRole('rowheader')).toHaveLength(platformCouponSnapshot().length)

    const active = rowOf(MOCK_PLATFORM_COUPON_IDS.active)

    // 발급·사용·할인 총액이 한 줄에 함께 선다 (F6).
    expect(within(active).getByText('240 / 1,000장')).toBeVisible()
    expect(within(active).getByText('120장 · 50%')).toBeVisible()
    expect(within(active).getByText('₩480,000')).toBeVisible()
  })

  it('announces that it is loading before anything arrives', () => {
    renderWithAuth(<CouponsPage />)

    expect(screen.getByText(copy.list.loadingLabel)).toBeInTheDocument()
  })

  it('shows the failure and a way to retry when the API cannot be reached', async () => {
    testServer.server.use(networkFailureOn('get', mockPaths.coupons))
    renderWithAuth(<CouponsPage />)

    expect(await screen.findByText(copy.list.errorTitle)).toBeVisible()
    expect(screen.getAllByRole('button', { name: copy.list.retryLabel }).length).toBeGreaterThan(0)
  })

  it('recovers when the retry succeeds', async () => {
    const user = userEvent.setup()
    testServer.server.use(networkFailureOn('get', mockPaths.coupons))
    renderWithAuth(<CouponsPage />)
    await screen.findByText(copy.list.errorTitle)

    testServer.server.resetHandlers()
    testServer.server.use(...platformCouponHandlers)
    await user.click(screen.getAllByRole('button', { name: copy.list.retryLabel })[0]!)

    expect(await screen.findByRole('table', { name: copy.list.listLabel })).toBeVisible()
  })

  it('says an empty console is empty, and says it differently when a filter caused it', async () => {
    const user = userEvent.setup()
    emptyPlatformCouponStore()
    renderWithAuth(<CouponsPage />)

    expect(await screen.findByText(copy.list.emptyTitle)).toBeVisible()

    await choose(user, copy.list.filters.lifecycleLabel, copy.lifecycleLabels.ACTIVE)

    expect(await screen.findByText(copy.list.filteredEmptyTitle)).toBeVisible()
  })

  /** F2 — 부담 주체가 목록에도 있다. 정산에서 판매자에게 차감되지 않는다는 사실이다. */
  it('says on every row that the platform is paying for this', async () => {
    const table = await openList()

    expect(screen.getByText(copy.burden.listNotice)).toBeVisible()
    expect(within(table).getAllByText(copy.burden.badge)).toHaveLength(
      platformCouponSnapshot().length,
    )
  })

  /**
   * F6 의 나머지 절반 — 쿠폰 하나가 아니라 **플랫폼 전체**가 지금까지 부담한 것.
   *
   * 서버가 페이지·필터와 무관한 집계로 따로 답하므로, 조건을 걸어도 이 숫자는 그대로다.
   */
  it('shows the standing totals, and does not move them when the list is narrowed', async () => {
    const user = userEvent.setup()
    await openList()
    const totals = screen.getByRole('region', { name: copy.list.totals.title })
    const spent = platformCouponSnapshot().reduce(
      (sum, entry) => sum + entry.stats.discountTotal,
      0,
    )

    expect(within(totals).getByText(`₩${spent.toLocaleString()}`)).toBeVisible()
    expect(within(totals).getByText(copy.list.totals.scopeNote)).toBeVisible()

    await choose(user, copy.list.filters.lifecycleLabel, copy.lifecycleLabels.SUSPENDED)
    await waitFor(() => {
      expect(within(listTable()).getAllByRole('rowheader')).toHaveLength(1)
    })

    expect(
      within(screen.getByRole('region', { name: copy.list.totals.title })).getByText(
        `₩${spent.toLocaleString()}`,
      ),
    ).toBeVisible()
  })

  /** F7 — 방문자가 낸 쿠폰과 실계정이 낸 쿠폰이 한 목록에 섞여 보인다. */
  it('marks the coupons a demo administrator issued as 체험용', async () => {
    await openList()

    expect(
      within(rowOf(MOCK_PLATFORM_COUPON_IDS.demo)).getByText(copy.audienceLabels.DEMO),
    ).toBeVisible()
    expect(
      within(rowOf(MOCK_PLATFORM_COUPON_IDS.active)).queryByText(copy.audienceLabels.DEMO),
    ).toBeNull()
  })
})

describe('상태로 좁히기', () => {
  it('asks the API for one state and redraws', async () => {
    const user = userEvent.setup()
    await openList()

    await choose(user, copy.list.filters.lifecycleLabel, copy.lifecycleLabels.SUSPENDED)

    await waitFor(() => {
      expect(lastListQuery()).toContain('lifecycle=SUSPENDED')
    })
    await waitFor(() => {
      expect(within(listTable()).getAllByRole('rowheader')).toHaveLength(1)
    })
    expect(
      within(listTable()).getByText(seeded(MOCK_PLATFORM_COUPON_IDS.suspended).coupon.name),
    ).toBeVisible()
  })

  /**
   * 기간은 **겹침**이다. 8월에 시작해 9월까지 가는 쿠폰은 「9월」을 찾는 사람이 찾는
   * 그 쿠폰이고, 시작일로 걸렀다면 목록에서 사라졌을 것이다.
   */
  it('asks for the coupons whose period overlaps the days that were chosen', async () => {
    const user = userEvent.setup()
    await openList()

    await user.type(screen.getByLabelText(copy.list.filters.fromLabel), '2026-09-05')

    await waitFor(() => {
      expect(lastListQuery()).toContain(encodeURIComponent('2026-09-04T15:00:00.000Z'))
    })
    // 8월 1일 ~ 12월 31일 쿠폰은 9월 5일에 걸쳐 있으므로 남아 있어야 한다.
    await waitFor(() => {
      expect(
        within(listTable()).getByText(seeded(MOCK_PLATFORM_COUPON_IDS.unlimited).coupon.name),
      ).toBeVisible()
    })
    // 8월에 끝난 쿠폰은 걸치지 않는다.
    expect(
      within(listTable()).queryByText(seeded(MOCK_PLATFORM_COUPON_IDS.ended).coupon.name),
    ).toBeNull()
    expect(screen.getByText(copy.list.filters.periodHint)).toBeVisible()
  })

  it('sends the closing day as the last instant of that day', async () => {
    const user = userEvent.setup()
    await openList()

    await user.type(screen.getByLabelText(copy.list.filters.toLabel), '2026-08-31')

    await waitFor(() => {
      expect(lastListQuery()).toContain(encodeURIComponent('2026-08-31T14:59:59.999Z'))
    })
    // 8월에 시작한 둘만 그 날에 걸쳐 있다 — 하나는 8월에 끝났고 하나는 12월까지 간다.
    await waitFor(() => {
      expect(within(listTable()).getAllByRole('rowheader')).toHaveLength(2)
    })
    expect(
      within(listTable()).getByText(seeded(MOCK_PLATFORM_COUPON_IDS.ended).coupon.name),
    ).toBeVisible()
    // 9월에 시작하는 쿠폰은 그 하루에 걸치지 않는다.
    expect(
      within(listTable()).queryByText(seeded(MOCK_PLATFORM_COUPON_IDS.active).coupon.name),
    ).toBeNull()
  })

  it('drops the condition again when it is cleared', async () => {
    const user = userEvent.setup()
    await openList()
    await choose(user, copy.list.filters.lifecycleLabel, copy.lifecycleLabels.ENDED)
    await waitFor(() => {
      expect(lastListQuery()).toContain('lifecycle=ENDED')
    })

    await user.click(screen.getByRole('button', { name: copy.list.filters.reset }))

    await waitFor(() => {
      expect(lastListQuery()).not.toContain('lifecycle=')
    })
  })
})

describe('발행 중단과 재개 (F5)', () => {
  it('moves the row to 중단 and back, and leaves what was issued alone', async () => {
    const user = userEvent.setup()
    await openList()
    const before = seeded(MOCK_PLATFORM_COUPON_IDS.active)

    await user.click(
      within(rowOf(MOCK_PLATFORM_COUPON_IDS.active)).getByRole('button', {
        name: copy.list.actions.suspend,
      }),
    )

    // 이미 발급된 장은 그대로 유효하다 — 그것을 토스트가 말한다.
    expect(await screen.findByText(copy.toast.suspended)).toBeVisible()
    await waitFor(() => {
      expect(
        within(rowOf(MOCK_PLATFORM_COUPON_IDS.active)).getByText(copy.lifecycleLabels.SUSPENDED),
      ).toBeVisible()
    })
    expect(seeded(MOCK_PLATFORM_COUPON_IDS.active).coupon.issuedCount).toBe(
      before.coupon.issuedCount,
    )

    await user.click(
      within(rowOf(MOCK_PLATFORM_COUPON_IDS.active)).getByRole('button', {
        name: copy.list.actions.resume,
      }),
    )

    expect(await screen.findByText(copy.toast.resumed)).toBeVisible()
    await waitFor(() => {
      expect(
        within(rowOf(MOCK_PLATFORM_COUPON_IDS.active)).getByText(copy.lifecycleLabels.ACTIVE),
      ).toBeVisible()
    })
  })

  /** U6 — 서버가 거절하면 사람에게 보인다. 조용히 아무 일도 일어나지 않는 것이 최악이다. */
  it('shows the refusal when the API says no', async () => {
    const user = userEvent.setup()
    await openList()
    testServer.server.use(
      httpFailureOn('patch', mockPaths.coupon, 500, 'INTERNAL_ERROR', '처리하지 못했습니다.'),
    )

    await user.click(
      within(rowOf(MOCK_PLATFORM_COUPON_IDS.active)).getByRole('button', {
        name: copy.list.actions.suspend,
      }),
    )

    expect(await screen.findByText(errors.INTERNAL_ERROR)).toBeVisible()
  })

  /**
   * U3 — 한 번 누른 뒤 답이 오기 전에 다시 눌러도 두 번 나가지 않는다.
   *
   * 답하지 않는 대역이 그 창을 열어 둔다. 이것이 없으면 느린 응답 하나에 같은 쿠폰이
   * 멈췄다 열렸다 하고, 마지막에 남는 상태는 **누른 순서가 아니라 답이 온 순서**가
   * 정한다.
   */
  it('sends one request even when the button is pressed twice', async () => {
    const user = userEvent.setup()
    await openList()
    testServer.server.use(neverAnswersOn('patch', mockPaths.coupon))

    const button = within(rowOf(MOCK_PLATFORM_COUPON_IDS.active)).getByRole('button', {
      name: copy.list.actions.suspend,
    })

    await user.click(button)
    await user.click(button)

    expect(requests.filter((line) => line.startsWith('PATCH')).length).toBe(1)
  })

  /** 끝난 쿠폰에는 버튼 대신 문장이 선다 — 회색 버튼은 키보드가 건너뛴다. */
  it('replaces the actions on an ended coupon with a sentence', async () => {
    await openList()
    const ended = rowOf(MOCK_PLATFORM_COUPON_IDS.ended)

    expect(within(ended).getByText(copy.list.actions.ended)).toBeVisible()
    expect(within(ended).queryByRole('button', { name: copy.list.actions.suspend })).toBeNull()
    expect(within(ended).queryByRole('button', { name: copy.list.actions.bulkIssue })).toBeNull()
  })
})

describe('일괄 지급 (F4)', () => {
  async function openBulk(user: UserEvent, couponId: string): Promise<HTMLElement> {
    await user.click(
      within(rowOf(couponId)).getByRole('button', { name: copy.list.actions.bulkIssue }),
    )

    return screen.findByRole('dialog', { name: new RegExp(copy.bulk.title) })
  }

  it('says how many went out, and raises what the list shows', async () => {
    const user = userEvent.setup()
    await openList()
    const before = seeded(MOCK_PLATFORM_COUPON_IDS.active)
    const dialog = await openBulk(user, MOCK_PLATFORM_COUPON_IDS.active)

    await user.click(within(dialog).getByRole('button', { name: copy.bulk.confirm }))

    const issued = seeded(MOCK_PLATFORM_COUPON_IDS.active).coupon.issuedCount

    expect(
      await within(dialog).findByText(
        copy.bulk.outcomes.issued.replace(
          '{count}',
          (issued - before.coupon.issuedCount).toLocaleString(),
        ),
      ),
    ).toBeVisible()

    // 대화상자가 열려 있는 동안 라딕스가 나머지 화면을 보조기술로부터 숨기므로,
    // 목록은 닫은 뒤에 읽는다 — 역할 질의는 숨겨진 것을 지나친다.
    await user.click(within(dialog).getByRole('button', { name: copy.bulk.close }))

    await waitFor(() => {
      expect(
        within(rowOf(MOCK_PLATFORM_COUPON_IDS.active)).getByText(
          `${issued.toLocaleString()} / 1,000장`,
        ),
      ).toBeVisible()
    })
  })

  /**
   * 한 번의 상한에 걸린 경우 — **다시 누르면 이어서 나간다**는 사실을 말해야 한다.
   *
   * 이것이 없으면 발행자는 「320명에게 지급했어요」를 읽고 끝난 줄 안다.
   */
  it('says there is more to come when it stopped at the limit', async () => {
    const user = userEvent.setup()
    await openList()
    const dialog = await openBulk(user, MOCK_PLATFORM_COUPON_IDS.unlimited)

    await user.click(within(dialog).getByRole('button', { name: copy.bulk.confirm }))

    expect(await within(dialog).findByText(copy.bulk.remaining)).toBeVisible()
  })

  /**
   * 「0장 나갔습니다」의 세 갈래. 셋에 발행자가 할 일이 전부 다르므로 문장도 셋이다.
   */
  it('says the quantity is what stopped it, not the audience', async () => {
    const user = userEvent.setup()
    await openList()
    const dialog = await openBulk(user, MOCK_PLATFORM_COUPON_IDS.exhausted)

    await user.click(within(dialog).getByRole('button', { name: copy.bulk.confirm }))

    expect(await within(dialog).findByText(copy.bulk.outcomes.quantity_gone)).toBeVisible()
  })

  /** 두 번 눌렀을 때 — 아무 일도 없었던 것이 아니라 **모두 이미 갖고 있는** 것이다. */
  it('tells "everybody already has it" apart from "nobody matched"', async () => {
    const user = userEvent.setup()
    await openList()
    const first = await openBulk(user, MOCK_PLATFORM_COUPON_IDS.demo)

    await user.click(within(first).getByRole('button', { name: copy.bulk.confirm }))
    await within(first).findByText(copy.bulk.resultTitle)
    // 같은 대화상자에서 한 번 더 누른다 — 두 번째 누름이 이 검사의 대상이다.
    await user.click(within(first).getByRole('button', { name: copy.bulk.confirm }))

    expect(
      await within(first).findByText(copy.bulk.outcomes.all_held.replace('{count}', '30')),
    ).toBeVisible()
  })

  it('says so when the condition matches nobody at all', async () => {
    const user = userEvent.setup()
    await openList()
    const dialog = await openBulk(user, MOCK_PLATFORM_COUPON_IDS.demo)

    await user.click(
      within(dialog).getByRole('combobox', {
        name: (name) => name.startsWith(copy.bulk.targetLabel),
      }),
    )
    await user.click(
      await screen.findByRole('option', { name: copy.bulk.targetLabels.HAS_ORDERED }),
    )
    await user.click(within(dialog).getByRole('button', { name: copy.bulk.confirm }))

    expect(await within(dialog).findByText(copy.bulk.outcomes.nobody)).toBeVisible()
  })

  /** 중단된 쿠폰에는 지급 버튼이 없다 — 서버가 `COUPON_SUSPENDED` 로 거절한다. */
  it('offers no bulk issue on a suspended coupon, and says why', async () => {
    await openList()
    const suspended = rowOf(MOCK_PLATFORM_COUPON_IDS.suspended)

    expect(within(suspended).getByText(copy.list.actions.suspendedNoIssue)).toBeVisible()
    expect(
      within(suspended).queryByRole('button', { name: copy.list.actions.bulkIssue }),
    ).toBeNull()
    // 재개는 그대로 할 수 있다 — 그것이 다음에 할 일이다.
    expect(within(suspended).getByRole('button', { name: copy.list.actions.resume })).toBeVisible()
  })

  /** 화면이 막아도 규칙은 서버에 있다. 그 거절이 도착하면 문장이 된다. */
  it('renders the refusal if a suspended coupon is issued anyway', async () => {
    const user = userEvent.setup()
    await openList()
    const dialog = await openBulk(user, MOCK_PLATFORM_COUPON_IDS.active)

    testServer.server.use(
      httpFailureOn(
        'post',
        mockPaths.couponBulkIssues,
        403,
        'COUPON_SUSPENDED',
        '발행이 중단된 쿠폰은 지급할 수 없어요.',
      ),
    )
    await user.click(within(dialog).getByRole('button', { name: copy.bulk.confirm }))

    expect(await within(dialog).findByText(errors.COUPON_SUSPENDED)).toBeVisible()
  })

  it('sends the condition that was chosen', async () => {
    const user = userEvent.setup()
    await openList()
    const dialog = await openBulk(user, MOCK_PLATFORM_COUPON_IDS.active)

    await user.click(
      within(dialog).getByRole('combobox', {
        name: (name) => name.startsWith(copy.bulk.targetLabel),
      }),
    )
    await user.click(
      await screen.findByRole('option', { name: copy.bulk.targetLabels.HAS_ORDERED }),
    )
    await user.click(within(dialog).getByRole('button', { name: copy.bulk.confirm }))

    await within(dialog).findByText(copy.bulk.resultTitle)
    expect(requests.some((line) => line.includes('/issues/bulk'))).toBe(true)
  })
})

describe('새 쿠폰 발행', () => {
  async function fill(user: UserEvent, values: { readonly limit?: string } = {}): Promise<void> {
    await user.type(fieldNamed(copy.form.nameLabel), '가을 정액 쿠폰')
    await choose(user, copy.form.discountTypeLabel, copy.discountTypeLabels.FIXED)
    await user.type(fieldNamed(copy.form.discountValueLabels.FIXED), '3000')
    await user.type(fieldNamed(copy.form.validFromLabel), '2026-09-10')
    await user.type(fieldNamed(copy.form.validUntilLabel), '2026-09-20')

    const limit = values.limit ?? '1000'

    if (limit !== '') await user.type(fieldNamed(copy.form.issueLimitLabel), limit)
  }

  /** F3 — 발급 수량 × 최대 할인액. 쿠폰이 존재하기 전에 보여야 뜻이 있다. */
  it('multiplies the quantity by the ceiling while the form is still being filled in', async () => {
    const user = await openForm()

    await fill(user)

    const cost = screen.getByRole('region', { name: copy.form.cost.title })

    expect(await within(cost).findByText('₩3,000,000')).toBeVisible()
    expect(within(cost).getByText('1,000장 × ₩3,000')).toBeVisible()
  })

  /**
   * F3 의 다른 절반 — **계산할 수 없으면 계산하지 않는다.**
   *
   * 상한 없는 정률 쿠폰의 최대 비용은 무한대다. 그 자리에 「10 × 1,000」 같은 값을
   * 적으면 발행자는 만원짜리 위험을 승인했다고 믿는다.
   */
  it('refuses to put a number on a percentage coupon with no ceiling', async () => {
    const user = await openForm()

    await choose(user, copy.form.discountTypeLabel, copy.discountTypeLabels.PERCENT)
    await user.type(fieldNamed(copy.form.discountValueLabels.PERCENT), '10')
    await user.type(fieldNamed(copy.form.issueLimitLabel), '1000')

    const cost = screen.getByRole('region', { name: copy.form.cost.title })

    expect(within(cost).getByText(copy.form.cost.unboundedTitle)).toBeVisible()
    expect(within(cost).getByText(copy.form.cost.gaps.no_ceiling)).toBeVisible()
  })

  it('says the same when the quantity is unlimited', async () => {
    const user = await openForm()

    await fill(user, { limit: '' })

    const cost = screen.getByRole('region', { name: copy.form.cost.title })

    expect(within(cost).getByText(copy.form.cost.gaps.no_limit)).toBeVisible()
  })

  /** F2 — 폼에도 부담 주체가 있다. 지금 만드는 할인이 누구 돈인지. */
  it('says in the form that the platform is paying for this', async () => {
    await openForm()

    expect(screen.getAllByText(copy.burden.formNotice).length).toBeGreaterThan(0)
  })

  /** R1 — 확인 없이는 발행되지 않는다. */
  it('asks once more, with the cost, before anything is issued', async () => {
    const user = await openForm()

    await fill(user)
    await user.click(screen.getByRole('button', { name: copy.form.submit }))

    const dialog = await screen.findByRole('dialog', { name: copy.form.confirm.title })

    expect(within(dialog).getByText('₩3,000,000')).toBeVisible()
    expect(requests.some((line) => line.startsWith('POST') && line.endsWith('/coupons'))).toBe(
      false,
    )
  })

  it('issues the coupon once it is confirmed, and shows it at the top of the list', async () => {
    const user = await openForm()

    await fill(user)
    await user.click(screen.getByRole('button', { name: copy.form.submit }))
    const dialog = await screen.findByRole('dialog', { name: copy.form.confirm.title })
    await user.click(within(dialog).getByRole('button', { name: copy.form.confirm.confirm }))

    expect(
      await screen.findByText(copy.toast.created.replace('{name}', '가을 정액 쿠폰')),
    ).toBeVisible()
    expect(await screen.findByRole('table', { name: copy.list.listLabel })).toBeVisible()
    expect(within(listTable()).getAllByRole('rowheader')[0]).toHaveTextContent('가을 정액 쿠폰')
  })

  it('backs out without issuing anything when the question is answered no', async () => {
    const user = await openForm()

    await fill(user)
    await user.click(screen.getByRole('button', { name: copy.form.submit }))
    const dialog = await screen.findByRole('dialog', { name: copy.form.confirm.title })
    await user.click(within(dialog).getByRole('button', { name: copy.form.confirm.cancel }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: copy.form.confirm.title })).toBeNull()
    })
    expect(requests.some((line) => line.startsWith('POST') && line.endsWith('/coupons'))).toBe(
      false,
    )
  })

  /** U2 — 폼이 스스로 아는 것은 보내기 전에, 그 칸에 붙여 말한다. */
  it('puts its own rules under the field they are about', async () => {
    const user = await openForm()

    await choose(user, copy.form.discountTypeLabel, copy.discountTypeLabels.PERCENT)
    await user.type(fieldNamed(copy.form.discountValueLabels.PERCENT), '120')
    await user.click(screen.getByRole('button', { name: copy.form.submit }))

    expect(await screen.findByText(copy.form.errors.percentOutOfRange)).toBeVisible()
    expect(screen.getByText(copy.form.errors.nameRequired)).toBeVisible()
  })

  /**
   * U6 — 서버가 어느 칸을 가리키면 그 칸에 선다.
   *
   * 필드 이름이 계약의 이름과 같기 때문에 가능한 일이다 (`couponPolicyFaultFields`).
   */
  it('lands a refusal that names an input under that input', async () => {
    const user = await openForm()

    testServer.server.use(
      httpFailureOn('post', mockPaths.coupons, 400, 'INVALID', '값이 올바르지 않습니다.', [
        { field: 'discountValue', message: '할인 값이 올바르지 않습니다.', code: 'INVALID' },
      ]),
    )

    await fill(user)
    await user.click(screen.getByRole('button', { name: copy.form.submit }))
    const dialog = await screen.findByRole('dialog', { name: copy.form.confirm.title })
    await user.click(within(dialog).getByRole('button', { name: copy.form.confirm.confirm }))

    expect(await screen.findByText(errors.INVALID)).toBeVisible()
  })
})

describe('데모 관리자에게 말하는 것 (F7)', () => {
  it('says what its writes reach, and leaves every row readable', async () => {
    const table = await openList(sessionDemoAdmin)

    expect(screen.getByText(copy.scope.demoNotice)).toBeVisible()
    // 실계정이 낸 쿠폰도 그대로 보인다 — 조회는 좁혀지지 않는다.
    expect(within(table).getAllByRole('rowheader')).toHaveLength(platformCouponSnapshot().length)
  })

  it('says nothing about scope to a full administrator', async () => {
    await openList()

    expect(screen.queryByText(copy.scope.demoNotice)).not.toBeInTheDocument()
  })

  /** 실계정이 낸 쿠폰에 손대면 서버가 거절하고, 그 거절은 **문장**으로 도착한다. */
  it('turns the refusal on somebody else’s coupon into a sentence', async () => {
    const user = userEvent.setup()
    await openList(sessionDemoAdmin)

    await user.click(
      within(rowOf(MOCK_PLATFORM_COUPON_IDS.active)).getByRole('button', {
        name: copy.list.actions.suspend,
      }),
    )

    expect(await screen.findByText(copy.scope.outOfScope)).toBeVisible()
  })

  it('leaves the demo administrator’s own coupon alone', async () => {
    const user = userEvent.setup()
    await openList(sessionDemoAdmin)

    await user.click(
      within(rowOf(MOCK_PLATFORM_COUPON_IDS.demo)).getByRole('button', {
        name: copy.list.actions.suspend,
      }),
    )

    expect(await screen.findByText(copy.toast.suspended)).toBeVisible()
  })

  /**
   * 플랫폼 목록이 요구하는 것은 `coupon.read` 를 **`any` 로** 가졌는가다. 판매자도
   * 자기 쿠폰에 대해 그 퍼미션을 갖고 있고, 그것으로 열면 403 이 「불러오지
   * 못했어요 · 다시 시도」로 도착한다 — 아무리 눌러도 되지 않는 재시도다.
   */
  it('refuses an account that only holds coupons of its own, instead of a dead retry', async () => {
    renderWithAuth(<CouponsPage />, { session: sessionSellerOwner })

    expect(await screen.findByText(copy.forbiddenTitle)).toBeVisible()
    // 「불러오지 못했어요 · 다시 시도」가 아니다 — 아무리 눌러도 되지 않는 재시도다.
    expect(screen.queryByRole('button', { name: copy.list.retryLabel })).not.toBeInTheDocument()
    expect(requests.some((line) => line.includes('/coupons'))).toBe(false)
  })
})

describe('키보드만으로 (U5 · P4)', () => {
  /** 탭으로 닿을 수 있어야 누를 수 있다. 도달과 조작을 함께 잰다. */
  it('reaches a row action with Tab and fires it with Enter', async () => {
    const user = userEvent.setup()
    await openList()
    const button = within(rowOf(MOCK_PLATFORM_COUPON_IDS.active)).getByRole('button', {
      name: copy.list.actions.suspend,
    })

    for (let step = 0; step < 40 && document.activeElement !== button; step += 1) {
      await user.tab()
    }

    expect(document.activeElement).toBe(button)

    await user.keyboard('{Enter}')

    expect(await screen.findByText(copy.toast.suspended)).toBeVisible()
  })
})

describe('세 검증 뷰포트에서 (P3)', () => {
  /**
   * jsdom 은 아무것도 그리지 않으므로 「레이아웃이 깨지지 않는다」를 여기서 잴 수는
   * 없다. 잴 수 있는 것은 콘솔의 모바일 규칙이 기대는 **구조**다
   * (`docs/design/pages.md` — 관리자 표는 옆으로 구르고 첫 열이 고정된다). 행 머리와
   * 이름이 있는 키보드 도달 가능한 스크롤 영역이 그 구조이고, 이 화면에는 폭에 따라
   * 갈리는 갈래가 아예 없으므로 세 폭에서 모두 있어야 한다.
   */
  it.each(Object.entries(VIEWPORTS))('%s (%ipx)', async (_name, width) => {
    stubViewport(width)
    await openList()

    const region = screen.getByRole('region', { name: copy.list.listLabel })

    expect(region).toHaveAttribute('tabindex', '0')
    expect(within(region).getAllByRole('rowheader')).toHaveLength(platformCouponSnapshot().length)
  })

  /** D-033 — 콘솔은 밀도 2 고정이고 토글이 어디에도 없다. */
  it('offers no display-density control of its own', async () => {
    await openList()

    expect(screen.queryByRole('radiogroup')).toBeNull()
    expect(document.querySelectorAll('[data-density]')).toHaveLength(0)
  })
})
