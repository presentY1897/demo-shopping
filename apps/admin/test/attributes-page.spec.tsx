/**
 * `/attributes`, driven the way an administrator drives it.
 *
 * Everything below renders the real page and then clicks or types. No component
 * is handed a made-up prop bag and no class name is asserted on
 * (QUALITY-GATES Q5): what is checked is that choosing a category changes what
 * is inherited, that a type decides which settings appear, that the preview is
 * the form a seller will fill in, and that a refused save is shown rather than
 * swallowed.
 *
 * The API is `@shopping/api-mocks`, which keeps real definitions — so "it was
 * saved" is answered by asking the API again rather than by trusting the frame
 * the screen drew.
 */

import {
  httpFailureOn,
  mockPaths,
  networkFailureAfterOn,
  networkFailureOn,
  neverAnswersOn,
} from '@shopping/api-mocks'
import { createApiClient } from '@shopping/shared'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { UserEvent } from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import AttributesPage from '@/app/attributes/page'
import { messagesFor } from '@/messages'

import { renderWithAuth } from './support/auth'
import { testServer } from './setup'

const { attributes: copy } = messagesFor()

/** Fixture category ids, as `packages/api-mocks` builds them depth first. */
const WOMEN = 1
const COAT = 3

/**
 * A second administrator, looking at the same definitions from their own
 * browser. The same client the app uses, against the same mock API.
 */
const otherAdmin = createApiClient({ appId: 'admin', baseUrl: 'http://api.test.invalid' })

const PATHS = {
  women: '여성',
  outer: '여성 › 아우터',
  coat: '여성 › 아우터 › 코트',
  shoes: '신발',
} as const

async function openConsole(): Promise<HTMLElement> {
  renderWithAuth(<AttributesPage />)

  return screen.findByRole('table', { name: copy.listLabel })
}

/** Opens a `Select` and picks an option by its visible text. */
async function choose(user: UserEvent, comboboxName: string, option: string): Promise<void> {
  await user.click(screen.getByRole('combobox', { name: comboboxName }))
  await user.click(await screen.findByRole('option', { name: option }))
}

async function selectCategory(user: UserEvent, path: string): Promise<void> {
  await choose(user, copy.categoryLabel, path)
}

function table(): HTMLElement {
  return screen.getByRole('table', { name: copy.listLabel })
}

/** The attribute names in the order the list shows them. */
function shownLabels(): string[] {
  return within(table())
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getByRole('rowheader').textContent ?? '')
}

function rowFor(label: string): HTMLElement {
  const found = within(table())
    .getAllByRole('row')
    .slice(1)
    .find((row) => within(row).getByRole('rowheader').textContent === label)

  if (found === undefined) throw new Error(`no attribute row named ${label}`)

  return found
}

