/**
 * 검색 화면 (TASK-0041 F1–F9).
 *
 * The screen is rendered against `@shopping/api-mocks`'s stateful search double,
 * so a click on a facet produces a *narrowed list* rather than the same rows
 * again — a filter that did nothing would pass a spec written against a frozen
 * fixture, and would fail here.
 *
 * `next/navigation` is mocked with an address bar that navigates
 * (`test/support/navigation.tsx`). That is not a convenience: this screen keeps
 * every filter in the URL and nothing in React state, so a mock that only
 * recorded `push` would leave it frozen on its first query.
 */

import { SEARCH_COAT_CATEGORY, SEARCH_SHOE_CATEGORY } from '@shopping/api-mocks'
import {
  DEFAULT_DENSITY,
  DENSITY_GRID_COLUMNS,
  DENSITY_LEVELS,
  DENSITY_STORAGE_KEY,
} from '@shopping/ui'
import { gridColumnsClass } from '@shopping/ui/catalog'
import { DensityProvider } from '@shopping/ui/density'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { messagesFor } from '@/messages'

import { navigation, nextNavigationMock } from './support/navigation'
import { stubViewport, VIEWPORTS } from './support/viewport'

vi.mock('next/navigation', () => nextNavigationMock())

const { default: SearchPage } = await import('@/app/search/page')

const messages = messagesFor().search
const filters = messages.filters
const box = messagesFor().layout.search

function renderSearch(href: string, width: number = VIEWPORTS.desktop) {
  stubViewport(width)
  navigation.start(href)

  return render(
    <DensityProvider>
      <SearchPage />
    </DensityProvider>,
  )
}

/** The results grid, once the first search has come back. */
async function results(): Promise<HTMLElement> {
  return screen.findByRole('list', { name: messages.list.gridLabel })
}

/**
 * The names on the cards, in the order they are drawn.
 *
 * Read from the card's link rather than from a heading: `ProductCard` deliberately
 * has none — a grid of forty is forty headings a screen reader has to walk past
 * to reach the pagination — and the link is what carries the name.
 */
async function productNames(): Promise<string[]> {
  const list = await results()

  return within(list)
    .getAllByRole('link')
    .map((link) => link.textContent ?? '')
}

beforeEach(() => {
  localStorage.clear()
  document.documentElement.setAttribute('data-density', String(DEFAULT_DENSITY))
  navigation.push.mockClear()
  navigation.back.mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('F1 자동완성', () => {
  it('offers candidates, walks them with the arrow keys and takes one with Enter', async () => {
    const user = userEvent.setup()
    renderSearch('/search')

    const field = screen.getAllByRole('combobox', { name: box.label })[0]!

    await user.type(field, '코트')

    const listbox = await screen.findByRole('listbox', { name: box.suggestionsLabel })
    const options = await within(listbox).findAllByRole('option')

    expect(options.length).toBeGreaterThan(1)
    // Nothing is highlighted until an arrow key says so: Enter on a freshly
    // typed word must search for that word, not for the first candidate.
    expect(options.every((option) => option.getAttribute('aria-selected') === 'false')).toBe(true)

    await user.keyboard('{ArrowDown}')

    expect(field).toHaveAttribute('aria-activedescendant', options[0]!.id)
    expect(options[0]).toHaveAttribute('aria-selected', 'true')

    await user.keyboard('{ArrowDown}')

    expect(field).toHaveAttribute('aria-activedescendant', options[1]!.id)

    const chosen = options[1]!.textContent ?? ''

    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(navigation.params.get('q')).toBe(chosen)
    })
  })

  it('does not ask for candidates before the second character (R2)', async () => {
    const user = userEvent.setup()
    renderSearch('/search')

    await user.type(screen.getAllByRole('combobox', { name: box.label })[0]!, '코')

    // Deliberately a plain wait rather than a `waitFor` for absence: the point
    // is that nothing arrives *after the debounce has passed*, and asserting it
    // immediately would pass even if a request were in flight.
    await new Promise((resolve) => setTimeout(resolve, 400))

    expect(screen.queryByRole('option')).toBeNull()
  })

  it('closes the list on Escape without touching what was typed', async () => {
    const user = userEvent.setup()
    renderSearch('/search')

    const field = screen.getAllByRole('combobox', { name: box.label })[0]!

    await user.type(field, '코트')
    await within(await screen.findByRole('listbox', { name: box.suggestionsLabel })).findAllByRole(
      'option',
    )

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('option')).toBeNull()
    expect(field).toHaveValue('코트')
  })
})

