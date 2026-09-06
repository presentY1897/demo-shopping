/**
 * axe over 취소·반품 목록 · 상세, 세 뷰포트에서 (QUALITY-GATES 2장 P2 · P3 · P4).
 *
 * **게이트이자 대역이다.** 이 화면들은 아직 브라우저로 열 수 없어 Lighthouse 를 돌릴 수
 * 없고, TASK-0060 이 같은 벽에서 같은 엔진을 조립된 화면에 돌렸다. 여기도 같다.
 *
 * **접근 가능한 컴포넌트를 모아 놓은 것이 접근 가능한 화면은 아니다.** 지연 배지는 표
 * 셀 안에 있고, 확인 대화상자의 사유 칸은 오류를 자기 자리에 달며, 사진 목록은 URL 이
 * 없을 때 이미지 대신 문장이 된다 — 전부 여기서 조립되기 전에는 존재하지 않는다.
 *
 * ## 밀도를 바꿔 가며 한 번 더 도는 이유
 *
 * 콘솔은 D-033 으로 **밀도 2 고정**이라 토글이 없다. 그런데 밀도는 `<html data-density>`
 * 의 값이고 그 위에서 토큰(간격 · 글자 크기 · 터치 타깃)이 갈리므로, 언젠가 그 값이
 * 바뀌거나 중첩 스코프가 생기면 화면은 **아무도 재 본 적 없는 조합**으로 그려진다.
 * 그래서 지금 재 둔다: 360px 에서 1 · 2 · 3 을 각각 씌우고 같은 화면을 다시 돌린다.
 * 재는 것은 「밀도 토글이 있다」가 아니라 **「토큰이 바뀌어도 접근성이 깨지지 않는다」**다.
 */

import { sellerClaimHandlers, sellerClaimPage } from '@shopping/api-mocks'
import { DENSITY_LEVELS } from '@shopping/ui'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import type { RunOptions } from 'axe-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ClaimsPage from '@/app/claims/page'
import { ClaimDetailWorkspace } from '@/components/claims/claim-detail-workspace'
import { messagesFor } from '@/messages'

import { testServer } from './setup'
import { stubViewport, VIEWPORTS } from './support/viewport'

const list = messagesFor().claimList
const detail = messagesFor().claimDetail
const vocabulary = messagesFor().claims

const OPTIONS: RunOptions = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] },
  rules: {
    // jsdom 은 아무것도 칠하지 않으므로 axe 가 대비를 판단할 수 없다.
    'color-contrast': { enabled: false },
    // 문서의 껍데기 — lang · title — 는 `app/layout.tsx` 의 것이다.
    'html-has-lang': { enabled: false },
    'document-title': { enabled: false },
    // 콘솔의 `<main>` 은 셸의 것이고 셸은 이 트리에 없다.
    region: { enabled: false },
  },
}

beforeEach(() => {
  testServer.server.use(...sellerClaimHandlers)
})

afterEach(() => {
  vi.unstubAllGlobals()
  document.documentElement.removeAttribute('data-density')
})

async function expectNoViolations(): Promise<void> {
  const results = await axe.run(document.body, OPTIONS)

  expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([])
}

/** 픽스처에서 이 상태의 클레임 하나. */
function idOf(status: string): string {
  const row = sellerClaimPage.claims.find((claim) => claim.status === status)

  if (row === undefined) throw new Error(`${status} 인 픽스처가 없습니다.`)

  return row.id
}

async function openList(): Promise<void> {
  render(<ClaimsPage />)
  await screen.findByRole('table', { name: list.table.caption })
}

async function openDetail(status: string): Promise<void> {
  render(<ClaimDetailWorkspace claimId={idOf(status)} />)
  await screen.findByRole('table', { name: detail.items.caption })
}

describe('취소·반품 목록', () => {
  it('has no violations at 1440px', async () => {
    stubViewport(VIEWPORTS.desktop)
    await openList()

    await expectNoViolations()
  })

  it('has no violations at 768px', async () => {
    stubViewport(VIEWPORTS.tablet)
    await openList()

    await expectNoViolations()
  })

  it('has no violations as cards at 360px', async () => {
    stubViewport(VIEWPORTS.mobile)
    render(<ClaimsPage />)
    await screen.findByRole('list', { name: list.table.caption })

    await expectNoViolations()
  })

  it('has no violations in the filtered empty state', async () => {
    stubViewport(VIEWPORTS.desktop)
    await openList()

    const user = userEvent.setup()

    await user.click(screen.getByRole('combobox', { name: list.filters.typeLabel }))
    await user.click(await screen.findByRole('option', { name: vocabulary.typeLabels.CANCEL }))
    await user.click(screen.getByRole('combobox', { name: list.filters.statusLabel }))
    await user.click(
      await screen.findByRole('option', { name: vocabulary.statusLabels.RETURN_REQUESTED }),
    )
    await screen.findByText(list.filteredEmpty.title)

    await expectNoViolations()
  })
})

describe('취소·반품 상세', () => {
  it('has no violations at 1440px', async () => {
    stubViewport(VIEWPORTS.desktop)
    await openDetail('RETURN_REQUESTED')

    await expectNoViolations()
  })

  it('has no violations at 768px', async () => {
    stubViewport(VIEWPORTS.tablet)
    await openDetail('RETURN_REQUESTED')

    await expectNoViolations()
  })

  it('has no violations at 360px', async () => {
    stubViewport(VIEWPORTS.mobile)
    await openDetail('RETURN_REQUESTED')

    await expectNoViolations()
  })

  it('has no violations with the reason dialog open and refusing', async () => {
    stubViewport(VIEWPORTS.mobile)
    await openDetail('RETURN_REQUESTED')

    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: vocabulary.actionLabels.RETURN_REJECTED }))
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: detail.actions.confirm }),
    )
    await screen.findByText(detail.actions.reasonRequired)

    await expectNoViolations()
  })
})

/**
 * 같은 두 화면을, 밀도 토큰만 바꿔 가며 한 번씩 더.
 *
 * `DENSITY_LEVELS` 를 그대로 도는 것은 단계가 늘면 이 검사도 함께 늘어야 하기 때문이다 —
 * 셋을 손으로 적으면 넷째 단계는 아무도 재지 않는다.
 */
describe('밀도 토큰이 바뀌어도 (D-033)', () => {
  for (const density of DENSITY_LEVELS) {
    it(`keeps the list accessible at 360px with data-density=${String(density)}`, async () => {
      document.documentElement.setAttribute('data-density', String(density))
      stubViewport(VIEWPORTS.mobile)
      render(<ClaimsPage />)
      await screen.findByRole('list', { name: list.table.caption })

      await expectNoViolations()
    })

    it(`keeps the detail accessible at 360px with data-density=${String(density)}`, async () => {
      document.documentElement.setAttribute('data-density', String(density))
      stubViewport(VIEWPORTS.mobile)
      await openDetail('RETURN_REQUESTED')

      await expectNoViolations()
    })
  }
})
