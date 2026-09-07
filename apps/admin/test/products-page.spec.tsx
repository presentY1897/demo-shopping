/**
 * `/products`, 운영자가 실제로 만지는 대로 (TASK-0095).
 *
 * 아래의 검사는 전부 **진짜 화면을 그린 뒤 고르거나 입력한다.** 지어낸 프롭 꾸러미를
 * 컴포넌트에 건네지 않고 클래스 이름을 확인하지 않는다 (QUALITY-GATES Q5). 재는 것은
 * 모든 스토어의 상품이 한 목록에 서는가(F1), 사유 없이 내리는 것이 **막히는가**(F3),
 * 내리기가 판매 중인 상품에만 열려 있는가(4.2), 그리고 **거절이 문장으로 서는가**다 —
 * 데모 관리자의 403(F8)과 상태가 어긋난 409 는 다른 말을 해야 한다.
 *
 * ## 대역이 둘로 갈린다
 *
 * `/products` 목록과 `/admin/products/:id/hidden` 은 `packages/api-mocks` 에 없어
 * `lib/catalog/console-api` 를 대신 세운다. 카테고리 트리는 그 패키지에 **있으므로**
 * 진짜 msw 대역을 그대로 쓴다 — id 가 이름으로 바뀌는 자리를 실제 응답으로 확인할 수
 * 있어야 한다.
 */

import { sessionDemoAdmin } from '@shopping/api-mocks'
import { ApiClientError } from '@shopping/shared'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { UserEvent } from '@testing-library/user-event'
import axe from 'axe-core'
import type { RunOptions } from 'axe-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { messagesFor } from '@/messages'

import type { MockSession } from './support/auth'
import { renderWithAuth } from './support/auth'
import { CATALOG_SELLER_ID, moderated, productList, productRow } from './support/catalog'
import { storeList, storeRow } from './support/stores'

const catalogApi = vi.hoisted(() => ({
  fetchProducts: vi.fn(),
  hideProduct: vi.fn(),
  unhideProduct: vi.fn(),
  fetchOrders: vi.fn(),
  fetchOrderPayments: vi.fn(),
  productSearch: vi.fn(),
  orderSearch: vi.fn(),
}))

const storesApi = vi.hoisted(() => ({
  fetchStores: vi.fn(),
  fetchStoreHistory: vi.fn(),
}))

vi.mock('@/lib/catalog/console-api', () => catalogApi)
vi.mock('@/lib/stores/console-api', () => storesApi)

const { adminProducts: copy, errors } = messagesFor()

const OPTIONS: RunOptions = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] },
  rules: {
    'color-contrast': { enabled: false },
    'html-has-lang': { enabled: false },
    'document-title': { enabled: false },
    region: { enabled: false },
  },
}

async function expectNoViolations(): Promise<void> {
  const results = await axe.run(document.body, OPTIONS)

  expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([])
}

async function openScreen(session?: MockSession): Promise<UserEvent> {
  const user = userEvent.setup()
  const { default: ProductsPage } = await import('@/app/products/page')

  renderWithAuth(<ProductsPage />, session === undefined ? {} : { session })
  await screen.findByRole('table', { name: copy.list.listLabel })

  return user
}

function table(): HTMLElement {
  return screen.getByRole('table', { name: copy.list.listLabel })
}

/** 서버가 답한 실패 하나. `createApiClient` 가 만드는 모양 그대로. */
function refusal(status: number, code: string): ApiClientError {
  return new ApiClientError({
    kind: 'http',
    message: 'for the log',
    status,
    body: { error: { code, message: '서버 문장', details: [], requestId: 'req-1' } },
  })
}

/** 「내리기」를 눌러 사유를 묻는 창을 연다. */
async function openHideDialog(user: UserEvent): Promise<HTMLElement> {
  await user.click(screen.getByRole('button', { name: new RegExp(copy.list.hideLabel) }))

  return screen.findByRole('dialog', { name: copy.hide.title })
}

beforeEach(() => {
  vi.clearAllMocks()
  catalogApi.fetchProducts.mockResolvedValue(productList([productRow()]))
  storesApi.fetchStores.mockResolvedValue(
    storeList([storeRow({ sellerId: CATALOG_SELLER_ID, brandName: '루미에르' })]),
  )
})

