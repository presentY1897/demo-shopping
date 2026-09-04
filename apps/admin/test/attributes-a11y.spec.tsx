/**
 * axe over `/attributes`, in every state it can be in.
 *
 * `packages/ui` runs the same engine over every story
 * (`packages/ui/test/story-a11y.spec.tsx`) — but components that are accessible
 * on their own are not a screen that is accessible: the table's row headers, the
 * choice editor's fieldset, the dialogs' focus traps and the preview's generated
 * labels only exist once they are assembled here. This is the gate for the
 * assembly.
 *
 * P1 (LCP) and P2 (Lighthouse Accessibility) need a real browser and are not
 * claimed by this file; what it claims is that nothing axe can decide
 * structurally is wrong — names, roles, relationships, duplicate ids, and the
 * label/control wiring the form system generates rather than a person writing it.
 */

import { mockPaths, networkFailureOn } from '@shopping/api-mocks'
import { createApiClient } from '@shopping/shared'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { UserEvent } from '@testing-library/user-event'
import axe from 'axe-core'
import type { RunOptions } from 'axe-core'
import { describe, expect, it } from 'vitest'

import AttributesPage from '@/app/attributes/page'
import { messagesFor } from '@/messages'

import { testServer } from './setup'

const { attributes: copy } = messagesFor()

const otherAdmin = createApiClient({ appId: 'admin', baseUrl: 'http://api.test.invalid' })

/**
 * The rule set, restated rather than imported.
 *
 * `categories-a11y.spec.tsx` holds the same list; `packages/ui`'s copy lives
 * behind an `exports` map that does not reach into `stories/`. Keeping the three
 * in step is worth a note in the report; inventing a different bar would not be.
 */
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
    // Dialogs and toasts render through portals, outside this page's `<main>`.
    region: { enabled: false },
  },
}

async function expectNoViolations(): Promise<void> {
  const results = await axe.run(document.body, OPTIONS)

  expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([])
}

async function openConsole(): Promise<void> {
  render(<AttributesPage />)
  await screen.findByRole('table', { name: copy.listLabel })
}

async function choose(user: UserEvent, comboboxName: string, option: string): Promise<void> {
  await user.click(screen.getByRole('combobox', { name: comboboxName }))
  await user.click(await screen.findByRole('option', { name: option }))
}

async function openEditor(user: UserEvent): Promise<void> {
  await user.click(screen.getByRole('button', { name: copy.actions.add }))
  await screen.findByRole('form')
}

describe('the attribute console has no accessibility violations', () => {
  it('while the definitions are loading', async () => {
    testServer.server.use(networkFailureOn('get', mockPaths.categories))
    render(<AttributesPage />)

    await expectNoViolations()
  })

  it('when the definitions have arrived, inherited rows included', async () => {
    const user = userEvent.setup()
    await openConsole()
    await choose(user, copy.categoryLabel, '여성 › 아우터 › 코트')
    await screen.findByText('여성 에서 물려받음')

    await expectNoViolations()
  })

  it('when the category has nothing defined on it', async () => {
    const user = userEvent.setup()
    await openConsole()
    await choose(user, copy.categoryLabel, '신발')
    await screen.findByText(copy.emptyTitle)

    await expectNoViolations()
  })

  it('when the API refused', async () => {
    testServer.server.use(networkFailureOn('get', mockPaths.attributes))
    render(<AttributesPage />)
    await screen.findByText(copy.errorTitle)

    await expectNoViolations()
  })

  it('with the editor open beside the preview', async () => {
    const user = userEvent.setup()
    await openConsole()
    await openEditor(user)

    await expectNoViolations()
  })

  it('with the choice editor showing', async () => {
    const user = userEvent.setup()
    await openConsole()
    await openEditor(user)
    await choose(user, copy.form.typeLabel, copy.typeLabels.SELECT)
    await user.click(await screen.findByRole('button', { name: copy.form.optionAddLabel }))

    await expectNoViolations()
  })

  it('with field errors showing', async () => {
    const user = userEvent.setup()
    await openConsole()
    await openEditor(user)
    await user.click(screen.getByRole('button', { name: copy.form.save }))
    await screen.findByText(copy.form.errors.keyRequired)

    await expectNoViolations()
  })

  it('with the delete confirmation open', async () => {
    const user = userEvent.setup()
    await openConsole()
    await user.click(screen.getAllByRole('button', { name: copy.actions.remove })[0]!)
    await screen.findByRole('dialog')

    await expectNoViolations()
  })

  it('with the version conflict open', async () => {
    const user = userEvent.setup()
    await openConsole()

    const { attributes } = await otherAdmin.getAttributes({ categoryId: 1 })
    await otherAdmin.updateAttribute(attributes[0]!.id, { version: 0, label: '상표' })

    await user.click(screen.getAllByRole('button', { name: copy.actions.edit })[0]!)
    const form = await screen.findByRole('form')
    const input = within(form).getByLabelText(copy.form.labelLabel, { exact: false })
    await user.clear(input)
    await user.type(input, '내가 쓴 이름')
    await user.click(within(form).getByRole('button', { name: copy.form.save }))
    await screen.findByRole('dialog', { name: copy.conflict.title })

    await expectNoViolations()
  })

  it('with a toast announcing a failure', async () => {
    const user = userEvent.setup()
    await openConsole()
    await choose(user, copy.categoryLabel, '여성 › 아우터 › 코트')
    await screen.findByText('여성 에서 물려받음')

    testServer.server.use(networkFailureOn('patch', mockPaths.attribute))
    await user.click(screen.getAllByRole('switch')[0]!)
    await screen.findByText(copy.toast.saveFailed)

    await expectNoViolations()
  })
})
