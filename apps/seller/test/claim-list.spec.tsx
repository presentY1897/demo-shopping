/**
 * `/claims` — 판매자 취소·반품 목록 (TASK-0070 6장).
 *
 * API 는 `@shopping/api-mocks` 이고 그 목은 **상태를 갖는다.** 그래서 여기서 단언하는
 * 것은 화면이 「무엇을 그렸나」가 아니라 **「무엇을 했나」**다 — 대기가 정말 먼저
 * 오는가, 커서를 끝까지 넘기며 한 줄도 겹치거나 빠지지 않는가, 탭을 옮기면 서버에
 * 실제로 다른 단계가 나가는가. 얼어붙은 응답으로는 그중 무엇도 실패할 수 없다.
 */

import {
  httpFailureOn,
  mockPaths,
  sellerClaimHandlers,
  sellerClaimPage,
  sellerClaimSummary,
} from '@shopping/api-mocks'
import { render, screen, waitFor, within } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ClaimsPage from '@/app/claims/page'
import { messagesFor } from '@/messages'

import { testServer } from './setup'
import { stubViewport, VIEWPORTS } from './support/viewport'

const copy = messagesFor().claimList
const vocabulary = messagesFor().claims

beforeEach(() => {
  /*
   * **판매자 저장소를 앞에 세운다.**
   *
   * `/claims/:id/transitions` 는 구매자 화면(TASK-0065)도 쓰는 라우트이고, 기본
   * 목록에서는 먼저 등록된 그쪽이 이긴다. 한 화면의 검사가 두 저장소를 섞어 보게 두면
   * 실패가 「어느 목이 답했나」에 달리게 된다.
   */
  testServer.server.use(...sellerClaimHandlers)
  // 콘솔은 데스크톱 퍼스트다. 표가 기본이고, 카드는 아래 모바일 절이 따로 잰다.
  stubViewport(VIEWPORTS.desktop)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function openList(): Promise<HTMLElement> {
  render(<ClaimsPage />)

  return screen.findByRole('table', { name: copy.table.caption })
}

/** 표의 데이터 줄. 머리글은 뺀다. */
function rows(table: HTMLElement): readonly HTMLElement[] {
  const [, ...body] = within(table).getAllByRole('row')

  return body
}

function table(): HTMLElement {
  return screen.getByRole('table', { name: copy.table.caption })
}

/** 탭 하나를 누른다. 이름에 건수가 붙어 있으므로 부분 일치로 찾는다. */
async function openTab(user: UserEvent, name: string): Promise<void> {
  await user.click(screen.getByRole('tab', { name: new RegExp(name, 'u') }))
}

/** 이 줄이 어느 단계인가 — 배지의 문장으로. 작을수록 먼저 와야 한다. */
function stageRankOf(row: HTMLElement): number {
  const labels = [
    vocabulary.stageLabels.WAITING,
    vocabulary.stageLabels.IN_PROGRESS,
    vocabulary.stageLabels.CLOSED,
  ]
  const rank = labels.findIndex((label) => within(row).queryByText(label) !== null)

  if (rank < 0) throw new Error('단계 배지가 없는 줄이 있습니다.')

  return rank
}

/**
 * 나가는 목록 질의에만 `limit` 을 얹어 한 페이지를 좁힌다.
 *
 * 픽스처 열 줄은 기본 한 페이지(20)에 통째로 들어가므로 화면이 「다음」을 누를 일이
 * 없다. **페이지 크기는 화면의 것이 아니라 서버의 것**이라 화면에 그 손잡이를 뚫지
 * 않고, 검사가 여기서 질의만 고친다 — 커서를 만드는 것도 이어 붙이는 것도 여전히
 * 목이고, 화면이 하는 일은 받은 커서를 **그대로 되돌려주는 것**뿐이다.
 */
function narrowPagesTo(size: number): void {
  const answer = globalThis.fetch

  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const url = new URL(href)

    if (!url.pathname.endsWith('/seller-claims')) return answer(input, init)

    url.searchParams.set('limit', String(size))

    return answer(url, init)
  })
}

