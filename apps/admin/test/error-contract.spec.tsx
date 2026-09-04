/**
 * What the console does with a failure (TASK-0117).
 *
 * `categories-page.spec.tsx` checks that the screen works. This file checks the
 * one thing that used to be invisible: **why** it does what it does. Three 409s
 * used to be one `CONFLICT`, and the screen told them apart by reading Korean
 * prose and by remembering which HTTP method it had sent — both of which keep
 * working right up until somebody edits a sentence, and neither of which any
 * test could see going wrong, because an error was still shown either way.
 *
 * So every case below drives the real screen against the mock API and asserts on
 * *placement and recovery*: which control the message lands under, which dialog
 * opens, whether a reference is offered. The last block runs the whole set again
 * with every server sentence rewritten — F3's negative control, at the screen.
 */

import { httpFailureOn, MOCK_REQUEST_ID, mockPaths, resetCategoryStore } from '@shopping/api-mocks'
import type { CategoryTreeNode } from '@shopping/shared'
import { createApiClient } from '@shopping/shared'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import CategoriesPage from '@/app/categories/page'
import { messagesFor } from '@/messages'

import { renderWithAuth } from './support/auth'
import { testServer } from './setup'

const { categories: copy, errors: errorCopy, errorNotice } = messagesFor()

const otherAdmin = createApiClient({ appId: 'admin', baseUrl: 'http://api.test.invalid' })

function flatten(nodes: readonly CategoryTreeNode[]): CategoryTreeNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)])
}

async function openConsole(): Promise<void> {
  renderWithAuth(<CategoriesPage />)
  await screen.findByRole('tree', { name: copy.treeLabel })
}

function item(name: string): HTMLElement {
  const found = screen.getAllByRole('treeitem').find((node) => node.textContent?.startsWith(name))

  if (found === undefined) throw new Error(`no tree item named ${name}`)

  return found
}

async function otherAdminEdits(id: number, name: string): Promise<void> {
  const { nodes } = await otherAdmin.getCategoryTree({ includeInactive: true })
  const target = flatten(nodes).find((node) => node.id === id)

  if (target === undefined) throw new Error(`no category ${String(id)}`)

  await otherAdmin.updateCategory(id, { version: target.version, name })
}

const nameInput = (): HTMLElement => screen.getByLabelText(copy.form.nameLabel, { exact: false })
const slugInput = (): HTMLElement =>
  screen.getByLabelText(copy.form.slugFieldLabel, { exact: false })

/** Opens 최상위 추가 and fills both fields. */
async function addRoot(user: ReturnType<typeof userEvent.setup>, name: string, slug: string) {
  await user.click(screen.getByRole('button', { name: copy.actions.addRoot }))
  await user.type(nameInput(), name)
  await user.type(slugInput(), slug)
  await user.click(screen.getByRole('button', { name: copy.form.save }))
}

beforeEach(() => {
  resetCategoryStore()
})

