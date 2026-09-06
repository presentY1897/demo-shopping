/**
 * 쿠폰 발행 폼 (TASK-0074 4장 · F1 · F2 · F3 · F4).
 *
 * 여기서 재는 것은 대부분 **화면이 판매자에게 보여 주는 숫자와 선택지**다. 그것이 이
 * TASK 의 목적이기 때문이다 — 「발행이 된다」는 대역 검사가 이미 재고 있고, 이 화면이
 * 막으려는 사고는 「부담 구조를 모르고 뿌리는 것」이다.
 *
 * 폼을 채우는 일이 반복되므로 아래에 채우개 하나를 두었다. 값이 검사마다 조금씩
 * 다른 것이 이 파일의 전부라, 그 차이만 인자로 받는다.
 */

import {
  httpFailureOn,
  mockPaths,
  sellerCouponHandlers,
  sellerCouponSnapshot,
  sellerProductListItem,
} from '@shopping/api-mocks'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import CouponsPage from '@/app/coupons/page'
import { money } from '@/lib/orders/format'
import { messagesFor } from '@/messages'

import { renderWithAuth } from './support/auth'
import { testServer } from './setup'
import { stubViewport, VIEWPORTS } from './support/viewport'

const list = messagesFor().couponList
const copy = messagesFor().couponForm
const vocabulary = messagesFor().coupons

