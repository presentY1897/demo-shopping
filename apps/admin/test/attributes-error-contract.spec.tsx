/**
 * What the attribute console does with a failure (TASK-0117).
 *
 * `attributes-page.spec.tsx` checks that the screen works. This file checks the
 * thing that used to be invisible: **why** it does what it does. Two 409s reach
 * this screen — a key already defined in the lineage, and somebody else's save —
 * and the only things separating them are `error.code` and `details[].field`.
 * Read out of Korean prose instead, both keep working right up until somebody
 * edits a sentence, and no test can see it go wrong because an error is still
 * *shown*.
 *
 * So every case below drives the real screen against the mock API and asserts on
 * **placement and recovery**: which control the message is tied to, which dialog
 * opens, whether a reference is offered. The last block runs the set again with
 * every server sentence replaced by nonsense — the negative control, at the
 * screen.
 */

import { httpFailureOn, MOCK_REQUEST_ID, mockPaths, networkFailureOn } from '@shopping/api-mocks'
import type { ApiFieldError } from '@shopping/shared'
import { createApiClient } from '@shopping/shared'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { UserEvent } from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import AttributesPage from '@/app/attributes/page'
import { messagesFor } from '@/messages'

import { renderWithAuth } from './support/auth'
import { testServer } from './setup'

const { attributes: copy, errors: errorCopy, errorNotice } = messagesFor()

const WOMEN = 1

const otherAdmin = createApiClient({ appId: 'admin', baseUrl: 'http://api.test.invalid' })

/** A sentence the server might send. Every assertion here has to survive it changing. */
const SERVER_PROSE = '서버가 쓴 문장입니다'

async function openConsole(): Promise<void> {
  renderWithAuth(<AttributesPage />)
  await screen.findByRole('table', { name: copy.listLabel })
}

async function choose(user: UserEvent, comboboxName: string, option: string): Promise<void> {
  await user.click(screen.getByRole('combobox', { name: comboboxName }))
  await user.click(await screen.findByRole('option', { name: option }))
}

/**
 * The editor panel's `<form>`.
 *
 * Every lookup for an input goes through it, because the preview beside it
 * renders inputs too — with the labels being typed into this one. `아이보리` in
 * the choice list and `이름` in the label box would otherwise both match a field
 * the draft has just produced, and the spec would be asserting against the
 * preview of what it typed.
 */
function editor(): HTMLElement {
  return screen.getByRole('form')
}

const keyInput = (): HTMLElement =>
  within(editor()).getByLabelText(copy.form.keyLabel, { exact: false })
const labelInput = (): HTMLElement =>
  within(editor()).getByLabelText(copy.form.labelLabel, { exact: false })

async function fillNew(
  user: UserEvent,
  values: { key: string; label: string; type?: string },
): Promise<void> {
  await user.click(screen.getByRole('button', { name: copy.actions.add }))
  await screen.findByRole('form')
  await user.type(keyInput(), values.key)
  await user.type(labelInput(), values.label)
  await choose(user, copy.form.typeLabel, values.type ?? copy.typeLabels.TEXT)
  await user.click(screen.getByRole('button', { name: copy.form.save }))
}

async function editBrand(user: UserEvent, label: string): Promise<void> {
  await user.click(screen.getAllByRole('button', { name: copy.actions.edit })[0]!)
  await screen.findByRole('form')
  await user.clear(labelInput())
  await user.type(labelInput(), label)
  await user.click(screen.getByRole('button', { name: copy.form.save }))
}

/** Somebody else saves the first definition of 여성 from their own browser. */
async function otherAdminEdits(label: string): Promise<void> {
  const { attributes } = await otherAdmin.getAttributes({ categoryId: WOMEN })
  const target = attributes[0]

  if (target === undefined) throw new Error('no definition to edit')

  await otherAdmin.updateAttribute(target.id, { version: target.version, label })
}

/** A refusal carrying a code and a field, with a sentence nobody should read. */
function refusal(
  method: 'post' | 'patch',
  path: (typeof mockPaths)[keyof typeof mockPaths],
  status: number,
  code: string,
  detail: ApiFieldError,
) {
  return httpFailureOn(method, path, status, code, SERVER_PROSE, [detail])
}

