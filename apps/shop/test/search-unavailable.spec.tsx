/**
 * 검색 엔진에 닿지 못할 때 화면은 기다린다 (TASK-0143 F5 ~ F9 · P2 · P3).
 *
 * The API is awake and its search engine is not: `/health` answers 200 with
 * `search: "down"` and every search answers 503 `SEARCH_UNAVAILABLE`. That is a
 * state that passes — the engine is a separate free service that sleeps and
 * restarts on its own — so nothing here may tell the visitor to do anything
 * until the wake-up budget has actually been spent.
 *
 * **Nobody presses anything in the recovery specs.** `userEvent` appears only
 * after a budget has ended, which is the one place a button is allowed to exist.
 *
 * **The clock is turned down, not faked**, as in `api-wake-gate.spec.tsx`: the
 * gate and the search hook take their policy as a value. The one measurement
 * that needs the production numbers — the 21 request ceiling, F8 — is in
 * `wake.spec.ts`, against the loop itself. The two axe runs use the real pages
 * and the real policy; they assert on the first notice and wait for nothing.
 *
 * The describe names carry the criterion they measure.
 */

import {
  healthHandlers,
  httpFailure,
  mockPaths,
  searchHandlers,
  searchUnavailableFor,
  unreachableSearchEngine,
} from '@shopping/api-mocks'
import { DENSITY_STORAGE_KEY } from '@shopping/ui'
import { DensityProvider } from '@shopping/ui/density'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import type { RunOptions } from 'axe-core'
import { useContext } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import HomePage from '@/app/page'
import { ApiWakeGate } from '@/components/api-wake-gate'
import { ProductSection } from '@/components/home/product-section'
import { ResultBrowser } from '@/components/search/result-browser'
import { resetCategoryMenuCache } from '@/lib/categories/use-category-menu'
import { resetLocalHistoryCache } from '@/lib/collections/use-recently-viewed'
import { SectionReadiness } from '@/lib/products/section-readiness'
import { useSearch } from '@/lib/search/use-search'
import type { WakePolicy } from '@/lib/wake-policy'
import { WAKE_POLICY } from '@/lib/wake-policy'
import { messagesFor } from '@/messages'

import { renderWithAuth } from './support/auth'
import { resetCommunityStores, stubCommunityApi } from './support/community'
import { navigation } from './support/navigation'
import { testServer } from './setup'
import { stubViewport, VIEWPORTS } from './support/viewport'

vi.mock('next/navigation', async () => {
  const { nextNavigationMock } = await import('./support/navigation')

  return nextNavigationMock()
})

const { default: SearchPage } = await import('@/app/search/page')

const messages = messagesFor()
const { home, search, wake } = messages
const box = messages.layout.search

// Module level: both hooks take the policy as an effect dependency, so an
// object rebuilt per render would restart the sequence forever.
const FAST: WakePolicy = {
  ...WAKE_POLICY,
  attemptTimeoutMs: 300,
  // Out of reach on purpose — nothing under this policy is meant to run out,
  // and the specs that hold the waiting state still need it to stay there.
  budgetMs: 10_000,
  backoffMs: [10, 20],
  noticeAfterMs: 40,
  tickMs: 10,
}

// {@link FAST} that gives up, for the specs that are *about* giving up. Nothing
// under it recovers, so the narrow budget costs no reliability.
const GIVES_UP: WakePolicy = { ...FAST, budgetMs: 600, backoffMs: [20] }

// {@link FAST} whose delay notice is out of reach: if 「준비 중」 shows under it,
// that is because the API answered and named search — not because the wait grew
// long enough to be explained.
const NO_DELAY_NOTICE: WakePolicy = { ...FAST, noticeAfterMs: 60_000 }

const NEVER = Number.POSITIVE_INFINITY