beforeEach(() => {
  testServer.server.use(...sellerCouponHandlers)
  stubViewport(VIEWPORTS.desktop)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** 목록이 도착한 뒤 발행 폼을 연다. 기본은 닫혀 있다 — 목록이 이 화면의 본문이다. */
async function openForm(user: UserEvent): Promise<HTMLElement> {
  renderWithAuth(<CouponsPage />)
  await screen.findByRole('table', { name: list.table.caption })
  await user.click(screen.getByRole('button', { name: copy.openLabel }))

  return screen.findByRole('form', { name: copy.legend })
}

/** 라벨의 시작으로 컨트롤을 찾는다. 필수 표시(`*`)가 뒤에 붙기 때문이다. */
function field(label: string): HTMLElement {
  return screen.getByLabelText(new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}`, 'u'))
}

/** `datetime-local` 은 타이핑으로 채우기 어렵다. 값을 직접 넣고 React 에 알린다. */
function setDateTime(label: string, value: string): void {
  fireEvent.change(field(label), { target: { value } })
}

interface FormInput {
  readonly name?: string
  readonly discountValue?: string
  readonly issueLimit?: string
  readonly validFrom?: string
  readonly validUntil?: string
}

/** 통과하는 정액 쿠폰 한 벌. 검사가 바꾸고 싶은 칸만 덮어쓴다. */
async function fillValidCoupon(user: UserEvent, input: FormInput = {}): Promise<void> {
  await user.type(field(copy.fields.nameLabel), input.name ?? '가을 3,000원')
  await user.type(field(copy.fields.discountValueLabel.FIXED), input.discountValue ?? '3000')

  if (input.issueLimit !== undefined) {
    await user.type(field(copy.fields.issueLimitLabel), input.issueLimit)
  }

  setDateTime(copy.fields.validFromLabel, input.validFrom ?? '2026-09-10T09:00')
  setDateTime(copy.fields.validUntilLabel, input.validUntil ?? '2026-09-30T23:59')
}

/** 할인 방식을 정률로 옮긴다. 그때만 최대 할인 금액 칸이 나타난다. */
async function choosePercent(user: UserEvent): Promise<void> {
  await user.click(screen.getByRole('combobox', { name: copy.fields.discountTypeLabel }))
  await user.click(
    await screen.findByRole('option', { name: vocabulary.discountTypeLabels.PERCENT }),
  )
}

/** 범위를 「지정한 상품」으로 옮긴다. */
async function chooseProductScope(user: UserEvent): Promise<void> {
  await user.click(screen.getByRole('combobox', { name: copy.fields.scopeTypeLabel }))
  await user.click(await screen.findByRole('option', { name: vocabulary.scopeTypeLabels.PRODUCT }))
}

describe('F2 — 부담 경고', () => {
  it('stands above every input, not below the button', async () => {
    const user = userEvent.setup()
    const form = await openForm(user)

    const warning = within(form).getByText(copy.warning.title)
    const firstInput = within(form).getByLabelText(new RegExp(`^${copy.fields.nameLabel}`, 'u'))

    // 아래로 내리면 스크롤 밖으로 나가고, 스크롤 밖의 경고는 읽히지 않는다.
    expect(warning.compareDocumentPosition(firstInput)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  it('says the discount comes out of the settlement', async () => {
    const user = userEvent.setup()
    const form = await openForm(user)

    expect(within(form).getByText(copy.warning.title)).toBeVisible()
    expect(within(form).getByText(copy.warning.body)).toBeVisible()
  })
})

describe('F3 — 예상 부담액', () => {
  it('says nothing yet on an empty form', async () => {
    const user = userEvent.setup()
    const form = await openForm(user)

    expect(within(form).getByText(copy.warning.unknown)).toBeVisible()
  })

  it('multiplies the amount by the count as the form changes', async () => {
    const user = userEvent.setup()
    const form = await openForm(user)

    await user.type(field(copy.fields.discountValueLabel.FIXED), '5000')
    await user.type(field(copy.fields.issueLimitLabel), '100')

    // TASK-0074 4장이 적어 둔 그 줄이다 — 100장 × 5,000원 = 500,000원.
    const expected = `${copy.warning.estimateLabel}: ${copy.warning.estimate
      .replace('{count}', '100')
      .replace('{perVoucher}', money(5_000))
      .replace('{total}', money(500_000))}`

    await waitFor(() => {
      expect(within(form).getByText(expected)).toBeVisible()
    })
  })

  it('recomputes when the count changes rather than keeping the first answer', async () => {
    const user = userEvent.setup()
    const form = await openForm(user)

    await user.type(field(copy.fields.discountValueLabel.FIXED), '5000')
    await user.type(field(copy.fields.issueLimitLabel), '10')
    await waitFor(() => {
      expect(within(form).getByText(new RegExp(money(50_000), 'u'))).toBeVisible()
    })

    await user.clear(field(copy.fields.issueLimitLabel))
    await user.type(field(copy.fields.issueLimitLabel), '20')

    await waitFor(() => {
      expect(within(form).getByText(new RegExp(money(100_000), 'u'))).toBeVisible()
    })
  })

  it('refuses to print a number for a percentage coupon with no ceiling', async () => {
    const user = userEvent.setup()
    const form = await openForm(user)

    await choosePercent(user)
    await user.type(field(copy.fields.discountValueLabel.PERCENT), '10')
    await user.type(field(copy.fields.issueLimitLabel), '100')

    // 상한 없는 정률의 최대 부담은 큰 수가 아니라 **없는 수**다.
    await waitFor(() => {
      expect(within(form).getByText(copy.warning.unbounded.noDiscountCeiling)).toBeVisible()
    })
  })

  it('computes it once the ceiling is filled in', async () => {
    const user = userEvent.setup()
    const form = await openForm(user)

    await choosePercent(user)
    await user.type(field(copy.fields.discountValueLabel.PERCENT), '10')
    await user.type(field(copy.fields.maxDiscountAmountLabel), '3000')
    await user.type(field(copy.fields.issueLimitLabel), '200')

    await waitFor(() => {
      expect(within(form).getByText(new RegExp(money(600_000), 'u'))).toBeVisible()
    })
  })

  it('says an unlimited issue count has no bounded maximum either', async () => {
    const user = userEvent.setup()
    const form = await openForm(user)

    await user.type(field(copy.fields.discountValueLabel.FIXED), '5000')

    expect(within(form).getByText(copy.warning.unbounded.unlimitedIssue)).toBeVisible()
  })
})

describe('F1 — 범위 제한', () => {
  it('offers only this store and its products — never 전체 or 카테고리', async () => {
    const user = userEvent.setup()

    await openForm(user)
    await user.click(screen.getByRole('combobox', { name: copy.fields.scopeTypeLabel }))

    const options = await screen.findAllByRole('option')

    expect(options.map((option) => option.textContent)).toEqual([
      vocabulary.scopeTypeLabels.SELLER,
      vocabulary.scopeTypeLabels.PRODUCT,
    ])
  })

  it("offers this store's own products and nothing else", async () => {
    const user = userEvent.setup()

    await openForm(user)
    await chooseProductScope(user)

    // 출처가 `GET /seller/products` 라 「남의 상품이 없다」가 화면의 필터가 아니라
    // 응답의 성질이다. 첫 줄이 카탈로그의 첫 상품이면 그 출처를 읽은 것이다.
    expect(
      await screen.findByRole('checkbox', { name: sellerProductListItem(0).name }),
    ).toBeVisible()
  })

  it('explains why 카테고리 is not on offer', async () => {
    const user = userEvent.setup()
    const form = await openForm(user)

    // 적지 않으면 「전체가 없는 것」이 결함으로 신고된다.
    expect(within(form).getByText(copy.fields.scopeTypeHint)).toBeVisible()
  })

  it('refuses to submit a product scope with nothing chosen (U2)', async () => {
    const user = userEvent.setup()

    await openForm(user)
    await chooseProductScope(user)
    await fillValidCoupon(user)
    await user.click(screen.getByRole('button', { name: copy.submitLabel }))

    expect(await screen.findByText(copy.errors.scopeRequired)).toBeVisible()
  })
})

describe('F4 — 발행', () => {
  it('sends the store as the issuer and adds the coupon to the list', async () => {
    const user = userEvent.setup()

    await openForm(user)
    await fillValidCoupon(user, { name: '테스트 쿠폰', discountValue: '2500', issueLimit: '50' })
    await user.click(screen.getByRole('button', { name: copy.submitLabel }))

    expect(
      await screen.findByText(copy.issuedNotice.replace('{name}', '테스트 쿠폰')),
    ).toBeVisible()

    const stored = sellerCouponSnapshot().find((entry) => entry.coupon.name === '테스트 쿠폰')

    expect(stored?.coupon.issuerType).toBe('SELLER')
    expect(stored?.coupon.discountValue).toBe(2_500)
    expect(stored?.coupon.issueLimit).toBe(50)
    // 목록은 다시 읽힌다 — 발행이 답하는 것은 정책 하나뿐이라 상태도 통계도 없다.
    await waitFor(() => {
      expect(screen.getByText('테스트 쿠폰')).toBeVisible()
    })
  })

  it('closes the form once the coupon is out', async () => {
    const user = userEvent.setup()

    await openForm(user)
    await fillValidCoupon(user)
    await user.click(screen.getByRole('button', { name: copy.submitLabel }))

    await waitFor(() => {
      expect(screen.queryByRole('form', { name: copy.legend })).toBeNull()
    })
  })
})

describe('U2 — 거절은 그 칸에 붙는다', () => {
  it('puts a missing name under the name input', async () => {
    const user = userEvent.setup()

    await openForm(user)
    await user.click(screen.getByRole('button', { name: copy.submitLabel }))

    expect(await screen.findByText(copy.errors.nameRequired)).toBeVisible()
  })

  it('refuses a period that ends before it starts', async () => {
    const user = userEvent.setup()

    await openForm(user)
    await fillValidCoupon(user, {
      validFrom: '2026-09-30T09:00',
      validUntil: '2026-09-10T09:00',
    })
    await user.click(screen.getByRole('button', { name: copy.submitLabel }))

    expect(await screen.findByText(copy.errors.periodOrder)).toBeVisible()
  })

  it('refuses a rate above 100 percent', async () => {
    const user = userEvent.setup()

    await openForm(user)
    await choosePercent(user)
    await user.type(field(copy.fields.nameLabel), '이상한 쿠폰')
    await user.type(field(copy.fields.discountValueLabel.PERCENT), '200')
    setDateTime(copy.fields.validFromLabel, '2026-09-10T09:00')
    setDateTime(copy.fields.validUntilLabel, '2026-09-30T23:59')
    await user.click(screen.getByRole('button', { name: copy.submitLabel }))

    expect(await screen.findByText(copy.errors.percentRange)).toBeVisible()
  })

  it("lands the server's scope refusal on the field it names (U6)", async () => {
    testServer.server.use(
      httpFailureOn('post', mockPaths.coupons, 403, 'COUPON_SCOPE_FORBIDDEN', '범위가 넓습니다.', [
        {
          field: 'scopeIds',
          message: '판매자 쿠폰은 내 스토어의 상품에만 적용할 수 있어요.',
          code: 'COUPON_SCOPE_FORBIDDEN',
        },
      ]),
    )

    const user = userEvent.setup()

    await openForm(user)
    await chooseProductScope(user)
    await user.click(await screen.findByRole('checkbox', { name: sellerProductListItem(0).name }))
    await fillValidCoupon(user)
    await user.click(screen.getByRole('button', { name: copy.submitLabel }))

    // 화면이 먼저 막는 것은 친절이고, 거절되는 것이 규칙이다 — API 를 직접 부르는
    // 길이 남아 있으므로 이 문장은 실제로 도착할 수 있다.
    expect(await screen.findByText(messagesFor().errors.COUPON_SCOPE_FORBIDDEN)).toBeVisible()
  })

  it('shows a failure that names no field at the top of the form', async () => {
    testServer.server.use(
      httpFailureOn('post', mockPaths.coupons, 500, 'INTERNAL_ERROR', '서버 오류'),
    )

    const user = userEvent.setup()

    await openForm(user)
    await fillValidCoupon(user)
    await user.click(screen.getByRole('button', { name: copy.submitLabel }))

    const banner = await screen.findByRole('alert')

    expect(within(banner).getByText(copy.errorTitle)).toBeVisible()
    expect(within(banner).getByText(messagesFor().errors.INTERNAL_ERROR)).toBeVisible()
  })
})

describe('U3 · U5 — 한 문으로만 제출된다', () => {
  it('does not issue twice when the button is pressed twice', async () => {
    const user = userEvent.setup()
    const before = sellerCouponSnapshot().length

    await openForm(user)
    await fillValidCoupon(user, { name: '한 번만' })

    const submit = screen.getByRole('button', { name: copy.submitLabel })

    await Promise.all([user.click(submit), user.click(submit)])
    await screen.findByText(copy.issuedNotice.replace('{name}', '한 번만'))

    expect(sellerCouponSnapshot()).toHaveLength(before + 1)
  })

  it('meets the same validation when Enter is pressed in a text field', async () => {
    const user = userEvent.setup()

    await openForm(user)

    // 버튼을 지나지 않는 제출이다. `Button.loading` 만으로는 막히지 않는 자리이고,
    // 검증도 마찬가지로 여기서 새어 나갈 수 있다.
    await user.type(field(copy.fields.nameLabel), '이름만 적음{Enter}')

    expect(await screen.findByText(copy.errors.discountValueRequired)).toBeVisible()
  })
})