describe('U1 · P5 — 네 상태', () => {
  it('announces the wait before the API has answered', () => {
    render(<ClaimsPage />)

    expect(screen.getByRole('status')).toHaveTextContent(copy.loadingLabel)
  })

  it('draws the first page once it arrives', async () => {
    expect(rows(await openList())).toHaveLength(sellerClaimPage.claims.length)
  })

  it('offers a retry rather than an empty table when the load fails (U6)', async () => {
    testServer.server.use(
      httpFailureOn('get', mockPaths.sellerClaims, 500, 'INTERNAL_ERROR', '서버 오류'),
    )
    render(<ClaimsPage />)

    expect(await screen.findByText(copy.errorTitle)).toBeVisible()
    expect(screen.getByRole('button', { name: copy.retry })).toBeVisible()
  })

  it('tells an empty filter from an empty store', async () => {
    await openList()

    const user = userEvent.setup()

    // 취소이면서 반품 신청인 건은 없다 — 조합이 비는 것이지 가게가 빈 것이 아니다.
    await user.click(screen.getByRole('combobox', { name: copy.filters.typeLabel }))
    await user.click(await screen.findByRole('option', { name: vocabulary.typeLabels.CANCEL }))
    await user.click(screen.getByRole('combobox', { name: copy.filters.statusLabel }))
    await user.click(
      await screen.findByRole('option', { name: vocabulary.statusLabels.RETURN_REQUESTED }),
    )

    expect(await screen.findByText(copy.filteredEmpty.title)).toBeVisible()
  })
})

describe('처리 대기가 먼저 온다', () => {
  /**
   * **판매자가 묻는 것은 「내가 지금 뭘 해야 하나」다.**
   *
   * 정렬이 없으면 이 목록은 신청 순서로 섞여 있고, 처리할 다섯 건을 찾으려면 열 줄을
   * 전부 읽어야 한다. 정렬은 서버의 것이므로 화면이 다시 정렬해서도 안 된다 — 그러면
   * 커서가 가리키는 자리와 화면의 순서가 갈린다.
   */
  it('puts every 처리 대기 row first, even on the 전체 tab', async () => {
    const ranks = rows(await openList()).map(stageRankOf)

    expect(ranks[0]).toBe(0)
    expect(ranks).toEqual([...ranks].sort((left, right) => left - right))
  })

  it('narrows the list to the tab’s stage', async () => {
    await openList()

    const user = userEvent.setup()

    await openTab(user, copy.tabs.names.closed)

    await waitFor(() => {
      const body = rows(table())

      expect(body.length).toBeGreaterThan(0)
      for (const row of body) expect(stageRankOf(row)).toBe(2)
    })
  })

  it('shows the count beside each tab', async () => {
    await openList()

    expect(
      await screen.findByRole('tab', {
        name: copy.tabs.countLabel
          .replace('{name}', copy.tabs.names.waiting)
          .replace('{count}', String(sellerClaimSummary.summary.stages.WAITING)),
      }),
    ).toBeVisible()
  })
})

describe('뱃지', () => {
  it('shows what is waiting, from its own request', async () => {
    await openList()

    expect(
      await screen.findByText(
        copy.badges.waiting.replace('{count}', String(sellerClaimSummary.summary.waiting)),
      ),
    ).toBeVisible()
  })

  /**
   * **뱃지가 필터를 따라 움직이면 그것은 뱃지가 아니다.**
   *
   * 목록과 같은 요청에 실었다면 탭을 옮기는 순간 숫자가 바뀐다. 그 숫자는 사이드바에
   * 그릴 수 없고, 「처리할 것이 몇 건인가」에도 답하지 못한다.
   */
  it('does not move when the tab does', async () => {
    await openList()

    const badge = copy.badges.waiting.replace('{count}', String(sellerClaimSummary.summary.waiting))

    await screen.findByText(badge)

    const user = userEvent.setup()

    await openTab(user, copy.tabs.names.closed)
    await waitFor(() => {
      expect(screen.getByText(badge)).toBeVisible()
    })
  })
})

