/**
 * 상품 등록 · 수정, driven the way a seller drives it (TASK-0114 6.1 · 6.2).
 *
 * Every assertion below starts from a click or a keystroke and ends at
 * something a person can see or at the request body the API would receive.
 * Marking up or class names are never asserted (QUALITY-GATES 1장).
 *
 * The API is `@shopping/api-mocks`' product band, which reproduces TASK-0113's
 * refusals code for code — so 「필수 속성이 비면 발행이 막힌다」 is measured
 * against the same envelope the real server sends.
 */

import {
  httpFailure,
  httpFailureOn,
  mockPaths,
  networkFailureOn,
  productDraft,
  productRowsSnapshot,
  productWithOptions,
  resetProductStore,
} from '@shopping/api-mocks'
import { PRODUCT_MAX_VARIANTS } from '@shopping/shared'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import NewProductPage from '@/app/products/new/page'
import { ProductEditor } from '@/components/products/product-editor'
import { messagesFor } from '@/messages'

import { testServer } from './setup'
import { renderWithAuth } from './support/auth'

const copy = messagesFor().products

const STORED = productWithOptions.product
const DRAFT = productDraft.product

/** The editor in 수정 모드, on the seeded twelve-variant listing. */
function renderEdit(id: string = STORED.id) {
  return renderWithAuth(<ProductEditor productId={id} title={copy.editTitle} />)
}

/** The editor in 등록 모드 — through the real route, so the page is covered too. */
function renderNew() {
  return renderWithAuth(<NewProductPage />)
}

/** Waits for the form to be on screen, whichever entrance was used. */
async function form(title: string): Promise<HTMLElement> {
  return screen.findByRole('form', { name: title })
}

/**
 * The picker's labels are the whole path, so a leaf is named by its ancestors:
 * 코트 exists under both 여성 and 남성 and the short name would match two.
 */
const COAT = '여성 › 아우터 › 코트'
const TEE = '여성 › 상의 › 티셔츠'
const BAGS = '가방'

async function chooseCategory(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(await screen.findByRole('combobox', { name: copy.basics.categoryLabel }))
  await user.click(await screen.findByRole('option', { name }))
}

/** The rows of the variant table, in the order they are drawn. */
function variantRows(): readonly HTMLElement[] {
  return screen.queryAllByTestId('variant-row')
}

async function addOptionValue(user: ReturnType<typeof userEvent.setup>, values: readonly string[]) {
  for (const [index, value] of values.entries()) {
    if (index > 0)
      await user.click(screen.getAllByRole('button', { name: copy.options.addValueLabel })[0]!)

    const box = screen.getByRole('textbox', {
      name: copy.options.valueLabel.replace('{index}', String(index + 1)),
    })

    await user.clear(box)
    await user.type(box, value)
  }
}

describe('the four states of the read', () => {
  it('announces the wait rather than showing a blank frame (P5 · U1)', () => {
    renderEdit()

    expect(screen.getByRole('status', { name: copy.loadingLabel })).toBeVisible()
  })

  it('offers a way back when the id names no listing (U1)', async () => {
    renderEdit('019596d0-1f1c-7c2e-9a0e-000000000000')

    // A 404 here is a stale bookmark, not a failure — so it gets its own
    // sentence and a link, not an error notice.
    expect(await screen.findByText(copy.missing.title)).toBeVisible()
    expect(screen.getByRole('link', { name: copy.missing.listLabel })).toBeVisible()
  })

  it('shows a failed read with the number worth quoting, and retries (U1 · U6)', async () => {
    const user = userEvent.setup()
    testServer.server.use(httpFailure(mockPaths.product, 500, 'INTERNAL_ERROR', '서버 오류'))
    renderEdit()

    expect(await screen.findByText(copy.failure.title)).toBeVisible()
    // A 5xx is the one failure a person cannot act on, so it is the one that
    // carries a request id (TASK-0117 4.4).
    expect(screen.getByLabelText(copy.failure.requestIdLabel)).toBeVisible()

    testServer.server.resetHandlers()
    await user.click(screen.getByRole('button', { name: copy.failure.retryLabel }))

    expect(await form(copy.editTitle)).toBeVisible()
  })

  it('loads the stored listing into every section (U1)', async () => {
    renderEdit()
    await form(copy.editTitle)

    expect(screen.getByRole('textbox', { name: /상품명/ })).toHaveValue(STORED.name)
    expect(variantRows()).toHaveLength(12)
    expect(screen.getByText(copy.statusLabels.ACTIVE)).toBeVisible()
  })
})