const OPTIONS: RunOptions = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] },
  rules: {
    // jsdom paints nothing, so axe cannot decide contrast.
    'color-contrast': { enabled: false },
    // The document shell — lang, title, the `main` landmark — belongs to
    // `app/layout.tsx`, which is not rendered here.
    'html-has-lang': { enabled: false },
    'document-title': { enabled: false },
    region: { enabled: false },
    'landmark-one-main': { enabled: false },
  },
}

async function expectNoViolations(): Promise<void> {
  const results = await axe.run(document.body, OPTIONS)

  expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([])
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * The most `role="alert"` elements the document has held at once, over every
 * commit since this was called.
 *
 * "No alert at the end" is the weaker claim: a row that announced a failure and
 * took it back a moment later would pass it, and a screen reader would already
 * have read the failure out. F5 and F6 mean *never*.
 */
function watchAlerts(): () => number {
  let most = 0
  const count = (): void => {
    most = Math.max(most, document.querySelectorAll('[role="alert"]').length)
  }

  observer = new MutationObserver(count)
  observer.observe(document.body, {
    attributeFilter: ['role'],
    attributes: true,
    childList: true,
    subtree: true,
  })

  return () => {
    count()

    return most
  }
}

let observer: MutationObserver | null = null
let requests: string[] = []

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem(DENSITY_STORAGE_KEY, '2')
  document.documentElement.setAttribute('data-density', '2')
  resetCategoryMenuCache()
  resetLocalHistoryCache()
  resetCommunityStores()
  stubViewport(VIEWPORTS.desktop)
  stubCommunityApi()

  requests = []
  testServer.server.events.on('request:start', ({ request }) => {
    requests.push(request.url)
  })
})

afterEach(() => {
  observer?.disconnect()
  observer = null
  vi.unstubAllGlobals()
  testServer.server.events.removeAllListeners('request:start')
})

const retryButtons = (): HTMLElement[] =>
  // One name for both: the gate's button and a row's say 「다시 시도」 alike.
  screen.queryAllByRole('button', { name: wake.retryLabel })

/** The gate alone, with a probe where the rows go — what F6 and F7 count on. */
function ReadinessProbe() {
  return <p>{`products ${useContext(SectionReadiness)}`}</p>
}

function renderGate(policy: WakePolicy) {
  return renderWithAuth(
    <ApiWakeGate policy={policy} wake={wake}>
      <ReadinessProbe />
    </ApiWakeGate>,
  )
}

/**
 * The home's two rows inside the home's gate — `app/page.tsx` with the policy
 * turned down, which the page itself has no prop for.
 */
function renderRows(policy: WakePolicy) {
  return renderWithAuth(
    <DensityProvider>
      <ApiWakeGate policy={policy} wake={wake}>
        <ProductSection
          href="/search?sort=newest"
          messages={home}
          sort="newest"
          title={home.newTitle}
        />
        <ProductSection
          href="/search?sort=sales"
          messages={home}
          sort="sales"
          title={home.popularTitle}
        />
      </ApiWakeGate>
    </DensityProvider>,
  )
}

async function rowGrid(title: string): Promise<HTMLElement> {
  return screen.findByRole('list', { name: home.gridLabel.replace('{title}', title) })
}