describe('커서 페이지네이션', () => {
  /** 지금 화면에 있는 줄들을, 줄마다 하나의 문자열로. */
  function textOfRows(): readonly string[] {
    return rows(table()).map((row) => row.textContent ?? '')
  }

  it('walks every row without repeating or losing one', async () => {
    narrowPagesTo(4)

    await openList()

    const seen: string[] = [...textOfRows()]
    const user = userEvent.setup()

    // 4 · 4 · 2 — 마지막 페이지에서 「다음」이 닫힌다.
    for (let page = 0; page < 2; page += 1) {
      const first = seen.at(-1)

      await user.click(screen.getByRole('button', { name: copy.pagination.next }))
      await waitFor(() => {
        expect(textOfRows().at(-1)).not.toBe(first)
      })
      seen.push(...textOfRows())
    }

    // 오프셋이었다면 두 페이지가 겹친다. 커서를 쓰는 이유가 이것이고, 겹침은 「목록이
    // 이상하다」로만 신고된다.
    expect(seen).toHaveLength(sellerClaimPage.claims.length)
    expect(new Set(seen).size).toBe(sellerClaimPage.claims.length)
    expect(screen.getByRole('button', { name: copy.pagination.next })).toBeDisabled()
  })

  it('goes back to the first page when the filter changes', async () => {
    narrowPagesTo(4)
    await openList()

    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: copy.pagination.next }))
    await screen.findByText(copy.pagination.page.replace('{page}', '2'))

    await openTab(user, copy.tabs.names.waiting)

    // 커서는 그 필터 안에서만 위치를 뜻한다. 들고 가면 이제 존재하지 않는 목록을 이어
    // 달라고 하는 셈이다.
    await waitFor(() => {
      expect(screen.getByText(copy.pagination.page.replace('{page}', '1'))).toBeVisible()
    })
  })
})

describe('지연 강조', () => {
  /**
   * **색만으로 말하지 않는다.**
   *
   * 붉은 글씨는 색을 구분하지 못하는 사람에게 그냥 글씨이고, 흑백 인쇄에서는 아무것도
   * 아니다. 그래서 배지가 문장을 들고 있고, 검사가 재는 것도 그 문장이다.
   */
  it('marks every overdue row with words, not only a colour', async () => {
    const body = await openList()
    const overdue = sellerClaimPage.claims.filter((claim) => claim.overdue)

    expect(overdue.length).toBeGreaterThan(0)
    expect(within(body).getAllByText(copy.deadline.overdue)).toHaveLength(overdue.length)
  })

  it('says the rule the server actually used', async () => {
    await openList()

    // 주말만 세고 공휴일은 보지 않는다. 적어 두지 않으면 연휴에 뜨는 「기한 초과」가
    // 버그로 신고된다.
    expect(screen.getByText(copy.deadline.rule)).toBeVisible()
  })
})

describe('모바일', () => {
  it('mounts cards instead of a table at 360px', async () => {
    stubViewport(VIEWPORTS.mobile)
    render(<ClaimsPage />)

    // 두 벌을 CSS 로 감추지 않는다 — 그러면 DOM 이 두 배가 되고 접근성 트리도
    // 중복된다 (설계서 「모바일 전용 UI 패턴」).
    expect(await screen.findByRole('list', { name: copy.table.caption })).toBeVisible()
    expect(screen.queryByRole('table', { name: copy.table.caption })).toBeNull()
  })

  it('still reaches the detail from a card', async () => {
    stubViewport(VIEWPORTS.mobile)
    render(<ClaimsPage />)

    const list = await screen.findByRole('list', { name: copy.table.caption })

    expect(within(list).getAllByRole('link', { name: copy.table.open }).length).toBeGreaterThan(0)
  })
})
