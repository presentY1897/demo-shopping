/**
 * What `ErrorNotice` promises: the number on screen is quotable, and it only
 * appears when there is something to quote.
 */

import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ErrorNotice } from './error-notice'

const REQUEST_ID = '4f3c1a90-8e2b-4c7d-9a11-4d0b7f2ea7b2'

const COPY_PROPS = {
  requestId: REQUEST_ID,
  requestIdLabel: '문의 번호',
  requestIdHint: '문의하실 때 이 번호를 알려주세요.',
  copyLabel: '복사',
  copiedLabel: '복사했어요',
} as const

/** Replaces the clipboard for one test and puts it back afterwards. */
function withClipboard(writeText: () => Promise<void>): void {
  Object.defineProperty(globalThis.navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  })
}

afterEach(() => {
  vi.useRealTimers()
  // `configurable: true` above is what makes this possible; jsdom ships no
  // clipboard, so deleting restores the original absence.
  Reflect.deleteProperty(globalThis.navigator, 'clipboard')
})

describe('ErrorNotice', () => {
  it('announces itself, because what was asked for did not happen', () => {
    render(<ErrorNotice title="일시적인 문제가 생겼어요" />)

    expect(screen.getByRole('alert')).toHaveTextContent('일시적인 문제가 생겼어요')
  })

  it('shows no reference when there is none to quote', () => {
    render(<ErrorNotice description="네트워크에 닿지 못했어요" title="문제가 생겼어요" />)

    expect(screen.queryByRole('button', { name: '복사' })).toBeNull()
    expect(screen.getByRole('alert').textContent).not.toContain('-')
  })

  it('shows the id as selectable text, not only behind a button', () => {
    render(<ErrorNotice {...COPY_PROPS} title="문제가 생겼어요" />)

    // Visible, so it can be read out loud or selected by hand when the
    // clipboard is unavailable.
    expect(screen.getByLabelText('문의 번호')).toHaveTextContent(REQUEST_ID)
  })

  it('copies the id and says so', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    withClipboard(writeText)

    render(<ErrorNotice {...COPY_PROPS} title="문제가 생겼어요" />)
    await userEvent.click(screen.getByRole('button', { name: '복사' }))

    expect(writeText).toHaveBeenCalledWith(REQUEST_ID)
    expect(await screen.findByRole('status')).toHaveTextContent('복사했어요')
  })

  it('says nothing when the clipboard refused, rather than claiming success', async () => {
    withClipboard(() => Promise.reject(new Error('denied')))

    render(<ErrorNotice {...COPY_PROPS} title="문제가 생겼어요" />)
    await userEvent.click(screen.getByRole('button', { name: '복사' }))

    expect(screen.getByRole('status')).toHaveTextContent('')
    // The id is still on screen, which is the whole point of showing it.
    expect(screen.getByLabelText('문의 번호')).toHaveTextContent(REQUEST_ID)
  })

  it('says nothing when the browser has no clipboard at all', async () => {
    render(<ErrorNotice {...COPY_PROPS} title="문제가 생겼어요" />)
    await userEvent.click(screen.getByRole('button', { name: '복사' }))

    expect(screen.getByRole('status')).toHaveTextContent('')
  })

  it('is reachable and operable from the keyboard alone (U5)', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    withClipboard(writeText)

    render(<ErrorNotice {...COPY_PROPS} title="문제가 생겼어요" />)
    await userEvent.tab()

    expect(screen.getByRole('button', { name: '복사' })).toHaveFocus()

    await userEvent.keyboard('{Enter}')

    expect(writeText).toHaveBeenCalledWith(REQUEST_ID)
  })

  it('drops the confirmation again after a moment', async () => {
    // `shouldAdvanceTime` keeps the real clock moving under the fake one, which
    // is what `userEvent`'s own internal waits need in order to resolve at all.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    withClipboard(() => Promise.resolve())

    render(<ErrorNotice {...COPY_PROPS} title="문제가 생겼어요" />)
    fireEvent.click(screen.getByRole('button', { name: '복사' }))

    expect(await screen.findByText('복사했어요')).toBeVisible()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_500)
    })

    expect(screen.getByRole('status')).toHaveTextContent('')
  })

  /**
   * P4, as far as jsdom can take it.
   *
   * There is no layout here and no stylesheet, so "does it overflow at 360px"
   * cannot be measured — `test/touch-target.spec.ts` explains the same limit and
   * takes the same way out. What *can* be pinned is the policy that makes the
   * answer no: a 36-character identifier that may not break, in a console column
   * that is 288px wide on a phone, overflows unless it is told it may. The
   * rendered result is checked in Storybook's `Narrow` story.
   */
  it('lets a long identifier break rather than pushing the panel wide', () => {
    render(<ErrorNotice {...COPY_PROPS} title="문제가 생겼어요" />)

    const id = screen.getByLabelText('문의 번호')

    expect(id.className).toContain('break-all')
    // The id and the copy button share a row; on a narrow viewport the button
    // has to be able to drop below it.
    expect(id.parentElement?.className).toContain('flex-wrap')
  })

  it('renders a caller supplied action beside the reference', () => {
    render(
      <ErrorNotice
        {...COPY_PROPS}
        action={<button type="button">다시 시도</button>}
        title="문제"
      />,
    )

    expect(screen.getByRole('button', { name: '다시 시도' })).toBeVisible()
  })
})