describe('F5 — 홈이 사람 개입 없이 회복한다', () => {
  it('fills both rows once health says search is ok, from the third check', async () => {
    // down → degraded → ok. The middle check is R2: the engine has no disk, so
    // it comes back empty and a search in that window answers zero results. A
    // row that believed that would say 「아직 보여드릴 상품이 없습니다」.
    const engine = unreachableSearchEngine({ downChecks: 1, indexingChecks: 1 })
    testServer.server.use(...engine.handlers)
    const alertsSeen = watchAlerts()

    renderRows(FAST)

    const newest = await rowGrid(home.newTitle)
    const popular = await rowGrid(home.popularTitle)

    expect(within(newest).getAllByRole('listitem').length).toBeGreaterThan(0)
    expect(within(popular).getAllByRole('listitem').length).toBeGreaterThan(0)
    expect(engine.healthRequests()).toBe(3)

    // Not one alert on the way, not only none at the end — and nothing was
    // pressed, because nothing pressable was ever drawn.
    expect(alertsSeen()).toBe(0)
    expect(retryButtons()).toHaveLength(0)
    expect(screen.queryByText(wake.storefrontPreparing)).toBeNull()
    expect(screen.queryByText(home.sectionEmpty)).toBeNull()
  })

  // R2 from the rows' side: the engine is already up when they first ask, and
  // its index is not. The answer is 200 with nothing in it — not a catalogue
  // with nothing in it.
  it('does not take an index that is still being rebuilt for an empty shop', async () => {
    const engine = unreachableSearchEngine({ downChecks: 0, indexingChecks: 2 })
    testServer.server.use(...engine.handlers)
    const alertsSeen = watchAlerts()

    renderRows(FAST)

    expect(await screen.findByText(wake.storefrontPreparing)).toBeVisible()
    expect(screen.queryByText(home.sectionEmpty)).toBeNull()

    expect(await rowGrid(home.newTitle)).toBeVisible()
    expect(await rowGrid(home.popularTitle)).toBeVisible()
    expect(screen.queryByText(home.sectionEmpty)).toBeNull()
    expect(alertsSeen()).toBe(0)
  })

  it('asks each row again exactly once, on the flip to ready', async () => {
    const engine = unreachableSearchEngine({ downChecks: 2 })
    testServer.server.use(...engine.handlers)

    renderRows(FAST)
    await rowGrid(home.newTitle)
    await rowGrid(home.popularTitle)

    // Two rows, each refused once at mount and answered once after the flip.
    // The checks in between cost the rows nothing: it is the gate that waits.
    expect(engine.searchRequests()).toBe(4)
  })
})

describe('F6 · P2 — 기다리는 동안 실패를 말하지 않는다', () => {
  it('shows one status, no alert and no retry button while the gate keeps asking', async () => {
    const engine = unreachableSearchEngine({ downChecks: NEVER })
    testServer.server.use(...engine.handlers)
    const alertsSeen = watchAlerts()

    renderGate(FAST)

    // Well into the retries, not merely after the first answer.
    await waitFor(() => {
      expect(engine.healthRequests()).toBeGreaterThan(3)
    })

    const statuses = screen.getAllByRole('status')

    expect(statuses).toHaveLength(1)
    expect(statuses[0]).toHaveTextContent(wake.storefrontPreparing)
    expect(screen.getByText('products pending')).toBeVisible()
    expect(alertsSeen()).toBe(0)
    expect(retryButtons()).toHaveLength(0)
  })

  it('says so at once, without the three quiet seconds of an ordinary load', async () => {
    testServer.server.use(...unreachableSearchEngine({ downChecks: NEVER }).handlers)

    renderGate(NO_DELAY_NOTICE)

    expect(await screen.findByRole('status')).toHaveTextContent(wake.storefrontPreparing)
  })

  it('keeps the rows as skeletons under that one sentence', async () => {
    const engine = unreachableSearchEngine({ downChecks: NEVER })
    testServer.server.use(...engine.handlers)
    const alertsSeen = watchAlerts()

    renderRows(FAST)

    await waitFor(() => {
      expect(engine.healthRequests()).toBeGreaterThan(3)
    })

    // The rows' skeletons carry their own screen-reader `status`; what there is
    // exactly one of is the sentence a visitor reads.
    const notices = screen.getAllByText(wake.storefrontPreparing)

    expect(notices).toHaveLength(1)
    expect(notices[0]?.closest('[role="status"]')).not.toBeNull()
    expect(screen.getAllByText(home.loadingLabel)).toHaveLength(2)
    expect(screen.queryByText(home.sectionFailed)).toBeNull()
    expect(screen.queryByText(home.sectionEmpty)).toBeNull()
    expect(alertsSeen()).toBe(0)
    expect(retryButtons()).toHaveLength(0)
  })
})