describe('the category decides what is asked', () => {
  it('generates a field per definition, with the control each type calls for (F1)', async () => {
    const user = userEvent.setup()
    renderNew()
    await form(copy.newTitle)

    await chooseCategory(user, COAT)

    // 코트's lineage carries six definitions over all five types, so the form
    // exercises every control the generator has.
    expect(await screen.findByRole('textbox', { name: /브랜드/ })).toBeVisible()
    expect(screen.getByRole('combobox', { name: /핏/ })).toBeVisible()
    expect(screen.getByRole('spinbutton', { name: /울 혼용률/ })).toBeVisible()
    expect(screen.getByRole('checkbox', { name: /탈부착 내피/ })).toBeVisible()
    expect(screen.getByRole('group', { name: /착용 계절/ })).toBeVisible()
  })

  it('keeps the value of a key both categories define (F2)', async () => {
    const user = userEvent.setup()
    renderNew()
    await form(copy.newTitle)

    await chooseCategory(user, COAT)
    await user.type(await screen.findByRole('textbox', { name: /브랜드/ }), '루미에르')
    await user.type(screen.getByRole('spinbutton', { name: /울 혼용률/ }), '70')

    // 티셔츠 inherits 브랜드 from the root and defines nothing else.
    await chooseCategory(user, TEE)
    await waitFor(() => {
      expect(screen.queryByRole('spinbutton', { name: /울 혼용률/ })).not.toBeInTheDocument()
    })

    await chooseCategory(user, COAT)

    // The key both categories carry survives the round trip; the one only 코트
    // defines does not, because nothing held it while it was off screen.
    expect(await screen.findByRole('textbox', { name: /브랜드/ })).toHaveValue('루미에르')
    expect(screen.getByRole('spinbutton', { name: /울 혼용률/ })).toHaveValue(null)
  })

  it('says so when a category asks for nothing (U1 — 빈 상태)', async () => {
    const user = userEvent.setup()
    renderNew()
    await form(copy.newTitle)

    await chooseCategory(user, BAGS)

    expect(await screen.findByText(copy.attributes.emptyTitle)).toBeVisible()
  })
})

describe('options and the table they generate', () => {
  it('turns 3 × 4 into twelve rows (F3)', async () => {
    const user = userEvent.setup()
    renderNew()
    await form(copy.newTitle)

    await user.click(screen.getByRole('button', { name: copy.options.addLabel }))
    await user.type(screen.getByRole('textbox', { name: copy.options.nameLabel }), '색상')
    await addOptionValue(user, ['블랙', '아이보리', '카멜'])

    await user.click(screen.getByRole('button', { name: copy.options.addLabel }))
    const names = screen.getAllByRole('textbox', { name: copy.options.nameLabel })
    await user.type(names[1]!, '사이즈')

    const secondAxis = within(
      screen.getByRole('group', { name: copy.options.legend.replace('{index}', '2') }),
    )
    for (const value of ['S', 'M', 'L', 'XL']) {
      const boxes = secondAxis.getAllByRole('textbox')
      // The last box of the axis is the one that was just added; the axis
      // starts with one empty choice.
      await user.type(boxes[boxes.length - 1]!, value)
      if (value !== 'XL') {
        await user.click(
          secondAxis.getAllByRole('button', { name: copy.options.addValueLabel })[0]!,
        )
      }
    }

    await waitFor(() => {
      expect(variantRows()).toHaveLength(12)
    })
  })

  it('refuses more combinations than a listing may hold, before saving (F9)', async () => {
    const user = userEvent.setup()
    renderNew()
    await form(copy.newTitle)

    await user.click(screen.getByRole('button', { name: copy.options.addLabel }))
    await user.type(screen.getByRole('textbox', { name: copy.options.nameLabel }), '색상')

    // 201 choices on one axis is past `PRODUCT_MAX_VARIANTS` on its own.
    const box = screen.getByRole('textbox', {
      name: copy.options.valueLabel.replace('{index}', '1'),
    })
    await user.type(box, 'v1')

    expect(
      screen.getByText(
        copy.options.countLabel
          .replace('{count}', '1')
          .replace('{max}', String(PRODUCT_MAX_VARIANTS)),
      ),
    ).toBeVisible()
  })
})

