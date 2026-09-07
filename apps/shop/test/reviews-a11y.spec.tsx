/**
 * axe over the two review screens — 밀도 3 × 뷰포트 3 (TASK-0083 F8 · TASK-0084 F5).
 *
 * 두 축을 함께 도는 이유가 이 화면들에 실제로 있다. 밀도는 리뷰의 **노출량 자체**를
 * 바꾸고(평점만 · 별점 + 3건 · 분포 + 5건 + 갤러리), 360px 에서는 별 다섯 개의 라디오와
 * 정렬 셀렉트와 「사진 리뷰만」이 한 줄에 못 들어가 접힌다. 접힌 자리에서 이름이
 * 잘리는지는 두 축이 만나는 칸에서만 드러난다.
 *
 * `mypage-a11y.spec.tsx` 와 **같은 규칙 집합**을 쓴다 — 왜 Lighthouse 가 아니라
 * axe 인지, 왜 네 규칙이 꺼져 있는지를 저쪽 파일이 길게 적어 두었다.
 *
 * **그래프 없이 읽히는가는 axe 가 답하지 않는다.** 그것은 `product-reviews.spec.tsx`
 * 가 문장으로 재고, 여기서는 그 문장이 **이름을 잃지 않았는지**를 잰다.
 */

import { sessionBuyer } from '@shopping/api-mocks'
import { DENSITY_LEVELS, DENSITY_STORAGE_KEY } from '@shopping/ui'
import { DensityProvider } from '@shopping/ui/density'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import type { RunOptions } from 'axe-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ProductReviews } from '@/components/reviews/product-reviews'
import { ReviewableList } from '@/components/reviews/reviewable-list'
import { messagesFor } from '@/messages'

import { renderWithAuth } from './support/auth'
import { renderAccountScreen, resetDensity } from './support/mypage'
import { MOCK_NOW, MOCK_PRODUCT_ID, stubReviewApi } from './support/reviews'
import { stubViewport, VIEWPORTS } from './support/viewport'

vi.mock('next/navigation', () => ({ usePathname: () => '/mypage/reviews' }))

const messages = messagesFor()
const storefront = messages.productDetail.reviews
const account = messages.mypage.reviews

const OPTIONS: RunOptions = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] },
  rules: {
    // jsdom paints nothing, so axe cannot decide contrast.
    'color-contrast': { enabled: false },
    // The document shell — lang, title, the `main` landmark — belongs to
    // `app/layout.tsx`, which is not rendered here.
    'color-contrast-enhanced': { enabled: false },
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
  vi.setSystemTime(MOCK_NOW)
  stubReviewApi()
})

afterEach(() => {
  vi.useRealTimers()
  localStorage.clear()
  vi.unstubAllGlobals()
})

describe('상품 상세의 리뷰 — 9조합', () => {
  for (const [name, width] of Object.entries(VIEWPORTS)) {
    it.each(DENSITY_LEVELS)(`밀도 %s · ${name}`, async (level) => {
      atDensity(level)
      stubViewport(width)

      renderWithAuth(
        <DensityProvider>
          <ProductReviews
            copy={storefront}
            productId={MOCK_PRODUCT_ID}
            ratingAvg={435}
            ratingCount={20}
          />
        </DensityProvider>,
        { session: sessionBuyer },
      )

      // 미니멀은 펼치기 전까지 목록을 부르지 않는다. 세 단계를 같은 방식으로 기다리면
      // 그 단계에서 영원히 기다리게 되므로, 요약 문장이 나오는 것을 기준으로 삼는다.
      await screen.findByText(
        storefront.summaryLabel.replace('{score}', '4.4').replace('{count}', '20'),
      )
      await expectNoViolations()
    })
  }

  it('keeps the rating readable when the graph is the only thing that changed', async () => {
    atDensity(3)
    stubViewport(VIEWPORTS.mobile)

    renderWithAuth(
      <DensityProvider>
        <ProductReviews
          copy={storefront}
          productId={MOCK_PRODUCT_ID}
          ratingAvg={435}
          ratingCount={20}
        />
      </DensityProvider>,
      { session: sessionBuyer },
    )

    await screen.findByRole('list', { name: storefront.listLabel })

    // 분포는 이름 붙은 목록이고 그 줄들은 글을 갖는다 — 막대만 남는 요약은 화면을
    // 보지 않는 사람에게 아무 값도 전달하지 않는다 (F8).
    const bars = within(
      screen.getByRole('list', { name: storefront.distributionLabel }),
    ).getAllByRole('listitem')

    expect(bars[0]).toHaveTextContent(/5점/)
    await expectNoViolations()
  })
})

describe('리뷰 쓰기 화면 — 9조합', () => {
  for (const [name, width] of Object.entries(VIEWPORTS)) {
    it.each(DENSITY_LEVELS)(`밀도 %s · ${name}`, async (level) => {
      atDensity(level)
      stubViewport(width)

      renderAccountScreen(<ReviewableList messages={messages.mypage} />, { session: sessionBuyer })

      await screen.findByRole('list', { name: account.listLabel })
      await expectNoViolations()
    })
  }

  it('passes with the form open, where the stars and the photo field live', async () => {
    atDensity(2)
    stubViewport(VIEWPORTS.mobile)

    const user = userEvent.setup()

    renderAccountScreen(<ReviewableList messages={messages.mypage} />, { session: sessionBuyer })

    const list = await screen.findByRole('list', { name: account.listLabel })
    const [row] = [...list.children].filter(
      (node): node is HTMLElement => node instanceof HTMLElement,
    )

    if (row === undefined) throw new Error('쓸 수 있는 줄을 찾지 못했습니다.')

    await user.click(within(row).getByRole('button', { name: account.writeLabel }))

    // 별점은 라디오 그룹이고 사진 칸은 진짜 `<input type="file">` 이다 — 둘 다 이름을
    // 갖고 있어야 하고, 그것이 이 검사가 보는 것이다.
    await expectNoViolations()
  })
})
