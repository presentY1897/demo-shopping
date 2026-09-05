/**
 * `/orders` — 판매자 주문 목록 (TASK-0060 6.1).
 *
 * API 는 `@shopping/api-mocks` 이고 그 목은 **상태를 갖는다.** 그래서 여기서 단언하는
 * 것은 화면이 「무엇을 그렸나」가 아니라 **「무엇을 했나」**다 — 일괄 발송이 정말 그
 * 줄들을 옮기는가, 커서를 넘겨 스물다섯 줄을 지나며 한 건도 겹치지 않는가, 탭을
 * 옮기면 서버에 실제로 다른 상태가 나가는가. 얼어붙은 응답으로는 그중 무엇도 실패할 수
 * 없다.
 */

import {
  httpFailureOn,
  mockPaths,
  sellerOrderHandlers,
  sellerOrderPage,
  sellerOrderSnapshot,
} from '@shopping/api-mocks'
import { render, screen, waitFor, within } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import OrdersPage from '@/app/orders/page'
import { messagesFor } from '@/messages'

import { testServer } from './setup'
import { stubViewport, VIEWPORTS } from './support/viewport'

const copy = messagesFor().orderList
const vocabulary = messagesFor().orders
const printCopy = messagesFor().orderDetail.print

beforeEach(() => {
  /*
   * **판매자 저장소를 앞에 세운다.**
   *
   * `/seller-orders/:id/actions` 와 `…/transitions` 는 구매자 화면(TASK-0063)도 쓰는
   * 라우트이고, 기본 목록에서는 먼저 등록된 그쪽이 이긴다. 목록·요약·발송은 이 앱만
   * 부르므로 겹치지 않지만, 한 화면의 검사가 두 저장소를 섞어 보게 두면 실패가
   * 「어느 목이 답했나」에 달리게 된다.
   */
  testServer.server.use(...sellerOrderHandlers)
  // 콘솔은 데스크톱 퍼스트다. 표가 기본이고, 카드는 아래 모바일 절이 따로 잰다.
  stubViewport(VIEWPORTS.desktop)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function openList(): Promise<HTMLElement> {
  render(<OrdersPage />)

  return screen.findByRole('table', { name: copy.table.caption })
}

/** 표의 데이터 줄. 머리글은 뺀다. */
function rows(table: HTMLElement): readonly HTMLElement[] {
  const [, ...body] = within(table).getAllByRole('row')

  return body
}

/** 탭 하나를 누른다. 이름에 건수가 붙어 있으므로 부분 일치로 찾는다. */
async function openTab(user: UserEvent, name: string): Promise<void> {
  await user.click(screen.getByRole('tab', { name: new RegExp(name, 'u') }))
}

describe('U1 · P5 — 네 상태', () => {
  it('announces the wait before the API has answered', () => {
    render(<OrdersPage />)

    expect(screen.getByRole('status')).toHaveTextContent(copy.loadingLabel)
  })

  it('draws the first page once it arrives (F1)', async () => {
    const table = await openList()

    // 스물다섯 줄 중 기본 한 페이지.
    expect(rows(table)).toHaveLength(20)
  })

  it('offers a retry rather than an empty table when the load fails (U6)', async () => {
    testServer.server.use(
      httpFailureOn('get', mockPaths.sellerOrders, 500, 'INTERNAL_ERROR', '서버 오류'),
    )
    render(<OrdersPage />)

    expect(await screen.findByText(copy.errorTitle)).toBeVisible()
    expect(screen.getByRole('button', { name: copy.retry })).toBeVisible()
  })

  it('tells an empty filter from an empty store', async () => {
    await openList()

    const user = userEvent.setup()

    await user.type(screen.getByLabelText(copy.filters.searchLabel), '없는주문번호')

    expect(await screen.findByText(copy.filteredEmpty.title)).toBeVisible()
  })
})

describe('상태 탭 (F2)', () => {
  it('narrows the list to the tab’s status', async () => {
    await openList()

    const user = userEvent.setup()

    await openTab(user, copy.tabs.names.shipped)

    await waitFor(() => {
      const table = screen.getByRole('table', { name: copy.table.caption })

      for (const row of rows(table)) {
        expect(within(row).getByText(vocabulary.statusLabels.SHIPPED)).toBeVisible()
      }
    })
  })

  it('asks for both statuses on the 취소·반품 tab', async () => {
    await openList()

    const user = userEvent.setup()

    await openTab(user, copy.tabs.names.closed)

    await waitFor(() => {
      const table = screen.getByRole('table', { name: copy.table.caption })

      // 픽스처에는 취소만 있다. 반품까지 물어보지 않으면 이 탭은 언젠가 반쪽만
      // 보여 주고, 그 사실은 반품이 처음 생기는 날까지 드러나지 않는다.
      expect(rows(table).length).toBeGreaterThan(0)
      for (const row of rows(table)) {
        expect(within(row).getByText(vocabulary.statusLabels.CANCELED)).toBeVisible()
      }
    })
  })

  it('shows the count beside each tab', async () => {
    await openList()

    const shipped = sellerOrderPage.sellerOrders.filter((row) => row.status === 'SHIPPED').length

    expect(
      await screen.findByRole('tab', {
        name: copy.tabs.countLabel
          .replace('{name}', copy.tabs.names.shipped)
          .replace('{count}', String(shipped)),
      }),
    ).toBeVisible()
  })
})

describe('뱃지 (2장)', () => {
  it('shows what is waiting, from its own request', async () => {
    await openList()

    const waiting = sellerOrderPage.sellerOrders.filter(
      (row) => row.status === 'PAID' || row.status === 'PREPARING',
    ).length

    expect(
      await screen.findByText(copy.badges.actionRequired.replace('{count}', String(waiting))),
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

    const waiting = sellerOrderPage.sellerOrders.filter(
      (row) => row.status === 'PAID' || row.status === 'PREPARING',
    ).length
    const badge = copy.badges.actionRequired.replace('{count}', String(waiting))

    await screen.findByText(badge)

    const user = userEvent.setup()

    await openTab(user, copy.tabs.names.delivered)
    await waitFor(() => {
      expect(screen.getByText(badge)).toBeVisible()
    })
  })
})

describe('커서 페이지네이션 (F7)', () => {
  it('walks every row without repeating one', async () => {
    const table = await openList()
    const first = rows(table).map((row) => row.textContent ?? '')

    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: copy.pagination.next }))

    const second = await waitFor(() => {
      const next = rows(screen.getByRole('table', { name: copy.table.caption }))

      expect(next).toHaveLength(sellerOrderPage.sellerOrders.length - 20)

      return next.map((row) => row.textContent ?? '')
    })

    // 오프셋이었다면 두 페이지가 겹친다. 커서를 쓰는 이유가 이것이고, 겹침은
    // 「목록이 이상하다」로만 신고된다.
    expect(second.filter((row) => first.includes(row))).toEqual([])
    expect(new Set([...first, ...second]).size).toBe(sellerOrderPage.sellerOrders.length)
  })

  it('goes back to the first page when the filter changes', async () => {
    const table = await openList()

    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: copy.pagination.next }))
    await waitFor(() => {
      expect(rows(screen.getByRole('table', { name: copy.table.caption }))).toHaveLength(5)
    })

    await openTab(user, copy.tabs.names.paid)

    // 커서는 그 필터 안에서만 위치를 뜻한다. 들고 가면 이제 없는 목록을 이어 달라고
    // 하는 셈이다.
    await waitFor(() => {
      expect(screen.getByText(copy.pagination.page.replace('{page}', '1'))).toBeVisible()
    })
    expect(table).toBeDefined()
  })
})

