/**
 * `/categories`, driven the way an administrator drives it.
 *
 * Everything below renders the real page and then clicks or types. No component
 * is given a hand-made prop bag and no class name is asserted on
 * (QUALITY-GATES Q5): what is checked is that pressing a key moves a category,
 * that a refused save is shown rather than swallowed, and that a move the API
 * rejects leaves the tree where it was.
 *
 * The API is `@shopping/api-mocks`, which keeps a real tree — so "the category
 * is gone" is answered by asking the API again, not by trusting the frame the
 * screen drew.
 */

import {
  categoryTreeEmpty,
  httpFailureOn,
  mockPaths,
  networkFailureAfterOn,
  networkFailureOn,
  neverAnswersOn,
  resetCategoryStore,
} from '@shopping/api-mocks'
import type { CategoryTreeNode } from '@shopping/shared'
import { createApiClient } from '@shopping/shared'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import CategoriesPage from '@/app/categories/page'
import { messagesFor } from '@/messages'

import { renderWithAuth } from './support/auth'
import { testServer } from './setup'

const { categories: copy, errors: errorCopy } = messagesFor()

/**
 * A second administrator, editing the same tree from their own browser.
 *
 * It is the same client the app uses against the same mock API, so "somebody
 * else saved first" is a real second request rather than a handler that was
 * told to answer 409 — which would have proved only that the screen can render
 * a status code.
 */
const otherAdmin = createApiClient({ appId: 'admin', baseUrl: 'http://api.test.invalid' })

function flatten(nodes: readonly CategoryTreeNode[]): CategoryTreeNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)])
}

async function otherAdminEdits(id: number, name: string): Promise<void> {
  const { nodes } = await otherAdmin.getCategoryTree({ includeInactive: true })
  const target = flatten(nodes).find((node) => node.id === id)

  if (target === undefined) throw new Error(`no category ${String(id)} to edit`)

  await otherAdmin.updateCategory(id, { version: target.version, name })
}

/** Renders the page and waits until the tree has arrived. */
async function openConsole(): Promise<HTMLElement> {
  renderWithAuth(<CategoriesPage />)

  return screen.findByRole('tree', { name: copy.treeLabel })
}

const itemNames = (): string[] =>
  screen.getAllByRole('treeitem').map((node) => node.textContent ?? '')

function item(name: string): HTMLElement {
  const found = screen.getAllByRole('treeitem').find((node) => node.textContent?.startsWith(name))

  if (found === undefined) throw new Error(`no tree item named ${name}`)

  return found
}

/**
 * The same row after it has moved.
 *
 * Names repeat in a category tree — every gender has an 아우터 — so a moved node
 * has to be followed by its id or the assertion lands on its namesake.
 */
function itemById(id: number): HTMLElement {
  const found = screen
    .getAllByRole('treeitem')
    .find((node) => node.dataset.categoryId === String(id))

  if (found === undefined) throw new Error(`no tree item with id ${String(id)}`)

  return found
}

/** The ids the API currently holds, so a claim can be checked against it. */
async function idsInApi(includeInactive = true): Promise<number[]> {
  const { nodes } = await otherAdmin.getCategoryTree({ includeInactive })

  return flatten(nodes).map((node) => node.id)
}

