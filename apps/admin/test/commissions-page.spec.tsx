/**
 * `/commissions`, 운영자가 실제로 만지는 대로 (TASK-0079).
 *
 * 아래의 검사는 전부 **진짜 화면을 그린 뒤 고르거나 입력한다.** 지어낸 프롭 꾸러미를
 * 컴포넌트에 건네지 않고 클래스 이름을 확인하지 않는다 (QUALITY-GATES Q5). 재는 것은
 * 우선순위가 화면의 구조로 서는가(F1·F2), 아무것도 설정되지 않았을 때 폴백이 보이는가
 * (F3), **사람이 친 퍼센트가 어떤 정수로 나가는가**, 미리보기가 비교할 것이 없을 때
 * 0원을 그리지 않는가(F6), 이력이 「누가 언제 무엇에서 무엇으로」를 말하는가(F5),
 * 그리고 운영자에게 저장이 막히는가(F7)다.
 *
 * ## 대역이 msw 가 아니라 모듈이다
 *
 * `packages/api-mocks` 에 `/commission-rates` 의 대역이 아직 없고, 이 TASK 는
 * `apps/admin` 밖을 고치지 않는다. 그래서 `lib/commissions/console-api` 를 대신
 * 세운다 — 경로와 스키마가 그 한 파일에 모여 있는 것이 이것을 가능하게 하고, 답은
 * 여전히 계약 스키마를 지난 값이다(`support/commissions.ts`). 카테고리 트리와 판매자
 * 목록은 그대로 msw 가 답한다.
 */

import { categoryRowsSnapshot, sessionAdminOperator, sessionDemoAdmin } from '@shopping/api-mocks'
import type { SetCommissionRateRequest } from '@shopping/shared'
import { ApiClientError } from '@shopping/shared'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { UserEvent } from '@testing-library/user-event'
import axe from 'axe-core'
import type { RunOptions } from 'axe-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { messagesFor } from '@/messages'

import type { MockSession } from './support/auth'
import { renderWithAuth } from './support/auth'
import {
  CHANGED_BY,
  commissionRate,
  rateList,
  simulation,
  UNKNOWN_SELLER_ID,
} from './support/commissions'

const api = vi.hoisted(() => ({
  fetchOpenCommissionRates: vi.fn(),
  fetchCommissionHistory: vi.fn(),
  fetchCommissionSimulation: vi.fn(),
  setCommissionRate: vi.fn(),
}))

vi.mock('@/lib/commissions/console-api', () => api)

const { commissions: copy, auth } = messagesFor()

/** `여성 › 아우터 › 코트` — 트리 대역이 실제로 들고 있는 잎 하나. */
const COAT = categoryRowsSnapshot().find((row) => row.slug === 'women-outer-coat')

const COAT_ID = COAT?.id ?? 0

const COAT_PATH = '여성 › 아우터 › 코트'

async function openScreen(session?: MockSession): Promise<UserEvent> {
  const user = userEvent.setup()
  const { default: CommissionsPage } = await import('@/app/commissions/page')

  renderWithAuth(<CommissionsPage />, session === undefined ? {} : { session })
  await screen.findByRole('form', { name: copy.editor.title })

  return user
}

/** 요율 칸 하나. 라벨에 괄호가 있어 부분 일치로 찾는다. */
function rateField(): HTMLElement {
  return screen.getByLabelText(copy.editor.rateLabel, { exact: false })
}

/** 라딕스의 셀렉트는 열고 나서 고른다. 이름에 괄호가 있을 수 있어 술어로 맞춘다. */
async function choose(user: UserEvent, label: string, option: string): Promise<void> {
  await user.click(screen.getByRole('combobox', { name: (name) => name.startsWith(label) }))
  await user.click(await screen.findByRole('option', { name: option }))
}

/** 저장 → 확인 다이얼로그 → 확정. 확인 없이는 아무것도 나가지 않는다. */
async function saveAndConfirm(user: UserEvent): Promise<void> {
  await user.click(screen.getByRole('button', { name: copy.editor.submit }))

  const dialog = await screen.findByRole('dialog')

  await user.click(within(dialog).getByRole('button', { name: copy.editor.confirm.confirm }))
}