describe('전체 상품 목록 (F1)', () => {
  /**
   * 관리자의 `product.read` 는 `any` 라 이 문이 이미 모든 스토어의 상품을 답한다
   * (4.1). 화면이 하는 일은 그 id 들을 사람이 읽을 수 있는 이름으로 바꾸는 것이다.
   */
  it('draws every store’s listing, with the store and the category as names', async () => {
    await openScreen()

    const rows = table()

    expect(within(rows).getByRole('rowheader', { name: /캐시미어 블렌드 코트/ })).toBeVisible()
    expect(within(rows).getByText('루미에르')).toBeVisible()
    // `@shopping/api-mocks` 의 트리에서 3번은 「여성 › 아우터 › 코트」다.
    expect(await within(rows).findByText('여성 › 아우터 › 코트')).toBeVisible()
    expect(catalogApi.fetchProducts).toHaveBeenCalledWith({}, expect.anything())
  })

  /**
   * **검색 엔진을 쓰지 않는다.** 색인은 판매 중인 것만 담으므로, 관리자가 정작
   * 찾으려는 초안이나 강제로 내려진 상품은 거기 없다 (TASK-0095 4.1).
   */
  it('searches by name, and says it also finds what is not on sale', async () => {
    const user = await openScreen()

    await user.type(screen.getByRole('searchbox', { name: copy.list.filters.searchLabel }), '코트')
    await user.click(screen.getByRole('button', { name: copy.list.filters.searchAction }))

    await waitFor(() => {
      expect(catalogApi.fetchProducts).toHaveBeenLastCalledWith(
        expect.objectContaining({ q: '코트' }),
        expect.anything(),
      )
    })
    expect(screen.getByText(copy.list.filters.searchHint)).toBeVisible()
  })

  /** 글자마다 보내면 「코트」를 치는 동안 상품 표 전체를 훑는 질의가 세 번 나간다. */
  it('does not search while somebody is still typing', async () => {
    const user = await openScreen()
    const before = catalogApi.fetchProducts.mock.calls.length

    await user.type(screen.getByRole('searchbox', { name: copy.list.filters.searchLabel }), '코트')

    expect(catalogApi.fetchProducts.mock.calls).toHaveLength(before)
  })

  it('narrows by store, category and status', async () => {
    const user = await openScreen()

    await user.click(screen.getByRole('combobox', { name: copy.list.filters.sellerLabel }))
    await user.click(await screen.findByRole('option', { name: '루미에르' }))

    expect(catalogApi.fetchProducts).toHaveBeenLastCalledWith(
      { sellerId: CATALOG_SELLER_ID },
      expect.anything(),
    )

    await user.click(screen.getByRole('combobox', { name: copy.list.filters.statusLabel }))
    await user.click(await screen.findByRole('option', { name: copy.statusLabels.SUSPENDED }))

    expect(catalogApi.fetchProducts).toHaveBeenLastCalledWith(
      { sellerId: CATALOG_SELLER_ID, status: 'SUSPENDED' },
      expect.anything(),
    )
  })

  it('says nothing rather than 0원 for a draft with no price yet', async () => {
    catalogApi.fetchProducts.mockResolvedValue(
      productList([productRow({ status: 'DRAFT', minPrice: null })]),
    )

    await openScreen()

    expect(within(table()).getByText(copy.list.noPrice)).toBeVisible()
  })
})

