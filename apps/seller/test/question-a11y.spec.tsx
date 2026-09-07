/**
 * axe 로 훑는 문의 관리 화면, 세 뷰포트에서 (QUALITY-GATES 2장 P2 · P3 · P4).
 *
 * **게이트이자 대역이다.** 이 화면은 아직 브라우저로 열 수 없어 Lighthouse 를 돌릴 수
 * 없고, TASK-0082 · TASK-0085 가 같은 벽에서 같은 엔진을 조립된 화면에 돌렸다.
 *
 * **접근 가능한 컴포넌트를 모아 놓은 것이 접근 가능한 화면은 아니다.** 이 화면에서
 * 특히 그런 자리는 줄마다 붙는 배지 둘(답변 대기 · 비공개)과 그 아래의 답변 블록이다.
 * 답변 블록을 랜드마크로 감싸면 같은 이름의 랜드마크가 줄마다 하나씩 생기고,
 * `landmark-unique` 가 그것을 잡는다.
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

import QuestionsPage from '@/app/questions/page'
import { messagesFor } from '@/messages'

import type * as SellerApi from '@/lib/api'

import { renderWithAuth } from './support/auth'
import { answerJson, resetApiStub, stubApiClient } from './support/api-stub'
import { questionsPage1 } from './support/question-fixtures'
import { stubViewport, VIEWPORTS } from './support/viewport'

vi.mock('@/lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof SellerApi>()
  const { stubApiClient: stub } = await import('./support/api-stub')

  return { ...original, getApiClient: stub }
})

const copy = messagesFor().questionList

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
  answerJson('/seller-questions', questionsPage1)
})

afterEach(() => {
  vi.unstubAllGlobals()
  document.documentElement.removeAttribute('data-density')
})

async function expectNoViolations(): Promise<void> {
  const results = await axe.run(document.body, OPTIONS)

  expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([])
}

describe('the product question console', () => {
  it.each(Object.entries(VIEWPORTS))('has no axe violations at %s', async (_name, width) => {
    stubViewport(width)
    renderWithAuth(<QuestionsPage />)
    await screen.findByRole('list', { name: copy.card.listLabel })

    await expectNoViolations()
  })

  it.each(DENSITY_LEVELS)('has no axe violations at density %s', async (level) => {
    document.documentElement.setAttribute('data-density', String(level))
    stubViewport(VIEWPORTS.desktop)
    renderWithAuth(<QuestionsPage />)
    await screen.findByRole('list', { name: copy.card.listLabel })

    await expectNoViolations()
  })

  it('has no axe violations with the answer editor open', async () => {
    const user = userEvent.setup()
    stubViewport(VIEWPORTS.mobile)
    renderWithAuth(<QuestionsPage />)
    await screen.findByRole('list', { name: copy.card.listLabel })

    await user.click(screen.getByRole('button', { name: copy.answer.writeLabel }))
    await screen.findByRole('textbox', { name: copy.answer.contentLabel })

    await expectNoViolations()
  })

  it('says "private" in words, not in colour alone', async () => {
    stubViewport(VIEWPORTS.desktop)
    renderWithAuth(<QuestionsPage />)
    await screen.findByRole('list', { name: copy.card.listLabel })

    // 배지가 문장을 들고 있고 색은 그것을 거들 뿐이다 (설계서 접근성 규칙).
    expect(screen.getByText(copy.card.privateBadge)).toBeVisible()
    expect(screen.getByText(copy.card.privateNote)).toBeVisible()
  })
})
