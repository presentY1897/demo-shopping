/**
 * axe over the M13 screens — 밀도 3 × 뷰포트 3 (TASK-0086 F7 · TASK-0089 F7).
 *
 * 두 축을 함께 도는 이유가 이 화면들에 실제로 있다. 위시리스트는 격자의 열 수가
 * 밀도와 폭에 함께 움직이고, 문의는 **밀도가 목록의 존재 자체를 정한다**
 * (맥시멀에서만 펼쳐진 채로 시작한다). 접힌 자리에서 이름이 잘리는지는 두 축이
 * 만나는 칸에서만 드러난다.
 *
 * 오버레이 둘 — 신고 다이얼로그와 알림 드롭다운 — 은 **열어 둔 채로** 잰다. 닫혀
 * 있는 동안 그 마크업은 DOM 에 없으므로, 열지 않으면 이 검사는 그 둘을 본 적이 없다.
 *
 * `mypage-a11y.spec.tsx` · `reviews-a11y.spec.tsx` 와 **같은 규칙 집합**을 쓴다 —
 * 왜 Lighthouse 가 아니라 axe 인지, 왜 몇 규칙이 꺼져 있는지를 저쪽 파일들이 길게
 * 적어 두었다.
 */

import { sessionBuyer } from '@shopping/api-mocks'
import { DENSITY_LEVELS, DENSITY_STORAGE_KEY } from '@shopping/ui'
import { DensityProvider } from '@shopping/ui/density'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import type { RunOptions } from 'axe-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FollowingScreen } from '@/components/collections/following-screen'
import { RecentScreen } from '@/components/collections/recent-screen'
import { WishlistScreen } from '@/components/collections/wishlist-screen'
import { ShopHeader } from '@/components/layout/shop-header'
import { NotificationScreen } from '@/components/notifications/notification-screen'
import { ProductQuestions } from '@/components/questions/product-questions'
import { MyQuestionsScreen } from '@/components/questions/my-questions-screen'
import { ReportDialog } from '@/components/reports/report-dialog'
import { messagesFor } from '@/messages'

import { renderWithAuth } from './support/auth'
import { MOCK_DETAIL_PRODUCT_ID, resetCommunityStores, stubCommunityApi } from './support/community'
import { renderAccountScreen, resetDensity } from './support/mypage'
import { stubViewport, VIEWPORTS } from './support/viewport'

vi.mock('next/navigation', async () => {
  const { nextNavigationMock } = await import('./support/navigation')

  return nextNavigationMock()
})

const messages = messagesFor()

