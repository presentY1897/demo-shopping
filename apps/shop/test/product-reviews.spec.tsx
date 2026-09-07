/**
 * 상품 상세의 리뷰 (TASK-0084 F1 · F5 · F6).
 *
 * **API 대역이 이 저장소의 msw 가 아니다.** `packages/api-mocks` 에 리뷰 라우트의
 * 핸들러가 아직 없고 그것을 더하는 일은 이 갈래의 소유가 아니라서, `globalThis.fetch`
 * 를 감싸 리뷰 경로만 가로챈다 — 그 대역이 내보내는 답은 **계약 스키마를 지나므로**
 * 서버가 보낼 수 없는 모양에 화면과 함께 합의하는 일은 생기지 않는다
 * (`test/support/reviews.ts` 의 머리말이 그 이음매를 적고 있다).
 *
 * **이 파일이 확인하는 것 다섯으로 줄이면**:
 *
 * ① **밀도가 노출량을 정한다.** 미니멀은 링크만이라 **아무것도 묻지 않고**, 표준은
 *    3건, 맥시멀은 5건에 분포와 사진 갤러리가 붙는다.
 * ② **평점은 그래프 없이도 읽힌다** (F8). 분포 막대는 그림이고 같은 사실이 글로 있다.
 * ③ **요약은 필터를 따라 움직이지 않는다.** 「사진 리뷰만」을 켜도 평균과 분포가 그대로다.
 * ④ **정렬·필터가 서버로 나간다.** 화면이 받아서 거르는 구현은 두 번째 장부터 틀리므로,
 *    무엇을 그렸나가 아니라 **무엇을 물었나**를 잰다.
 * ⑤ **로그인하지 않은 사람은 401 을 만나지 않는다.** 수는 보이고, 누르는 자리는 로그인이다.
 */

import { sessionBuyer } from '@shopping/api-mocks'
import { DENSITY_STORAGE_KEY } from '@shopping/ui'
import { DensityProvider } from '@shopping/ui/density'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ProductReviews } from '@/components/reviews/product-reviews'
import { messagesFor } from '@/messages'

import { renderWithAuth } from './support/auth'
import type { ReviewApiStub } from './support/reviews'
import { MOCK_PRODUCT_ID, MOCK_SUMMARY, stubReviewApi } from './support/reviews'

vi.mock('next/navigation', async () => {
  const { nextNavigationMock } = await import('./support/navigation')

  return nextNavigationMock()
})

const copy = messagesFor().productDetail.reviews

function open({
  density = 2,
  signedIn = true,
}: { density?: number; signedIn?: boolean } = {}): ReturnType<typeof userEvent.setup> {
  localStorage.setItem(DENSITY_STORAGE_KEY, String(density))
  document.documentElement.setAttribute('data-density', String(density))

  const user = userEvent.setup()

  renderWithAuth(
    <DensityProvider>
      <ProductReviews copy={copy} productId={MOCK_PRODUCT_ID} ratingAvg={435} ratingCount={20} />
    </DensityProvider>,
    { session: signedIn ? sessionBuyer : null },
  )

  return user
}

/**
 * 화면에 그려진 리뷰 카드들.
 *
 * 목록의 **직계 자식**만 센다. 카드 하나가 사진 목록을 품고 있어서
 * `getAllByRole('listitem')` 은 그 안의 줄까지 함께 돌려준다.
 */
function cards(): readonly HTMLElement[] {
  const list = screen.getByRole('list', { name: copy.listLabel })

  return [...list.children].filter((node): node is HTMLElement => node instanceof HTMLElement)
}

async function listShown(): Promise<readonly HTMLElement[]> {
  await screen.findByRole('list', { name: copy.listLabel })

  return cards()
}

let stub: ReviewApiStub

beforeEach(() => {
  localStorage.clear()
  stub = stubReviewApi()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('F5 밀도 3단계 — 노출량', () => {
  it('asks for nothing at the minimal step and offers a link instead (미니멀: 링크만)', async () => {
    const user = open({ density: 1 })

    // 상품 상세가 이미 들고 있는 집계로 그린다. 보이지도 않을 목록을 위해 요청을
    // 하나 더 보내면, 콜드 스타트가 90초인 배포에서 그것이 화면이 늦게 뜨는 이유다.
    expect(
      screen.getByText(copy.summaryLabel.replace('{score}', '4.4').replace('{count}', '20')),
    ).toBeVisible()
    expect(stub.listQueries).toEqual([])
    expect(screen.queryByRole('list', { name: copy.listLabel })).toBeNull()

    await user.click(
      screen.getByRole('button', { name: copy.expandLabel.replace('{count}', '20') }),
    )

    expect(await listShown()).toHaveLength(3)
    expect(stub.listQueries).toHaveLength(1)
  })

  it('shows three at the standard step, with stars and no distribution (표준: 별점 + 3건)', async () => {
    open({ density: 2 })

    expect(await listShown()).toHaveLength(3)
    expect(screen.getByTestId('rating-stars')).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: copy.distributionLabel })).toBeNull()
    expect(screen.queryByRole('heading', { name: copy.galleryLabel })).toBeNull()
  })

  it('shows five with the distribution and the photo gallery (맥시멀: 5건 + 갤러리)', async () => {
    open({ density: 3 })

    expect(await listShown()).toHaveLength(5)
    expect(screen.getByRole('list', { name: copy.distributionLabel })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: copy.galleryLabel })).toBeVisible()
  })
})