describe('the four states the tree can be in (U1)', () => {
  it('says it is loading while the API has not answered', () => {
    testServer.server.use(neverAnswersOn('get', mockPaths.categories))
    renderWithAuth(<CategoriesPage />)

    expect(screen.getByRole('status')).toHaveTextContent(copy.loadingLabel)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(copy.title)
  })

  it('offers the first category when the tree is empty', async () => {
    resetCategoryStore(categoryTreeEmpty)
    renderWithAuth(<CategoriesPage />)

    expect(await screen.findByText(copy.emptyTitle)).toBeVisible()
    expect(screen.getByRole('button', { name: copy.actions.addRoot })).toBeVisible()
  })

  it('shows the failure and a way out when the API refuses (U6)', async () => {
    testServer.server.use(
      httpFailureOn(
        'get',
        mockPaths.categories,
        403,
        'FORBIDDEN',
        // Whatever the server's own sentence is. The screen shows its own.
        '이 작업을 수행할 권한이 없습니다.',
      ),
    )
    renderWithAuth(<CategoriesPage />)

    const alert = await screen.findByRole('alert')

    expect(within(alert).getByText(copy.errorTitle)).toBeVisible()
    expect(within(alert).getByText(errorCopy.FORBIDDEN, { exact: false })).toBeVisible()
    expect(screen.getByRole('button', { name: copy.retryLabel })).toBeVisible()
  })

  it('recovers when the retry succeeds', async () => {
    const user = userEvent.setup()
    testServer.server.use(networkFailureOn('get', mockPaths.categories))
    renderWithAuth(<CategoriesPage />)

    const retry = await screen.findByRole('button', { name: copy.retryLabel })
    // The API comes back before the operator presses the button.
    testServer.server.resetHandlers()
    await user.click(retry)

    expect(await screen.findByRole('tree', { name: copy.treeLabel })).toBeVisible()
  })

  it('draws forty categories over three levels (F1)', async () => {
    await openConsole()

    const items = screen.getAllByRole('treeitem')
    const levels = new Set(items.map((node) => node.getAttribute('aria-level')))

    expect(items).toHaveLength(40)
    expect([...levels].sort()).toEqual(['1', '2', '3'])
  })

  it('marks a retired category rather than hiding it from the console', async () => {
    await openConsole()

    expect(within(item('치노')).getByText(copy.inactiveBadge)).toBeVisible()
  })
})

describe('walking the tree with the keyboard only (U5, P4)', () => {
  it('reaches the tree by Tab and moves through it with the arrows', async () => {
    const user = userEvent.setup()
    await openConsole()

    // Nothing is clicked anywhere in this test.
    await user.tab()
    while (document.activeElement?.getAttribute('role') !== 'treeitem') await user.tab()

    expect(document.activeElement).toHaveTextContent('여성')

    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toHaveTextContent('아우터')

    await user.keyboard('{ArrowUp}')
    expect(document.activeElement).toHaveTextContent('여성')

    await user.keyboard('{End}')
    expect(document.activeElement).toHaveTextContent('시계')

    await user.keyboard('{Home}')
    expect(document.activeElement).toHaveTextContent('여성')
  })

  it('is one tab stop, so Tab leaves the tree instead of walking forty rows', async () => {
    const user = userEvent.setup()
    await openConsole()

    // The decision behind putting every action in the toolbar (TASK-0029 4장).
    // axe cannot check it — `nested-interactive` does not cover `treeitem` — so
    // this spec is what holds it.
    item('여성').focus()
    await user.tab()

    expect(document.activeElement).not.toHaveAttribute('role', 'treeitem')
    expect(screen.getAllByRole('treeitem').filter((node) => node.tabIndex === 0)).toHaveLength(1)
  })

  it('folds and unfolds with left and right', async () => {
    const user = userEvent.setup()
    await openConsole()

    item('여성').focus()
    await user.keyboard('{ArrowLeft}')

    expect(item('여성')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryAllByRole('treeitem')).toHaveLength(40 - 14)

    await user.keyboard('{ArrowRight}')
    expect(item('여성')).toHaveAttribute('aria-expanded', 'true')

    // Right again walks into the subtree rather than expanding what is open.
    await user.keyboard('{ArrowRight}')
    expect(document.activeElement).toHaveTextContent('아우터')
  })
})