describe('a key already defined in the lineage', () => {
  it('lands on the key input, in the console’s words, naming the category', async () => {
    const user = userEvent.setup()
    await openConsole()

    // `brand` is defined on 여성 itself, so the API refuses with 409 and says
    // which category holds it.
    await fillNew(user, { key: 'brand', label: '브랜드' })

    const expected = "'여성' 에 같은 이름의 속성이 이미 있어요."
    expect(await screen.findByText(expected)).toBeVisible()
    await waitFor(() => {
      expect(keyInput()).toHaveAccessibleDescription(expect.stringContaining(expected))
    })
    expect(keyInput()).toHaveAttribute('aria-invalid', 'true')
    expect(screen.queryByText(SERVER_PROSE)).not.toBeInTheDocument()
  })

  it('is not placed on any other input', async () => {
    const user = userEvent.setup()
    await openConsole()

    await fillNew(user, { key: 'brand', label: '브랜드' })
    await screen.findByText("'여성' 에 같은 이름의 속성이 이미 있어요.")

    expect(labelInput()).not.toHaveAttribute('aria-invalid', 'true')
  })
})

describe('somebody else saved first', () => {
  it('opens the comparison rather than overwriting silently', async () => {
    const user = userEvent.setup()
    await openConsole()

    await otherAdminEdits('상표')
    await editBrand(user, '내가 쓴 이름')

    const dialog = await screen.findByRole('dialog', { name: copy.conflict.title })
    expect(within(dialog).getByText(/상표/)).toBeVisible()
    expect(within(dialog).getByText(/내가 쓴 이름/)).toBeVisible()
  })

  it('does not tie the conflict to a control nobody typed into', async () => {
    const user = userEvent.setup()
    await openConsole()

    await otherAdminEdits('상표')
    await editBrand(user, '내가 쓴 이름')
    await screen.findByRole('dialog', { name: copy.conflict.title })

    // `details[].field` is `version`, which is not an input. The recovery is the
    // dialog, chosen by code — nothing is marked invalid.
    expect(document.querySelectorAll('[aria-invalid="true"]')).toHaveLength(0)
  })

  it('can drop this edit and take the server’s', async () => {
    const user = userEvent.setup()
    await openConsole()

    await otherAdminEdits('상표')
    await editBrand(user, '내가 쓴 이름')
    const dialog = await screen.findByRole('dialog', { name: copy.conflict.title })
    await user.click(within(dialog).getByRole('button', { name: copy.conflict.reloadLabel }))

    await waitFor(() => {
      expect(labelInput()).toHaveValue('상표')
    })
  })

  it('can overwrite on purpose, and then it sticks', async () => {
    const user = userEvent.setup()
    await openConsole()

    await otherAdminEdits('상표')
    await editBrand(user, '내가 쓴 이름')
    const dialog = await screen.findByRole('dialog', { name: copy.conflict.title })
    await user.click(within(dialog).getByRole('button', { name: copy.conflict.overwriteLabel }))

    expect(await screen.findByText(copy.toast.updated)).toBeVisible()

    const { attributes } = await otherAdmin.getAttributes({ categoryId: WOMEN })
    expect(attributes[0]?.label).toBe('내가 쓴 이름')
  })
})

describe('a refusal about one input, coded by the server', () => {
  it('shows the catalog’s sentence for the code, not the server’s', async () => {
    const user = userEvent.setup()
    await openConsole()

    testServer.server.use(
      refusal('patch', mockPaths.attribute, 400, 'BAD_REQUEST', {
        field: 'label',
        message: SERVER_PROSE,
        code: 'INVALID',
      }),
    )
    await editBrand(user, '다른 이름')

    expect(await screen.findByText(errorCopy.INVALID)).toBeVisible()
    await waitFor(() => {
      expect(labelInput()).toHaveAccessibleDescription(expect.stringContaining(errorCopy.INVALID))
    })
    expect(screen.queryByText(SERVER_PROSE)).not.toBeInTheDocument()
  })

  it('falls back to the server’s sentence for a code it has never heard of', async () => {
    const user = userEvent.setup()
    await openConsole()

    testServer.server.use(
      refusal('patch', mockPaths.attribute, 400, 'BAD_REQUEST', {
        field: 'label',
        message: SERVER_PROSE,
        code: 'ATTRIBUTE_SOMETHING_NEW',
      }),
    )
    await editBrand(user, '다른 이름')

    // Better a server-worded error than a blank one. This is the reason the
    // envelope still carries `message` at all (TASK-0117 4.1).
    expect(await screen.findByText(SERVER_PROSE)).toBeVisible()
  })
})