beforeEach(() => {
  vi.clearAllMocks()
  api.fetchOpenCommissionRates.mockResolvedValue(rateList([]))
  api.fetchCommissionHistory.mockResolvedValue(rateList([]))
  api.fetchCommissionSimulation.mockResolvedValue(simulation())
  api.setCommissionRate.mockResolvedValue({ rate: commissionRate() })
})

describe('지금 적용되는 요율 (F1 · F2 · F3)', () => {
  it('groups the open rates by the scope each was set on', async () => {
    api.fetchOpenCommissionRates.mockResolvedValue(
      rateList([
        commissionRate({ rateBp: 300 }),
        commissionRate({ scope: 'category', categoryId: COAT_ID, rateBp: 550 }),
        commissionRate({ scope: 'seller', sellerId: UNKNOWN_SELLER_ID, rateBp: 250 }),
      ]),
    )

    await openScreen()

    const globals = await screen.findByRole('region', { name: copy.open.globalTitle })
    expect(within(globals).getByText('3%')).toBeVisible()

    const categories = screen.getByRole('region', { name: copy.open.categoryTitle })
    // 잎의 이름만이 아니라 뿌리부터의 경로다 — 요율은 아래로 내려가므로, 어디에
    // 걸렸는지가 곧 얼마나 넓게 걸렸는지다.
    expect(within(categories).getByText(COAT_PATH)).toBeVisible()
    expect(within(categories).getByText('5.5%')).toBeVisible()

    const sellers = screen.getByRole('region', { name: copy.open.sellerTitle })
    expect(within(sellers).getByText('2.5%')).toBeVisible()
  })

  /**
   * **「0%」가 아니다.** 「설정을 안 했다」와 「수수료를 받지 않기로 했다」는 다른
   * 결정이고, 폴백을 0으로 그리면 설정을 잊은 플랫폼이 조용히 아무것도 받지 않는
   * 것처럼 보인다.
   */
  it('says what is charged while nothing has been set at all', async () => {
    await openScreen()

    const globals = await screen.findByRole('region', { name: copy.open.globalTitle })

    expect(within(globals).getByText(copy.open.globalUnset.replace('{rate}', '3%'))).toBeVisible()
    expect(screen.getByText(copy.open.categoryEmpty)).toBeVisible()
    expect(screen.getByText(copy.open.sellerEmpty)).toBeVisible()
  })

  /** id 는 마지막 단서다. 이름을 못 찾았다고 빈칸을 그리면 그 요율을 고칠 수 없다. */
  it('keeps the store id on screen when its name is out of reach', async () => {
    api.fetchOpenCommissionRates.mockResolvedValue(
      rateList([commissionRate({ scope: 'seller', sellerId: UNKNOWN_SELLER_ID, rateBp: 250 })]),
    )

    await openScreen()

    const sellers = await screen.findByRole('region', { name: copy.open.sellerTitle })

    expect(
      within(sellers).getByText(copy.open.unknownTarget.replace('{id}', UNKNOWN_SELLER_ID)),
    ).toBeVisible()
  })

  it('offers a retry when the list did not arrive', async () => {
    api.fetchOpenCommissionRates.mockRejectedValue(
      new ApiClientError({ kind: 'network', message: 'network down' }),
    )

    await openScreen()

    expect(await screen.findByText(copy.open.errorTitle)).toBeVisible()
    expect(screen.getByRole('button', { name: copy.open.retryLabel })).toBeEnabled()
  })
})

