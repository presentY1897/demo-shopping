/**
 * axe over `/claims`, `/claims/[id]` and the dashboard panel, in every state
 * they can be in.
 *
 * `packages/ui` runs the same engine over every story
 * (`packages/ui/test/story-a11y.spec.tsx`) — but components that are accessible
 * on their own are not a screen that is accessible: the table's row headers, the
 * filter's names, the tabs' panels, the dialog's focus trap and **the notes that
 * replaced this screen's disabled buttons** only exist once they are assembled
 * here. This is the gate for the assembly, and for this TASK it is **the** gate —
 * P2 is the one performance-adjacent check QUALITY-GATES 2장 kept, because it is
 * cheap and has caught regressions (D-217).
 *
 * The notes are the reason this file matters more than usual here. A sentence
 * that replaces a control has to be *reachable and announced* — that is the
 * whole argument for preferring it to `aria-disabled` — and a `role="note"` in
 * the wrong place is exactly as silent as the tooltip it replaced.
 */

import {
  adminClaimHandlers,
  adminClaimRowsSnapshot,
  httpFailureOn,
  MOCK_ADMIN_CLAIMABLE_IDS,
  mockPaths,
  networkFailureOn,
  sessionDemoAdmin,
} from '@shopping/api-mocks'
import type { AdminClaimListItem } from '@shopping/shared'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import type { RunOptions } from 'axe-core'
import { beforeEach, describe, expect, it } from 'vitest'

import ClaimsPage from '@/app/claims/page'
import HomePage from '@/app/page'
import { ClaimDetailWorkspace } from '@/components/claims/claim-detail-workspace'
import { messagesFor } from '@/messages'

import { renderWithAuth } from './support/auth'
import { testServer } from './setup'

const { claims: copy, errors, errorNotice } = messagesFor()
const detail = copy.detail

/**
 * The rule set, restated rather than imported.
 *
 * `sellers-a11y.spec.tsx`, `categories-a11y.spec.tsx` and
 * `attributes-a11y.spec.tsx` hold the same list; `packages/ui`'s copy lives
 * behind an `exports` map that does not reach into `stories/`. Keeping the four
 * in step is worth a note in the report; inventing a different bar would not be.
 */
const OPTIONS: RunOptions = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] },
  rules: {
    // jsdom paints nothing, so axe cannot decide contrast.
    'color-contrast': { enabled: false },
    // The document shell — lang, title — belongs to `app/layout.tsx`.
    'html-has-lang': { enabled: false },
    'document-title': { enabled: false },
    // Dialogs and toasts render through portals, outside this page's `<main>`.
    region: { enabled: false },
  },
}

async function expectNoViolations(): Promise<void> {
  const results = await axe.run(document.body, OPTIONS)

  expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([])
}

beforeEach(() => {
  testServer.server.use(...adminClaimHandlers)
})

function claimWhere(match: (row: AdminClaimListItem) => boolean): AdminClaimListItem {
  const row = adminClaimRowsSnapshot().find(match)

  if (row === undefined) throw new Error('the mock store holds no such claim')

  return row
}

async function openList(): Promise<void> {
  renderWithAuth(<ClaimsPage />)
  await screen.findByRole('table', { name: copy.list.listLabel })
}

async function openDetail(
  claim: AdminClaimListItem,
  session?: typeof sessionDemoAdmin,
): Promise<void> {
  renderWithAuth(
    <ClaimDetailWorkspace
      claimId={claim.id}
      errors={errors}
      messages={copy}
      notice={errorNotice}
    />,
    session === undefined ? {} : { session },
  )

  await screen.findByText(detail.subtitle.replace('{orderNumber}', claim.orderNumber))
}

/** 판매자 심사 화면이 같은 이유로 같은 예산을 쓴다 — 이 파일의 검사는 화면 전체다. */
const A11Y_TIMEOUT = { timeout: 20_000 } as const