describe('F2 필터 자동 생성', () => {
  it('builds the panel from whatever the category declares', async () => {
    renderSearch(`/search?categoryId=${String(SEARCH_COAT_CATEGORY)}`)

    expect(await screen.findByRole('button', { name: '핏' })).toBeVisible()
    expect(screen.getByRole('button', { name: '주 소재' })).toBeVisible()
    expect(screen.queryByRole('button', { name: '발볼' })).toBeNull()
  })

  it('builds a different panel for a different category', async () => {
    renderSearch(`/search?categoryId=${String(SEARCH_SHOE_CATEGORY)}`)

    expect(await screen.findByRole('button', { name: '발볼' })).toBeVisible()
    expect(screen.queryByRole('button', { name: '핏' })).toBeNull()
    expect(screen.queryByRole('button', { name: '주 소재' })).toBeNull()
  })
})

describe('F4 URL 동기화', () => {
  it('puts a chosen facet in the address bar and narrows the results', async () => {
    const user = userEvent.setup()
    renderSearch(`/search?categoryId=${String(SEARCH_COAT_CATEGORY)}`)

    expect(await productNames()).toHaveLength(3)

    await user.click(await screen.findByRole('checkbox', { name: /슬림/ }))

    await waitFor(() => {
      expect(navigation.params.get('attr.fit')).toBe('슬림')
    })
    await waitFor(async () => {
      expect(await productNames()).toEqual(['슬림 더블 코트'])
    })
  })

  it('starts from the URL, so a reload keeps every filter', async () => {
    renderSearch(
      `/search?categoryId=${String(SEARCH_COAT_CATEGORY)}&attr.fit=오버사이즈&attr.material=울&inStock=true`,
    )

    await waitFor(async () => {
      expect(await productNames()).toEqual(['오버핏 싱글 코트'])
    })

    // 재고 없는 발마칸도 오버사이즈·울이다. 걸려 있는 세 필터가 모두 살아
    // 있어야만 결과가 하나다.
    expect(screen.getByRole('checkbox', { name: filters.inStock })).toBeChecked()
  })

  it('leaves Back to the browser, which is what makes it work', async () => {
    const user = userEvent.setup()
    renderSearch(`/search?categoryId=${String(SEARCH_COAT_CATEGORY)}`)

    await user.click(await screen.findByRole('checkbox', { name: /슬림/ }))

    await waitFor(() => {
      expect(navigation.params.get('attr.fit')).toBe('슬림')
    })

    navigation.back()

    await waitFor(() => {
      expect(navigation.params.get('attr.fit')).toBeNull()
    })
    await waitFor(async () => {
      expect(await productNames()).toHaveLength(3)
    })
  })
})

describe('F5 패싯 개수', () => {
  it('counts each value after the other filters and disables the ones that would return nothing', async () => {
    renderSearch(`/search?categoryId=${String(SEARCH_COAT_CATEGORY)}`)

    const oversize = await screen.findByRole('checkbox', { name: /오버사이즈/ })

    expect(oversize).toHaveAccessibleName(expect.stringContaining('2'))
    expect(oversize).toBeEnabled()

    // 루즈 is declared by the category and worn by nothing.
    const loose = screen.getByRole('checkbox', { name: /루즈/ })

    expect(loose).toHaveAccessibleName(expect.stringContaining('0'))
    expect(loose).toBeDisabled()
  })

  it('recounts after a narrowing, so a count is what the next click would leave', async () => {
    const user = userEvent.setup()
    renderSearch(`/search?categoryId=${String(SEARCH_COAT_CATEGORY)}`)

    await user.click(await screen.findByRole('checkbox', { name: /슬림/ }))

    await waitFor(() => {
      // 울 코트 둘은 모두 오버사이즈다. 슬림만 남기면 울은 0 이 된다.
      expect(screen.getByRole('checkbox', { name: /울/ })).toHaveAccessibleName(
        expect.stringContaining('0'),
      )
    })
  })
})