describe('퍼센트를 적으면 basis point 가 나간다', () => {
  /**
   * 이 화면에서 조용히 틀릴 수 있는 자리다. `8.31 * 100` 은 정수가 아니고, 반올림한
   * 값을 보내는 화면은 렌더링도 검사도 멀쩡하다 — 틀린 것은 판매자가 다음 정산에서
   * 받는 금액뿐이다.
   */
  it.each([
    ['3.5', 350],
    ['8.31', 831],
    ['0.07', 7],
    ['12.75', 1275],
  ])('sends %s%% as %i bp', async (typed, rateBp) => {
    const user = await openScreen()

    await user.type(rateField(), typed)
    await saveAndConfirm(user)

    await waitFor(() => {
      expect(api.setCommissionRate).toHaveBeenCalledWith({
        sellerId: null,
        categoryId: null,
        rateBp,
      })
    })
  })

  it('carries the category id and nothing else for a category rate (F1)', async () => {
    const user = await openScreen()

    await user.click(screen.getByRole('radio', { name: copy.scopeLabels.category }))
    await choose(user, copy.editor.categoryLabel, COAT_PATH)
    await user.type(rateField(), '5')
    await saveAndConfirm(user)

    await waitFor(() => {
      expect(api.setCommissionRate).toHaveBeenCalledWith({
        sellerId: null,
        categoryId: COAT_ID,
        rateBp: 500,
      })
    })
  })

  /**
   * 스토어 목록은 심사 큐를 다시 쓴다(`use-sellers.ts`) — 콘솔에 스토어를 빠짐없이
   * 답하는 다른 문이 없기 때문이다. 그래서 이 검사만 msw 를 지나고, 재는 것은
   * 「고른 스토어의 id 가 요청에 실리는가」다 (F2).
   */
  it('carries the store id and nothing else for a seller rate (F2)', async () => {
    const user = await openScreen()

    await user.click(screen.getByRole('radio', { name: copy.scopeLabels.seller }))

    const picker = await screen.findByRole('combobox', {
      name: (name) => name.startsWith(copy.editor.sellerLabel),
    })
    await user.click(picker)

    const [first] = await screen.findAllByRole('option')
    await user.click(first!)

    await user.type(rateField(), '2.5')
    await saveAndConfirm(user)

    await waitFor(() => {
      expect(api.setCommissionRate).toHaveBeenCalledTimes(1)
    })

    // 고른 스토어의 id 는 대역이 정하므로 검사가 미리 알 수 없다. 잴 수 있는 것은
    // **하나만 실렸다**는 것과, 실린 것이 스토어 id 라는 것이다.
    const [request] = (api.setCommissionRate.mock.lastCall ?? []) as unknown as [
      SetCommissionRateRequest,
    ]

    expect(request.sellerId).toMatch(/^[0-9a-f-]{36}$/)
    expect(request.categoryId).toBeNull()
    expect(request.rateBp).toBe(250)
  })

  /** 목록이 잘려 있다는 사실을 말없이 넘기지 않는다. */
  it('admits that the store list is only the first page', async () => {
    const user = await openScreen()

    await user.click(screen.getByRole('radio', { name: copy.scopeLabels.seller }))

    expect(await screen.findByText(copy.editor.sellerNotice)).toBeVisible()
  })

  /** 범위가 완결되지 않은 저장은 **그 칸 위에서** 거절된다. */
  it('refuses to send a category rate with no category chosen', async () => {
    const user = await openScreen()

    await user.click(screen.getByRole('radio', { name: copy.scopeLabels.category }))
    await user.type(rateField(), '5')
    await user.click(screen.getByRole('button', { name: copy.editor.submit }))

    expect(await screen.findByText(copy.editor.errors.categoryRequired)).toBeVisible()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(api.setCommissionRate).not.toHaveBeenCalled()
  })

  it('says which shape a rate is written in when it cannot read one', async () => {
    const user = await openScreen()

    await user.type(rateField(), '3.456')
    await user.click(screen.getByRole('button', { name: copy.editor.submit }))

    expect(await screen.findByText(copy.editor.errors.rate.too_precise)).toBeVisible()
    expect(api.setCommissionRate).not.toHaveBeenCalled()
  })
})