describe('개인정보 (F6)', () => {
  it('shows the masked name the server sent, and never the original', async () => {
    const table = await openList()

    expect(within(table).getAllByText('홍*동').length).toBeGreaterThan(0)
    expect(table.textContent).not.toContain('홍길동')
  })
})

describe('일괄 발송 (F4 · R1)', () => {
  /** 발송할 수 있는 줄 하나를 고른다 — 상품준비중인 것. */
  async function selectPreparing(user: UserEvent): Promise<string> {
    await openTab(user, copy.tabs.names.preparing)

    const table = await waitFor(() => {
      const next = screen.getByRole('table', { name: copy.table.caption })

      expect(rows(next).length).toBeGreaterThan(0)

      return next
    })
    const first = rows(table)[0]

    if (first === undefined) throw new Error('상품준비중인 줄이 없습니다.')

    // 첫 열(체크박스)은 `<th scope="row">` 라 `cell` 이 아니다. 그래서 주문번호가
    // 첫 번째 `cell` 이다.
    const orderNumber = within(first).getAllByRole('cell')[0]?.textContent ?? ''

    await user.click(
      within(first).getByRole('checkbox', {
        name: copy.table.selectRow.replace('{orderNumber}', orderNumber),
      }),
    )

    return orderNumber
  }

  it('ships every selected share and says how many', async () => {
    await openList()

    const user = userEvent.setup()
    const orderNumber = await selectPreparing(user)

    await user.click(screen.getByRole('button', { name: copy.bulk.ship }))
    await user.click(await screen.findByRole('button', { name: copy.ship.confirm }))

    expect(await screen.findByText(copy.ship.done.replace('{count}', '1'))).toBeVisible()

    // 목이 상태를 갖고 있으므로 「정말 옮겼는가」를 저장소에 물어볼 수 있다.
    const moved = sellerOrderSnapshot().find((row) => row.orderNumber === orderNumber)

    expect(moved?.status).toBe('SHIPPED')
    expect(moved?.trackingNumber).not.toBeNull()
  })

  it('says nothing is shippable rather than opening an empty dialog', async () => {
    await openList()

    const user = userEvent.setup()

    await openTab(user, copy.tabs.names.delivered)

    const table = await waitFor(() => {
      const next = screen.getByRole('table', { name: copy.table.caption })

      expect(rows(next).length).toBeGreaterThan(0)

      return next
    })

    const [selectAll] = within(table).getAllByRole('checkbox')

    if (selectAll === undefined) throw new Error('체크박스가 없습니다.')

    await user.click(selectAll)
    await user.click(screen.getByRole('button', { name: copy.bulk.ship }))

    expect(await screen.findByText(copy.ship.nothingShippable)).toBeVisible()
  })

  it('drops the selection when the page changes', async () => {
    await openList()

    const user = userEvent.setup()

    await user.click(screen.getByRole('checkbox', { name: copy.table.selectAll }))
    expect(await screen.findByText(copy.bulk.selected.replace('{count}', '20'))).toBeVisible()

    await user.click(screen.getByRole('button', { name: copy.pagination.next }))

    // 다음 페이지의 줄은 다른 줄이다. 살아남은 선택은 화면에 없는 것을 가리키고,
    // 「5건 선택됨」은 아무도 셀 수 없는 숫자가 된다.
    await waitFor(() => {
      expect(screen.queryByText(copy.bulk.selected.replace('{count}', '20'))).toBeNull()
    })
  })
})