describe('F7 · P2 — 예산이 끝나면 실패로 넘어간다', () => {
  it('ends on one alert and a retry button, and then asks for nothing more', async () => {
    const engine = unreachableSearchEngine({ downChecks: NEVER })
    testServer.server.use(...engine.handlers)

    renderGate(GIVES_UP)

    const alert = await screen.findByRole('alert')

    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(alert).toHaveTextContent(wake.storefrontFailed)
    expect(within(alert).getByRole('button', { name: wake.retryLabel })).toBeVisible()
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByText('products failed')).toBeVisible()

    const spent = requests.length
    const checks = engine.healthRequests()
    await pause(300)

    // More than one check — it did wait — and then none of any kind: no
    // re-check timer picks up where the budget left off (R3).
    expect(checks).toBeGreaterThan(1)
    expect(engine.healthRequests()).toBe(checks)
    expect(requests).toHaveLength(spent)
  })

  it('turns the waiting rows into failures without asking them again', async () => {
    const engine = unreachableSearchEngine({ downChecks: NEVER })
    testServer.server.use(...engine.handlers)

    renderRows(GIVES_UP)

    // The gate's, and one per row: a row that stayed a skeleton under 「불러오지
    // 못했어요」 would be promising something nobody is fetching.
    await waitFor(() => {
      expect(screen.getAllByRole('alert')).toHaveLength(3)
    })
    expect(screen.getAllByText(home.sectionFailed)).toHaveLength(3)
    expect(retryButtons()).toHaveLength(3)
    expect(screen.queryByText(home.loadingLabel)).toBeNull()

    // Giving up is the decision to stop asking — it is not itself a request.
    expect(engine.searchRequests()).toBe(2)

    const spent = requests.length
    await pause(300)

    expect(requests).toHaveLength(spent)
  })

  it('starts over from the gate’s button, and the rows go back to waiting', async () => {
    testServer.server.use(...unreachableSearchEngine({ downChecks: NEVER }).handlers)
    renderRows(GIVES_UP)

    await waitFor(() => {
      expect(screen.getAllByRole('alert')).toHaveLength(3)
    })

    testServer.server.use(...healthHandlers, ...searchHandlers)
    // The gate draws after its children, so its button is the last of the three.
    await userEvent.click(retryButtons().at(-1)!)

    expect(await rowGrid(home.newTitle)).toBeVisible()
    expect(await rowGrid(home.popularTitle)).toBeVisible()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('lets one row ask again on its own', async () => {
    testServer.server.use(...unreachableSearchEngine({ downChecks: NEVER }).handlers)
    renderRows(GIVES_UP)

    await waitFor(() => {
      expect(screen.getAllByRole('alert')).toHaveLength(3)
    })

    testServer.server.use(...searchHandlers)
    await userEvent.click(retryButtons()[0]!)

    expect(await rowGrid(home.newTitle)).toBeVisible()
    expect(screen.getAllByRole('alert')).toHaveLength(2)
  })
})

function renderSearch(href: string) {
  navigation.start(href)

  return renderWithAuth(
    <DensityProvider>
      <SearchPage />
    </DensityProvider>,
  )
}

/** The results half of the search screen, with the policy turned down. */
function Results({ policy }: { readonly policy: WakePolicy }) {
  const controller = useSearch({}, policy)

  return <ResultBrowser controller={controller} messages={search} />
}

function renderResults(policy: WakePolicy) {
  navigation.start('/search?q=코트')

  return renderWithAuth(
    <DensityProvider>
      <Results policy={policy} />
    </DensityProvider>,
  )
}

const resultList = (): Promise<HTMLElement> =>
  screen.findByRole('list', { name: search.list.gridLabel })

describe('F9 · P2 — 검색 결과 화면의 준비 중 안내와 자동 회복', () => {
  // The real page and the real policy: one refusal is one 1s backoff.
  it('says 「검색을 준비하고 있어요」 and then shows the results, with nothing pressed', async () => {
    testServer.server.use(searchUnavailableFor(mockPaths.search, 1))
    const alertsSeen = watchAlerts()

    renderSearch('/search?q=코트')

    const notice = await screen.findByText(search.preparing)

    expect(notice).toHaveAttribute('role', 'status')
    expect(screen.queryByText(search.list.errorTitle)).toBeNull()
    expect(screen.queryByRole('button', { name: search.list.retry })).toBeNull()

    const list = await resultList()

    expect(within(list).getAllByRole('listitem').length).toBeGreaterThan(0)
    expect(screen.queryByText(search.preparing)).toBeNull()
    expect(alertsSeen()).toBe(0)
  })

  it('keeps asking through several refusals, on the wake-up’s backoff', async () => {
    testServer.server.use(searchUnavailableFor(mockPaths.search, 3))
    const alertsSeen = watchAlerts()

    renderResults(FAST)

    expect(await screen.findByText(search.preparing)).toBeVisible()
    expect(await resultList()).toBeVisible()
    expect(alertsSeen()).toBe(0)
    // Three refusals and the answer — and then it stops asking.
    expect(requests.filter((url) => new URL(url).pathname.endsWith('/search'))).toHaveLength(4)
  })

  it('falls back to the failure it always had once the budget ends, and then stops', async () => {
    testServer.server.use(searchUnavailableFor(mockPaths.search, NEVER))

    renderResults(GIVES_UP)

    const alert = await screen.findByRole('alert')

    expect(alert).toHaveTextContent(search.list.errorTitle)
    expect(screen.queryByText(search.preparing)).toBeNull()

    const spent = requests.length
    await pause(300)

    expect(spent).toBeGreaterThan(1)
    expect(requests).toHaveLength(spent)

    testServer.server.use(...searchHandlers)
    await userEvent.click(within(alert).getByRole('button', { name: search.list.retry }))

    expect(await resultList()).toBeVisible()
  })

  it('does not wait out a failure that is not the engine’s schedule', async () => {
    testServer.server.use(httpFailure(mockPaths.search, 500, 'INTERNAL_ERROR', 'Boom'))

    renderResults(FAST)

    expect(await screen.findByRole('alert')).toHaveTextContent(search.list.errorTitle)
    expect(screen.queryByText(search.preparing)).toBeNull()
    expect(requests.filter((url) => new URL(url).pathname.endsWith('/search'))).toHaveLength(1)
  })

  it('shows nothing under the search box when suggestions are refused', async () => {
    testServer.server.use(searchUnavailableFor(mockPaths.searchSuggest, NEVER))
    const alertsSeen = watchAlerts()
    const user = userEvent.setup()

    renderSearch('/search')
    await user.type(screen.getAllByRole('combobox', { name: box.label })[0]!, '코트')

    // Past the 250ms debounce, so the refusal has arrived and been dropped.
    await pause(500)

    expect(requests.some((url) => new URL(url).pathname.endsWith('/search/suggest'))).toBe(true)
    expect(screen.queryByRole('option')).toBeNull()
    expect(alertsSeen()).toBe(0)
  })
})

describe('P3 — 준비 중 화면의 axe', () => {
  it('finds nothing on the home while the engine is away', async () => {
    testServer.server.use(...unreachableSearchEngine({ downChecks: NEVER }).handlers)

    renderWithAuth(
      <DensityProvider>
        <HomePage />
      </DensityProvider>,
    )

    expect(await screen.findByText(wake.storefrontPreparing)).toBeVisible()
    await expectNoViolations()
  })

  it('finds nothing on the results screen while it is being prepared', async () => {
    testServer.server.use(searchUnavailableFor(mockPaths.search, NEVER))

    renderSearch('/search?q=코트')

    expect(await screen.findByText(search.preparing)).toBeVisible()
    await expectNoViolations()
  })

  it('finds nothing on the home once the budget has ended', async () => {
    testServer.server.use(...unreachableSearchEngine({ downChecks: NEVER }).handlers)

    renderRows(GIVES_UP)

    await waitFor(() => {
      expect(screen.getAllByRole('alert')).toHaveLength(3)
    })
    await expectNoViolations()
  })
})