describe('moving a category (F3, F4, F7)', () => {
  it('reorders siblings with Alt and an arrow, and the API agrees', async () => {
    const user = userEvent.setup()
    await openConsole()

    item('여성').focus()
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}')

    await waitFor(() => {
      expect(itemNames()[0]).toContain('남성')
    })

    const { nodes } = await otherAdmin.getCategoryTree()
    expect(nodes[0]?.name).toBe('남성')
  })

  it('lifts a node a level and drops it a level with Alt and left or right', async () => {
    const user = userEvent.setup()
    await openConsole()

    const id = Number(item('아우터').dataset.categoryId)
    item('아우터').focus()
    await user.keyboard('{Alt>}{ArrowLeft}{/Alt}')

    await waitFor(() => {
      expect(itemById(id)).toHaveAttribute('aria-level', '1')
    })

    // Back in, under whichever sibling now precedes it.
    await user.keyboard('{Alt>}{ArrowRight}{/Alt}')

    await waitFor(() => {
      expect(itemById(id)).toHaveAttribute('aria-level', '2')
    })
  })

  it('does the same from the toolbar buttons, which is the pointer path', async () => {
    const user = userEvent.setup()
    await openConsole()

    await user.click(item('가방'))
    await user.click(screen.getByRole('button', { name: copy.actions.moveUp }))

    await waitFor(() => {
      expect(
        itemNames().filter((name) => name.startsWith('가방') || name.startsWith('남성')),
      ).toEqual([expect.stringContaining('가방'), expect.stringContaining('남성')])
    })
  })

  it('disables the moves that cannot happen, and would have refused them anyway', async () => {
    const user = userEvent.setup()
    await openConsole()

    await user.click(item('여성'))

    expect(screen.getByRole('button', { name: copy.actions.moveUp })).toBeDisabled()
    expect(screen.getByRole('button', { name: copy.actions.moveOut })).toBeDisabled()
    expect(screen.getByRole('button', { name: copy.actions.moveIn })).toBeDisabled()
    expect(screen.getByRole('button', { name: copy.actions.moveDown })).toBeEnabled()
  })

  it('draws the move before the API has answered (즉시 반영)', async () => {
    const user = userEvent.setup()
    await openConsole()

    // The reorder never comes back, so anything on screen was drawn by the
    // screen itself rather than by the response.
    testServer.server.use(neverAnswersOn('post', mockPaths.categoryReorder))

    item('여성').focus()
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}')

    expect(itemNames()[0]).toContain('남성')
  })

  it('puts the tree back when the move fails (F10, 실패 시 원위치)', async () => {
    const user = userEvent.setup()
    await openConsole()

    const before = itemNames()
    testServer.server.use(networkFailureAfterOn('post', mockPaths.categoryReorder, 50))

    item('여성').focus()
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}')

    // It moved first — that is the point of an optimistic update, and the
    // failure is still in flight while this is asserted.
    expect(itemNames()[0]).toContain('남성')

    expect(await screen.findByText(copy.toast.moveFailed)).toBeVisible()
    expect(screen.getByText(copy.toast.restored, { exact: false })).toBeVisible()
    expect(itemNames()).toEqual(before)
  })
})