describe('저장 전에 보는 영향 (F6)', () => {
  it('asks the API what the proposed rate would have cost, and says it in one line', async () => {
    api.fetchCommissionSimulation.mockResolvedValue(
      simulation({ salesAmount: 12_000_000, currentAmount: 360_000, proposedAmount: 420_000 }),
    )

    const user = await openScreen()

    await user.type(rateField(), '3.5')

    expect(
      await screen.findByText(
        copy.simulation.summary
          .replace('{days}', '30')
          .replace('{sales}', '₩12,000,000')
          .replace('{current}', '₩360,000')
          .replace('{proposed}', '₩420,000'),
      ),
    ).toBeVisible()

    expect(api.fetchCommissionSimulation).toHaveBeenCalledWith(
      { kind: 'global' },
      350,
      expect.anything(),
    )
  })

  /**
   * **0원을 그리지 않는다.** 「지금 요율이면 0원 · 새 요율이면 0원」은 「영향이
   * 없다」로 읽히는데, 실제로 일어난 일은 「비교할 근거가 없다」이고 요율을 두 배로
   * 올리려는 사람에게 그 둘은 정반대의 뜻이다.
   */
  it('says there is nothing to compare instead of showing zero', async () => {
    api.fetchCommissionSimulation.mockResolvedValue(
      simulation({
        salesAmount: 0,
        currentAmount: 0,
        proposedAmount: 0,
        sellerOrderCount: 0,
      }),
    )

    const user = await openScreen()

    await user.type(rateField(), '3.5')

    const preview = await screen.findByRole('region', { name: copy.simulation.title })

    expect(await within(preview).findByText(copy.simulation.nothingTitle)).toBeVisible()
    expect(within(preview).queryByText(/₩/)).toBeNull()
  })

  it('asks nothing while there is no rate to ask about', async () => {
    await openScreen()

    expect(screen.getAllByText(copy.simulation.idle)[0]).toBeVisible()
    expect(api.fetchCommissionSimulation).not.toHaveBeenCalled()
  })
})

describe('변경 이력 (F5)', () => {
  it('reads one scope, and says who moved it from what to what', async () => {
    api.fetchCommissionHistory.mockResolvedValue(
      rateList([
        commissionRate({ rateBp: 400, validFrom: '2026-09-03T00:00:00.000Z' }),
        commissionRate({ rateBp: 350, validFrom: '2026-09-02T00:00:00.000Z' }),
        commissionRate({ rateBp: 300, validFrom: '2026-09-01T00:00:00.000Z' }),
      ]),
    )

    await openScreen()

    const table = await screen.findByRole('table', { name: copy.history.listLabel })

    expect(within(table).getByText('3.5% → 4%')).toBeVisible()
    expect(within(table).getByText('3% → 3.5%')).toBeVisible()
    // 처음 설정된 줄에는 「무엇에서」가 없다.
    expect(within(table).getByText(copy.history.firstChange.replace('{to}', '3%'))).toBeVisible()
    expect(within(table).getAllByText(CHANGED_BY.email)).toHaveLength(3)
  })

  it('reads the history of the scope that is chosen, not of everything', async () => {
    const user = await openScreen()

    await user.click(screen.getByRole('radio', { name: copy.scopeLabels.category }))
    await choose(user, copy.editor.categoryLabel, COAT_PATH)

    await waitFor(() => {
      expect(api.fetchCommissionHistory).toHaveBeenLastCalledWith(
        { kind: 'category', categoryId: COAT_ID },
        expect.anything(),
      )
    })
  })

  it('has nothing to show before the scope is finished', async () => {
    const user = await openScreen()

    await user.click(screen.getByRole('radio', { name: copy.scopeLabels.seller }))

    expect(await screen.findByText(copy.history.idle)).toBeVisible()
  })
})