describe('the claim console has no accessibility violations', A11Y_TIMEOUT, () => {
  it('while the queue is loading', async () => {
    renderWithAuth(<ClaimsPage />)

    await expectNoViolations()
  })

  it('when the queue has arrived', async () => {
    await openList()

    await expectNoViolations()
  })

  it('when the API refused the queue', async () => {
    testServer.server.use(networkFailureOn('get', mockPaths.adminClaims))
    renderWithAuth(<ClaimsPage />)
    await screen.findByText(copy.list.errorTitle)

    await expectNoViolations()
  })

  it('with the status filter open', async () => {
    const user = userEvent.setup()
    await openList()
    await user.click(screen.getByRole('combobox', { name: copy.list.filters.statusLabel }))
    await screen.findByRole('option', { name: copy.vocabulary.statusLabels.REFUNDED })

    await expectNoViolations()
  })

  it('on the overdue tab', async () => {
    const user = userEvent.setup()
    await openList()
    await user.click(screen.getByRole('tab', { name: new RegExp(copy.list.tabs.overdue) }))
    await screen.findByRole('table', { name: copy.overdue.listLabel })

    await expectNoViolations()
  })

  it('on the failed refund tab', async () => {
    const user = userEvent.setup()
    await openList()
    await user.click(screen.getByRole('tab', { name: new RegExp(copy.list.tabs.failedRefunds) }))
    await screen.findByRole('table', { name: copy.failedRefunds.listLabel })

    await expectNoViolations()
  })

  it('with the demo scope notice up', async () => {
    renderWithAuth(<ClaimsPage />, { session: sessionDemoAdmin })
    await screen.findByText(copy.scope.demoNotice)

    await expectNoViolations()
  })

  it('on the dashboard, where the two attention lists also appear', async () => {
    renderWithAuth(<HomePage />)
    const panel = await screen.findByRole('region', { name: copy.attention.title })
    await within(panel).findByRole('table', { name: copy.overdue.listLabel })

    await expectNoViolations()
  })
})

/**
 * The fourth tab, which is a **form** rather than a list (TASK-0071 F4).
 *
 * It carries everything the other three do not: a text field with its own
 * validation, a checkbox-plus-select row per item, a file input behind a drop
 * zone, and the note that replaces the button when the order cannot be started
 * from. The drop zone in particular is the reason this block exists — a `<div>`
 * with an `onClick` looks identical here and is unreachable from a keyboard.
 */
describe('the confirmed-order defect return has no accessibility violations', A11Y_TIMEOUT, () => {
  const defect = copy.defectReturn

  async function openDefectTab(): Promise<ReturnType<typeof userEvent.setup>> {
    const user = userEvent.setup()

    await openList()
    await user.click(screen.getByRole('tab', { name: defect.title }))
    await screen.findByLabelText(defect.lookup.label, { exact: false })

    return user
  }

  async function find(user: ReturnType<typeof userEvent.setup>, value: string): Promise<void> {
    await user.type(screen.getByLabelText(defect.lookup.label, { exact: false }), value)
    await user.click(screen.getByRole('button', { name: defect.lookup.submit }))
  }

  it('with nothing looked up yet', async () => {
    await openDefectTab()

    await expectNoViolations()
  })

  it('with the form open on a confirmed order', async () => {
    const user = await openDefectTab()

    await find(user, MOCK_ADMIN_CLAIMABLE_IDS.confirmed)
    await screen.findByText(defect.form.found)

    await expectNoViolations()
  })

  /** The sentence that replaced the form. If it is silent, the argument collapses. */
  it('with the form replaced by the sentence that explains it away', async () => {
    const user = await openDefectTab()

    await find(user, MOCK_ADMIN_CLAIMABLE_IDS.shipped)
    await screen.findByText(defect.blocked.state.in_transit)

    await expectNoViolations()
  })

  it('with what is still missing listed under the button', async () => {
    const user = await openDefectTab()

    await find(user, MOCK_ADMIN_CLAIMABLE_IDS.confirmed)
    await screen.findByText(defect.form.found)
    await user.click(screen.getByRole('button', { name: defect.form.submit }))
    await screen.findByText(defect.form.issues.no_items)

    await expectNoViolations()
  })

  it('with the confirmation dialog open', async () => {
    const user = await openDefectTab()

    await find(user, MOCK_ADMIN_CLAIMABLE_IDS.confirmed)
    await screen.findByText(defect.form.found)
    await user.click(screen.getByRole('checkbox', { name: /울 블렌드 코트/u }))
    await user.upload(
      screen.getByLabelText(defect.form.photosDropLabel),
      new File([new Uint8Array([1, 2, 3])], 'defect.png', { type: 'image/png' }),
    )
    await within(await screen.findByRole('list', { name: defect.form.photosListLabel })).findByText(
      defect.form.photoStatus.ready,
    )
    await user.type(
      screen.getByLabelText(defect.form.noteLabel, { exact: false }),
      '솔기 하자를 확인했습니다.',
    )
    await user.click(screen.getByRole('button', { name: defect.form.submit }))
    await screen.findByRole('dialog', { name: defect.confirm.title })

    await expectNoViolations()
  })
})