describe('adding a category (F2)', () => {
  it('creates it, and any later reader of the API sees it', async () => {
    const user = userEvent.setup()
    await openConsole()

    await user.click(screen.getByRole('button', { name: copy.actions.addRoot }))
    await user.type(screen.getByLabelText(copy.form.nameLabel, { exact: false }), '리빙')
    await user.type(screen.getByLabelText(copy.form.slugFieldLabel, { exact: false }), 'living')
    await user.click(screen.getByRole('button', { name: copy.form.save }))

    expect(await screen.findByText(copy.toast.created)).toBeVisible()
    expect(itemNames().some((name) => name.startsWith('리빙'))).toBe(true)

    // The product form will read the same endpoint; asking it is the only proof
    // that "즉시 선택지에 나타난다" is about the API and not about this screen's
    // own optimistic frame.
    const { nodes } = await otherAdmin.getCategoryTree()
    expect(nodes.map((node) => node.name)).toContain('리빙')
  })

  it('adds a child under the selected category', async () => {
    const user = userEvent.setup()
    await openConsole()

    await user.click(item('가방'))
    await user.click(screen.getByRole('button', { name: copy.actions.addChild }))
    await user.type(screen.getByLabelText(copy.form.nameLabel, { exact: false }), '토트백')
    await user.type(screen.getByLabelText(copy.form.slugFieldLabel, { exact: false }), 'bags-tote')
    await user.click(screen.getByRole('button', { name: copy.form.save }))

    await waitFor(() => {
      expect(item('토트백')).toHaveAttribute('aria-level', '2')
    })
  })

  it('refuses to add the deepest level a fourth time', async () => {
    const user = userEvent.setup()
    await openConsole()

    await user.click(item('코트'))

    expect(screen.getByRole('button', { name: copy.actions.addChild })).toBeDisabled()
  })

  it('shows a validation failure on the field it belongs to (U2)', async () => {
    const user = userEvent.setup()
    await openConsole()

    await user.click(screen.getByRole('button', { name: copy.actions.addRoot }))
    await user.type(
      screen.getByLabelText(copy.form.slugFieldLabel, { exact: false }),
      '대문자 Slug',
    )
    await user.click(screen.getByRole('button', { name: copy.form.save }))

    const name = screen.getByLabelText(copy.form.nameLabel, { exact: false })
    const slug = screen.getByLabelText(copy.form.slugFieldLabel, { exact: false })

    expect(await screen.findByText(copy.form.errors.nameRequired)).toBeVisible()
    expect(screen.getByText(copy.form.errors.slugFormat)).toBeVisible()
    expect(name).toHaveAttribute('aria-invalid', 'true')
    expect(slug).toHaveAttribute('aria-invalid', 'true')
    // Nothing was sent — the form refused it before the API had to.
    expect(await idsInApi()).toHaveLength(40)
  })

  it('puts a slug the API has already taken on the slug field', async () => {
    const user = userEvent.setup()
    await openConsole()

    await user.click(screen.getByRole('button', { name: copy.actions.addRoot }))
    await user.type(screen.getByLabelText(copy.form.nameLabel, { exact: false }), '여성복')
    await user.type(screen.getByLabelText(copy.form.slugFieldLabel, { exact: false }), 'women')
    await user.click(screen.getByRole('button', { name: copy.form.save }))

    // The catalog's sentence for `CATEGORY_SLUG_TAKEN`, under the slug input —
    // not the server's, and not at the top of the form.
    expect(await screen.findByText(errorCopy.CATEGORY_SLUG_TAKEN)).toBeVisible()
  })
})

describe('editing a category (F7, F8)', () => {
  beforeEach(() => {
    resetCategoryStore()
  })

  it('saves only when the save button is pressed', async () => {
    const user = userEvent.setup()
    await openConsole()

    await user.click(item('가방'))
    await user.click(screen.getByRole('button', { name: copy.actions.edit }))

    const name = screen.getByLabelText(copy.form.nameLabel, { exact: false })
    await user.clear(name)
    await user.type(name, '가방·잡화')

    // Typed, not saved. The tree is behind the dialog and inert, so the claim is
    // made where it means something: the API has not been told.
    const before = await otherAdmin.getCategoryTree()
    expect(before.nodes.map((node) => node.name)).toContain('가방')

    await user.click(screen.getByRole('button', { name: copy.form.save }))

    expect(await screen.findByText(copy.toast.updated)).toBeVisible()
    expect(itemNames().some((label) => label.startsWith('가방·잡화'))).toBe(true)
  })

  it('refuses to overwrite an edit that landed first, and shows both (F8)', async () => {
    const user = userEvent.setup()
    await openConsole()

    const id = Number(item('신발').dataset.categoryId)
    await user.click(item('신발'))
    await user.click(screen.getByRole('button', { name: copy.actions.edit }))

    // Somebody else saves while this dialog is open.
    await otherAdminEdits(id, '슈즈')

    const name = screen.getByLabelText(copy.form.nameLabel, { exact: false })
    await user.clear(name)
    await user.type(name, '풋웨어')
    await user.click(screen.getByRole('button', { name: copy.form.save }))

    const dialog = await screen.findByRole('dialog')

    expect(within(dialog).getByText(copy.conflict.title)).toBeVisible()
    expect(within(dialog).getByText('슈즈')).toBeVisible()
    expect(within(dialog).getByText('풋웨어')).toBeVisible()

    // And nothing was written: the other administrator's name still stands.
    const { nodes } = await otherAdmin.getCategoryTree()
    expect(nodes.find((node) => node.id === id)?.name).toBe('슈즈')
  })

  it('can take the latest values into the form instead', async () => {
    const user = userEvent.setup()
    await openConsole()

    const id = Number(item('신발').dataset.categoryId)
    await user.click(item('신발'))
    await user.click(screen.getByRole('button', { name: copy.actions.edit }))
    await otherAdminEdits(id, '슈즈')

    const name = screen.getByLabelText(copy.form.nameLabel, { exact: false })
    await user.clear(name)
    await user.type(name, '풋웨어')
    await user.click(screen.getByRole('button', { name: copy.form.save }))
    await user.click(await screen.findByRole('button', { name: copy.conflict.reloadLabel }))

    expect(screen.getByLabelText(copy.form.nameLabel, { exact: false })).toHaveValue('슈즈')
  })

  it('overwrites only when a person chooses to, on the version that is current', async () => {
    const user = userEvent.setup()
    await openConsole()

    const id = Number(item('신발').dataset.categoryId)
    await user.click(item('신발'))
    await user.click(screen.getByRole('button', { name: copy.actions.edit }))

    await otherAdminEdits(id, '슈즈')

    const name = screen.getByLabelText(copy.form.nameLabel, { exact: false })
    await user.clear(name)
    await user.type(name, '풋웨어')
    await user.click(screen.getByRole('button', { name: copy.form.save }))
    await user.click(await screen.findByRole('button', { name: copy.conflict.overwriteLabel }))

    expect(await screen.findByText(copy.toast.updated)).toBeVisible()

    const { nodes } = await otherAdmin.getCategoryTree()
    expect(nodes.find((node) => node.id === id)?.name).toBe('풋웨어')
  })
})