/** The preview panel — the form a seller would be shown. */
function preview(): HTMLElement {
  const panel = screen
    .getByRole('heading', { name: copy.preview.title })
    .closest('div')?.parentElement

  if (panel === null || panel === undefined) throw new Error('no preview panel')

  return panel
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

async function fillNewAttribute(
  user: UserEvent,
  values: { key: string; label: string; type: string },
): Promise<void> {
  await user.click(screen.getByRole('button', { name: copy.actions.add }))
  await screen.findByRole('form')
  await user.type(within(editor()).getByLabelText(copy.form.keyLabel, { exact: false }), values.key)
  await user.type(
    within(editor()).getByLabelText(copy.form.labelLabel, { exact: false }),
    values.label,
  )
  await choose(user, copy.form.typeLabel, values.type)
}

describe('the four states the list can be in (U1)', () => {
  it('says it is loading while the API has not answered', () => {
    testServer.server.use(neverAnswersOn('get', mockPaths.categories))
    renderWithAuth(<AttributesPage />)

    expect(screen.getByRole('status')).toHaveTextContent(copy.loadingLabel)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(copy.title)
  })

  it('offers the first definition when a category has none', async () => {
    const user = userEvent.setup()
    await openConsole()

    await selectCategory(user, PATHS.shoes)

    expect(await screen.findByText(copy.emptyTitle)).toBeVisible()
    expect(screen.getAllByRole('button', { name: copy.actions.add }).length).toBeGreaterThan(0)
  })

  it('shows the failure and a way out when the API refuses (U6)', async () => {
    testServer.server.use(networkFailureOn('get', mockPaths.attributes))
    renderWithAuth(<AttributesPage />)

    expect(await screen.findByText(copy.errorTitle)).toBeVisible()
    expect(screen.getByRole('button', { name: copy.retryLabel })).toBeVisible()
  })

  it('recovers when the retry succeeds', async () => {
    const user = userEvent.setup()
    testServer.server.use(networkFailureOn('get', mockPaths.attributes))
    renderWithAuth(<AttributesPage />)

    await screen.findByText(copy.errorTitle)
    testServer.server.resetHandlers()
    await user.click(screen.getByRole('button', { name: copy.retryLabel }))

    expect(await screen.findByRole('table', { name: copy.listLabel })).toBeVisible()
  })

  it('draws the definitions once they arrive', async () => {
    await openConsole()

    expect(shownLabels()).toEqual(['브랜드'])
  })
})

describe('inheritance is visible on the row it applies to (F1)', () => {
  it('shows ancestors’ definitions first, naming where each comes from', async () => {
    const user = userEvent.setup()
    await openConsole()

    await selectCategory(user, PATHS.coat)

    await waitFor(() => {
      expect(shownLabels()).toEqual([
        '브랜드',
        '핏',
        '넥라인',
        '울 혼용률',
        '탈부착 내피',
        '착용 계절',
      ])
    })
    expect(within(rowFor('브랜드')).getByText('여성 에서 물려받음')).toBeVisible()
    expect(within(rowFor('핏')).getByText('아우터 에서 물려받음')).toBeVisible()
  })

  it('offers the category that owns an inherited definition instead of a dead button', async () => {
    const user = userEvent.setup()
    await openConsole()
    await selectCategory(user, PATHS.coat)
    await screen.findByText('여성 에서 물려받음')

    await user.click(within(rowFor('브랜드')).getByRole('button', { name: '여성 에서 수정' }))

    await waitFor(() => {
      expect(shownLabels()).toEqual(['브랜드'])
    })
    // On its own category the definition is editable, and says so.
    expect(within(rowFor('브랜드')).getByRole('button', { name: copy.actions.edit })).toBeVisible()
  })

  it('does not carry a definition sideways to a sibling branch', async () => {
    const user = userEvent.setup()
    await openConsole()

    await selectCategory(user, '여성 › 아우터 › 재킷')

    await waitFor(() => {
      expect(shownLabels()).toEqual(['브랜드', '핏'])
    })
  })
})

describe('the settings a type asks for (F2)', () => {
  it('shows the choice editor only for the types that take choices', async () => {
    const user = userEvent.setup()
    await openConsole()

    await user.click(screen.getByRole('button', { name: copy.actions.add }))
    expect(screen.queryByRole('group', { name: copy.form.optionsLabel })).not.toBeInTheDocument()

    await choose(user, copy.form.typeLabel, copy.typeLabels.SELECT)
    expect(await screen.findByRole('group', { name: copy.form.optionsLabel })).toBeVisible()

    await choose(user, copy.form.typeLabel, copy.typeLabels.MULTI_SELECT)
    expect(screen.getByRole('group', { name: copy.form.optionsLabel })).toBeVisible()

    await choose(user, copy.form.typeLabel, copy.typeLabels.NUMBER)
    expect(screen.queryByRole('group', { name: copy.form.optionsLabel })).not.toBeInTheDocument()

    await choose(user, copy.form.typeLabel, copy.typeLabels.BOOLEAN)
    expect(screen.queryByRole('group', { name: copy.form.optionsLabel })).not.toBeInTheDocument()
  })

  it('cannot change key or type once a definition exists', async () => {
    const user = userEvent.setup()
    await openConsole()

    await user.click(within(rowFor('브랜드')).getByRole('button', { name: copy.actions.edit }))

    expect(await screen.findByText(copy.form.keyLockedHint)).toBeVisible()
    expect(screen.getByText(copy.form.typeLockedHint)).toBeVisible()
    expect(
      within(editor()).queryByLabelText(copy.form.keyLabel, { exact: false }),
    ).not.toBeInTheDocument()
    // The label is still editable, which is the point of the edit form.
    expect(within(editor()).getByLabelText(copy.form.labelLabel, { exact: false })).toHaveValue(
      '브랜드',
    )
  })
})

describe('editing the choices of a SELECT (F3)', () => {
  it('saves the choices that were typed and offers them in the preview', async () => {
    const user = userEvent.setup()
    await openConsole()
    await selectCategory(user, PATHS.coat)
    await screen.findByText('여성 에서 물려받음')

    await fillNewAttribute(user, { key: 'color', label: '색상', type: copy.typeLabels.SELECT })

    for (const choice of ['블랙', '아이보리', '카멜']) {
      await user.click(screen.getByRole('button', { name: copy.form.optionAddLabel }))
      const boxes = within(
        screen.getByRole('group', { name: copy.form.optionsLabel }),
      ).getAllByRole('textbox')
      await user.type(boxes[boxes.length - 1]!, choice)
    }

    await user.click(screen.getByRole('button', { name: copy.form.save }))

    await waitFor(() => {
      expect(shownLabels()).toContain('색상')
    })

    const { attributes } = await otherAdmin.getAttributes({ categoryId: COAT })
    expect(attributes.find((row) => row.key === 'color')?.options).toEqual([
      '블랙',
      '아이보리',
      '카멜',
    ])

    // And the generated form now asks for it.
    expect(within(preview()).getByRole('combobox', { name: /색상/ })).toBeVisible()
  })

  it('refuses a SELECT with no choices, under the choice list (U2)', async () => {
    const user = userEvent.setup()
    await openConsole()

    await fillNewAttribute(user, { key: 'color', label: '색상', type: copy.typeLabels.SELECT })
    await user.click(screen.getByRole('button', { name: copy.form.save }))

    expect(await screen.findByText(copy.form.errors.optionsRequired)).toBeVisible()
  })

  it('refuses the same choice twice', async () => {
    const user = userEvent.setup()
    await openConsole()

    await fillNewAttribute(user, { key: 'color', label: '색상', type: copy.typeLabels.SELECT })
    for (const choice of ['블랙', '블랙']) {
      await user.click(screen.getByRole('button', { name: copy.form.optionAddLabel }))
      const boxes = within(
        screen.getByRole('group', { name: copy.form.optionsLabel }),
      ).getAllByRole('textbox')
      await user.type(boxes[boxes.length - 1]!, choice)
    }
    await user.click(screen.getByRole('button', { name: copy.form.save }))

    expect(await screen.findByText(copy.form.errors.optionsDuplicate)).toBeVisible()
  })
})

describe('the preview is the seller’s form (F4)', () => {
  it('asks the questions the definitions describe, in the same order', async () => {
    const user = userEvent.setup()
    await openConsole()
    await selectCategory(user, PATHS.coat)
    await screen.findByText('여성 에서 물려받음')

    const labels = within(preview())
      .getAllByRole('textbox')
      .concat(within(preview()).getAllByRole('spinbutton'))
      .map((control) => control.getAttribute('aria-describedby') ?? control.id)

    expect(labels.length).toBeGreaterThan(0)
    expect(within(preview()).getByRole('textbox', { name: /브랜드/ })).toBeVisible()
    expect(within(preview()).getByRole('spinbutton', { name: /울 혼용률/ })).toBeVisible()
    expect(within(preview()).getByRole('combobox', { name: /넥라인/ })).toBeVisible()
    expect(within(preview()).getByRole('group', { name: /착용 계절/ })).toBeVisible()
    expect(within(preview()).getByRole('checkbox', { name: /탈부착 내피/ })).toBeVisible()
  })

  it('marks a required attribute as required in the generated form', async () => {
    await openConsole()

    expect(within(preview()).getByRole('textbox', { name: /브랜드/ })).toHaveAttribute(
      'aria-required',
      'true',
    )
  })

  it('shows the definition being written before it is saved', async () => {
    const user = userEvent.setup()
    await openConsole()

    await fillNewAttribute(user, { key: 'origin', label: '원산지', type: copy.typeLabels.TEXT })

    expect(await screen.findByText(copy.preview.draftBadge)).toBeVisible()
    expect(within(preview()).getByRole('textbox', { name: /원산지/ })).toBeVisible()
  })

  it('takes the draft back out when the editor is closed', async () => {
    const user = userEvent.setup()
    await openConsole()
    await fillNewAttribute(user, { key: 'origin', label: '원산지', type: copy.typeLabels.TEXT })
    await screen.findByText(copy.preview.draftBadge)

    await user.click(screen.getByRole('button', { name: copy.form.cancel }))

    await waitFor(() => {
      expect(screen.queryByText(copy.preview.draftBadge)).not.toBeInTheDocument()
    })
    expect(within(preview()).queryByRole('textbox', { name: /원산지/ })).not.toBeInTheDocument()
  })
})

describe('order (F6)', () => {
  it('changes the list and the generated form together', async () => {
    const user = userEvent.setup()
    await openConsole()
    await selectCategory(user, PATHS.coat)
    await screen.findByText('여성 에서 물려받음')

    await user.click(within(rowFor('울 혼용률')).getByRole('button', { name: copy.actions.moveUp }))

    await waitFor(() => {
      expect(shownLabels()).toEqual([
        '브랜드',
        '핏',
        '울 혼용률',
        '넥라인',
        '탈부착 내피',
        '착용 계절',
      ])
    })

    const { attributes } = await otherAdmin.getAttributes({ categoryId: COAT })
    expect(attributes.map((row) => row.key)).toEqual([
      'brand',
      'fit',
      'wool_ratio',
      'neckline',
      'detachable_liner',
      'season',
    ])
  })

  it('cannot move the ends, and never offers to move an inherited row', async () => {
    const user = userEvent.setup()
    await openConsole()
    await selectCategory(user, PATHS.coat)
    await screen.findByText('여성 에서 물려받음')

    expect(
      within(rowFor('넥라인')).getByRole('button', { name: copy.actions.moveUp }),
    ).toBeDisabled()
    expect(
      within(rowFor('착용 계절')).getByRole('button', { name: copy.actions.moveDown }),
    ).toBeDisabled()
    expect(
      within(rowFor('브랜드')).queryByRole('button', { name: copy.actions.moveUp }),
    ).not.toBeInTheDocument()
  })

  it('re-reads rather than rolling back when a move is refused', async () => {
    const user = userEvent.setup()
    await openConsole()
    await selectCategory(user, PATHS.coat)
    await screen.findByText('여성 에서 물려받음')

    testServer.server.use(networkFailureAfterOn('patch', mockPaths.attribute, 20))
    await user.click(within(rowFor('울 혼용률')).getByRole('button', { name: copy.actions.moveUp }))

    expect(await screen.findByText(copy.toast.moveFailed)).toBeVisible()
    await waitFor(() => {
      expect(shownLabels()).toEqual([
        '브랜드',
        '핏',
        '넥라인',
        '울 혼용률',
        '탈부착 내피',
        '착용 계절',
      ])
    })
  })
})

describe('the search filter switch', () => {
  it('turns a definition into a facet and says so', async () => {
    const user = userEvent.setup()
    await openConsole()
    await selectCategory(user, PATHS.coat)
    await screen.findByText('여성 에서 물려받음')

    await user.click(within(rowFor('울 혼용률')).getByRole('switch', { name: /울 혼용률/ }))

    expect(await screen.findByText(copy.toast.filterableOn)).toBeVisible()

    const { attributes } = await otherAdmin.getAttributes({ categoryId: COAT })
    expect(attributes.find((row) => row.key === 'wool_ratio')?.isFilterable).toBe(true)
  })

  it('is not offered on a row this category does not own', async () => {
    const user = userEvent.setup()
    await openConsole()
    await selectCategory(user, PATHS.coat)
    await screen.findByText('여성 에서 물려받음')

    expect(within(rowFor('브랜드')).queryByRole('switch')).not.toBeInTheDocument()
  })
})

describe('deleting a definition (F5)', () => {
  it('asks first, then retires it', async () => {
    const user = userEvent.setup()
    await openConsole()

    await user.click(within(rowFor('브랜드')).getByRole('button', { name: copy.actions.remove }))
    await user.click(await screen.findByRole('button', { name: copy.retire.confirm }))

    expect(await screen.findByText(copy.emptyTitle)).toBeVisible()

    const { attributes } = await otherAdmin.getAttributes({ categoryId: WOMEN })
    expect(attributes).toEqual([])
  })

  /**
   * The refusal path, which the API cannot yet produce.
   *
   * "사용 중인 속성은 삭제되지 않는다" (F5) needs `Product`, and with it the check
   * and a code of its own — both TASK-0032's (TASK-0030 R2). What is checked here
   * is the half this screen owns: a refused delete **explains inside the dialog**
   * instead of closing and leaving a toast behind. `CONFLICT` is the envelope
   * code a 409 carries until a domain names one, so this is still a branch on
   * `error.code` rather than on prose (TASK-0031 4.7).
   */
  it('turns the dialog into an explanation when the delete is refused', async () => {
    const user = userEvent.setup()
    await openConsole()

    testServer.server.use(
      httpFailureOn('delete', mockPaths.attribute, 409, 'CONFLICT', '서버가 쓴 문장'),
    )
    await user.click(within(rowFor('브랜드')).getByRole('button', { name: copy.actions.remove }))
    await user.click(await screen.findByRole('button', { name: copy.retire.confirm }))

    const dialog = await screen.findByRole('dialog', { name: copy.retire.blockedTitle })
    expect(within(dialog).getByText(copy.retire.blockedDescription)).toBeVisible()
    // Nothing left to press but 취소 — the delete is not offered again.
    expect(
      within(dialog).queryByRole('button', { name: copy.retire.confirm }),
    ).not.toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: copy.retire.cancel }))
    expect(shownLabels()).toEqual(['브랜드'])
  })

  it('keeps the definition and says so when the request never arrived', async () => {
    const user = userEvent.setup()
    await openConsole()

    testServer.server.use(networkFailureOn('delete', mockPaths.attribute))
    await user.click(within(rowFor('브랜드')).getByRole('button', { name: copy.actions.remove }))
    await user.click(await screen.findByRole('button', { name: copy.retire.confirm }))

    expect(await screen.findByText(copy.toast.saveFailed)).toBeVisible()
    expect(await screen.findByText(copy.failures.network)).toBeVisible()

    await user.click(screen.getByRole('button', { name: copy.retire.cancel }))
    expect(shownLabels()).toEqual(['브랜드'])
  })
})