describe('an error lands on the control it is about, and takes focus (F4)', () => {
  it('moves focus to the first field the schema objected to', async () => {
    const user = userEvent.setup()
    await openConsole()

    await user.click(screen.getByRole('button', { name: copy.actions.addRoot }))
    await user.click(screen.getByRole('button', { name: copy.form.save }))

    expect(await screen.findByText(copy.form.errors.nameRequired)).toBeVisible()
    expect(nameInput()).toHaveFocus()
  })

  it('moves focus to the field the *server* objected to', async () => {
    const user = userEvent.setup()
    await openConsole()

    // A slug this form accepts and the API refuses — the only way a server
    // field error reaches this dialog at all.
    await addRoot(user, '여성복', 'women')

    expect(await screen.findByText(errorCopy.CATEGORY_SLUG_TAKEN)).toBeVisible()
    expect(slugInput()).toHaveFocus()
  })

  it('describes the input by its own message, not by a line above the form', async () => {
    const user = userEvent.setup()
    await openConsole()

    await addRoot(user, '여성복', 'women')
    await screen.findByText(errorCopy.CATEGORY_SLUG_TAKEN)

    // `aria-describedby` is what makes the message part of the control for a
    // screen reader; a sentence merely rendered nearby is not (TASK-0017 규약).
    expect(slugInput().getAttribute('aria-describedby')).not.toBeNull()
    expect(slugInput()).toHaveAccessibleDescription(
      new RegExp(errorCopy.CATEGORY_SLUG_TAKEN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    )
    expect(slugInput()).toHaveAttribute('aria-invalid', 'true')
  })
})

describe('each code gets its own recovery (F5)', () => {
  it('a taken address becomes a message under the address field', async () => {
    const user = userEvent.setup()
    await openConsole()

    await addRoot(user, '여성복', 'women')

    const dialog = await screen.findByRole('dialog')

    // The dialog stays open — the operator's next act is to edit the field that
    // is now marked, and closing it would throw away what they typed.
    expect(within(dialog).getByText(errorCopy.CATEGORY_SLUG_TAKEN)).toBeVisible()
    expect(within(dialog).queryByText(copy.conflict.title)).toBeNull()
  })

  it("somebody else's edit becomes the comparison dialog", async () => {
    const user = userEvent.setup()
    await openConsole()

    const id = Number(item('신발').dataset.categoryId)
    await user.click(item('신발'))
    await user.click(screen.getByRole('button', { name: copy.actions.edit }))
    await otherAdminEdits(id, '슈즈')

    await user.clear(nameInput())
    await user.type(nameInput(), '풋웨어')
    await user.click(screen.getByRole('button', { name: copy.form.save }))

    const dialog = await screen.findByRole('dialog')

    expect(within(dialog).getByText(copy.conflict.title)).toBeVisible()
    // Both sides, so the operator can see what overwriting would cost.
    expect(within(dialog).getByText('슈즈')).toBeVisible()
    expect(within(dialog).getByText('풋웨어')).toBeVisible()
  })

  it('a category the server will not delete becomes the deactivate-instead dialog', async () => {
    const user = userEvent.setup()
    await openConsole()

    // A leaf, so the console lets the delete be attempted and the *server* is
    // what refuses it. That is the path F5 is about: the screen choosing a
    // recovery from what came back, not from what it knew beforehand.
    testServer.server.use(
      httpFailureOn(
        'delete',
        mockPaths.category,
        409,
        'CATEGORY_HAS_CHILDREN',
        '하위 카테고리를 먼저 옮기거나 삭제해 주세요.',
      ),
    )

    await user.click(item('로퍼'))
    await user.click(screen.getByRole('button', { name: copy.actions.remove }))
    await user.click(await screen.findByRole('button', { name: copy.retire.confirmRemove }))

    const dialog = await screen.findByRole('dialog')

    expect(within(dialog).getByText(copy.retire.removeBlockedTitle)).toBeVisible()
    expect(
      within(dialog).getByRole('button', { name: copy.retire.confirmDeactivate }),
    ).toBeVisible()
  })

  it('a failure only we can fix becomes a reference, not an instruction', async () => {
    testServer.server.use(
      httpFailureOn('get', mockPaths.categories, 500, 'INTERNAL_ERROR', '서버 내부 오류'),
    )
    renderWithAuth(<CategoriesPage />)

    const alert = await screen.findByRole('alert')

    expect(within(alert).getByText(errorCopy.INTERNAL_ERROR, { exact: false })).toBeVisible()
    expect(within(alert).getByLabelText(errorNotice.requestIdLabel)).toHaveTextContent(
      MOCK_REQUEST_ID,
    )
  })

  it('offers no reference for a failure the operator can act on', async () => {
    const user = userEvent.setup()
    await openConsole()

    await addRoot(user, '여성복', 'women')
    await screen.findByText(errorCopy.CATEGORY_SLUG_TAKEN)

    // A UUID beside "다른 주소를 입력해 주세요" is noise, and it suggests the
    // problem is ours when it is theirs to fix (TASK-0117 R2).
    expect(screen.queryByText(MOCK_REQUEST_ID)).toBeNull()
  })
})

describe('the number on screen is the number the API sent (F6)', () => {
  it('shows the id from the response, and copies it', async () => {
    const user = userEvent.setup()
    testServer.server.use(
      httpFailureOn('get', mockPaths.categories, 500, 'INTERNAL_ERROR', '서버 내부 오류'),
    )
    renderWithAuth(<CategoriesPage />)

    const alert = await screen.findByRole('alert')
    const shown = within(alert).getByLabelText(errorNotice.requestIdLabel).textContent

    // The value the API put on `x-request-id`, verbatim — that is the whole
    // contract. A number the screen invented would match nothing in any log.
    expect(shown).toBe(MOCK_REQUEST_ID)

    const copied: string[] = []
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (text: string) => {
          copied.push(text)
          return Promise.resolve()
        },
      },
    })

    await user.click(within(alert).getByRole('button', { name: errorNotice.copyLabel }))

    expect(copied).toEqual([MOCK_REQUEST_ID])
    Reflect.deleteProperty(globalThis.navigator, 'clipboard')
  })

  it('says what happened without a reference when there was no response at all', async () => {
    testServer.server.use(
      httpFailureOn('get', mockPaths.categories, 403, 'FORBIDDEN', '권한이 없습니다'),
    )
    renderWithAuth(<CategoriesPage />)

    const alert = await screen.findByRole('alert')

    expect(within(alert).getByText(errorCopy.FORBIDDEN, { exact: false })).toBeVisible()
    expect(within(alert).queryByLabelText(errorNotice.requestIdLabel)).toBeNull()
  })
})