describe('F6 오타 검색', () => {
  it('shows results and says which word it could not match literally', async () => {
    renderSearch('/search?q=레트루')

    await waitFor(async () => {
      expect(await productNames()).toEqual(['레트로 러너'])
    })

    expect(screen.getByText(messages.approximateTitle)).toBeVisible()
    expect(
      screen.getByText(messages.approximateBody.replace('{terms}', '레트루'), { exact: false }),
    ).toBeVisible()
  })

  it('says nothing of the sort when the word was found as typed', async () => {
    renderSearch('/search?q=레트로')

    await waitFor(async () => {
      expect(await productNames()).toEqual(['레트로 러너'])
    })

    expect(screen.queryByText(messages.approximateTitle)).toBeNull()
  })
})

describe('F7 결과 없음', () => {
  it('offers a way out rather than an empty page', async () => {
    renderSearch('/search?q=존재하지않는검색어')

    expect(await screen.findByText(messages.list.emptyTitle)).toBeVisible()
    expect(screen.getByText(messages.list.emptyDescription)).toBeVisible()
  })

  it('asks for a search when none has been made', () => {
    renderSearch('/search')

    expect(screen.getByText(messages.promptTitle)).toBeVisible()
    expect(screen.queryByRole('list', { name: messages.list.gridLabel })).toBeNull()
  })
})

describe('F8 · P6 밀도 3단계', () => {
  it.each(DENSITY_LEVELS)('draws the results at density %s', async (level) => {
    localStorage.setItem(DENSITY_STORAGE_KEY, String(level))
    document.documentElement.setAttribute('data-density', String(level))

    renderSearch(`/search?categoryId=${String(SEARCH_COAT_CATEGORY)}`)

    const grid = await results()

    expect(grid).toHaveAttribute('data-density', String(level))
    // The column count is the step's, and it is read from the matrix rather than
    // written here — a number typed into the spec would stop following the
    // matrix the moment it moved.
    expect(grid.className).toContain(gridColumnsClass(level))
    expect(grid.className).toContain(`grid-cols-${String(DENSITY_GRID_COLUMNS[level].base)}`)
  })
})

describe('P3 세 검증 뷰포트', () => {
  /**
   * jsdom paints nothing, so 「레이아웃이 깨지지 않는다」 cannot be measured here.
   * What can be is the branch the widths actually decide: below 768 the panel is
   * a sheet behind a button, at 768 and above it is a column beside the results
   * — one component in one place, never both (D-055).
   */
  it('is a sheet behind a button at 360px', async () => {
    renderSearch(`/search?categoryId=${String(SEARCH_COAT_CATEGORY)}`, VIEWPORTS.mobile)

    expect(await screen.findByRole('button', { name: filters.openLabel })).toBeVisible()
    expect(screen.queryByRole('complementary', { name: filters.title })).toBeNull()
  })

  it.each([VIEWPORTS.tablet, VIEWPORTS.desktop])('is a side column at %ipx', async (width) => {
    renderSearch(`/search?categoryId=${String(SEARCH_COAT_CATEGORY)}`, width)

    expect(await screen.findByRole('complementary', { name: filters.title })).toBeVisible()
    expect(screen.queryByRole('button', { name: filters.openLabel })).toBeNull()
  })
})