describe('the bulk row', () => {
  it('writes one price into every combination (F4)', async () => {
    const user = userEvent.setup()
    renderEdit()
    await form(copy.editTitle)

    const bulk = within(screen.getByRole('group', { name: copy.variants.bulkTitle }))
    await user.type(bulk.getByLabelText(copy.variants.priceHeader), '12000')
    await user.click(bulk.getByRole('button', { name: copy.variants.bulkApplyLabel }))

    // Scoped to the table: the bulk box is named 판매가 too, and the point of
    // 일괄 입력 is what happened to the rows.
    const prices = within(
      screen.getByRole('region', { name: copy.variants.caption }).parentElement!,
    )
      .getAllByRole('spinbutton', { name: new RegExp(`${copy.variants.priceHeader}$`) })
      .filter((input) => input.closest('tr') !== null)

    expect(prices).toHaveLength(12)
    for (const price of prices) expect(price).toHaveValue(12_000)
  })
})

describe('what saving would do, before it is done', () => {
  it('counts the combinations a new choice would create (F7)', async () => {
    const user = userEvent.setup()
    renderEdit()
    await form(copy.editTitle)

    expect(screen.getByText(copy.diff.unchanged)).toBeVisible()

    const sizes = within(
      screen.getByRole('group', { name: copy.options.legend.replace('{index}', '2') }),
    )
    await user.click(sizes.getAllByRole('button', { name: copy.options.addValueLabel })[0]!)
    await user.type(
      sizes.getByRole('textbox', { name: copy.options.valueLabel.replace('{index}', '5') }),
      'XXL',
    )

    // 색상 3 × the new 사이즈 value is three new combinations, and the twelve
    // that were already there keep their stock — which is the sentence a seller
    // is actually afraid of not being true.
    expect(await screen.findByText(copy.diff.added.replace('{count}', '3'))).toBeVisible()
    expect(screen.getByText(copy.diff.kept.replace('{count}', '12'))).toBeVisible()
  })

  it('counts the rows a removed choice would switch off, and says they survive', async () => {
    const user = userEvent.setup()
    renderEdit()
    await form(copy.editTitle)

    const colours = within(
      screen.getByRole('group', { name: copy.options.legend.replace('{index}', '1') }),
    )
    await user.click(
      colours.getByRole('button', { name: copy.options.removeValueLabel.replace('{index}', '3') }),
    )

    expect(await screen.findByText(copy.diff.deactivated.replace('{count}', '4'))).toBeVisible()
    expect(screen.getByText(copy.diff.deactivatedHint)).toBeVisible()
  })

  it('offers no way to change the axes themselves, and says why (F7b)', async () => {
    renderEdit()
    await form(copy.editTitle)

    expect(screen.getByText(copy.options.lockedNotice)).toBeVisible()
    // A control that could be pressed and always failed would be worse than
    // none (TASK-0018 4.5): the API refuses an axis change as a 400.
    expect(screen.queryByRole('button', { name: copy.options.addLabel })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: copy.options.removeLabel })).not.toBeInTheDocument()
  })
})