describe('retiring a category (F5, F6)', () => {
  it('will not delete a category that has children, and says why', async () => {
    const user = userEvent.setup()
    await openConsole()

    await user.click(item('여성'))

    expect(screen.getByRole('button', { name: copy.actions.remove })).toBeDisabled()
    expect(screen.getByText(copy.actions.removeBlocked)).toBeVisible()
  })

  it('deletes a leaf, and the API agrees it is gone', async () => {
    const user = userEvent.setup()
    await openConsole()

    const id = Number(item('로퍼').dataset.categoryId)
    await user.click(item('로퍼'))

    await user.click(screen.getByRole('button', { name: copy.actions.remove }))
    await user.click(await screen.findByRole('button', { name: copy.retire.confirmRemove }))

    expect(await screen.findByText(copy.toast.removed)).toBeVisible()
    expect(await idsInApi()).not.toContain(id)
  })

  it('turns a refused delete into the reason and an alternative (U6)', async () => {
    const user = userEvent.setup()
    await openConsole()

    // What a category with products in it will answer once products exist. The
    // screen picks the alternative from the code, not from the sentence.
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

  it('deactivates instead, and the category leaves the shopper-facing tree (F6)', async () => {
    const user = userEvent.setup()
    await openConsole()

    const id = Number(item('로퍼').dataset.categoryId)
    await user.click(item('로퍼'))

    await user.click(screen.getByRole('button', { name: copy.actions.deactivate }))
    await user.click(await screen.findByRole('button', { name: copy.retire.confirmDeactivate }))

    expect(await screen.findByText(copy.toast.deactivated)).toBeVisible()
    expect(within(item('로퍼')).getByText(copy.inactiveBadge)).toBeVisible()

    // The console still sees it; a buyer's query does not.
    expect(await idsInApi(true)).toContain(id)
    expect(await idsInApi(false)).not.toContain(id)
  })

  it('brings a retired category back', async () => {
    const user = userEvent.setup()
    await openConsole()

    await user.click(item('치노'))
    await user.click(screen.getByRole('button', { name: copy.actions.activate }))
    await user.click(await screen.findByRole('button', { name: copy.retire.confirmActivate }))

    expect(await screen.findByText(copy.toast.activated)).toBeVisible()
    expect(within(item('치노')).queryByText(copy.inactiveBadge)).toBeNull()
  })
})

describe('the network this screen actually used', () => {
  it('called no API but the mock, on any transport', () => {
    // The two counters `setupTestServer` keeps. They also fail the file in
    // `afterAll`; asserting here names the measurement TASK-0029 asks for.
    expect(testServer.unhandledRequests()).toEqual([])
    expect(testServer.outboundConnections()).toEqual([])
  })
})
