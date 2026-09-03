/**
 * TASK-0016 F6 — a child throws and the page survives.
 *
 * React's default is to unmount the whole tree, so the assertion that matters is
 * the *sibling*: the header is still there, the navigation is still there, and
 * only the broken panel was replaced.
 *
 * React writes the caught error to `console.error` by design. It is silenced per
 * test rather than globally, so a genuinely unexpected error still shows up.
 */

import { render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setupUser } from '../../test/support/ui'
import { Button } from './button'
import { ErrorBoundary } from './error-boundary'

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

function Boom({ throws }: { readonly throws: boolean }): React.ReactElement {
  if (throws) throw new Error('Order row exploded')
  return <p>Order 20260903-0001</p>
}

describe('ErrorBoundary', () => {
  it('replaces only the broken subtree', () => {
    render(
      <div>
        <p>Seller console</p>
        <ErrorBoundary fallback={<p>This panel is unavailable</p>}>
          <Boom throws />
        </ErrorBoundary>
      </div>,
    )

    expect(screen.getByText('This panel is unavailable')).toBeVisible()
    // The rest of the page is still standing — the whole point.
    expect(screen.getByText('Seller console')).toBeVisible()
  })

  it('renders children untouched when nothing throws', () => {
    render(
      <ErrorBoundary fallback={<p>This panel is unavailable</p>}>
        <Boom throws={false} />
      </ErrorBoundary>,
    )

    expect(screen.getByText('Order 20260903-0001')).toBeVisible()
  })

  it('hands the error and a reset to a render-prop fallback', async () => {
    const user = setupUser()

    function Panel() {
      const [throws, setThrows] = useState(true)
      return (
        <ErrorBoundary
          fallback={({ error, reset }) => (
            <div>
              <p>{error.message}</p>
              <Button
                onClick={() => {
                  setThrows(false)
                  reset()
                }}
              >
                Try again
              </Button>
            </div>
          )}
        >
          <Boom throws={throws} />
        </ErrorBoundary>
      )
    }

    render(<Panel />)
    expect(screen.getByText('Order row exploded')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Try again' }))

    expect(screen.getByText('Order 20260903-0001')).toBeVisible()
  })

  it('reports the error to a monitoring hook', () => {
    const onError = vi.fn()

    render(
      <ErrorBoundary fallback={<p>unavailable</p>} onError={onError}>
        <Boom throws />
      </ErrorBoundary>,
    )

    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(Error)
  })

  it('clears itself when a reset key changes', () => {
    const { rerender } = render(
      <ErrorBoundary fallback={<p>unavailable</p>} resetKeys={['product-12']}>
        <Boom throws />
      </ErrorBoundary>,
    )

    expect(screen.getByText('unavailable')).toBeVisible()

    // Navigating to another product must not leave the previous product's
    // failure on screen.
    rerender(
      <ErrorBoundary fallback={<p>unavailable</p>} resetKeys={['product-13']}>
        <Boom throws={false} />
      </ErrorBoundary>,
    )

    expect(screen.getByText('Order 20260903-0001')).toBeVisible()
  })

  it('stays broken while the reset keys are unchanged', () => {
    const { rerender } = render(
      <ErrorBoundary fallback={<p>unavailable</p>} resetKeys={['product-12']}>
        <Boom throws />
      </ErrorBoundary>,
    )

    rerender(
      <ErrorBoundary fallback={<p>unavailable</p>} resetKeys={['product-12']}>
        <Boom throws={false} />
      </ErrorBoundary>,
    )

    expect(screen.getByText('unavailable')).toBeVisible()
  })

  it('clears when the number of reset keys changes', () => {
    const { rerender } = render(
      <ErrorBoundary fallback={<p>unavailable</p>} resetKeys={['product-12']}>
        <Boom throws />
      </ErrorBoundary>,
    )

    rerender(
      <ErrorBoundary fallback={<p>unavailable</p>} resetKeys={['product-12', 'page-2']}>
        <Boom throws={false} />
      </ErrorBoundary>,
    )

    expect(screen.getByText('Order 20260903-0001')).toBeVisible()
  })

  it('normalises a thrown non-Error', () => {
    function ThrowString(): React.ReactElement {
      // Legal JavaScript, and it reaches the boundary exactly as written. The
      // cast is the only way to write it: a string literal in a `throw` is a
      // lint error, and the case being reproduced is third-party code that does
      // it anyway.
      throw 'stringly typed failure' as unknown as Error
    }

    render(
      <ErrorBoundary fallback={({ error }) => <p>{error.message}</p>}>
        <ThrowString />
      </ErrorBoundary>,
    )

    expect(screen.getByText('stringly typed failure')).toBeVisible()
  })
})
