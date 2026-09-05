/**
 * The editor at three widths, from the keyboard, and with a table the size the
 * cap allows (TASK-0114 P3 · P4 · U5 · F9 · F10).
 *
 * Split from `product-editor.spec.tsx` because these drive one screen many
 * times over — three viewports, two hundred rows — and a file that mixed them
 * with the ordinary paths would make every run pay for it.
 */

import { productWithOptions, resetProductStore } from '@shopping/api-mocks'
import type { Product, ProductResponse } from '@shopping/shared'
import { PRODUCT_MAX_VARIANTS } from '@shopping/shared'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { ProductEditor } from '@/components/products/product-editor'
import { messagesFor } from '@/messages'

import { renderWithAuth } from './support/auth'
import { stubViewport, VIEWPORTS } from './support/viewport'

const copy = messagesFor().products
const STORED = productWithOptions.product

/**
 * The seeded listing rebuilt with three axes of the given widths.
 *
 * Three, because the caps make two impossible to push past: one axis may offer
 * at most `PRODUCT_MAX_OPTION_VALUES` (40) choices, so two axes reach 1,600
 * only in theory and 40 × 40 is already refused a value at a time. The grid a
 * seller actually overshoots with is three modest axes, which is what
 * `PRODUCT_MAX_VARIANTS` exists for (`products.ts`).
 *
 * Built here rather than added to `@shopping/api-mocks` because it is not a
 * shape the API has an opinion about — it is a listing with a bigger grid, and
 * the only thing it exists to measure is what the screen does at that size.
 */
function listingWith(widths: readonly [number, number, number]): ProductResponse {
  const names = ['색상', '사이즈', '핏'] as const
  const options = names.map((name, axis) => ({
    id: `019596d0-1f1c-7c2e-9a0e-a00${String(axis)}00000000`,
    name,
    sortOrder: axis,
    values: Array.from({ length: widths[axis] ?? 0 }, (_unused, index) => ({
      id: `019596d0-1f1c-7c2e-9a0e-b0${String(axis)}${String(index).padStart(9, '0')}`,
      value: `${name[0] ?? 'v'}${String(index)}`,
      meta: null,
      sortOrder: index,
    })),
  }))

  const combinations = options.reduce<(typeof options)[number]['values'][]>(
    (rows, option) => rows.flatMap((prefix) => option.values.map((value) => [...prefix, value])),
    [[]],
  )

  const product: Product = {
    ...STORED,
    maxPurchaseQuantity: null,
    attributes: { brand: '루미에르', fit: '오버핏' },
    options,
    variants: combinations.map((combination, index) => ({
      id: `019596d0-1f1c-7c2e-9a0e-c${String(index).padStart(11, '0')}`,
      sku: `WIDE-${String(index)}`,
      price: 10_000,
      listPrice: null,
      stock: 1,
      availableStock: 1,
      maxPurchaseQuantity: null,
      effectiveMaxPurchaseQuantity: null,
      isActive: true,
      optionValueIds: combination.map((value) => value.id),
    })),
  }

  return { product }
}

function renderEdit() {
  return renderWithAuth(<ProductEditor productId={STORED.id} title={copy.editTitle} />)
}

async function editorForm(): Promise<HTMLElement> {
  return screen.findByRole('form', { name: copy.editTitle })
}

function variantRows(): readonly HTMLElement[] {
  return screen.getAllByTestId('variant-row')
}

const THIRD_AXIS = copy.options.legend.replace('{index}', '3')
const SIZES_AXIS = copy.options.legend.replace('{index}', '2')

describe('P3 — 360 · 768 · 1440', () => {
  it.each([
    ['mobile', VIEWPORTS.mobile],
    ['tablet', VIEWPORTS.tablet],
    ['desktop', VIEWPORTS.desktop],
  ])('draws every section at %s', async (_name, width) => {
    stubViewport(width)
    renderEdit()
    await editorForm()

    // One column at every width: the console has no viewport branch on this
    // screen, and that is the claim rather than an omission.
    expect(screen.getByRole('textbox', { name: /상품명/ })).toBeVisible()
    expect(screen.getByRole('button', { name: copy.preview.openLabel })).toBeVisible()
    expect(variantRows()).toHaveLength(12)

    // The one thing that cannot fit at 360px is the table, and it does not have
    // to: the overflow lives on a named, focusable region rather than on the
    // page, so the document itself never scrolls sideways (TASK-0016 F4b).
    const region = screen.getByRole('region', { name: copy.variants.caption })

    expect(region).toHaveClass('overflow-x-auto')
    expect(region).toHaveAttribute('tabindex', '0')
  })
})