describe('무엇을 내릴 수 있는가 (4.2)', () => {
  it('offers 내리기 for a listing on sale', async () => {
    await openScreen()

    expect(
      within(table()).getByRole('button', { name: new RegExp(copy.list.hideLabel) }),
    ).toBeVisible()
  })

  it('offers 다시 올리기 for one that was pulled, and marks it as pulled by an admin', async () => {
    catalogApi.fetchProducts.mockResolvedValue(productList([productRow({ status: 'SUSPENDED' })]))

    await openScreen()

    const rows = table()

    expect(within(rows).getByText(copy.list.hiddenBadge)).toBeVisible()
    expect(
      within(rows).getByRole('button', { name: new RegExp(copy.list.restoreLabel) }),
    ).toBeVisible()
  })

  /**
   * 초안을 `ACTIVE` 로 올리면 값 없는 상품이 진열되어 `Product_active_price_check` 에
   * 걸리고, 그 500 은 관리자에게 아무 뜻도 없다. 눌러 봐야만 알 수 있는 버튼을
   * 내밀지 않는 대신 **왜 없는지**를 적는다.
   */
  it('offers neither for a draft, and says why', async () => {
    catalogApi.fetchProducts.mockResolvedValue(
      productList([productRow({ status: 'DRAFT', minPrice: null })]),
    )

    await openScreen()

    const rows = table()

    expect(within(rows).getByText(copy.list.notModeratable)).toBeVisible()
    expect(within(rows).queryByRole('button', { name: new RegExp(copy.list.hideLabel) })).toBeNull()
  })
})

describe('내리기 (F2 · F3)', () => {
  /** 사유 없이 내려진 상품은 **판매자에게 설명할 방법이 없다** (4.2). */
  it('refuses to send with no reason, and says so under the field', async () => {
    const user = await openScreen()
    const dialog = await openHideDialog(user)

    await user.click(within(dialog).getByRole('button', { name: copy.hide.submit }))

    expect(await within(dialog).findByText(copy.hide.errors.reasonRequired)).toBeVisible()
    expect(catalogApi.hideProduct).not.toHaveBeenCalled()
  })

  it('sends the reason once it is written, and re-reads the list', async () => {
    const row = productRow()
    catalogApi.fetchProducts.mockResolvedValue(productList([row]))
    catalogApi.hideProduct.mockResolvedValue(moderated(row, true, '상표 도용'))

    const user = await openScreen()
    const dialog = await openHideDialog(user)

    await user.type(
      within(dialog).getByLabelText(copy.hide.reasonLabel, { exact: false }),
      '상표 도용',
    )
    await user.click(within(dialog).getByRole('button', { name: copy.hide.submit }))

    await waitFor(() => {
      expect(catalogApi.hideProduct).toHaveBeenCalledWith(row.id, '상표 도용')
    })
    // 줄의 상태는 서버가 말한다 — 답은 숨김 여부만 싣는다.
    await waitFor(() => {
      expect(catalogApi.fetchProducts).toHaveBeenCalledTimes(2)
    })
    expect(await screen.findByText(copy.toast.hidden)).toBeVisible()
  })

  it('sends one request however many times the confirm button is pressed', async () => {
    const row = productRow()
    catalogApi.fetchProducts.mockResolvedValue(productList([row]))
    catalogApi.hideProduct.mockResolvedValue(moderated(row, true, '상표 도용'))

    const user = await openScreen()
    const dialog = await openHideDialog(user)

    await user.type(
      within(dialog).getByLabelText(copy.hide.reasonLabel, { exact: false }),
      '상표 도용',
    )
    const confirm = within(dialog).getByRole('button', { name: copy.hide.submit })

    await user.click(confirm)
    await user.click(confirm)

    await waitFor(() => {
      expect(catalogApi.hideProduct).toHaveBeenCalledTimes(1)
    })
  })

  it('tells the operator that hiding also takes the listing out of search', async () => {
    const user = await openScreen()
    const dialog = await openHideDialog(user)

    expect(within(dialog).getByText(copy.hide.notice)).toBeVisible()
  })
})

