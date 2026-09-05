/**
 * The three states every screen can be in before it is a screen (P5), plus the
 * placeholder routes that exist so the header's links are not dead ends.
 *
 * 검색은 더 이상 여기에 없다 — TASK-0041 이 자리 표시자를 실제 화면으로 바꿨고,
 * 그 화면은 `search-page.spec.tsx` 가 검증한다.
 *
 * They are ordinary components, so they are rendered as such. What is being
 * checked is that each one says what happened in Korean the visitor can act on,
 * and that the error state hands back a real retry rather than a dead end.
 */

import { sessionBuyer } from '@shopping/api-mocks'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import CartPage from '@/app/cart/page'
import CategoryPage from '@/app/categories/[slug]/page'
import RouteError from '@/app/error'
import Loading from '@/app/loading'
import MyPage from '@/app/mypage/page'
import NotFound from '@/app/not-found'
import { messagesFor } from '@/messages'

import { renderWithAuth } from './support/auth'

const messages = messagesFor()
const states = messages.routeStates
const placeholder = messages.placeholder

describe('the loading state', () => {
  it('announces itself once and draws the rest for the eye only', () => {
    render(<Loading />)

    expect(screen.getByRole('status')).toHaveTextContent(states.loadingLabel)
  })
})

describe('the not-found state', () => {
  it('explains the address and offers the way home', () => {
    render(<NotFound />)

    expect(screen.getByText(states.notFoundTitle)).toBeVisible()
    expect(screen.getByText(states.notFoundBody)).toBeVisible()
    expect(screen.getByRole('link', { name: states.homeLabel })).toHaveAttribute('href', '/')
  })
})

describe('the error state', () => {
  it('retries the segment rather than reloading the document', async () => {
    const reset = vi.fn()
    render(<RouteError error={new Error('boom')} reset={reset} />)

    expect(screen.getByText(states.errorTitle)).toBeVisible()

    await userEvent.click(screen.getByRole('button', { name: states.retryLabel }))

    expect(reset).toHaveBeenCalledOnce()
  })
})

describe('the category placeholder', () => {
  it('is titled with the category the header linked to', async () => {
    const category = messages.layout.nav.categories[0]!

    render(await CategoryPage({ params: Promise.resolve({ slug: category.slug }) }))

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(category.label)
  })

  it('is a 404 for a slug nothing links to', async () => {
    // `notFound()` throws; letting the page invent a title from the URL instead
    // is how a placeholder turns into an accidental open redirect for text.
    await expect(
      CategoryPage({ params: Promise.resolve({ slug: 'no-such-thing' }) }),
    ).rejects.toThrow()
  })
})

describe('the cart placeholder', () => {
  it('names itself and the milestone that fills it', () => {
    render(<CartPage />)

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(placeholder.cart.title)
    expect(screen.getByText(placeholder.cart.body)).toBeVisible()
  })
})

describe('the account placeholder', () => {
  it('invites a signed-out visitor to sign in instead of showing the screen', async () => {
    renderWithAuth(<MyPage />)

    expect(await screen.findByText(messages.auth.requireSignIn.title)).toBeVisible()
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull()
  })

  it('shows the screen once somebody is signed in', async () => {
    renderWithAuth(<MyPage />, { session: sessionBuyer })

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
      placeholder.mypage.title,
    )
    expect(screen.getByText(placeholder.mypage.body)).toBeVisible()
  })

  /**
   * The state that is neither of the two above. A prompt that flashed for every
   * returning shopper would be the visible cost of collapsing three states into
   * a boolean (TASK-0023 4장).
   */
  it('shows neither while the session is still being checked', () => {
    renderWithAuth(<MyPage />, { session: sessionBuyer })

    expect(screen.getByRole('status')).toHaveAttribute(
      'aria-label',
      messages.auth.requireSignIn.checkingLabel,
    )
  })
})