describe('details without a code still work (F9)', () => {
  it('shows a plain-string refusal rather than swallowing it', async () => {
    const user = userEvent.setup()
    await openConsole()

    // What an endpoint that has not been given codes yet still sends.
    testServer.server.use(
      httpFailureOn(
        'post',
        mockPaths.categories,
        400,
        'BAD_REQUEST',
        '요청 형식이 올바르지 않습니다.',
        ['선택한 카테고리가 없어졌어요. 목록을 새로고침해 주세요.'],
      ),
    )

    await addRoot(user, '리빙', 'living')

    // Nothing threw, and the failure reached the operator — as the envelope's
    // own sentence, since no field was named.
    expect(await screen.findByText(errorCopy.BAD_REQUEST, { exact: false })).toBeVisible()
  })
})

describe('내부 식별자가 화면에 나오지 않는다 (F7)', () => {
  /**
   * Words that mean something to us and nothing to an operator.
   *
   * Checked over the whole catalog rather than over a rendered screen: the
   * screen only shows the sentences it happens to hit, and the one that leaks is
   * always the one nobody opened.
   */
  const INTERNAL = [
    /slug/i,
    /orderedIds/i,
    /parentId/i,
    /categoryId/i,
    /엔드포인트/,
    /퍼미션/,
    /버전/,
    /version/i,
    /\bAPI\b/,
    /HTTP/i,
    /\b(4|5)\d\d\b/,
    /null|undefined/i,
    /[a-z]+\.[a-z]+\(/i,
  ]

  it.each(Object.entries(errorCopy))('%s says nothing internal', (_code, sentence) => {
    for (const pattern of INTERNAL) expect(sentence).not.toMatch(pattern)
  })

  it.each(Object.entries(copy.failures))('%s says nothing internal', (_reason, sentence) => {
    for (const pattern of INTERNAL) expect(sentence).not.toMatch(pattern)
  })

  it('was actually reading a catalog', () => {
    // A renamed slice would make every case above vacuous.
    expect(Object.keys(errorCopy).length).toBeGreaterThan(15)
  })
})

describe('문구를 바꿔도 복구 수단 선택이 유지된다 (F3)', () => {
  /**
   * The three 409s, worded as nothing anybody would pattern-match on.
   *
   * Same codes, same fields, same statuses — only the prose is unrecognisable.
   * If the screen still opens the right dialog and marks the right input, then
   * nothing it does depends on the words, which is what F3 asks.
   */
  const REWORDED = {
    slugTaken: '그 주소는 이미 쓰이고 있어요.',
    hasChildren: '아래에 남아 있는 항목이 있어요.',
  }

  it('still marks the address field when the sentence is unrecognisable', async () => {
    const user = userEvent.setup()
    await openConsole()

    testServer.server.use(
      httpFailureOn('post', mockPaths.categories, 409, 'CATEGORY_SLUG_TAKEN', REWORDED.slugTaken, [
        { field: 'slug', message: REWORDED.slugTaken, code: 'CATEGORY_SLUG_TAKEN' },
      ]),
    )

    await addRoot(user, '리빙', 'living')

    expect(await screen.findByText(errorCopy.CATEGORY_SLUG_TAKEN)).toBeVisible()
    expect(slugInput()).toHaveFocus()
    // And the server's own wording never reaches the screen.
    expect(screen.queryByText(REWORDED.slugTaken)).toBeNull()
  })

  it('still offers deactivation when the delete refusal is unrecognisable', async () => {
    const user = userEvent.setup()
    await openConsole()

    testServer.server.use(
      httpFailureOn(
        'delete',
        mockPaths.category,
        409,
        'CATEGORY_HAS_CHILDREN',
        REWORDED.hasChildren,
      ),
    )

    await user.click(item('로퍼'))
    await user.click(screen.getByRole('button', { name: copy.actions.remove }))
    await user.click(await screen.findByRole('button', { name: copy.retire.confirmRemove }))

    const dialog = await screen.findByRole('dialog')

    expect(within(dialog).getByText(copy.retire.removeBlockedTitle)).toBeVisible()
  })

  it('still opens the comparison dialog when the conflict sentence is unrecognisable', async () => {
    const user = userEvent.setup()
    await openConsole()

    const id = Number(item('신발').dataset.categoryId)
    await user.click(item('신발'))
    await user.click(screen.getByRole('button', { name: copy.actions.edit }))
    await otherAdminEdits(id, '슈즈')

    testServer.server.use(
      httpFailureOn(
        'patch',
        mockPaths.category,
        409,
        'CATEGORY_VERSION_CONFLICT',
        '먼저 저장된 내용이 있어요.',
        [
          {
            field: 'version',
            message: '먼저 저장된 내용이 있어요.',
            code: 'CATEGORY_VERSION_CONFLICT',
          },
        ],
      ),
    )

    await user.clear(nameInput())
    await user.type(nameInput(), '풋웨어')
    await user.click(screen.getByRole('button', { name: copy.form.save }))

    await waitFor(() => {
      expect(screen.getByText(copy.conflict.title)).toBeVisible()
    })
  })
})