describe('P4 · U5 — the keyboard alone', () => {
  it('reaches the option editor, a table cell and the save button', async () => {
    const user = userEvent.setup()
    renderEdit()
    await editorForm()

    const sizes = within(screen.getByRole('group', { name: SIZES_AXIS }))

    // 값 추가 is reachable and operable without a pointer, and the box it
    // creates takes focus — otherwise a keyboard user has to tab back through
    // every existing choice to reach the one they just asked for.
    const add = sizes.getAllByRole('button', { name: copy.options.addValueLabel })[0]!
    add.focus()
    await user.keyboard('{Enter}')
    await user.keyboard('XXL')

    expect(
      sizes.getByRole('textbox', { name: copy.options.valueLabel.replace('{index}', '5') }),
    ).toHaveValue('XXL')

    // A table cell, named so a screen reader can say which variant it belongs to.
    const cell = screen.getByRole('spinbutton', {
      name: copy.variants.cellLabel
        .replace('{combination}', '블랙 / S')
        .replace('{column}', copy.variants.stockHeader),
    })

    cell.focus()
    await user.keyboard('{Control>}a{/Control}9')
    expect(cell).toHaveValue(9)

    // And the save itself, through the same door a click uses.
    const save = screen.getByRole('button', { name: copy.actions.saveLabel })

    save.focus()
    expect(save).toHaveFocus()
    await user.keyboard('{Enter}')

    expect(await screen.findAllByText(copy.actions.savedNotice)).not.toHaveLength(0)
  })

  it('submits from Enter pressed in a text field, not only from the button', async () => {
    const user = userEvent.setup()
    renderEdit()
    await editorForm()

    const name = screen.getByRole('textbox', { name: /상품명/ })

    name.focus()
    // The browser's implicit submission. `Button.loading` cannot cover it,
    // which is why the guard lives in `useForm` (TASK-0017 4.2).
    await user.keyboard('{Enter}')

    expect(await screen.findAllByText(copy.actions.savedNotice)).not.toHaveLength(0)
  })
})

describe('F9 — past the combination cap', () => {
  beforeEach(() => {
    // 6 × 6 × 5 = 180. One more choice on the third axis takes it to 216, past
    // `PRODUCT_MAX_VARIANTS` — the boundary measured from the side a seller
    // actually crosses it from.
    resetProductStore([listingWith([6, 6, 5])])
  })

  it('says so on the keystroke that crosses it, before anything is sent', async () => {
    const user = userEvent.setup()
    renderEdit()
    await editorForm()

    const fits = within(screen.getByRole('group', { name: THIRD_AXIS }))

    expect(screen.queryByText(copy.options.issues.too_many_variants)).not.toBeInTheDocument()

    await user.click(fits.getAllByRole('button', { name: copy.options.addValueLabel })[0]!)
    await user.type(
      fits.getByRole('textbox', { name: copy.options.valueLabel.replace('{index}', '6') }),
      '핏5',
    )

    expect(screen.getByText(copy.options.issues.too_many_variants)).toBeVisible()
    // The number in the sentence and the number in the count come from the same
    // constant the server refuses with, so the two cannot block different grids.
    expect(
      screen.getByText(
        copy.options.countLabel
          .replace('{count}', '216')
          .replace('{max}', String(PRODUCT_MAX_VARIANTS)),
      ),
    ).toBeVisible()
    // The table keeps what was typed: the axes are one keystroke away from
    // fitting again, and emptying it would take every price with it.
    expect(variantRows()).toHaveLength(180)
  })

  it('refuses the save, above the table the repair is in', async () => {
    const user = userEvent.setup()
    renderEdit()
    await editorForm()

    const fits = within(screen.getByRole('group', { name: THIRD_AXIS }))

    await user.click(fits.getAllByRole('button', { name: copy.options.addValueLabel })[0]!)
    await user.type(
      fits.getByRole('textbox', { name: copy.options.valueLabel.replace('{index}', '6') }),
      '핏5',
    )
    await user.click(screen.getByRole('button', { name: copy.actions.saveLabel }))

    const notices = await screen.findAllByRole('alert')
    const table = notices.find(
      (notice) => within(notice).queryByText(copy.variants.noticeTitle) !== null,
    )

    // The button stays pressable on purpose: a natively disabled submit blocks
    // the browser's implicit submission too, so Enter in a text field would do
    // nothing and say nothing about why (TASK-0018 4.5 · TASK-0109 9장).
    expect(table).toBeDefined()
    expect(within(table!).getByText(copy.options.issues.too_many_variants)).toBeVisible()
  })
})

describe('F10 — the table at the cap', () => {
  beforeEach(() => {
    // 180 rows — near enough to `PRODUCT_MAX_VARIANTS` that a table which
    // re-rendered all of them on every keystroke would be felt.
    resetProductStore([listingWith([6, 6, 5])])
  })

  it('edits one cell without disturbing the other rows', async () => {
    const user = userEvent.setup()
    renderEdit()
    await editorForm()

    const before = variantRows()

    expect(before).toHaveLength(180)

    const cell = screen.getByRole('spinbutton', {
      name: copy.variants.cellLabel
        .replace('{combination}', '색0 / 사0 / 핏0')
        .replace('{column}', copy.variants.priceHeader),
    })

    await user.clear(cell)
    await user.type(cell, '12345')

    const after = variantRows()

    expect(cell).toHaveValue(12_345)
    // Every other row is the same element, holding the same value: the state
    // update replaces one row object and `memo` skips the rest (`patchRow` is
    // pinned to that in `product-variant-rows.spec.ts`).
    expect(after).toHaveLength(before.length)
    expect(after.every((row, index) => row === before[index])).toBe(true)
    expect(
      screen.getByRole('spinbutton', {
        name: copy.variants.cellLabel
          .replace('{combination}', '색0 / 사0 / 핏1')
          .replace('{column}', copy.variants.priceHeader),
      }),
    ).toHaveValue(10_000)
  })
})