describe('F8 그래프 없이 읽히는 평점', () => {
  it('states the average and the count as a sentence, not only as stars', async () => {
    open({ density: 3 })
    await listShown()

    // 별과 막대는 `aria-hidden` 이다. 남는 것은 이 문장이어야 하고, 그것이 F8 의 요구다.
    expect(
      screen.getByText(copy.summaryLabel.replace('{score}', '4.4').replace('{count}', '20')),
    ).toBeVisible()
    expect(screen.getByTestId('rating-stars')).toHaveAttribute('aria-hidden', 'true')
  })

  it('writes every distribution bar out in words as well', async () => {
    open({ density: 3 })
    await listShown()

    const bars = within(screen.getByRole('list', { name: copy.distributionLabel })).getAllByRole(
      'listitem',
    )

    expect(bars).toHaveLength(5)
    // 서버가 보낸 비율을 그대로 쓴다. 다섯을 더하면 100이 되도록 맞춰 온 값이라
    // 화면이 다시 나누면 그 합이 99나 101이 된다.
    expect(bars[0]).toHaveTextContent(
      copy.bucketLabel
        .replace('{rating}', '5')
        .replace('{count}', '12')
        .replace('{percentage}', '60'),
    )
  })
})

describe('F6 사진 필터 · 정렬 — 무엇을 물었나', () => {
  it('sends the sort to the server rather than reordering what it already has', async () => {
    const user = open({ density: 2 })
    await listShown()

    await user.click(screen.getByRole('combobox', { name: copy.sortLabel }))
    await user.click(await screen.findByRole('option', { name: copy.sorts.rating }))

    await waitFor(() => {
      expect(stub.listQueries.at(-1)?.searchParams.get('sort')).toBe('rating')
    })
  })

  it('sends photoOnly and leaves the summary alone', async () => {
    const user = open({ density: 3 })
    await listShown()

    await user.click(
      screen.getByRole('checkbox', { name: copy.photoOnlyLabel.replace('{count}', '2') }),
    )

    await waitFor(() => {
      expect(stub.listQueries.at(-1)?.searchParams.get('photoOnly')).toBe('true')
    })
    await waitFor(() => {
      expect(cards()).toHaveLength(2)
    })

    // **요약은 필터와 무관한 사실이다** (`ratingSummarySchema`). 필터를 켤 때마다
    // 분포가 흔들리면 사람은 그것을 「이 필터 안에서의 분포」로 읽는다.
    expect(
      screen.getByText(copy.summaryLabel.replace('{score}', '4.4').replace('{count}', '20')),
    ).toBeVisible()
    // 말하지 않으면 그 사실은 화면이 필터를 무시한 것으로 읽힌다.
    expect(screen.getByText(copy.summaryScopeNotice)).toBeVisible()
  })

  it('says so when the filter empties the list', async () => {
    stub.state.reviews = stub.state.reviews.map((review) => ({ ...review, images: [] }))
    const user = open({ density: 2 })
    await listShown()

    await user.click(
      screen.getByRole('checkbox', { name: copy.photoOnlyLabel.replace('{count}', '2') }),
    )

    expect(await screen.findByText(copy.photoOnlyEmpty)).toBeVisible()
  })
})