describe('요율을 바꿀 수 없는 계정 (F7)', () => {
  /**
   * 데모 관리자는 운영자에서 파생되고(`role-permissions.ts`), 운영자에게
   * `commission.write` 가 없다. 그래서 거절은 조건문이 아니라 권한 목록의 **빈자리**가
   * 만들고, 화면은 서버가 묻는 것과 같은 표에 물어 같은 답을 받는다.
   */
  it.each([
    ['an operator', sessionAdminOperator],
    ['a demo administrator', sessionDemoAdmin],
  ])('shows %s everything and blocks the one write, with a reason', async (_name, session) => {
    await openScreen(session)

    // 목록도 폼도 미리보기도 그대로 있다. 감추면 콘솔이 실제보다 적은 기능을 가진
    // 것처럼 보인다.
    expect(await screen.findByRole('region', { name: copy.open.globalTitle })).toBeVisible()
    expect(screen.getByLabelText(copy.editor.rateLabel, { exact: false })).toBeEnabled()

    const save = screen.getByRole('button', { name: copy.editor.submit })

    expect(save).toHaveAttribute('aria-disabled', 'true')
    expect(save).toHaveAccessibleDescription(auth.denials.missing_permission)
  })

  /**
   * 속성 `disabled` 였다면 졌다. 키보드가 닿지 못하는 컨트롤은 자기가 왜 막혔는지도
   * 말하지 못하고, 그 설명이 가장 필요한 사람이 바로 화면을 볼 수 없는 사람이다.
   */
  it('stays reachable and inert while blocked (P4)', async () => {
    const user = await openScreen(sessionAdminOperator)

    await user.type(rateField(), '3.5')

    const save = screen.getByRole('button', { name: copy.editor.submit })
    save.focus()
    expect(save).toHaveFocus()

    await user.keyboard('{Enter}')

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(api.setCommissionRate).not.toHaveBeenCalled()
  })
})

describe('저장', () => {
  it('confirms first, and nothing goes out if the answer is no', async () => {
    const user = await openScreen()

    await user.type(rateField(), '4')
    await user.click(screen.getByRole('button', { name: copy.editor.submit }))

    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: copy.editor.confirm.cancel }))

    expect(api.setCommissionRate).not.toHaveBeenCalled()
    // 폼은 채워진 채 남는다. 다시 열면 같은 값이 그대로 있다.
    expect(rateField()).toHaveValue('4')
  })

  it('reads the list and the history again once the rate has moved', async () => {
    const user = await openScreen()

    expect(api.fetchOpenCommissionRates).toHaveBeenCalledTimes(1)
    expect(api.fetchCommissionHistory).toHaveBeenCalledTimes(1)

    await user.type(rateField(), '4')
    await saveAndConfirm(user)

    await waitFor(() => {
      expect(api.fetchOpenCommissionRates).toHaveBeenCalledTimes(2)
    })
    await waitFor(() => {
      expect(api.fetchCommissionHistory).toHaveBeenCalledTimes(2)
    })
  })

  it('puts a refusal the server made above the form', async () => {
    api.setCommissionRate.mockRejectedValue(
      new ApiClientError({
        kind: 'http',
        message: 'seller not found',
        status: 404,
        body: {
          error: {
            code: 'NOT_FOUND',
            message: '판매자를 찾을 수 없어요.',
            details: [],
            requestId: '0192f0c1-4e2b-7a10-9c33-8f2b6d0a41c7',
          },
        },
      }),
    )

    const user = await openScreen()

    await user.type(rateField(), '4')
    await saveAndConfirm(user)

    expect(await screen.findByText(messagesFor().errors.NOT_FOUND)).toBeVisible()
  })
})

const A11Y: RunOptions = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] },
  rules: {
    'color-contrast': { enabled: false },
    'html-has-lang': { enabled: false },
    'document-title': { enabled: false },
    region: { enabled: false },
  },
}

describe('접근성 (P2)', () => {
  it('has no violations with the rates listed and the write blocked', async () => {
    api.fetchOpenCommissionRates.mockResolvedValue(
      rateList([
        commissionRate({ rateBp: 300 }),
        commissionRate({ scope: 'category', categoryId: COAT_ID, rateBp: 550 }),
      ]),
    )

    await openScreen(sessionAdminOperator)
    await screen.findByRole('region', { name: copy.open.categoryTitle })

    const results = await axe.run(document.body, A11Y)

    expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([])
  })
})