describe('a refusal that names no input this form owns', () => {
  it('is shown at form level rather than invented onto a control', async () => {
    const user = userEvent.setup()
    await openConsole()

    testServer.server.use(
      httpFailureOn('post', mockPaths.attributes, 400, 'BAD_REQUEST', SERVER_PROSE, [
        '선택한 카테고리가 없어졌어요. 목록을 새로고침해 주세요.',
      ]),
    )
    await fillNew(user, { key: 'origin', label: '원산지' })

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('선택한 카테고리가 없어졌어요')
    expect(keyInput()).not.toHaveAttribute('aria-invalid', 'true')
  })
})

describe('a failure nobody on this screen can fix', () => {
  it('offers the request number, and only then', async () => {
    const user = userEvent.setup()
    await openConsole()

    testServer.server.use(
      httpFailureOn('post', mockPaths.attributes, 500, 'INTERNAL_ERROR', SERVER_PROSE),
    )
    await fillNew(user, { key: 'origin', label: '원산지' })

    expect(await screen.findByText(errorNotice.title)).toBeVisible()
    expect(screen.getByText(MOCK_REQUEST_ID)).toBeVisible()
    expect(screen.getByText(errorCopy.INTERNAL_ERROR)).toBeVisible()
  })

  it('offers no number when there was no answer to take one from', async () => {
    const user = userEvent.setup()
    await openConsole()

    testServer.server.use(networkFailureOn('post', mockPaths.attributes))
    await fillNew(user, { key: 'origin', label: '원산지' })

    expect(await screen.findByText(copy.failures.network)).toBeVisible()
    expect(screen.queryByText(MOCK_REQUEST_ID)).not.toBeInTheDocument()
    expect(screen.queryByText(errorNotice.requestIdLabel)).not.toBeInTheDocument()
  })

  it('says so on the list too, with somewhere to go', async () => {
    testServer.server.use(
      httpFailureOn('get', mockPaths.attributes, 500, 'INTERNAL_ERROR', SERVER_PROSE),
    )
    renderWithAuth(<AttributesPage />)

    expect(await screen.findByText(copy.errorTitle)).toBeVisible()
    expect(screen.getByText(MOCK_REQUEST_ID)).toBeVisible()
    expect(screen.getByRole('button', { name: copy.retryLabel })).toBeVisible()
  })
})

/**
 * F3's negative control, at the screen.
 *
 * Every sentence the server sends is replaced with the same nonsense string. If
 * any decision below were reading prose, it would change; none of them do,
 * because all of them read `code` and `field`.
 */
describe('with every server sentence rewritten', () => {
  it('still puts a taken key under the key input', async () => {
    const user = userEvent.setup()
    await openConsole()

    testServer.server.use(
      refusal('post', mockPaths.attributes, 409, 'ATTRIBUTE_KEY_TAKEN', {
        field: 'key',
        message: SERVER_PROSE,
        code: 'ATTRIBUTE_KEY_TAKEN',
        params: { name: '여성' },
      }),
    )
    await fillNew(user, { key: 'origin', label: '원산지' })

    await waitFor(() => {
      expect(keyInput()).toHaveAccessibleDescription(
        expect.stringContaining("'여성' 에 같은 이름의 속성이 이미 있어요."),
      )
    })
  })

  it('still opens the comparison for a version conflict', async () => {
    const user = userEvent.setup()
    await openConsole()

    testServer.server.use(
      refusal('patch', mockPaths.attribute, 409, 'ATTRIBUTE_VERSION_CONFLICT', {
        field: 'version',
        message: SERVER_PROSE,
        code: 'ATTRIBUTE_VERSION_CONFLICT',
      }),
    )
    await editBrand(user, '내가 쓴 이름')

    expect(await screen.findByRole('dialog', { name: copy.conflict.title })).toBeVisible()
    expect(screen.queryByText(SERVER_PROSE)).not.toBeInTheDocument()
  })

  it('still keeps a taken key off the label input', async () => {
    const user = userEvent.setup()
    await openConsole()

    testServer.server.use(
      refusal('post', mockPaths.attributes, 409, 'ATTRIBUTE_KEY_TAKEN', {
        field: 'key',
        message: SERVER_PROSE,
        code: 'ATTRIBUTE_KEY_TAKEN',
        params: { name: '여성' },
      }),
    )
    await fillNew(user, { key: 'origin', label: '원산지' })
    await screen.findByText("'여성' 에 같은 이름의 속성이 이미 있어요.")

    expect(labelInput()).not.toHaveAttribute('aria-invalid', 'true')
  })
})
