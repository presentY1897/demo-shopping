/**
 * The three states every screen can be in before it is a screen (P5), plus the
 * placeholder routes that exist so the header's links are not dead ends.
 *
 * They are ordinary components, so they are rendered as such. What is being
 * checked is that each one says what happened in Korean the visitor can act on,
 * and that the error state hands back a real retry rather than a dead end.
 */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import CartPage from '@/app/cart/page'
import CategoryPage from '@/app/categories/[slug]/page'
import RouteError from '@/app/error'
import Loading from '@/app/loading'
import MyPage from '@/app/mypage/page'
import NotFound from '@/app/not-found'
import SearchPage from '@/app/search/page'
import { messagesFor } from '@/messages'

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

describe('the search placeholder', () => {
  it('echoes the query the header submitted', async () => {
    render(await SearchPage({ searchParams: Promise.resolve({ q: '코트' }) }))

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(placeholder.search.title)
    expect(screen.getByText('코트')).toBeVisible()
  })

  it('says nothing about a query when there was none', async () => {
    render(await SearchPage({ searchParams: Promise.resolve({}) }))

    // The label with its colon: the body copy mentions 검색어 in a sentence, and
    // a substring match on the bare word would find that instead.
    expect(screen.queryByText(`${placeholder.search.queryLabel}:`, { exact: false })).toBeNull()
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

describe('the cart and account placeholders', () => {
  it.each([
    [CartPage, placeholder.cart],
    [MyPage, placeholder.mypage],
  ])('names itself and the milestone that fills it', (Page, copy) => {
    render(<Page />)

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(copy.title)
    expect(screen.getByText(copy.body)).toBeVisible()
  })
})