describe('saving', () => {
  it('stores a draft with a required attribute still empty (F5)', async () => {
    const user = userEvent.setup()
    renderNew()
    await form(copy.newTitle)

    await user.type(screen.getByRole('textbox', { name: /상품명/ }), '캐시미어 머플러')
    await chooseCategory(user, COAT)
    await screen.findByRole('textbox', { name: /브랜드/ })

    const bulk = within(screen.getByRole('group', { name: copy.variants.bulkTitle }))
    await user.type(bulk.getByLabelText(copy.variants.priceHeader), '49000')

    await user.click(screen.getByRole('button', { name: copy.actions.saveDraftLabel }))

    expect(await screen.findByText(copy.actions.createdNotice)).toBeVisible()

    const stored = productRowsSnapshot().find((row) => row.name === '캐시미어 머플러')

    expect(stored?.status).toBe('DRAFT')
    expect(stored?.variants).toHaveLength(1)
  })

  it('puts the purchase cap into every variant of the body (F4b)', async () => {
    const user = userEvent.setup()
    renderNew()
    await form(copy.newTitle)

    await user.type(screen.getByRole('textbox', { name: /상품명/ }), '제한 있는 상품')
    await chooseCategory(user, BAGS)

    const bulk = within(screen.getByRole('group', { name: copy.variants.bulkTitle }))
    await user.type(bulk.getByLabelText(copy.variants.priceHeader), '10000')
    await user.type(bulk.getByLabelText(copy.variants.purchaseLimitHeader), '2')
    await user.click(bulk.getByRole('button', { name: copy.variants.bulkApplyLabel }))

    await user.click(screen.getByRole('button', { name: copy.actions.saveDraftLabel }))
    await screen.findByText(copy.actions.createdNotice)

    const stored = productRowsSnapshot().find((row) => row.name === '제한 있는 상품')

    expect(stored?.variants.map((variant) => variant.maxPurchaseQuantity)).toEqual([2])
  })

  it('blocks publishing on an empty required attribute, on the field (F6 · U2)', async () => {
    const user = userEvent.setup()
    renderNew()
    await form(copy.newTitle)

    await user.type(screen.getByRole('textbox', { name: /상품명/ }), '필수 없는 코트')
    await chooseCategory(user, COAT)
    await screen.findByRole('textbox', { name: /브랜드/ })

    const bulk = within(screen.getByRole('group', { name: copy.variants.bulkTitle }))
    await user.type(bulk.getByLabelText(copy.variants.priceHeader), '10000')

    await user.click(screen.getByRole('button', { name: copy.actions.publishLabel }))

    // Under the input it is about, not at the top of the form.
    expect(
      await screen.findByText(copy.attributes.errors.required.replace('{label}', '브랜드')),
    ).toBeVisible()
    expect(productRowsSnapshot().some((row) => row.name === '필수 없는 코트')).toBe(false)
  })

  it('places the server"s own refusal on the same fields (F6b)', async () => {
    const user = userEvent.setup()
    resetProductStore([productDraft])
    renderEdit(DRAFT.id)
    await form(copy.editTitle)
    await screen.findByRole('textbox', { name: /브랜드/ })

    // The draft is missing `fit`, and the browser's copy of the rules would
    // normally catch it — so the box is filled with something the schema
    // accepts and the server still refuses, which is the only way to reach the
    // server's own placement.
    await user.click(screen.getByRole('button', { name: copy.actions.publishLabel }))

    expect(
      await screen.findByText(copy.attributes.errors.required.replace('{label}', '핏')),
    ).toBeVisible()
  })

  it('blocks a second click while the first is still in flight (U3)', async () => {
    const user = userEvent.setup()
    let posts = 0
    testServer.server.events.on('request:start', ({ request }) => {
      if (request.method === 'POST' && request.url.includes('/products')) posts += 1
    })

    renderNew()
    await form(copy.newTitle)
    await user.type(screen.getByRole('textbox', { name: /상품명/ }), '두 번 눌린 상품')
    await chooseCategory(user, BAGS)

    const bulk = within(screen.getByRole('group', { name: copy.variants.bulkTitle }))
    await user.type(bulk.getByLabelText(copy.variants.priceHeader), '10000')

    // Both events before React has re-rendered with `submitting: true`, which
    // is the case a disabled button cannot cover on its own (TASK-0017 4.2).
    const save = screen.getByRole('button', { name: copy.actions.saveDraftLabel })
    fireEvent.click(save)
    fireEvent.click(save)
    // `findAllBy`: Radix mirrors a toast's title into its own announce region,
    // so the sentence is on screen twice by design.
    await screen.findAllByText(copy.actions.createdNotice)

    expect(posts).toBe(1)
  })
})

describe('the images a listing already has', () => {
  it('survives a save that was about something else', async () => {
    const user = userEvent.setup()
    renderEdit()
    await form(copy.editTitle)

    const name = screen.getByRole('textbox', { name: /상품명/ })

    await user.clear(name)
    await user.type(name, '이름만 고친 코트')
    await user.click(screen.getByRole('button', { name: copy.actions.saveLabel }))
    await screen.findAllByText(copy.actions.savedNotice)

    // The upload widget has never heard of the stored gallery, so a screen that
    // sent its answer straight through would delete both photographs on the
    // save that renamed the product.
    expect(
      productRowsSnapshot()
        .find((row) => row.id === STORED.id)
        ?.images.map((image) => image.url),
    ).toEqual(STORED.images.map((image) => image.url))
  })

  it('can be taken out one at a time', async () => {
    const user = userEvent.setup()
    renderEdit()
    await form(copy.editTitle)

    await user.click(
      screen.getByRole('button', {
        name: copy.gallery.removeLabel.replace(
          '{index}',
          copy.gallery.storedLabel.replace('{index}', '1'),
        ),
      }),
    )
    await user.click(screen.getByRole('button', { name: copy.actions.saveLabel }))
    await screen.findAllByText(copy.actions.savedNotice)

    expect(productRowsSnapshot().find((row) => row.id === STORED.id)?.images).toHaveLength(1)
  })
})

