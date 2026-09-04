/**
 * axe over 입점 신청 · 스토어 설정, in every state the screen can be in
 * (QUALITY-GATES 2장 P2).
 *
 * `packages/ui` runs the same engine over every story, but a set of accessible
 * components is not an accessible screen: the field wiring
 * (`aria-describedby` to a hint *and* an error), the live region beside the
 * brand name, the status banner's heading and the conflict alert only exist once
 * they are assembled here. This is the gate for the assembly.
 *
 * The rule set is `apps/admin/test/categories-a11y.spec.tsx`'s, restated for the
 * same reason it restates `packages/ui/stories/support/a11y.ts`: the package's
 * `exports` map does not reach into `stories/`. Keeping the three in step is
 * worth a note; inventing a different bar would not be.
 */

import {
  httpFailure,
  mockPaths,
  resetSellerStore,
  sellerActive,
  sellerPending,
  sellerRejected,
  sellerSuspended,
} from '@shopping/api-mocks'
import type { Seller } from '@shopping/shared'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import type { RunOptions } from 'axe-core'
import { describe, expect, it } from 'vitest'

import ApplyPage from '@/app/apply/page'
import SettingsPage from '@/app/settings/page'
import { messagesFor } from '@/messages'

import { testServer } from './setup'

const { store: copy } = messagesFor()

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

describe('the application screen has no accessibility violations', () => {
  it('while the store is being read', async () => {
    render(<ApplyPage />)

    await expectNoViolations()
  })

  it('with an empty application form', async () => {
    render(<ApplyPage />)
    await screen.findByRole('form', { name: copy.applyTitle })

    await expectNoViolations()
  })

  it.each([
    ['PENDING', sellerPending],
    ['REJECTED', sellerRejected],
    ['ACTIVE', sellerActive],
    ['SUSPENDED', sellerSuspended],
  ])('with a %s store', async (_status, seed: Seller) => {
    resetSellerStore(seed)
    render(<ApplyPage />)
    await screen.findByRole('form', { name: copy.applyTitle })

    await expectNoViolations()
  })

  it('when the read failed', async () => {
    testServer.server.use(httpFailure(mockPaths.sellerMe, 500, 'INTERNAL_ERROR', '서버 오류'))
    render(<ApplyPage />)
    await screen.findByRole('alert')

    await expectNoViolations()
  })

  it('with a message under a field', async () => {
    const user = userEvent.setup()
    render(<ApplyPage />)
    await screen.findByRole('form', { name: copy.applyTitle })

    // The state the wiring exists for: a hint *and* an error described by the
    // same control, which is where `aria-describedby` gets a list rather than a
    // single id.
    await user.click(screen.getByRole('button', { name: copy.form.applyLabel }))
    await screen.findByText(copy.form.errors.brandNameRequired)

    await expectNoViolations()
  })
})

describe('the settings screen has no accessibility violations', () => {
  it('with a store to edit', async () => {
    resetSellerStore(sellerActive)
    render(<SettingsPage />)
    await screen.findByRole('form', { name: /스토어 설정/ })

    await expectNoViolations()
  })

  it('with nothing to edit yet', async () => {
    render(<SettingsPage />)
    await screen.findByText(copy.absent.title)

    await expectNoViolations()
  })

  it('while a save conflict is being resolved', async () => {
    const user = userEvent.setup()
    resetSellerStore(sellerActive)
    render(<SettingsPage />)
    await screen.findByRole('form', { name: /스토어 설정/ })

    resetSellerStore({ ...sellerActive, version: sellerActive.version + 1 })
    await user.click(screen.getByRole('button', { name: copy.form.saveLabel }))
    await screen.findByText(copy.conflict.title)

    await expectNoViolations()
  })
})