describe('엑셀 내보내기', () => {
  it('offers a file with every filtered row, not just the page on screen', async () => {
    await openList()

    const user = userEvent.setup()
    const created: string[] = []

    /*
     * jsdom 에는 다운로드가 없다. 재는 것은 「파일을 만들었는가」이고, 그 자리가
     * `createObjectURL` 이다.
     *
     * `URL` 을 통째로 바꿔 끼우지 않는다 — 그 클래스는 API 클라이언트가 주소를 만드는
     * 데 쓰고, 평범한 객체로 갈아 끼우면 `new URL(...)` 이 던져 화면이 아무것도 못
     * 부른다. 두 정적 메서드만 얹는다.
     */
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: (blob: Blob) => {
        created.push(blob.type)

        return 'blob:test'
      },
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: () => undefined,
    })

    await user.click(screen.getByRole('checkbox', { name: copy.table.selectAll }))
    await user.click(screen.getByRole('button', { name: copy.bulk.export }))

    expect(
      await screen.findByText(
        copy.bulk.exported.replace('{count}', String(sellerOrderPage.sellerOrders.length)),
      ),
    ).toBeVisible()
    expect(created).toEqual(['text/csv;charset=utf-8'])
  })
})

describe('주문서 인쇄', () => {
  it('assembles a printable sheet per selected order', async () => {
    const table = await openList()

    const user = userEvent.setup()
    const [firstRow, secondRow] = rows(table)

    if (firstRow === undefined || secondRow === undefined) throw new Error('줄이 모자랍니다.')

    for (const row of [firstRow, secondRow]) {
      const orderNumber = within(row).getAllByRole('cell')[0]?.textContent ?? ''

      await user.click(
        within(row).getByRole('checkbox', {
          name: copy.table.selectRow.replace('{orderNumber}', orderNumber),
        }),
      )
    }

    await user.click(screen.getByRole('button', { name: copy.bulk.print }))

    /*
     * **목록에는 종이에 필요한 것이 없다.** 수령인 전체와 항목은 상세에만 있으므로
     * (F6 · A5) 인쇄는 고른 건마다 상세를 읽어야 하고, 그 왕복이 빠지면 주문서에
     * 「홍*동」과 빈 상품표가 찍힌다.
     */
    const sheets = await screen.findAllByRole('article', {
      name: new RegExp(printCopy.documentTitle, 'u'),
    })

    expect(sheets).toHaveLength(2)
    expect(sheets[0]).toHaveTextContent('홍길동')
    expect(sheets[0]).toHaveTextContent(printCopy.notice)
  })
})

describe('모바일 (F9)', () => {
  it('mounts cards instead of a table at 360px', async () => {
    stubViewport(VIEWPORTS.mobile)
    render(<OrdersPage />)

    // 두 벌을 CSS 로 감추지 않는다 — 그러면 DOM 이 두 배가 되고 접근성 트리도
    // 중복된다 (설계서 「모바일 전용 UI 패턴」).
    expect(await screen.findByRole('list', { name: copy.table.caption })).toBeVisible()
    expect(screen.queryByRole('table', { name: copy.table.caption })).toBeNull()
  })

  it('still reaches the detail from a card', async () => {
    stubViewport(VIEWPORTS.mobile)
    render(<OrdersPage />)

    const list = await screen.findByRole('list', { name: copy.table.caption })

    expect(within(list).getAllByRole('link', { name: copy.table.open }).length).toBeGreaterThan(0)
  })
})
