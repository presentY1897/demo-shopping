/**
 * axe over 상품 등록 · 수정, in every state the screen can be in
 * (QUALITY-GATES 2장 P2, TASK-0114 4장).
 *
 * **This is the gate, and it is a substitute.** The screen cannot be opened in
 * a browser — the only sign-in path is Google OAuth and the demo account is
 * TASK-0024 — so Lighthouse cannot be run against it. TASK-0109 · 0110 · 0112
 * all hit the same wall and all measured accessibility by running the same
 * engine over the assembled screen instead. This does the same, and the TASK's
 * 4장 records it.
 *
 * **A set of accessible components is not an accessible screen.**
 * `packages/ui` runs axe over every story, but the field wiring
 * (`aria-describedby` to a hint *and* an error), the option editor's nested
 * fieldsets, the variant table's row headers and named cells, the diff notice's
 * live region and the preview dialog only exist once they are assembled here.
 *
 * The rule set is `apps/seller/test/store-a11y.spec.tsx`'s, restated for the
 * reason that file restates `packages/ui/stories/support/a11y.ts`: the
 * package's `exports` map does not reach into `stories/`. Keeping the three in
 * step is worth a note; inventing a different bar would not be.
 */

import {
  httpFailure,
  httpFailureOn,
  mockPaths,
  productDraft,
  productWithOptions,
  resetProductStore,
} from '@shopping/api-mocks'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import type { RunOptions } from 'axe-core'
import { describe, expect, it } from 'vitest'

import { ProductEditor } from '@/components/products/product-editor'
import { messagesFor } from '@/messages'

import { testServer } from './setup'
import { renderWithAuth } from './support/auth'

const copy = messagesFor().products
const STORED = productWithOptions.product

const OPTIONS: RunOptions = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] },
  rules: {
    // jsdom paints nothing, so axe cannot decide contrast. `packages/ui`
    // converts the OKLCH palette and fails below 4.5:1 over more pairs than a
    // screen would exercise.
    'color-contrast': { enabled: false },
    // The document shell — lang, title — belongs to `app/layout.tsx`, which is
    // not rendered here.
    'html-has-lang': { enabled: false },
    'document-title': { enabled: false },
    // The console's `<main>` is the shell's, and the shell is not in this tree.
    region: { enabled: false },
  },
}

async function expectNoViolations(): Promise<void> {
  const results = await axe.run(document.body, OPTIONS)

  expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([])
}

function renderEdit(id: string = STORED.id) {
  return renderWithAuth(<ProductEditor productId={id} title={copy.editTitle} />)
}

function renderNew() {
  return renderWithAuth(<ProductEditor productId={null} title={copy.newTitle} />)
}

describe('the editor has no accessibility violations', () => {
  it('while the listing is being read', async () => {
    renderEdit()

    await expectNoViolations()
  })

  it('with an empty registration form and no category chosen', async () => {
    renderNew()
    await screen.findByRole('form', { name: copy.newTitle })

    await expectNoViolations()
  })

  it('when the id names no listing', async () => {
    renderEdit('019596d0-1f1c-7c2e-9a0e-000000000000')
    await screen.findByText(copy.missing.title)

    await expectNoViolations()
  })

  it('when the read failed', async () => {
    testServer.server.use(httpFailure(mockPaths.product, 500, 'INTERNAL_ERROR', '서버 오류'))
    renderEdit()
    await screen.findByText(copy.failure.title)

    await expectNoViolations()
  })

  it('with a full listing loaded — generated fields, options, table, diff', async () => {
    renderEdit()
    await screen.findByRole('form', { name: copy.editTitle })

    // The state everything is wired in: six generated fields over five control
    // types, two axes of nested fieldsets, twelve named rows and a live region.
    expect(screen.getAllByTestId('variant-row')).toHaveLength(12)
    await expectNoViolations()
  })

  it('with a draft whose category asks for nothing extra', async () => {
    resetProductStore([productDraft])
    renderEdit(productDraft.product.id)
    await screen.findByRole('form', { name: copy.editTitle })

    await expectNoViolations()
  })

  it('with a message under a generated field', async () => {
    const user = userEvent.setup()
    resetProductStore([productDraft])
    renderEdit(productDraft.product.id)
    await screen.findByRole('form', { name: copy.editTitle })

    // The state the wiring exists for: a hint *and* an error described by the
    // same control, which is where `aria-describedby` gets a list rather than a
    // single id.
    await user.click(screen.getByRole('button', { name: copy.actions.publishLabel }))
    await screen.findByText(copy.attributes.errors.required.replace('{label}', '핏'))

    await expectNoViolations()
  })

  it('with a refusal above the variant table', async () => {
    const user = userEvent.setup()
    testServer.server.use(
      httpFailureOn('patch', mockPaths.product, 409, 'PRODUCT_SKU_TAKEN', '이미 쓰고 있는 SKU'),
    )
    renderEdit()
    await screen.findByRole('form', { name: copy.editTitle })

    await user.click(screen.getByRole('button', { name: copy.actions.saveLabel }))
    await screen.findByText(copy.variants.noticeTitle)

    await expectNoViolations()
  })

  it('while a save conflict is being resolved', async () => {
    const user = userEvent.setup()
    renderEdit()
    await screen.findByRole('form', { name: copy.editTitle })

    resetProductStore([{ product: { ...STORED, version: STORED.version + 1 } }])
    await user.click(screen.getByRole('button', { name: copy.actions.saveLabel }))
    await screen.findByText(copy.conflict.title)

    await expectNoViolations()
  })

  it('with the store"s own state blocking the save', async () => {
    const user = userEvent.setup()
    testServer.server.use(
      httpFailureOn('patch', mockPaths.product, 403, 'PRODUCT_SELLER_INACTIVE', '승인 대기'),
    )
    renderEdit()
    await screen.findByRole('form', { name: copy.editTitle })

    await user.click(screen.getByRole('button', { name: copy.actions.saveLabel }))
    await screen.findByText(messagesFor().errors.PRODUCT_SELLER_INACTIVE)

    await expectNoViolations()
  })

  it('with the preview open', async () => {
    const user = userEvent.setup()
    renderEdit()
    await screen.findByRole('form', { name: copy.editTitle })

    await user.click(screen.getByRole('button', { name: copy.preview.openLabel }))

    const dialog = await screen.findByRole('dialog', { name: copy.preview.title })

    expect(within(dialog).getByText(STORED.name)).toBeVisible()
    await expectNoViolations()
  })
})
