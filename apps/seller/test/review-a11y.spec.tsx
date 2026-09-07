/**
 * axe 로 훑는 리뷰 관리 화면, 세 뷰포트에서 (QUALITY-GATES 2장 P2 · P3 · P4).
 *
 * **게이트이자 대역이다.** 이 화면은 아직 브라우저로 열 수 없어 Lighthouse 를 돌릴 수
 * 없고, TASK-0074 · TASK-0082 가 같은 벽에서 같은 엔진을 조립된 화면에 돌렸다.
 *
 * **접근 가능한 컴포넌트를 모아 놓은 것이 접근 가능한 화면은 아니다.** 이 화면이
 * 특히 그렇다 — 리뷰마다 별 다섯 개가 `aria-hidden` 으로 그려지고 그 옆의 문장이
 * 진짜 내용인데, 그 둘의 관계는 여기서 조립되기 전에는 존재하지 않는다. 답변 블록도
 * 마찬가지다: 줄마다 하나씩 있으므로 랜드마크로 감싸면 같은 이름의 랜드마크가
 * 여러 개가 되고, `landmark-unique` 가 그것을 잡는다.
 *
 * **폼이 열린 상태도 함께 잰다.** 닫힌 목록만 재면 이 화면에서 사람이 실제로 글을
 * 쓰는 유일한 순간이 한 번도 검사되지 않는다.
 */

import { DENSITY_LEVELS } from '@shopping/ui'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import type { RunOptions } from 'axe-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ReviewsPage from '@/app/reviews/page'
import { messagesFor } from '@/messages'

import type * as SellerApi from '@/lib/api'

import { renderWithAuth } from './support/auth'
import { answerJson, resetApiStub, stubApiClient } from './support/api-stub'
import { reviewsPage1 } from './support/review-fixtures'
import { stubViewport, VIEWPORTS } from './support/viewport'

vi.mock('@/lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof SellerApi>()
  const { stubApiClient: stub } = await import('./support/api-stub')

  return { ...original, getApiClient: stub }
})

const copy = messagesFor().reviewList

const OPTIONS: RunOptions = {
  rules: {
    // jsdom 은 아무것도 칠하지 않으므로 axe 가 대비를 판단할 수 없다.
    'color-contrast': { enabled: false },
    // 문서의 껍데기 — lang · title — 는 `app/layout.tsx` 의 것이다.
    'document-title': { enabled: false },
    'html-has-lang': { enabled: false },
    // 콘솔의 `<main>` 은 셸의 것이고 셸은 이 트리에 없다.
    region: { enabled: false },
  },
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] },
}

beforeEach(() => {
  resetApiStub()
  stubApiClient()
  answerJson('/seller-product-reviews', reviewsPage1)
})

afterEach(() => {
  vi.unstubAllGlobals()
  document.documentElement.removeAttribute('data-density')
})

async function expectNoViolations(): Promise<void> {
  const results = await axe.run(document.body, OPTIONS)

  expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([])
}

describe('the product review console', () => {
  it.each(Object.entries(VIEWPORTS))('has no axe violations at %s', async (_name, width) => {
    stubViewport(width)
    renderWithAuth(<ReviewsPage />)
    await screen.findByRole('list', { name: copy.card.listLabel })

    await expectNoViolations()
  })

  it.each(DENSITY_LEVELS)('has no axe violations at density %s', async (level) => {
    document.documentElement.setAttribute('data-density', String(level))
    stubViewport(VIEWPORTS.desktop)
    renderWithAuth(<ReviewsPage />)
    await screen.findByRole('list', { name: copy.card.listLabel })

    await expectNoViolations()
  })

  it('has no axe violations with the reply editor open', async () => {
    const user = userEvent.setup()
    stubViewport(VIEWPORTS.mobile)
    renderWithAuth(<ReviewsPage />)
    await screen.findByRole('list', { name: copy.card.listLabel })

    await user.click(screen.getByRole('button', { name: copy.reply.writeLabel }))
    await screen.findByRole('textbox', { name: copy.reply.contentLabel })

    await expectNoViolations()
  })

  it('keeps the stars out of the accessibility tree and the number in it', async () => {
    stubViewport(VIEWPORTS.desktop)
    renderWithAuth(<ReviewsPage />)

    const list = await screen.findByRole('list', { name: copy.card.listLabel })

    // 별 다섯 개는 보조 기술에게 「검은 별 흰 별 흰 별…」이지 숫자가 아니다.
    expect(screen.getByText(copy.card.ratingValue.replace('{rating}', '2'))).toBeVisible()
    expect(list.querySelector('[aria-hidden="true"]')).toHaveTextContent('★')
  })
})