describe('the claim detail has no accessibility violations', A11Y_TIMEOUT, () => {
  it('with an appeal waiting and both actions offered', async () => {
    await openDetail(claimWhere((row) => row.status === 'CANCEL_REJECTED' && row.appealPending))

    await expectNoViolations()
  })

  /**
   * The note that replaced a disabled button. If this is silent, the argument
   * for preferring a sentence collapses.
   */
  it('with the actions replaced by the sentence that explains them away', async () => {
    await openDetail(claimWhere((row) => row.status === 'REFUNDED'))
    await screen.findByText(detail.blocked.state.settled)

    await expectNoViolations()
  })

  it('with the force dialog open', async () => {
    const user = userEvent.setup()
    await openDetail(claimWhere((row) => row.status === 'CANCEL_REJECTED' && row.appealPending))
    await user.click(screen.getByRole('button', { name: detail.actions.force }))
    await screen.findByRole('dialog', { name: copy.force.title })

    await expectNoViolations()
  })

  /**
   * 반품 거절을 하자로 뒤집는 자리 — **사진 칸이 열린 대화상자**.
   *
   * 끌어 놓는 자리와 붙인 목록이 이름을 갖는지, 그리고 못 보내는 이유를 적은 경고가
   * 실제로 읽히는지가 여기서 갈린다 (`ReturnPhotoField` 는 확정 후 하자 반품 탭과
   * 같은 컴포넌트다).
   */
  it('with the photo box the defect overturn opens', async () => {
    const user = userEvent.setup()
    await openDetail(claimWhere((row) => row.status === 'RETURN_REJECTED' && row.appealPending))
    await user.click(screen.getByRole('button', { name: detail.actions.force }))
    const dialog = await screen.findByRole('dialog', { name: copy.force.title })
    await within(dialog).findByLabelText(copy.defectReturn.form.photosDropLabel)

    await expectNoViolations()
  })

  it('with the sentence that says why the defect overturn cannot be sent', async () => {
    const user = userEvent.setup()
    await openDetail(claimWhere((row) => row.status === 'RETURN_REJECTED' && row.appealPending))
    await user.click(screen.getByRole('button', { name: detail.actions.force }))
    const dialog = await screen.findByRole('dialog', { name: copy.force.title })
    await user.type(
      within(dialog).getByLabelText(copy.force.reasonLabel, { exact: false }),
      '하자가 확인됩니다.',
    )
    await user.click(within(dialog).getByRole('button', { name: copy.force.confirm }))
    await within(dialog).findByText(copy.defectReturn.form.issues.photo_required)

    await expectNoViolations()
  })

  it('with a reason the form refused, under the field', async () => {
    const user = userEvent.setup()
    await openDetail(claimWhere((row) => row.status === 'CANCEL_REJECTED' && row.appealPending))
    await user.click(screen.getByRole('button', { name: detail.actions.force }))
    const dialog = await screen.findByRole('dialog', { name: copy.force.title })
    await user.click(within(dialog).getByRole('button', { name: copy.force.confirm }))
    await within(dialog).findByText(copy.force.errors.reasonRequired)

    await expectNoViolations()
  })

  it('with the appeal dismissal dialog open', async () => {
    const user = userEvent.setup()
    await openDetail(claimWhere((row) => row.status === 'RETURN_REJECTED' && row.appealPending))
    await user.click(screen.getByRole('button', { name: detail.actions.dismissAppeal }))
    await screen.findByRole('dialog', { name: copy.appeal.dismiss.title })

    await expectNoViolations()
  })

  it('after the server refused this particular claim', async () => {
    const user = userEvent.setup()
    await openDetail(
      claimWhere((row) => row.status === 'CANCEL_REJECTED' && row.appealPending),
      sessionDemoAdmin,
    )

    testServer.server.use(
      httpFailureOn('post', mockPaths.adminClaims, 403, 'FORBIDDEN', '권한이 없습니다.'),
    )

    await user.click(screen.getByRole('button', { name: detail.actions.force }))
    const dialog = await screen.findByRole('dialog', { name: copy.force.title })
    await user.type(
      within(dialog).getByLabelText(copy.force.reasonLabel, { exact: false }),
      '개입합니다.',
    )
    await user.click(within(dialog).getByRole('button', { name: copy.force.confirm }))
    await screen.findByText(copy.scope.outOfScope)

    await expectNoViolations()
  })
})
