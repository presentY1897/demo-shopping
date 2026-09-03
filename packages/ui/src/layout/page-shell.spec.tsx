/**
 * The two quiet pieces of the shell.
 *
 * `PageContainer` is a class-name decision and there is little to assert about
 * it beyond "it renders what it was given as the element it was told to be" —
 * the gutter itself is a token and `test/component-tokens.spec.ts` is what keeps
 * a length out of it. `SkipLink` is the opposite: it exists entirely for the
 * keyboard, so what matters is that the keyboard reaches it (P4).
 */

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { PageContainer } from './page-container'
import { SkipLink } from './skip-link'

afterEach(cleanup)

describe('PageContainer', () => {
  it('renders as the landmark element the band asked for', () => {
    render(
      <PageContainer as="footer">
        <p>site info</p>
      </PageContainer>,
    )

    expect(screen.getByRole('contentinfo')).toBeVisible()
    expect(screen.getByText('site info')).toBeVisible()
  })
})

describe('SkipLink', () => {
  it('is the first thing the keyboard reaches, and points at the content', async () => {
    render(
      <>
        <SkipLink href="#main">skip to content</SkipLink>
        <button type="button">first header control</button>
      </>,
    )

    await userEvent.tab()

    const link = screen.getByRole('link', { name: 'skip to content' })

    expect(link).toHaveFocus()
    expect(link).toHaveAttribute('href', '#main')
  })
})