describe('거절이 문장으로 선다', () => {
  /**
   * F8. 카탈로그의 「권한이 없어요」는 **어느 자격이 어떻게 좁혀져 있는지**를 말하지
   * 못한다. 그리고 어느 상품이 데모 계정의 것인지는 줄에 없어 버튼을 미리 죽일 수 없다.
   */
  it('explains the 403 a demo administrator gets on a real account’s listing', async () => {
    catalogApi.hideProduct.mockRejectedValue(refusal(403, 'FORBIDDEN'))

    const user = await openScreen(sessionDemoAdmin)
    const dialog = await openHideDialog(user)

    await user.type(
      within(dialog).getByLabelText(copy.hide.reasonLabel, { exact: false }),
      '상표 도용',
    )
    await user.click(within(dialog).getByRole('button', { name: copy.hide.submit }))

    expect(await within(dialog).findByText(copy.refusals.forbidden)).toBeVisible()
    expect(within(dialog).queryByText(errors.FORBIDDEN)).toBeNull()
  })

  it('warns a demo administrator before they even try', async () => {
    await openScreen(sessionDemoAdmin)

    expect(screen.getAllByText(copy.refusals.forbidden).length).toBeGreaterThan(0)
  })

  /** 409 는 카탈로그가 이미 문장을 갖고 있다. 여기서 되풀이하면 두 벌이 생긴다. */
  it('uses the catalog sentence when the listing was no longer in the right state', async () => {
    catalogApi.hideProduct.mockRejectedValue(refusal(409, 'PRODUCT_NOT_MODERATABLE'))

    const user = await openScreen()
    const dialog = await openHideDialog(user)

    await user.type(
      within(dialog).getByLabelText(copy.hide.reasonLabel, { exact: false }),
      '상표 도용',
    )
    await user.click(within(dialog).getByRole('button', { name: copy.hide.submit }))

    expect(await within(dialog).findByText(errors.PRODUCT_NOT_MODERATABLE)).toBeVisible()
  })

  it('keeps a refusal on screen when it arrives outside the dialog', async () => {
    catalogApi.fetchProducts.mockResolvedValue(productList([productRow({ status: 'SUSPENDED' })]))
    catalogApi.unhideProduct.mockRejectedValue(refusal(404, 'NOT_FOUND'))

    const user = await openScreen()

    await user.click(screen.getByRole('button', { name: new RegExp(copy.list.restoreLabel) }))
    const dialog = await screen.findByRole('dialog', { name: copy.restore.title })
    await user.click(within(dialog).getByRole('button', { name: copy.restore.confirm }))

    expect(await screen.findByRole('alert')).toHaveTextContent(copy.refusals.stale)
  })
})

describe('다시 올리기', () => {
  it('asks first, then sends with no reason of its own', async () => {
    const row = productRow({ status: 'SUSPENDED' })
    catalogApi.fetchProducts.mockResolvedValue(productList([row]))
    catalogApi.unhideProduct.mockResolvedValue(moderated(row, false))

    const user = await openScreen()

    await user.click(screen.getByRole('button', { name: new RegExp(copy.list.restoreLabel) }))
    const dialog = await screen.findByRole('dialog', { name: copy.restore.title })
    await user.click(within(dialog).getByRole('button', { name: copy.restore.confirm }))

    await waitFor(() => {
      expect(catalogApi.unhideProduct).toHaveBeenCalledWith(row.id)
    })
    expect(await screen.findByText(copy.toast.restored)).toBeVisible()
  })
})

describe('불러오지 못했을 때', () => {
  it('shows the failure and a way to retry', async () => {
    catalogApi.fetchProducts.mockRejectedValue(
      new ApiClientError({ kind: 'network', message: 'for the log' }),
    )

    const user = userEvent.setup()
    const { default: ProductsPage } = await import('@/app/products/page')

    renderWithAuth(<ProductsPage />)

    expect(await screen.findByText(copy.list.errorTitle)).toBeVisible()
    expect(screen.getByText(copy.failures.network)).toBeVisible()

    catalogApi.fetchProducts.mockResolvedValue(productList([productRow()]))
    await user.click(screen.getByRole('button', { name: copy.list.retryLabel }))

    expect(await screen.findByRole('table', { name: copy.list.listLabel })).toBeVisible()
  })

  /** 스토어 이름을 못 받아도 상품 목록은 읽힌다 — 이 화면의 본 일이 아니다. */
  it('still draws the list when the store names could not be fetched', async () => {
    storesApi.fetchStores.mockRejectedValue(
      new ApiClientError({ kind: 'network', message: 'for the log' }),
    )

    await openScreen()

    expect(await within(table()).findByText(copy.list.unknownSeller)).toBeVisible()
  })
})

describe('접근성', { timeout: 20_000 }, () => {
  it('has no violations with the list on screen', async () => {
    await openScreen()

    await expectNoViolations()
  })

  it('has no violations with the reason dialog open', async () => {
    const user = await openScreen()
    await openHideDialog(user)

    await expectNoViolations()
  })
})