const OPTIONS: RunOptions = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] },
  rules: {
    // jsdom paints nothing, so axe cannot decide contrast.
    'color-contrast': { enabled: false },
    'color-contrast-enhanced': { enabled: false },
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

function atDensity(level: number): void {
  localStorage.setItem(DENSITY_STORAGE_KEY, String(level))
  document.documentElement.setAttribute('data-density', String(level))
}

beforeEach(() => {
  resetDensity()
  resetCommunityStores()
  stubCommunityApi()
})

afterEach(() => {
  localStorage.clear()
  vi.unstubAllGlobals()
})

describe('위시리스트 — 9조합', () => {
  for (const [name, width] of Object.entries(VIEWPORTS)) {
    it.each(DENSITY_LEVELS)(`밀도 %s · ${name}`, async (level) => {
      atDensity(level)
      stubViewport(width)

      renderAccountScreen(<WishlistScreen messages={messages.mypage} />, { session: sessionBuyer })

      await screen.findByRole('list', { name: messages.mypage.wishlist.listLabel })
      await expectNoViolations()
    })
  }
})

describe('상품 문의 — 9조합', () => {
  for (const [name, width] of Object.entries(VIEWPORTS)) {
    it.each(DENSITY_LEVELS)(`밀도 %s · ${name}`, async (level) => {
      atDensity(level)
      stubViewport(width)

      renderWithAuth(
        <DensityProvider>
          <ProductQuestions
            copy={messages.productDetail.questions}
            productId={MOCK_DETAIL_PRODUCT_ID}
            refusals={messages.refusals}
            report={messages.report}
          />
        </DensityProvider>,
        { session: sessionBuyer },
      )

      // 접힌 단계는 목록을 부르지 않는다. 세 단계를 같은 방식으로 기다리면 그
      // 단계에서 영원히 기다리게 되므로, 언제나 있는 버튼을 기준으로 삼는다.
      await screen.findByRole('button', { name: messages.productDetail.questions.askLabel })
      await expectNoViolations()
    })
  }

  it('passes with the form open, where the visibility radios live', async () => {
    atDensity(2)
    stubViewport(VIEWPORTS.mobile)

    const user = userEvent.setup()

    renderWithAuth(
      <DensityProvider>
        <ProductQuestions
          copy={messages.productDetail.questions}
          productId={MOCK_DETAIL_PRODUCT_ID}
          refusals={messages.refusals}
          report={messages.report}
        />
      </DensityProvider>,
      { session: sessionBuyer },
    )

    await user.click(
      await screen.findByRole('button', { name: messages.productDetail.questions.askLabel }),
    )
    await expectNoViolations()
  })
})

describe('나머지 계정 화면', () => {
  it('최근 본 상품', async () => {
    stubViewport(VIEWPORTS.desktop)
    renderAccountScreen(<RecentScreen messages={messages.mypage} />, { session: sessionBuyer })

    await screen.findByRole('list', { name: messages.mypage.recent.listLabel })
    await expectNoViolations()
  })

  it('팔로우한 브랜드', async () => {
    stubViewport(VIEWPORTS.desktop)
    renderAccountScreen(<FollowingScreen messages={messages.mypage} />, { session: sessionBuyer })

    await screen.findByRole('list', { name: messages.mypage.following.listLabel })
    await expectNoViolations()
  })

  it('내 문의', async () => {
    stubViewport(VIEWPORTS.desktop)
    renderAccountScreen(<MyQuestionsScreen messages={messages.mypage} />, {
      session: sessionBuyer,
    })

    await screen.findByRole('list', { name: messages.mypage.questions.listLabel })
    await expectNoViolations()
  })

  it('알림함', async () => {
    stubViewport(VIEWPORTS.desktop)
    renderAccountScreen(<NotificationScreen messages={messages.mypage} />, {
      session: sessionBuyer,
    })

    await screen.findByRole('list', { name: messages.mypage.notifications.listLabel })
    await expectNoViolations()
  })
})

describe('열려 있는 오버레이 둘', () => {
  it('신고 다이얼로그', async () => {
    stubViewport(VIEWPORTS.mobile)

    const user = userEvent.setup()

    renderWithAuth(
      <ReportDialog
        copy={messages.report}
        refusals={messages.refusals}
        targetId="019596d0-1f1c-7c2e-9a0e-630000000001"
        targetType="REVIEW"
      />,
      { session: sessionBuyer },
    )

    await user.click(await screen.findByRole('button', { name: messages.report.triggerLabel }))
    await screen.findByRole('dialog', { name: messages.report.title })

    // 사유는 라디오 그룹이고 「기타」의 설명 칸은 진짜 `<textarea>` 다 — 둘 다 이름을
    // 갖고 있어야 하고, 그것이 이 검사가 보는 것이다.
    await user.click(screen.getByRole('radio', { name: messages.report.reasons.OTHER }))
    await expectNoViolations()
  })

  it('알림 드롭다운', async () => {
    stubViewport(VIEWPORTS.desktop)

    const user = userEvent.setup()

    renderWithAuth(
      <DensityProvider>
        <ShopHeader brand={messages.app.name} messages={messages.layout} />
      </DensityProvider>,
      { session: sessionBuyer },
    )

    await user.click(
      await screen.findByRole('button', {
        name: messages.layout.notifications.labelWithCount.replace('{count}', '3'),
      }),
    )
    await screen.findByRole('list', { name: messages.layout.notifications.listLabel })
    await expectNoViolations()
  })
})