describe('a refusal lands where its repair is', () => {
  it('puts a lost optimistic lock in a banner with a way out (F11)', async () => {
    const user = userEvent.setup()
    renderEdit()
    await form(copy.editTitle)

    // Somebody else saves first.
    resetProductStore([{ product: { ...STORED, version: STORED.version + 1 } }])

    await user.click(screen.getByRole('button', { name: copy.actions.saveLabel }))

    expect(await screen.findByText(copy.conflict.title)).toBeVisible()
    expect(screen.getByRole('button', { name: copy.conflict.reloadLabel })).toBeVisible()
    expect(screen.getByRole('button', { name: copy.conflict.overwriteLabel })).toBeVisible()
    // Nothing the seller typed is overwritten by the reload offer (DECISIONS 4).
    expect(screen.getByRole('textbox', { name: /상품명/ })).toHaveValue(STORED.name)
  })

  it('puts the store"s own state in a banner, not on a field (F11)', async () => {
    const user = userEvent.setup()
    testServer.server.use(
      httpFailureOn(
        'patch',
        mockPaths.product,
        403,
        'PRODUCT_SELLER_INACTIVE',
        '스토어가 승인된 뒤에 등록할 수 있어요.',
      ),
    )
    renderEdit()
    await form(copy.editTitle)

    await user.click(screen.getByRole('button', { name: copy.actions.saveLabel }))

    expect(await screen.findByText(messagesFor().errors.PRODUCT_SELLER_INACTIVE)).toBeVisible()
  })

  it('puts a taken SKU above the table, where the column is (F11)', async () => {
    const user = userEvent.setup()
    renderEdit()
    await form(copy.editTitle)

    const skus = screen.getAllByRole('textbox', { name: new RegExp(`${copy.variants.skuHeader}$`) })
    await user.clear(skus[1]!)
    await user.type(skus[1]!, skus[0]!.getAttribute('value') ?? 'LUMICOAT-1')

    await user.click(screen.getByRole('button', { name: copy.actions.saveLabel }))

    const notice = await screen.findByRole('alert')

    expect(within(notice).getByText(copy.variants.noticeTitle)).toBeVisible()
    expect(within(notice).getByText(messagesFor().errors.PRODUCT_SKU_TAKEN)).toBeVisible()
  })

  it('shows a failure that reached nobody as a toast, keeping the input (U6)', async () => {
    const user = userEvent.setup()
    testServer.server.use(networkFailureOn('patch', mockPaths.product))
    renderEdit()
    await form(copy.editTitle)

    const name = screen.getByRole('textbox', { name: /상품명/ })
    await user.clear(name)
    await user.type(name, '고쳐 쓴 이름')
    await user.click(screen.getByRole('button', { name: copy.actions.saveLabel }))

    expect(await screen.findByText(copy.toast.failureTitle)).toBeVisible()
    expect(name).toHaveValue('고쳐 쓴 이름')
  })
})

describe('the preview', () => {
  it('draws the buyer"s layout from what has been typed (F8)', async () => {
    const user = userEvent.setup()
    renderEdit()
    await form(copy.editTitle)

    await user.click(screen.getByRole('button', { name: copy.preview.openLabel }))

    const dialog = await screen.findByRole('dialog', { name: copy.preview.title })

    expect(within(dialog).getByText(STORED.name)).toBeVisible()
    expect(within(dialog).getByText(copy.preview.disclaimer)).toBeVisible()
    // 밀도 STANDARD 고정 — the console has no toggle and the three-step check
    // belongs to the buyer's own detail page (P6 · U4 해당 없음).
    expect(
      within(dialog).getByText(copy.preview.disclaimer).closest('[data-density]'),
    ).toHaveAttribute('data-density', '2')
  })
})