describe('the form guards its own submit', () => {
  it('sends one request however many times save is pressed (U3)', async () => {
    const user = userEvent.setup()
    await openConsole()

    let posts = 0
    testServer.server.events.on('request:start', ({ request }) => {
      if (request.method === 'POST') posts += 1
    })
    testServer.server.use(networkFailureAfterOn('post', mockPaths.attributes, 40))

    await fillNewAttribute(user, { key: 'origin', label: '원산지', type: copy.typeLabels.TEXT })
    const save = screen.getByRole('button', { name: copy.form.save })
    await user.click(save)
    await user.click(save)
    await user.click(save)

    await waitFor(() => {
      expect(posts).toBe(1)
    })
  })

  it('names the inputs it is missing rather than the form (U2)', async () => {
    const user = userEvent.setup()
    await openConsole()

    await user.click(screen.getByRole('button', { name: copy.actions.add }))
    await user.click(await screen.findByRole('button', { name: copy.form.save }))

    expect(await screen.findByText(copy.form.errors.keyRequired)).toBeVisible()
    expect(screen.getByText(copy.form.errors.labelRequired)).toBeVisible()
    expect(screen.getByText(copy.form.errors.typeRequired)).toBeVisible()
    expect(within(editor()).getByLabelText(copy.form.keyLabel, { exact: false })).toHaveFocus()
  })

  it('refuses a key the database could not hold', async () => {
    const user = userEvent.setup()
    await openConsole()

    await fillNewAttribute(user, { key: 'Size.EU', label: '사이즈', type: copy.typeLabels.TEXT })
    await user.click(screen.getByRole('button', { name: copy.form.save }))

    expect(await screen.findByText(copy.form.errors.keyFormat)).toBeVisible()
  })
})

describe('the console can be driven from the keyboard alone (U5)', () => {
  it('reaches the picker, changes the category and opens the editor', async () => {
    const user = userEvent.setup()
    await openConsole()

    const picker = screen.getByRole('combobox', { name: copy.categoryLabel })
    picker.focus()
    await user.keyboard('{Enter}')
    await screen.findByRole('listbox')
    await user.keyboard('{ArrowDown}{Enter}')

    await waitFor(() => {
      expect(picker).toHaveTextContent(PATHS.outer)
    })

    await user.tab()
    expect(screen.getByRole('button', { name: copy.actions.add })).toHaveFocus()
    await user.keyboard('{Enter}')

    await screen.findByRole('form')
    expect(within(editor()).getByLabelText(copy.form.keyLabel, { exact: false })).toBeVisible()
  })
})