describe('P4 키보드만으로', () => {
  it('reaches the field, the sort, a facet and a result by tabbing', async () => {
    const user = userEvent.setup()
    renderSearch(`/search?categoryId=${String(SEARCH_COAT_CATEGORY)}`)

    const list = await results()
    const wanted = new Set<HTMLElement>([
      screen.getAllByRole('combobox', { name: box.label })[0]!,
      screen.getByRole('combobox', { name: messages.sort.label }),
      screen.getByRole('checkbox', { name: /오버사이즈/ }),
      within(list).getAllByRole('link')[0]!,
    ])

    // Bounded: the field, the submit, two accordion headers, the price pair and
    // its button, the stock box, two facet sections and three cards. Anything
    // not reached inside thirty stops is not reachable.
    for (let step = 0; step < 30 && wanted.size > 0; step += 1) {
      await user.tab()
      if (document.activeElement instanceof HTMLElement) wanted.delete(document.activeElement)
    }

    expect([...wanted]).toEqual([])
  })
})

describe('F9 모바일 필터', () => {
  it('opens the panel as a sheet at 360px and closes it on 결과 보기', async () => {
    const user = userEvent.setup()
    renderSearch(`/search?categoryId=${String(SEARCH_COAT_CATEGORY)}`, VIEWPORTS.mobile)

    // No side panel at this width — one component, mounted in one place (D-055).
    expect(screen.queryByRole('complementary', { name: filters.title })).toBeNull()

    await user.click(await screen.findByRole('button', { name: filters.openLabel }))

    const sheet = await screen.findByRole('dialog')

    expect(within(sheet).getByRole('button', { name: '핏' })).toBeVisible()

    await user.click(within(sheet).getByRole('button', { name: filters.applyLabel }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
  })

  it('keeps the panel beside the results on a desktop', async () => {
    renderSearch(`/search?categoryId=${String(SEARCH_COAT_CATEGORY)}`, VIEWPORTS.desktop)

    expect(await screen.findByRole('complementary', { name: filters.title })).toBeVisible()
    expect(screen.queryByRole('button', { name: filters.openLabel })).toBeNull()
  })
})

describe('적용된 필터 칩', () => {
  it('removes one filter and leaves the rest alone', async () => {
    const user = userEvent.setup()
    renderSearch(
      `/search?categoryId=${String(SEARCH_COAT_CATEGORY)}&attr.fit=오버사이즈&attr.material=울`,
    )

    const chips = await screen.findByRole('group', { name: filters.appliedLabel })

    await user.click(
      within(chips).getByRole('button', {
        name: filters.removeLabel.replace('{name}', '핏: 오버사이즈'),
      }),
    )

    await waitFor(() => {
      expect(navigation.params.get('attr.fit')).toBeNull()
      expect(navigation.params.get('attr.material')).toBe('울')
    })
  })

  it('clears every filter but keeps the search itself', async () => {
    const user = userEvent.setup()
    renderSearch(
      `/search?q=코트&categoryId=${String(SEARCH_COAT_CATEGORY)}&attr.fit=오버사이즈&inStock=true`,
    )

    const chips = await screen.findByRole('group', { name: filters.appliedLabel })

    await user.click(within(chips).getByRole('button', { name: filters.clearAll }))

    await waitFor(() => {
      expect(navigation.params.get('attr.fit')).toBeNull()
      expect(navigation.params.get('inStock')).toBeNull()
      expect(navigation.params.get('q')).toBe('코트')
      expect(navigation.params.get('categoryId')).toBe(String(SEARCH_COAT_CATEGORY))
    })
  })
})

describe('정렬', () => {
  it('reorders through the URL like every other choice', async () => {
    const user = userEvent.setup()
    renderSearch(`/search?categoryId=${String(SEARCH_COAT_CATEGORY)}`)

    await user.click(await screen.findByRole('combobox', { name: messages.sort.label }))
    await user.click(await screen.findByRole('option', { name: messages.sort.names.price_asc }))

    await waitFor(() => {
      expect(navigation.params.get('sort')).toBe('price_asc')
    })
    await waitFor(async () => {
      expect(await productNames()).toEqual([
        '경량 발마칸 코트',
        '오버핏 싱글 코트',
        '슬림 더블 코트',
      ])
    })
  })
})