describe('F1 도움돼요 · 판매자 답변 · 신고', () => {
  it('takes the answer as the next state rather than counting on screen', async () => {
    const user = open({ density: 2 })
    const [first] = await listShown()

    if (first === undefined) throw new Error('리뷰 카드가 없습니다.')

    await user.click(
      within(first).getByRole('button', { name: copy.helpfulLabel.replace('{count}', '4') }),
    )

    // 서버가 `{ helpfulCount, helpfulByMe }` 를 돌려주므로 화면이 세지 않는다 —
    // 세면 두 번 눌러도 한 번인 서버의 규칙이 화면에서 두 번이 된다.
    expect(
      await within(first).findByRole('button', {
        name: copy.helpfulPressedLabel.replace('{count}', '5'),
      }),
    ).toHaveAttribute('aria-pressed', 'true')
  })

  it('sends a signed-out visitor to sign-in, with the count still visible', async () => {
    open({ density: 2, signedIn: false })
    const [first] = await listShown()

    if (first === undefined) throw new Error('리뷰 카드가 없습니다.')

    const link = within(first).getByRole('link', {
      name: copy.helpfulSignInLabel.replace('{count}', '4'),
    })

    expect(link).toHaveAttribute('href', expect.stringContaining('/login'))
    expect(within(first).queryByRole('button', { name: /도움돼요/ })).toBeNull()
  })

  it('draws the seller reply under the review it answers', async () => {
    open({ density: 2 })
    const shown = await listShown()
    const answered = shown.find(
      (card) => within(card).queryByText(copy.replyLabel.replace('{brand}', '루미크')) !== null,
    )

    if (answered === undefined) throw new Error('답변이 달린 리뷰를 찾지 못했습니다.')
    expect(within(answered).getByText(/다음 입고 때 사이즈를/)).toBeVisible()
  })

  it('keeps the report button reachable and says it is not ready yet (TASK-0091)', async () => {
    open({ density: 2 })
    const [first] = await listShown()

    if (first === undefined) throw new Error('리뷰 카드가 없습니다.')

    const report = within(first).getByRole('button', { name: copy.reportLabel })

    // `aria-disabled` 이지 `disabled` 가 아니다 — 탭 순서에 남아야 그 옆의 「준비 중」을
    // 읽을 수 있고, `disabled` 인 버튼은 아무에게도 이유를 말하지 못한다.
    expect(report).toHaveAttribute('aria-disabled', 'true')
    expect(within(first).getByText(copy.reportComingSoon)).toBeVisible()
  })

  it('draws the photos the server gave an address for', async () => {
    open({ density: 2 })
    const [first] = await listShown()

    if (first === undefined) throw new Error('리뷰 카드가 없습니다.')

    // 주소는 서버가 만든다. 화면이 열쇠로 조립하면 저장소를 옮기는 날 모든 화면이
    // 함께 틀린다 (`reviewImageSchema`).
    expect(
      within(first).getByRole('img', { name: copy.imageAlt.replace('{index}', '1') }),
    ).toHaveAttribute('src', expect.stringContaining('/reviews/'))
  })

  it('drops the photo but keeps the review when the deployment has no storage', async () => {
    stub.state.reviews = stub.state.reviews.map((review) =>
      review.images.length === 0
        ? review
        : { ...review, images: review.images.map((image) => ({ ...image, url: null })) },
    )
    open({ density: 2 })
    const [first] = await listShown()

    if (first === undefined) throw new Error('리뷰 카드가 없습니다.')

    // 빈 `<img>` 를 그리면 깨진 그림이 뜬다. 사진만 빠지고 리뷰는 그대로 읽힌다 —
    // 사진을 못 보는 것과 리뷰를 못 읽는 것은 다른 일이다 (TASK-0011 4.5).
    expect(within(first).queryByRole('img')).toBeNull()
    expect(within(first).getByText(copy.photosPending)).toBeVisible()
    expect(within(first).getByText(/1번째 리뷰입니다/)).toBeVisible()
  })

  it('never unmasks the name the server already masked', async () => {
    open({ density: 2 })
    const [first] = await listShown()

    if (first === undefined) throw new Error('리뷰 카드가 없습니다.')
    expect(within(first).getByText('김*민')).toBeVisible()
  })
})

describe('더 보기와 실패', () => {
  it('unfolds what is already loaded before asking for another page', async () => {
    const user = open({ density: 2 })

    expect(await listShown()).toHaveLength(3)

    await user.click(screen.getByRole('button', { name: copy.moreLabel }))

    // 여섯 건을 한 번에 받아 두었고(밀도는 몇 개를 보일지만 정한다), 커서가 없으므로
    // 두 번째 요청은 나가지 않는다.
    await waitFor(() => {
      expect(cards()).toHaveLength(6)
    })
    expect(stub.listQueries).toHaveLength(1)
  })

  it('offers a retry when the list did not arrive', async () => {
    stub.state.failList = true
    const user = open({ density: 2 })

    expect(await screen.findByText(copy.errorTitle)).toBeVisible()

    stub.state.failList = false
    await user.click(screen.getByRole('button', { name: copy.retryLabel }))

    expect(await listShown()).toHaveLength(3)
  })

  it('says nothing has been written yet when the product has no reviews', async () => {
    stub.state.reviews = []
    stub.state.summary = { ...MOCK_SUMMARY, averageTimes100: 0, count: 0, photoCount: 0 }
    open({ density: 2 })

    expect(await screen.findByText(copy.emptyTitle)).toBeVisible()
  })
})
